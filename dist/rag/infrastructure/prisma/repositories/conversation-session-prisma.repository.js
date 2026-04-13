"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationSessionPrismaRepository = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const prisma_service_1 = require("../prisma.service");
const uuid_1 = require("uuid");
const HISTORY_TTL_SECONDS = 60 * 60 * 24;
let ConversationSessionPrismaRepository = class ConversationSessionPrismaRepository {
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    async addTurn(sessionId, query, answer, embedding) {
        await this.prisma.conversationSession.create({
            data: {
                id: (0, uuid_1.v4)(),
                sessionId,
                query,
                answer,
                embedding: embedding ?? [],
                timestamp: new Date(),
            },
        });
        await this.pruneOldTurns(sessionId, 50);
        await this.bustSessionCache(sessionId);
    }
    async getHistory(sessionId, maxTurns = 5) {
        const cacheKey = `session:${sessionId}:history:${maxTurns}`;
        try {
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.map(t => ({ ...t, timestamp: new Date(t.timestamp) }));
            }
        }
        catch (err) {
        }
        const sessions = await this.prisma.conversationSession.findMany({
            where: { sessionId },
            orderBy: { timestamp: 'desc' },
            take: maxTurns,
        });
        const turns = sessions
            .reverse()
            .map((s) => ({
            query: s.query,
            answer: s.answer,
            timestamp: s.timestamp,
            embedding: s.embedding.length > 0 ? s.embedding : undefined,
        }));
        try {
            await this.redis.set(cacheKey, JSON.stringify(turns), 'EX', HISTORY_TTL_SECONDS);
        }
        catch { }
        return turns;
    }
    async clearSession(sessionId) {
        await this.prisma.conversationSession.deleteMany({ where: { sessionId } });
        await this.bustSessionCache(sessionId);
    }
    async deleteOldSessions(beforeDate) {
        const result = await this.prisma.conversationSession.deleteMany({
            where: { timestamp: { lte: beforeDate } },
        });
        return result.count;
    }
    async getSessionCount(sessionId) {
        return this.prisma.conversationSession.count({ where: { sessionId } });
    }
    async pruneOldTurns(sessionId, keepLast) {
        const count = await this.getSessionCount(sessionId);
        if (count <= keepLast)
            return;
        const oldest = await this.prisma.conversationSession.findMany({
            where: { sessionId },
            orderBy: { timestamp: 'asc' },
            take: count - keepLast,
            select: { id: true },
        });
        await this.prisma.conversationSession.deleteMany({
            where: { id: { in: oldest.map((s) => s.id) } },
        });
    }
    async bustSessionCache(sessionId) {
        try {
            const pattern = `rag:session:${sessionId}:history:*`;
            let cursor = '0';
            do {
                const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 50);
                cursor = next;
                if (keys.length)
                    await this.redis.del(...keys);
            } while (cursor !== '0');
        }
        catch { }
    }
};
exports.ConversationSessionPrismaRepository = ConversationSessionPrismaRepository;
exports.ConversationSessionPrismaRepository = ConversationSessionPrismaRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)('REDIS_CLIENT')),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ioredis_1.default])
], ConversationSessionPrismaRepository);
//# sourceMappingURL=conversation-session-prisma.repository.js.map