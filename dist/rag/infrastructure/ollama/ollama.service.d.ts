import { ConfigService } from '@nestjs/config';
import { Redis } from "@upstash/redis";
import { LoggerPort } from "../../shared/application/ports/logger.port";
export interface LLMOptions {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    stop?: string[];
    systemPrompt?: string;
    repeatPenalty?: number;
    seed?: number;
}
export declare class OllamaService {
    private readonly configService;
    private readonly logger;
    private readonly redis;
    private readonly baseURL;
    private readonly apiKey?;
    private readonly textEmbedModel;
    private readonly chatModel;
    private readonly visionModel;
    private readonly timeout;
    private readonly visionTimeout;
    constructor(configService: ConfigService, logger: LoggerPort, redis: Redis);
    private getHeaders;
    embed(prompt: string): Promise<number[] | null>;
    extractKeywords(text: string): Promise<string[]>;
    getRagResponseByPrompt(prompt: string, options?: LLMOptions): Promise<string>;
    getRagResponseByPromptStream(prompt: string, options?: LLMOptions): AsyncGenerator<string>;
    describeImage(file: Express.Multer.File): Promise<string>;
    healthCheck(): Promise<boolean>;
    listModels(): Promise<string[]>;
    private getErrorMessage;
}
