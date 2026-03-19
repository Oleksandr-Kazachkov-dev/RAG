import { ConfigService } from '@nestjs/config';
import { Schemas } from '@qdrant/js-client-rest';
import { CollectionConfig } from 'src/rag/domain/value-objects/collection-config.vo';
export type SearchMode = 'precise' | 'wide' | 'balanced';
export declare class RagQdrantService {
    private readonly configService;
    private readonly client;
    constructor(configService: ConfigService);
    ensureCollectionWithConfig(config: CollectionConfig): Promise<void>;
    createPayloadIndex(collectionName: string, fieldName: string, fieldType: 'text' | 'keyword' | 'integer' | 'float' | 'bool' | 'geo'): Promise<void>;
    upsert(collectionName: string, points: unknown[]): Promise<Schemas['UpdateResult']>;
    search(collectionName: string, params: {
        vector: number[];
        limit: number;
        filter?: unknown;
        score_threshold?: number | null;
        params?: Record<string, unknown>;
        searchMode?: SearchMode;
        with_vector?: boolean;
    }): Promise<Array<Schemas['ScoredPoint']>>;
    scroll(collectionName: string, params: {
        limit: number;
        offset?: string | number;
        filter?: unknown;
        with_payload?: boolean;
    }): Promise<Schemas['ScrollResult']>;
    getPoints(collectionName: string, ids: (string | number)[]): Promise<Schemas['Record'][]>;
    deletePoints(collectionName: string, ids: (string | number)[]): Promise<Schemas['UpdateResult']>;
}
