import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import { QdrantCollectionConfigMapper } from './mappers/qdrant-collection-config.mapper';
import { CollectionConfig } from 'src/rag/domain/value-objects/collection-config.vo';
import { TRagConfig, RAG_CONFIG } from '../config/rag-config';

export type SearchMode = 'precise' | 'wide' | 'balanced';

const EF_BY_MODE: Record<SearchMode, number> = {
  precise: 256,
  balanced: 256,
  wide: 256,
};

const DEFAULT_SCORE_THRESHOLD_BY_MODE: Record<SearchMode, number> = {
  precise: 0.75,
  balanced: 0.65,
  wide: 0.50,
};

@Injectable()
export class RagQdrantService {
  private readonly client: QdrantClient;

  constructor(private readonly configService: ConfigService) {
    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);
    this.client = new QdrantClient({
      url: ragConfig?.qdrantUrl,
      apiKey: ragConfig?.qdrantApiKey
    });
  }

  async ensureCollectionWithConfig(config: CollectionConfig): Promise<void> {
    const existing = await this.client.getCollections();
    if (existing.collections.some((c) => c.name === config.name)) return;

    const qdrantConfig = QdrantCollectionConfigMapper.toQdrantConfig(config);
    await this.client.createCollection(config.name, qdrantConfig);
  }

  async createPayloadIndex(
    collectionName: string,
    fieldName: string,
    fieldType: 'text' | 'keyword' | 'integer' | 'float' | 'bool' | 'geo',
  ): Promise<void> {
    try {
      await this.client.createPayloadIndex(collectionName, {
        field_name: fieldName,
        field_schema: fieldType,
      });
    } catch (err) {
      const msg =
        err?.data?.status?.error ??
        err?.response?.data?.status?.error ??
        err?.message ??
        '';
      const alreadyExists =
        msg.toLowerCase().includes('already exists') ||
        msg.toLowerCase().includes('field already exists');
      if (!alreadyExists) throw err;
    }
  }

  async upsert(
    collectionName: string,
    points: unknown[],
  ): Promise<Schemas['UpdateResult']> {
    return this.client.upsert(collectionName, { points: points as any });
  }

  async search(
    collectionName: string,
    params: {
      vector: number[];
      limit: number;
      filter?: unknown;
      score_threshold?: number | null;
      params?: Record<string, unknown>;
      searchMode?: SearchMode;
    },
  ): Promise<Array<Schemas['ScoredPoint']>> {
    const mode: SearchMode = params.searchMode ?? 'balanced';
    const ef = EF_BY_MODE[mode];

    const scoreThreshold: number | undefined =
      params.score_threshold === null
        ? undefined
        : params.score_threshold !== undefined
          ? params.score_threshold
          : DEFAULT_SCORE_THRESHOLD_BY_MODE[mode];

    return this.client.search(collectionName, {
      vector: params.vector,
      limit: params.limit,
      filter: params.filter as any,
      score_threshold: scoreThreshold,
      params: {
        hnsw_ef: ef,
        exact: false,
        ...(params.params ?? {}),
      },
    });
  }

  async scroll(
    collectionName: string,
    params: { limit: number; filter?: unknown; with_payload?: boolean },
  ): Promise<Schemas['ScrollResult']> {
    return this.client.scroll(collectionName, {
      limit: params.limit,
      filter: params.filter,
      with_payload: params.with_payload ?? true,
      with_vector: false,
    } as any);
  }

  async getPoints(
    collectionName: string,
    ids: (string | number)[],
  ): Promise<Schemas['Record'][]> {
    const result = await this.client.retrieve(collectionName, {
      ids,
      with_payload: true,
      with_vector: false,
    });
    return result as Schemas['Record'][];
  }

  async deletePoints(
    collectionName: string,
    ids: (string | number)[],
  ): Promise<Schemas['UpdateResult']> {
    return this.client.delete(collectionName, { points: ids });
  }
}