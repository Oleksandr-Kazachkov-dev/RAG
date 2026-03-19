import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagQdrantService, SearchMode } from '../rag-qdrant.service';
import { RAG_CONFIG, TRagConfig } from '../../config/rag-config';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import { TextDocumentQdrantMapper } from '../../mappers/text-document.qdrant.mapper';
import { TextDocument } from 'src/rag/domain/entities/text-document.entity';
import { ITextDocumentRepository } from 'src/rag/domain/repositories/text-document.repository';
import { CollectionConfig } from 'src/rag/domain/value-objects/collection-config.vo';
import { Embedding } from 'src/rag/domain/value-objects/embedding.vo';

@Injectable()
export class QdrantTextDocumentRepository
  implements ITextDocumentRepository, OnModuleInit
{
  private readonly collectionConfig: CollectionConfig;

  constructor(
    private readonly qdrant: RagQdrantService,
    private readonly configService: ConfigService,
    @Inject('LoggerPort') private readonly logger: LoggerPort,
  ) {
    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);
    const vectorSize = ragConfig?.textRagVectorSize || 768;
    const hnswConfig = ragConfig?.textRagHnswConfig;

    this.collectionConfig = new CollectionConfig(
      ragConfig?.textRagCollectionName || 'rag_text',
      vectorSize,
      'Cosine',
      hnswConfig
        ? { m: hnswConfig.m, efConstruct: hnswConfig.efConstruct, efSearch: hnswConfig.efSearch }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.qdrant.ensureCollectionWithConfig(this.collectionConfig);

    await Promise.all([
      this.qdrant.createPayloadIndex(this.collectionConfig.name, 'text',            'text'),
      this.qdrant.createPayloadIndex(this.collectionConfig.name, 'contextKeywords', 'keyword'),
      this.qdrant.createPayloadIndex(this.collectionConfig.name, 'level',           'integer'),
      this.qdrant.createPayloadIndex(this.collectionConfig.name, 'parentId',        'keyword'),
      this.qdrant.createPayloadIndex(this.collectionConfig.name, 'textLength',      'integer'),
    ]);

    this.logger.log(
      `Qdrant text collection "${this.collectionConfig.name}" ready (indexes ensured)`,
    );
  }

  async saveMany(documents: TextDocument[]): Promise<void> {
    if (!documents.length) return;

    const EXPECTED_DIM = this.collectionConfig.vectorSize;

    const points = documents
      .map(doc => {
        const point = TextDocumentQdrantMapper.toPoint(doc);
        (point.payload as any).textLength = (point.payload).text?.length ?? 0;
        return point;
      })
      .filter(p => {
        const valid =
          Array.isArray(p.vector) &&
          p.vector.length === EXPECTED_DIM &&
          p.vector.every(v => typeof v === 'number' && Number.isFinite(v));

        if (!valid) {
          this.logger.warn('[QDRANT] Invalid vector, skipping', {
            id: p.id,
            vectorLength: p.vector?.length,
          });
        }
        return valid;
      });

    if (!points.length) {
      throw new Error('[QDRANT] No valid vectors to upsert (all embeddings are empty or invalid)');
    }

    const BATCH_SIZE = 64;
    const MAX_RETRIES = 3;

    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      let attempt = 0;

      while (true) {
        try {
          await this.qdrant.upsert(this.collectionConfig.name, batch);
          break;
        } catch (err) {
          attempt++;

          if (err?.data?.status?.error?.includes('Vector dimension error')) {
            this.logger.error('[QDRANT] Vector dimension mismatch', {
              batchFrom: i, batchTo: i + batch.length,
              error: err.data.status.error,
            });
            throw err;
          }

          if (attempt > MAX_RETRIES) {
            this.logger.error(
              `[QDRANT] Upsert failed after ${MAX_RETRIES} retries (batch ${i}–${i + batch.length})`,
              err,
            );
            throw err;
          }

          this.logger.warn(`[QDRANT] Upsert attempt ${attempt}/${MAX_RETRIES} failed. Retrying…`);
          await new Promise(r => setTimeout(r, 1_000 * attempt));
        }
      }
    }
  }

  async findByEmbedding(
    embedding: Embedding,
    limit: number,
    options?: {
      scoreThreshold?: number;
      onlyChildren?: boolean;
      searchMode?: SearchMode;
      filter?: object;
    },
  ): Promise<TextDocument[]> {
    const filter = this.buildFilter(options?.onlyChildren, options?.filter);

    const results = await this.qdrant.search(this.collectionConfig.name, {
      vector: embedding.values,
      limit,
      searchMode: options?.searchMode ?? 'balanced',
      ...(options?.scoreThreshold !== undefined
        ? { score_threshold: options.scoreThreshold }
        : {}),
      ...(filter ? { filter } : {}),
    });

    return results
      .filter(r => !!r.payload && typeof (r.payload).model !== 'undefined')
      .map(r =>
        TextDocumentQdrantMapper.fromPoint(
          r,
          String((r.payload as { model?: unknown }).model),
        ),
      );
  }

  async findAll(limit = 1_000): Promise<TextDocument[]> {
    const { documents } = await this.findAllPaginated(limit);
    return documents;
  }

  async findAllPaginated(
    limit = 100,
    offset?: string,
  ): Promise<{ documents: TextDocument[]; nextOffset?: string }> {
    const results = await this.qdrant.scroll(this.collectionConfig.name, {
      limit,
      offset,
    });
    const points = results.points || [];

    const documents = points
      .filter(p => !!p.payload && typeof (p.payload as any).model !== 'undefined')
      .map(p =>
        TextDocumentQdrantMapper.fromPoint(
          p,
          String((p.payload as { model?: unknown }).model),
        ),
      );

    return {
      documents,
      nextOffset: results.next_page_offset?.toString(),
    };
  }

  async deleteById(id: string): Promise<void> {
    await this.qdrant.deletePoints(this.collectionConfig.name, [id]);
  }

  private buildFilter(onlyChildren?: boolean, extra?: object): object | undefined {
    const conditions: object[] = [];

    if (onlyChildren) {
      conditions.push({
        should: [
          { key: 'level', match: { value: 1 } },
          { key: 'level', is_null: true },
        ],
      });
    }

    conditions.push({
      key:   'textLength',
      range: { gte: 80 },
    });

    if (extra) conditions.push(extra);

    if (!conditions.length) return undefined;
    return conditions.length === 1 ? conditions[0] : { must: conditions };
  }
}