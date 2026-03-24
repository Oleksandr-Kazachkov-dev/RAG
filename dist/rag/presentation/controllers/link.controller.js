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
exports.LinksController = void 0;
const common_1 = require("@nestjs/common");
const link_service_1 = require("../../application/services/link.service");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const extract_links_handler_1 = require("../../application/handlers/extract-links.handler");
const extract_links_command_1 = require("../../application/commands/extract-links.command");
const mdFilesInterceptor = () => (0, platform_express_1.FilesInterceptor)('files', 200, {
    storage: (0, multer_1.memoryStorage)(),
    fileFilter: (_req, file, cb) => {
        if (file.originalname.endsWith('.md')) {
            cb(null, true);
        }
        else {
            cb(null, false);
        }
    },
});
let LinksController = class LinksController {
    constructor(linkService, repo, logger, handler) {
        this.linkService = linkService;
        this.repo = repo;
        this.logger = logger;
        this.handler = handler;
    }
    async getAllLinks(sourceFile) {
        let links = await this.repo.findAll();
        if (sourceFile) {
            links = links.filter(l => l.sourceFile === sourceFile);
        }
        this.logger.log('LinksController.getAllLinks', {
            sourceFile: sourceFile ?? 'all',
            total: links.length,
        });
        return { total: links.length, links };
    }
    async searchLinks(q) {
        if (!q || !q.trim()) {
            throw new common_1.BadRequestException('Query param "q" is required');
        }
        const result = await this.linkService.findLinksForContext(q.trim());
        this.logger.log('LinksController.searchLinks', {
            q,
            found: result.found,
            total: result.links.length,
        });
        return {
            query: q.trim(),
            total: result.links.length,
            links: result.links,
            block: result.block,
        };
    }
    async queryLinks(q) {
        if (!q || !q.trim()) {
            throw new common_1.BadRequestException('Query param "q" is required');
        }
        const result = await this.linkService.findLinksForQuery(q.trim());
        if (!result.found) {
            throw new common_1.NotFoundException('Query does not appear to be link-related. Use /links/search for keyword lookup.');
        }
        this.logger.log('LinksController.queryLinks', {
            q,
            total: result.links.length,
        });
        return {
            query: q.trim(),
            total: result.links.length,
            links: result.links,
            block: result.block,
        };
    }
    async deleteBySourceFile(sourceFile) {
        if (!sourceFile || !sourceFile.trim()) {
            throw new common_1.BadRequestException('sourceFile param is required');
        }
        await this.repo.deleteBySourceFile(sourceFile.trim());
        this.logger.log('LinksController.deleteBySourceFile', { sourceFile });
        return { sourceFile: sourceFile.trim(), deleted: true };
    }
    async indexLinks(files) {
        if (!files || files.length === 0) {
            throw new common_1.BadRequestException('No .md files received. Send files under the "files" multipart field.');
        }
        this.logger.log('UploadFolderController: indexLinks received', {
            files: files.map(f => f.originalname),
        });
        return this.handler.execute(new extract_links_command_1.IndexLinksCommand(files));
    }
};
exports.LinksController = LinksController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('sourceFile')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "getAllLinks", null);
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "searchLinks", null);
__decorate([
    (0, common_1.Get)('query'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "queryLinks", null);
__decorate([
    (0, common_1.Delete)(':sourceFile'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sourceFile')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "deleteBySourceFile", null);
__decorate([
    (0, common_1.Post)('index-links'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, common_1.UseInterceptors)(mdFilesInterceptor()),
    __param(0, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array]),
    __metadata("design:returntype", Promise)
], LinksController.prototype, "indexLinks", null);
exports.LinksController = LinksController = __decorate([
    (0, common_1.Controller)('links'),
    __param(1, (0, common_1.Inject)('IKnowledgeLinkRepository')),
    __param(2, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [link_service_1.LinkService, Object, Object, extract_links_handler_1.ExtractLinksHandler])
], LinksController);
//# sourceMappingURL=link.controller.js.map