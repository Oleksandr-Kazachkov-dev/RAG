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
exports.ExtractLinksHandler = void 0;
const common_1 = require("@nestjs/common");
const link_service_1 = require("../services/link.service");
let ExtractLinksHandler = class ExtractLinksHandler {
    constructor(logger, linkService) {
        this.logger = logger;
        this.linkService = linkService;
    }
    async execute(command) {
        const { files } = command;
        this.logger.log('UploadFolder:indexLinksOnly', { files: files.length });
        const result = await this.linkService.indexLinksFromFiles(files.map(f => ({
            originalname: f.originalname,
            buffer: Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer),
        })));
        this.logger.log('UploadFolder:indexLinksOnly complete', result);
        return result;
    }
};
exports.ExtractLinksHandler = ExtractLinksHandler;
exports.ExtractLinksHandler = ExtractLinksHandler = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [Object, link_service_1.LinkService])
], ExtractLinksHandler);
//# sourceMappingURL=extract-links.handler.js.map