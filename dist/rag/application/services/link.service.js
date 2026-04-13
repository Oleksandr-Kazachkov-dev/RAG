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
const p_limit_1 = require("p-limit");
const redis_1 = require("@upstash/redis");
const link_extractor_util_1 = require("../utils/link-extractor.util");
const LINK_STOP = new Set([
    'де', 'як', 'що', 'який', 'яка', 'яке', 'які', 'чи', 'у', 'в',
    'до', 'від', 'із', 'зі', 'та', 'і', 'й', 'або', 'але', 'при',
    'без', 'між', 'після', 'перед', 'над', 'під', 'через', 'для',
    'мені', 'мне', 'це', 'той', 'та', 'ті', 'цей', 'ця', 'ці',
    'посилання', 'лінк', 'лінка', 'сайт', 'знайти', 'відкрити',
    'where', 'find', 'give', 'what', 'is', 'the', 'a', 'an', 'of', 'for',
    'and', 'or', 'but', 'with', 'by', 'from', 'to', 'at', 'on', 'how',
    'url', 'link', 'me', 'my', 'can', 'you', 'please',
]);
const ABBR_VARIANTS = {
    vpn: ['впн', 'vpn'],
    впн: ['vpn', 'впн'],
    'вpн': ['vpn', 'впн'],
    ip: ['іп', 'ip'],
    іп: ['ip', 'іп'],
    'wi-fi': ['вайфай', 'wifi', 'wi-fi'],
    wifi: ['вайфай', 'wifi', 'wi-fi'],
    вайфай: ['wifi', 'wi-fi'],
    dns: ['днс', 'dns'],
    днс: ['dns', 'днс'],
    http: ['хттп', 'http'],
    https: ['хттпс', 'https'],
    ssl: ['ссл', 'ssl'],
    ссл: ['ssl', 'ссл'],
    hrm: ['хрм', 'hrm'],
    хрм: ['hrm', 'хрм'],
    crm: ['срм', 'crm'],
    срм: ['crm', 'срм'],
    erp: ['єрп', 'erp'],
    єрп: ['erp', 'єрп'],
    kpi: ['кпі', 'kpi'],
    кпі: ['kpi', 'кпі'],
    api: ['апі', 'api'],
    апі: ['api', 'апі'],
    ui: ['юай', 'ui'],
    юай: ['ui', 'юай'],
    ux: ['юекс', 'ux'],
    cv: ['резюме', 'cv'],
    резюме: ['cv'],
    підключ: ['підключення', 'підключитись'],
    підключення: ['підключ'],
    налашт: ['налаштування', 'налаштувати'],
    налаштування: ['налашт'],
    встанов: ['встановлення', 'встановити'],
    встановлення: ['встанов'],
    реєстр: ['реєстрація', 'зареєструватись'],
    реєстрація: ['реєстр'],
};
const MIN_SCORE_QUERY = 4;
const MIN_SCORE_CONTEXT = 0;
const LINK_CHECK_TIMEOUT_MS = 5000;
const LINK_CHECK_CONCURRENCY = 5;
const QUERY_CACHE_TTL = 60 * 30;
const REACHABILITY_TTL_OK = 60 * 60 * 4;
const REACHABILITY_TTL_ERR = 60 * 10;
function expandVariants(word) {
    const lower = word.toLowerCase();
    const variants = ABBR_VARIANTS[lower] ?? [];
    return [...new Set([lower, ...variants])];
}
function extractQueryKeywords(query) {
    const base = query
        .toLowerCase()
        .replace(/[?!.,;:'"()[\]]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !LINK_STOP.has(w));
    const expanded = new Set();
    for (const w of base) {
        for (const v of expandVariants(w)) {
            expanded.add(v);
        }
    }
    return [...expanded];
}
function queryCacheKey(prefix, query) {
    return `${prefix}:${query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`;
}
let LinkService = class LinkService {
    constructor(repo, logger, redis) {
        this.repo = repo;
        this.logger = logger;
        this.redis = redis;
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
        await this.bustLinkCache();
        return { filesProcessed: files.length, linksIndexed };
    }
    async findLinksForQuery(query) {
        if (!(0, link_extractor_util_1.isLinkQuery)(query))
            return { found: false, links: [] };
        const cacheKey = queryCacheKey('links-query', query);
        const cached = await this.redisGet(cacheKey);
        if (cached)
            return cached;
        const keywords = extractQueryKeywords(query);
        this.logger.log('LinkService: searching by query', { keywords });
        const raw = await this.repo.findByKeywords(keywords);
        const valid = this.filterValid(raw);
        const alive = await this.filterReachable(valid);
        const ranked = this.rankLinks(alive, query, keywords);
        const relevant = ranked.filter(l => this.linkScore(l, query.toLowerCase(), keywords) >= MIN_SCORE_QUERY);
        this.logger.log('LinkService: query relevance filter', {
            before: ranked.length,
            after: relevant.length,
            threshold: MIN_SCORE_QUERY,
        });
        const result = relevant.length
            ? { found: true, links: relevant, block: this.formatLinksBlock(relevant) }
            : { found: true, links: [] };
        await this.redisSet(cacheKey, result, QUERY_CACHE_TTL);
        return result;
    }
    async findLinksForContext(query) {
        const keywords = extractQueryKeywords(query);
        if (!keywords.length)
            return { found: false, links: [] };
        const cacheKey = queryCacheKey('links-ctx', query);
        const cached = await this.redisGet(cacheKey);
        if (cached)
            return cached;
        this.logger.log('LinkService: context search', { keywords });
        const raw = await this.repo.findByKeywords(keywords);
        const valid = this.filterValid(raw);
        const alive = await this.filterReachable(valid);
        const ranked = this.rankLinks(alive, query, keywords);
        const relevant = ranked.filter(l => this.linkScore(l, query.toLowerCase(), keywords) >= MIN_SCORE_CONTEXT);
        this.logger.log('LinkService: context relevance filter', {
            before: ranked.length,
            after: relevant.length,
            threshold: MIN_SCORE_CONTEXT,
        });
        const result = relevant.length
            ? { found: true, links: relevant, block: this.formatLinksBlock(relevant) }
            : { found: false, links: [] };
        await this.redisSet(cacheKey, result, QUERY_CACHE_TTL);
        return result;
    }
    filterValid(links) {
        return links.filter(l => (0, link_extractor_util_1.isValidUrl)(l.url));
    }
    async filterReachable(links) {
        if (!links.length)
            return [];
        const limit = (0, p_limit_1.default)(LINK_CHECK_CONCURRENCY);
        const checks = await Promise.allSettled(links.map(link => limit(async () => {
            const ok = await this.isReachable(link.url);
            return ok ? link : null;
        })));
        return checks
            .filter((r) => r.status === 'fulfilled')
            .map(r => r.value)
            .filter((v) => v !== null);
    }
    async isReachable(url, timeoutMs = LINK_CHECK_TIMEOUT_MS) {
        if (!(0, link_extractor_util_1.isValidUrl)(url))
            return false;
        const cacheKey = `url-alive:${url}`;
        const cached = await this.redisGet(cacheKey);
        if (cached !== null)
            return cached;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let reachable = false;
        try {
            const headRes = await fetch(url, {
                method: 'HEAD', redirect: 'follow', signal: controller.signal,
            });
            this.logger.log('Link HEAD check', { url, status: headRes.status });
            if (this.isAllowedStatus(headRes.status)) {
                reachable = true;
            }
            else {
                const getRes = await fetch(url, {
                    method: 'GET', redirect: 'follow', signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 LinkChecker/1.0' },
                });
                this.logger.log('Link GET check', { url, status: getRes.status });
                reachable = this.isAllowedStatus(getRes.status);
            }
        }
        catch (err) {
            this.logger.warn('Link check failed', { url, error: err?.message ?? String(err) });
            reachable = false;
        }
        finally {
            clearTimeout(timeout);
        }
        const ttl = reachable ? REACHABILITY_TTL_OK : REACHABILITY_TTL_ERR;
        await this.redisSet(cacheKey, reachable, ttl);
        return reachable;
    }
    isAllowedStatus(status) {
        return [200, 201, 202, 204, 301, 302, 307, 308].includes(status);
    }
    linkScore(link, query, keywords) {
        let score = 0;
        const label = link.label.toLowerCase();
        const context = link.context.toLowerCase();
        const sourceFile = link.sourceFile.toLowerCase();
        if (query.includes(label))
            score += 10;
        for (const kw of keywords) {
            if (link.keywords.some(k => k === kw || k.startsWith(kw)))
                score += 3;
            if (label.includes(kw))
                score += 2;
            if (context.includes(kw))
                score += 1;
            if (sourceFile.includes(kw))
                score += 1;
        }
        if (link.linkType === 'image' && /фото|image|photo|зображ|скрин/i.test(query))
            score += 5;
        if (link.linkType === 'video' && /відео|video|запис/i.test(query))
            score += 5;
        return score;
    }
    rankLinks(links, query, keywords) {
        const q = query.toLowerCase();
        return [...links].sort((a, b) => this.linkScore(b, q, keywords) - this.linkScore(a, q, keywords));
    }
    formatLinksBlock(links) {
        if (!links.length)
            return '';
        return links.map(l => `${l.label}**: ${l.url}`).join('\n');
    }
    async redisGet(key) {
        try {
            const raw = await this.redis.get(key);
            return raw ?? null;
        }
        catch (err) {
            this.logger.warn('LinkService: Redis get failed', { key, error: err?.message });
            return null;
        }
    }
    async redisSet(key, value, ttl) {
        try {
            await this.redis.set(key, value, { ex: ttl });
        }
        catch (err) {
            this.logger.warn('LinkService: Redis set failed', { key, error: err?.message });
        }
    }
    async bustLinkCache() {
        try {
            const patterns = ['rag:links-query:*', 'rag:links-ctx:*'];
            for (const pattern of patterns) {
                let cursor = '0';
                do {
                    const [nextCursor, keys] = await this.redis.scan(cursor, {
                        match: pattern,
                        count: 100,
                    });
                    if (keys.length)
                        await this.redis.del(...keys);
                } while (cursor !== '0');
            }
            this.logger.log('LinkService: link cache busted');
        }
        catch (err) {
            this.logger.warn('LinkService: cache bust failed', { error: err?.message });
        }
    }
};
exports.LinkService = LinkService;
exports.LinkService = LinkService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('IKnowledgeLinkRepository')),
    __param(1, (0, common_1.Inject)('LoggerPort')),
    __param(2, (0, common_1.Inject)('REDIS_CLIENT')),
    __metadata("design:paramtypes", [Object, Object, redis_1.Redis])
], LinkService);
//# sourceMappingURL=link.service.js.map