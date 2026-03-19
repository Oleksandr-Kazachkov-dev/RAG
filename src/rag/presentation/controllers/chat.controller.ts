import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApiResponse } from '../api-response/api-response';
import { Meta } from '../api-response/meta';

export interface ChatTurn {
  id: string;
  query: string;
  answer: string;
  timestamp: Date;
}

export interface ChatSummary {
  sessionId: string;
  firstMessage: string;
  lastActivity: Date;
  turnCount: number;
}

export interface ChatDetail {
  sessionId: string;
  turns: ChatTurn[];
}

@Controller('rag/chats')
export class ChatController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listChats(): Promise<ApiResponse<ChatSummary[]>> {
    const rows = await this.prisma.conversationSession.findMany({
      orderBy: { timestamp: 'desc' },
      select: {
        sessionId: true,
        query: true,
        timestamp: true,
      },
    });

    const map = new Map<string, { firstQuery: string; lastActivity: Date; count: number }>();
    for (const row of rows) {
      if (!map.has(row.sessionId)) {
        map.set(row.sessionId, {
          firstQuery: row.query,
          lastActivity: row.timestamp,
          count: 1,
        });
      } else {
        map.get(row.sessionId)!.count++;
      }
    }

    const chats: ChatSummary[] = [...map.entries()].map(([sessionId, data]) => ({
      sessionId,
      firstMessage: data.firstQuery.slice(0, 60) + (data.firstQuery.length > 60 ? '…' : ''),
      lastActivity: data.lastActivity,
      turnCount: data.count,
    }));

    return ApiResponse.success(
      chats,
      new Meta({ message: 'Chats retrieved', count: chats.length }),
    );
  }

  @Get(':sessionId')
  async getChat(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<ChatDetail>> {
    const take = limit ? parseInt(limit, 10) : 100;

    const rows = await this.prisma.conversationSession.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
      take,
      select: { id: true, query: true, answer: true, timestamp: true },
    });

    return ApiResponse.success(
      { sessionId, turns: rows },
      new Meta({ message: 'Chat retrieved', count: rows.length }),
    );
  }

  @Delete(':sessionId')
  async deleteChat(@Param('sessionId') sessionId: string): Promise<ApiResponse<null>> {
    await this.prisma.conversationSession.deleteMany({ where: { sessionId } });
    return ApiResponse.success(null, new Meta({ message: 'Chat deleted' }));
  }

  @Delete()
  async clearAllChats(): Promise<ApiResponse<null>> {
    await this.prisma.conversationSession.deleteMany({});
    return ApiResponse.success(null, new Meta({ message: 'All chats deleted' }));
  }
}