import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IImageDocumentRepository } from '../../../domain/repositories/image-document.repository';
import { ImageDocument } from '../../../domain/entities/image-document.entity';
import { Embedding } from '../../../domain/value-objects/embedding.vo';
import { RagQdrantService } from '../rag-qdrant.service';
import { LoggerPort } from "../../../shared/application/ports/logger.port";
export declare class QdrantImageDocumentRepository implements IImageDocumentRepository, OnModuleInit {
    private readonly qdrant;
    private readonly configService;
    private readonly logger;
    private readonly collectionConfig;
    constructor(qdrant: RagQdrantService, configService: ConfigService, logger: LoggerPort);
    onModuleInit(): Promise<void>;
    save(document: ImageDocument): Promise<void>;
    saveMany(documents: ImageDocument[]): Promise<void>;
    findByEmbedding(embedding: Embedding, limit: number): Promise<Array<ImageDocument>>;
    findAll(limit?: number): Promise<Array<ImageDocument>>;
    deleteById(id: string): Promise<void>;
    findById(id: string): Promise<ImageDocument | null>;
}
