import { OllamaService } from '../../infrastructure/ollama/ollama.service';
export interface RerankedResult<T> {
    id?: string;
    text?: string;
    score?: number;
    item: T;
    originalScore: number;
    rerankScore: number;
    finalScore: number;
}
export interface RerankableItem {
    text: string;
    score?: number;
    vector?: number[];
}
export declare class Reranker {
    private readonly ollamaService;
    constructor(ollamaService: OllamaService);
    rerank<T extends RerankableItem>(query: string, results: T[], options?: {
        topK?: number;
        method?: 'llm' | 'embedding' | 'hybrid' | 'listwise';
    }): Promise<RerankedResult<T>[]>;
    private listwiseLlmRerank;
    private llmRerank;
    private embeddingRerank;
    private hybridRerank;
    private cosineSimilarity;
}
