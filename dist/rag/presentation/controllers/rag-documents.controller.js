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
exports.RagDocumentsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const ask_question_command_1 = require("../../application/commands/ask-question.command");
const ask_question_handler_1 = require("../../application/handlers/ask-question.handler");
const upload_knowledge_command_1 = require("../../application/commands/upload-knowledge.command");
const delete_document_command_1 = require("../../application/commands/delete-document.command");
const rag_queries_1 = require("../../application/queries/rag.queries");
const api_response_1 = require("../api-response/api-response");
const meta_1 = require("../api-response/meta");
const ask_dto_1 = require("../dto/ask.dto");
const upload_folder_command_1 = require("../../application/commands/upload-folder.command");
const retrieve_dto_1 = require("../dto/retrieve.dto");
const upload_folder_dto_1 = require("../dto/upload-folder.dto");
let RagDocumentsController = class RagDocumentsController {
    constructor(commandBus, askQuestionHandler) {
        this.commandBus = commandBus;
        this.askQuestionHandler = askQuestionHandler;
    }
    async askQuestion(dto) {
        const command = new ask_question_command_1.AskQuestionCommand(dto.question, {
            limit: dto.limit,
            scoreThreshold: dto.scoreThreshold,
            useHybridSearch: dto.options?.useHybridSearch,
            useReranking: dto.options?.useReranking,
            rerankStrategy: dto.rerankStrategy,
            useQueryTransformation: dto.options?.useQueryTransformation,
            useContextualCompression: dto.options?.useContextualCompression,
            useConversationMemory: dto.options?.useConversationMemory,
            useCitationTracking: dto.options?.useCitationTracking,
            useKnowledgeGraph: dto.options?.useKnowledgeGraph,
            temperature: dto.temperature,
            topP: dto.topP,
            topK: dto.topK,
            maxTokens: dto.maxTokens,
            includeSources: dto.includeSources,
            sessionId: dto.options?.sessionId,
            conversationHistory: dto.conversationHistory,
        });
        const answer = await this.commandBus.execute(command);
        return api_response_1.ApiResponse.success(answer, new meta_1.Meta({ message: 'Answer generated successfully' }));
    }
    async askQuestionStream(dto, res) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Content-Encoding', 'none');
        res.flushHeaders();
        res.socket?.setNoDelay(true);
        const command = new ask_question_command_1.AskQuestionCommand(dto.question, {
            limit: dto.limit,
            scoreThreshold: dto.scoreThreshold,
            useHybridSearch: dto.options?.useHybridSearch,
            useReranking: dto.options?.useReranking,
            rerankStrategy: dto.rerankStrategy,
            useQueryTransformation: dto.options?.useQueryTransformation,
            useContextualCompression: dto.options?.useContextualCompression,
            useConversationMemory: dto.options?.useConversationMemory,
            useCitationTracking: dto.options?.useCitationTracking,
            useKnowledgeGraph: dto.options?.useKnowledgeGraph,
            temperature: dto.temperature,
            topP: dto.topP,
            topK: dto.topK,
            maxTokens: dto.maxTokens,
            includeSources: dto.includeSources,
            sessionId: dto.options?.sessionId,
            conversationHistory: dto.conversationHistory,
        });
        const writeChunk = (chunk, eventName) => {
            res.write(`event: ${eventName}\ndata: ${JSON.stringify(chunk)}\n\n`);
            res.flush?.();
        };
        try {
            for await (const chunk of this.askQuestionHandler.streamableExecute(command)) {
                writeChunk(chunk, chunk.event);
                if (chunk.event === 'done' || chunk.event === 'error')
                    break;
            }
        }
        catch (err) {
            writeChunk({ event: 'error', error: err.message }, 'error');
        }
        finally {
            res.end();
        }
    }
    async uploadFile(file, chunkingStrategy, enableKnowledgeGraph) {
        const domainFile = {
            buffer: file.buffer,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            destination: file.destination,
            filename: file.filename,
            path: file.path,
            fieldname: file.fieldname,
            encoding: file.encoding,
            stream: file.stream,
        };
        const result = await this.commandBus.execute(new upload_knowledge_command_1.UploadKnowledgeCommand(domainFile, {
            chunkingStrategy: chunkingStrategy ?? 'simple',
            enableKnowledgeGraph: enableKnowledgeGraph === 'true',
        }));
        return api_response_1.ApiResponse.success(result, new meta_1.Meta({
            message: `Document uploaded successfully with ${chunkingStrategy ?? 'simple'} chunking.`,
        }));
    }
    async getAllDocuments() {
        const documents = await this.commandBus.execute(new rag_queries_1.GetAllDocumentsQuery());
        return api_response_1.ApiResponse.success(documents, new meta_1.Meta({ message: 'Documents retrieved successfully', count: documents.length }));
    }
    async deleteDocument(id) {
        await this.commandBus.execute(new delete_document_command_1.DeleteDocumentCommand(id));
        return api_response_1.ApiResponse.success(null, new meta_1.Meta({ message: 'Document deleted successfully' }));
    }
    async uploadFolder(files, dto) {
        const mdFiles = files.filter((f) => f.originalname.toLowerCase().endsWith('.md'));
        if (mdFiles.length === 0) {
            return api_response_1.ApiResponse.error('No markdown files found in upload');
        }
        const domainFiles = mdFiles.map((f) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            encoding: f.encoding,
            mimetype: f.mimetype,
            size: f.size,
            destination: f.destination ?? '',
            filename: f.filename ?? '',
            path: f.path ?? '',
            buffer: f.buffer,
            stream: f.stream,
        }));
        const result = await this.commandBus.execute(new upload_folder_command_1.UploadFolderCommand(domainFiles, {
            chunkingStrategy: dto.chunkingStrategy ?? 'simple',
            enableKnowledgeGraph: dto.enableKnowledgeGraph === 'true',
        }));
        return api_response_1.ApiResponse.success(result, new meta_1.Meta({
            message: `Processed ${result.filesProcessed} files with ${dto.chunkingStrategy ?? 'simple'} chunking.`,
        }));
    }
    async retrieve(dto) {
        const results = await this.commandBus.execute(new rag_queries_1.RetrieveDocumentsQuery(dto.query, dto.options?.limit, dto.options));
        return api_response_1.ApiResponse.success(results, new meta_1.Meta({ message: `Retrieved ${results.length} relevant documents` }));
    }
};
exports.RagDocumentsController = RagDocumentsController;
__decorate([
    (0, common_1.Post)('ask'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ask_dto_1.AskDto]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "askQuestion", null);
__decorate([
    (0, common_1.Post)('ask/stream'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ask_dto_1.AskDto, Object]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "askQuestionStream", null);
__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: 10 * 1024 * 1024 } })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('chunkingStrategy')),
    __param(2, (0, common_1.Body)('enableKnowledgeGraph')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "getAllDocuments", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "deleteDocument", null);
__decorate([
    (0, common_1.Post)('upload-folder'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', 2500, {
        preservePath: true,
        limits: { fileSize: 10 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFiles)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array, upload_folder_dto_1.UploadFolderDto]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "uploadFolder", null);
__decorate([
    (0, common_1.Post)('retrieve'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [retrieve_dto_1.RetrieveDto]),
    __metadata("design:returntype", Promise)
], RagDocumentsController.prototype, "retrieve", null);
exports.RagDocumentsController = RagDocumentsController = __decorate([
    (0, common_1.Controller)('rag/documents'),
    __param(0, (0, common_1.Inject)('CommandBus')),
    __metadata("design:paramtypes", [Object, ask_question_handler_1.AskQuestionHandler])
], RagDocumentsController);
//# sourceMappingURL=rag-documents.controller.js.map