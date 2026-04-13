import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagQdrantService, SearchMode } from '../rag-qdrant.service';
import { LoggerPort } from "../../../shared/application/ports/logger.port";
import { TextDocument } from "../../../domain/entities/text-document.entity";
import { ITextDocumentRepository } from "../../../domain/repositories/text-document.repository";
import { Embedding } from "../../../domain/value-objects/embedding.vo";
export declare class QdrantTextDocumentRepository implements ITextDocumentRepository, OnModuleInit {
    private readonly qdrant;
    private readonly configService;
    private readonly logger;
    private readonly collectionConfig;
    constructor(qdrant: RagQdrantService, configService: ConfigService, logger: LoggerPort);
    onModuleInit(): Promise<void>;
    saveMany(documents: TextDocument[]): Promise<void>;
    findByEmbedding(embedding: Embedding, limit: number, options?: {
        scoreThreshold?: number;
        onlyChildren?: boolean;
        searchMode?: SearchMode;
        filter?: object;
    }): Promise<TextDocument[]>;
    findAll(limit?: number): Promise<TextDocument[]>;
    findAllPaginated(limit?: number, offset?: string): Promise<{
        documents: TextDocument[];
        nextOffset?: string;
    }>;
    deleteById(id: string): Promise<void>;
    private buildFilter;
}
