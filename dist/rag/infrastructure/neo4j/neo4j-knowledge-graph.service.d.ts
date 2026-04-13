import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerPort } from "../../shared/application/ports/logger.port";
export interface KnowledgeGraphEntity {
    id: string;
    name: string;
    type: string;
    sourceDocument: string;
    properties?: Record<string, any>;
}
export interface KnowledgeGraphRelationship {
    id: string;
    fromEntityId: string;
    toEntityId: string;
    type: string;
    properties?: Record<string, any>;
}
export interface IKnowledgeGraphService {
    getGraphStats(): Promise<{
        totalEntities: number;
        totalRelationships: number;
        entityTypes: Record<string, number>;
    }>;
    addEntity(entity: KnowledgeGraphEntity): Promise<void>;
    addRelationship(relationship: KnowledgeGraphRelationship): Promise<void>;
    queryEntities(query: string): Promise<KnowledgeGraphEntity[]>;
    getEntityById(id: string): Promise<KnowledgeGraphEntity | null>;
    getRelatedEntities(entityId: string, depth?: number): Promise<KnowledgeGraphEntity[]>;
    deleteEntity(id: string): Promise<void>;
    clearGraph(): Promise<void>;
}
export declare class Neo4jKnowledgeGraphService implements IKnowledgeGraphService, OnModuleInit, OnModuleDestroy {
    private readonly configService;
    private readonly logger;
    private driver;
    private isEnabled;
    constructor(configService: ConfigService, logger: LoggerPort);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    addEntity(entity: KnowledgeGraphEntity): Promise<void>;
    addRelationship(rel: KnowledgeGraphRelationship): Promise<void>;
    queryEntities(query: string): Promise<KnowledgeGraphEntity[]>;
    getEntityById(id: string): Promise<KnowledgeGraphEntity | null>;
    getRelatedEntities(entityId: string, depth?: number): Promise<KnowledgeGraphEntity[]>;
    deleteEntity(id: string): Promise<void>;
    clearGraph(): Promise<void>;
    getGraphStats(): Promise<any>;
}
