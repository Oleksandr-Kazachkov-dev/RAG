import { RagQdrantService, SearchMode } from '../../infrastructure/qdrant/rag-qdrant.service';
import { Embedding } from '../../domain/value-objects/embedding.vo';
import { ConfigService } from '@nestjs/config';
export interface HybridSearchResult {
    id: string;
    text: string;
    parentText?: string;
    parentId?: string;
    vectorScore: number;
    keywordScore: number;
    hybridScore: number;
    vector?: number[];
}
export declare class HybridSearchEngine {
    private readonly qdrantService;
    private readonly configService;
    constructor(qdrantService: RagQdrantService, configService: ConfigService);
    search(collectionName: string, queryEmbedding: Embedding, keywords: string[], limit?: number, options?: {
        vectorWeight?: number;
        keywordWeight?: number;
        minKeywordMatch?: number;
        searchMode?: SearchMode | 'entity';
        scoreThreshold?: number;
        minTextLength?: number;
    }): Promise<HybridSearchResult[] | null>;
}
