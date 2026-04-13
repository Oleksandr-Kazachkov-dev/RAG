import { IKnowledgeLink, IKnowledgeLinkRepository } from "../interfaces/knowledge-link.interface";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
export declare class KnowledgeLinkPrismaRepository implements IKnowledgeLinkRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    upsertMany(links: Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<number>;
    findByKeywords(keywords: string[]): Promise<IKnowledgeLink[]>;
    findAll(): Promise<IKnowledgeLink[]>;
    deleteBySourceFile(sourceFile: string): Promise<void>;
    private toInterface;
}
