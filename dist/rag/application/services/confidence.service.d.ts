import { ConfigService } from '@nestjs/config';
import { ConfidenceThresholds, ConfidenceScore, VerificationResult } from "../../domain/interfaces/confidence.interface";
import { IConfidencePort } from "../../domain/ports/confidence.port";
interface IEmbeddingPort {
    embed(text: string): Promise<number[]>;
}
interface IChatLlmPort {
    complete(prompt: string): Promise<string>;
}
export declare class ConfidenceService implements IConfidencePort {
    private readonly embeddingPort;
    private readonly chatPort;
    private readonly configService;
    private readonly logger;
    private readonly MAX_EMBED_CHARS;
    private readonly MAX_CHUNKS_TO_COMPARE;
    constructor(embeddingPort: IEmbeddingPort, chatPort: IChatLlmPort, configService: ConfigService);
    computeScore(answer: string, retrievedChunks: string[], thresholds?: Partial<ConfidenceThresholds>): Promise<ConfidenceScore>;
    verify(answer: string, retrievedChunks: string[], thresholds?: Partial<ConfidenceThresholds>): Promise<VerificationResult>;
    private llmRelevanceScore;
    private safeEmbed;
    private trimForEmbedding;
    private scoreTier;
    private resolveThresholds;
    private filterChunksByKeywords;
}
export {};
