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
exports.LinkService = void 0;
const common_1 = require("@nestjs/common");
const link_extractor_util_1 = require("../utils/link-extractor.util");
let LinkService = class LinkService {
    constructor(repo, logger) {
        this.repo = repo;
        this.logger = logger;
    }
    async indexLinksFromFiles(files) {
        let linksIndexed = 0;
        for (const file of files) {
            if (!file.originalname.endsWith('.md'))
                continue;
            try {
                const content = file.buffer.toString('utf-8');
                const links = (0, link_extractor_util_1.extractLinksFromMarkdown)(content, file.originalname);
                if (!links.length)
                    continue;
                await this.repo.deleteBySourceFile(file.originalname);
                const saved = await this.repo.upsertMany(links);
                this.logger.log('Links indexed', {
                    file: file.originalname,
                    count: saved,
                    sample: links.slice(0, 3).map(l => `${l.label} → ${l.url}`),
                });
                linksIndexed += saved;
            }
            catch (err) {
                this.logger.warn('Link indexing failed for file', {
                    file: file.originalname,
                    error: err?.message,
                });
            }
        }
        return { filesProcessed: files.length, linksIndexed };
    }
    async findLinksForQuery(query) {
        if (!(0, link_extractor_util_1.isLinkQuery)(query))
            return { found: false, links: [] };
        const keywords = this.extractQueryKeywords(query);
        this.logger.log('LinkService: searching by query', { keywords });
        const links = await this.repo.findByKeywords(keywords);
        if (!links.length)
            return { found: true, links: [] };
        const ranked = this.rankLinks(links, query);
        const block = this.formatLinksBlock(ranked.slice(0, 5));
        return { found: true, links: ranked, block };
    }
    async findLinksForContext(query) {
        const keywords = this.extractQueryKeywords(query);
        if (!keywords.length)
            return { found: false, links: [] };
        this.logger.log('LinkService: context search', { keywords });
        const links = await this.repo.findByKeywords(keywords);
        if (!links.length)
            return { found: false, links: [] };
        const ranked = this.rankLinks(links, query);
        const block = this.formatLinksBlock(ranked.slice(0, 5));
        return { found: true, links: ranked, block };
    }
    extractQueryKeywords(query) {
        const STOP = new Set([
            'де', 'як', 'що', 'який', 'яка', 'яке', 'які', 'чи', 'є', 'є', 'у', 'в',
            'посилання', 'лінк', 'лінка', 'сайт', 'url', 'link', 'де', 'знайти',
            'where', 'find', 'give', 'what', 'is', 'the', 'a', 'an', 'of', 'for',
        ]);
        return query
            .toLowerCase()
            .replace(/[?!.,;:'"]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 1 && !STOP.has(w));
    }
    rankLinks(links, query) {
        const q = query.toLowerCase();
        return [...links].sort((a, b) => this.linkScore(b, q) - this.linkScore(a, q));
    }
    linkScore(link, query) {
        let score = 0;
        const label = link.label.toLowerCase();
        if (query.includes(label))
            score += 10;
        for (const kw of link.keywords) {
            if (query.includes(kw))
                score += 2;
        }
        if (link.linkType === 'image' && /фото|image|photo|зображ|скрин/i.test(query))
            score += 5;
        if (link.linkType === 'video' && /відео|video|запис/i.test(query))
            score += 5;
        return score;
    }
    formatLinksBlock(links) {
        if (!links.length)
            return '';
        const lines = links.map(l => {
            const icon = l.linkType === 'image' ? '🖼️' :
                l.linkType === 'video' ? '🎬' : '🔗';
            return `${icon} **${l.label}**: ${l.url}`;
        });
        return '\n\n---\n**Посилання:**\n' + lines.join('\n');
    }
};
exports.LinkService = LinkService;
exports.LinkService = LinkService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('IKnowledgeLinkRepository')),
    __param(1, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [Object, Object])
], LinkService);
//# sourceMappingURL=link.service.js.map