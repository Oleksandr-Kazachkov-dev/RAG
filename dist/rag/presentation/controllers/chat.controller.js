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
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../infrastructure/prisma/prisma.service");
const api_response_1 = require("../api-response/api-response");
const meta_1 = require("../api-response/meta");
let ChatController = class ChatController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listChats() {
        const rows = await this.prisma.conversationSession.findMany({
            orderBy: { timestamp: 'desc' },
            select: {
                sessionId: true,
                query: true,
                timestamp: true,
            },
        });
        const map = new Map();
        for (const row of rows) {
            if (!map.has(row.sessionId)) {
                map.set(row.sessionId, {
                    firstQuery: row.query,
                    lastActivity: row.timestamp,
                    count: 1,
                });
            }
            else {
                map.get(row.sessionId).count++;
            }
        }
        const chats = [...map.entries()].map(([sessionId, data]) => ({
            sessionId,
            firstMessage: data.firstQuery.slice(0, 60) + (data.firstQuery.length > 60 ? '…' : ''),
            lastActivity: data.lastActivity,
            turnCount: data.count,
        }));
        return api_response_1.ApiResponse.success(chats, new meta_1.Meta({ message: 'Chats retrieved', count: chats.length }));
    }
    async getChat(sessionId, limit) {
        const take = limit ? parseInt(limit, 10) : 100;
        const rows = await this.prisma.conversationSession.findMany({
            where: { sessionId },
            orderBy: { timestamp: 'asc' },
            take,
            select: { id: true, query: true, answer: true, timestamp: true },
        });
        return api_response_1.ApiResponse.success({ sessionId, turns: rows }, new meta_1.Meta({ message: 'Chat retrieved', count: rows.length }));
    }
    async deleteChat(sessionId) {
        await this.prisma.conversationSession.deleteMany({ where: { sessionId } });
        return api_response_1.ApiResponse.success(null, new meta_1.Meta({ message: 'Chat deleted' }));
    }
    async clearAllChats() {
        await this.prisma.conversationSession.deleteMany({});
        return api_response_1.ApiResponse.success(null, new meta_1.Meta({ message: 'All chats deleted' }));
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "listChats", null);
__decorate([
    (0, common_1.Get)(':sessionId'),
    __param(0, (0, common_1.Param)('sessionId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getChat", null);
__decorate([
    (0, common_1.Delete)(':sessionId'),
    __param(0, (0, common_1.Param)('sessionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "deleteChat", null);
__decorate([
    (0, common_1.Delete)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "clearAllChats", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)('rag/chats'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map