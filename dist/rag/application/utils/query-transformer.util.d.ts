import { OllamaService } from '../../infrastructure/ollama/ollama.service';
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
    constructor(ollamaService: OllamaService);
    transformQuery(query: string): Promise<TransformedQuery>;
    private expandQuery;
    private rephraseQuery;
    private extractKeywords;
}
