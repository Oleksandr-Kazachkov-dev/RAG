import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  IConversationSessionRepository,
  ConversationTurn,
} from 'src/rag/domain/ports/conversation-session.repository.port';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ConversationSessionPrismaRepository
  implements IConversationSessionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async addTurn(
    sessionId: string,
    query: string,
    answer: string,
    embedding?: number[],
  ): Promise<void> {
    await this.prisma.conversationSession.create({
      data: {
        id: uuidv4(),
        sessionId,
        query,
        answer,
        embedding: embedding ?? [],
        timestamp: new Date(),
      },
    });

    await this.pruneOldTurns(sessionId, 50);
  }

  async getHistory(sessionId: string, maxTurns = 5): Promise<ConversationTurn[]> {
    const sessions = await this.prisma.conversationSession.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'desc' },
      take: maxTurns,
    });

    return sessions
      .reverse()
      .map((s: { query: string, answer: string, timestamp: Date, embedding: Array<number> }) => ({
        query: s.query,
        answer: s.answer,
        timestamp: s.timestamp,
        embedding: s.embedding.length > 0 ? s.embedding : undefined,
      }));
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.prisma.conversationSession.deleteMany({
      where: { sessionId },
    });
  }

  async deleteOldSessions(beforeDate: Date): Promise<number> {
    const result = await this.prisma.conversationSession.deleteMany({
      where: { timestamp: { lte: beforeDate } },
    });
    return result.count;
  }

  async getSessionCount(sessionId: string): Promise<number> {
    return this.prisma.conversationSession.count({
      where: { sessionId },
    });
  }

  private async pruneOldTurns(sessionId: string, keepLast: number): Promise<void> {
    const count = await this.getSessionCount(sessionId);
    if (count <= keepLast) return;

    const oldest = await this.prisma.conversationSession.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      take: count - keepLast,
      select: { id: true },
    });

    await this.prisma.conversationSession.deleteMany({
      where: { id: { in: oldest.map((s: { id: string }) => s.id) } },
    });
  }
}