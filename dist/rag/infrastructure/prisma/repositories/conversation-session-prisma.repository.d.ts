import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { IConversationSessionRepository, ConversationTurn } from "../../../domain/ports/conversation-session.repository.port";
export declare class ConversationSessionPrismaRepository implements IConversationSessionRepository {
    private readonly prisma;
    private readonly redis;
    constructor(prisma: PrismaService, redis: Redis);
    addTurn(sessionId: string, query: string, answer: string, embedding?: number[]): Promise<void>;
    getHistory(sessionId: string, maxTurns?: number): Promise<ConversationTurn[]>;
    clearSession(sessionId: string): Promise<void>;
    deleteOldSessions(beforeDate: Date): Promise<number>;
    getSessionCount(sessionId: string): Promise<number>;
    private pruneOldTurns;
    private bustSessionCache;
}
