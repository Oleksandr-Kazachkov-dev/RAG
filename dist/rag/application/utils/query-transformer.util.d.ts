import { OllamaService } from '../../infrastructure/ollama/ollama.service';
import { Redis } from "@upstash/redis";
export interface TransformedQuery {
    original: string;
    expanded: string[];
    rephrased: string[];
    keywords: string[];
    isEntityQuery: boolean;
}
export declare function translateQueryToUkrainian(query: string): string[];
export declare class QueryTransformer {
    private readonly ollamaService;
    private readonly redis?;
    constructor(ollamaService: OllamaService, redis?: Redis | undefined);
    transformQuery(query: string): Promise<TransformedQuery>;
    private expandQuery;
    private rephraseQuery;
    private extractKeywords;
}
