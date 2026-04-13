import { Injectable, Inject } from '@nestjs/common';
import pLimit from 'p-limit';
import { Redis } from "@upstash/redis"

import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import {
  IKnowledgeLink,
  IKnowledgeLinkRepository,
} from 'src/rag/domain/interfaces/knowledge-link.interface';
import {
  extractLinksFromMarkdown,
  isLinkQuery,
  isValidUrl,
} from '../utils/link-extractor.util';

export interface LinkSearchResult {
  found: boolean;
  links: IKnowledgeLink[];
  block?: string;
}

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

const ABBR_VARIANTS: Record<string, string[]> = {
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

const MIN_SCORE_QUERY   = 4;
const MIN_SCORE_CONTEXT = 0;

const LINK_CHECK_TIMEOUT_MS  = 5000;
const LINK_CHECK_CONCURRENCY = 5;

const QUERY_CACHE_TTL      = 60 * 30;
const REACHABILITY_TTL_OK  = 60 * 60 * 4; 
const REACHABILITY_TTL_ERR = 60 * 10;   

function expandVariants(word: string): string[] {
  const lower    = word.toLowerCase();
  const variants = ABBR_VARIANTS[lower] ?? [];
  return [...new Set([lower, ...variants])];
}

function extractQueryKeywords(query: string): string[] {
  const base = query
    .toLowerCase()
    .replace(/[?!.,;:'"()[\]]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !LINK_STOP.has(w));

  const expanded = new Set<string>();
  for (const w of base) {
    for (const v of expandVariants(w)) {
      expanded.add(v);
    }
  }

  return [...expanded];
}

function queryCacheKey(prefix: string, query: string): string {
  return `${prefix}:${query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`;
}

@Injectable()
export class LinkService {
  constructor(
    @Inject('IKnowledgeLinkRepository')
    private readonly repo: IKnowledgeLinkRepository,
    @Inject('LoggerPort')
    private readonly logger: LoggerPort,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async indexLinksFromFiles(
    files: Array<{ originalname: string; buffer: Buffer }>,
  ): Promise<{ filesProcessed: number; linksIndexed: number }> {
    let linksIndexed = 0;

    for (const file of files) {
      if (!file.originalname.endsWith('.md')) continue;

      try {
        const content = file.buffer.toString('utf-8');
        const links   = extractLinksFromMarkdown(content, file.originalname);

        if (!links.length) continue;

        await this.repo.deleteBySourceFile(file.originalname);

        const saved = await this.repo.upsertMany(links);

        this.logger.log('Links indexed', {
          file:   file.originalname,
          count:  saved,
          sample: links.slice(0, 3).map(l => `${l.label} → ${l.url}`),
        });

        linksIndexed += saved;
      } catch (err: any) {
        this.logger.warn('Link indexing failed for file', {
          file:  file.originalname,
          error: err?.message,
        });
      }
    }

    await this.bustLinkCache();

    return { filesProcessed: files.length, linksIndexed };
  }

  async findLinksForQuery(query: string): Promise<LinkSearchResult> {
    if (!isLinkQuery(query)) return { found: false, links: [] };

    const cacheKey = queryCacheKey('links-query', query);

    const cached = await this.redisGet<LinkSearchResult>(cacheKey);
    if (cached) return cached;

    const keywords = extractQueryKeywords(query);
    this.logger.log('LinkService: searching by query', { keywords });

    const raw     = await this.repo.findByKeywords(keywords);
    const valid   = this.filterValid(raw);
    const alive   = await this.filterReachable(valid);
    const ranked  = this.rankLinks(alive, query, keywords);

    const relevant = ranked.filter(
      l => this.linkScore(l, query.toLowerCase(), keywords) >= MIN_SCORE_QUERY,
    );

    this.logger.log('LinkService: query relevance filter', {
      before:    ranked.length,
      after:     relevant.length,
      threshold: MIN_SCORE_QUERY,
    });

    const result: LinkSearchResult = relevant.length
      ? { found: true,  links: relevant, block: this.formatLinksBlock(relevant) }
      : { found: true,  links: [] };

    await this.redisSet(cacheKey, result, QUERY_CACHE_TTL);
    return result;
  }

  async findLinksForContext(query: string): Promise<LinkSearchResult> {
    const keywords = extractQueryKeywords(query);
    if (!keywords.length) return { found: false, links: [] };

    const cacheKey = queryCacheKey('links-ctx', query);

    const cached = await this.redisGet<LinkSearchResult>(cacheKey);
    if (cached) return cached;

    this.logger.log('LinkService: context search', { keywords });

    const raw     = await this.repo.findByKeywords(keywords);
    const valid   = this.filterValid(raw);
    const alive   = await this.filterReachable(valid);
    const ranked  = this.rankLinks(alive, query, keywords);

    const relevant = ranked.filter(
      l => this.linkScore(l, query.toLowerCase(), keywords) >= MIN_SCORE_CONTEXT,
    );

    this.logger.log('LinkService: context relevance filter', {
      before:    ranked.length,
      after:     relevant.length,
      threshold: MIN_SCORE_CONTEXT,
    });

    const result: LinkSearchResult = relevant.length
      ? { found: true,  links: relevant, block: this.formatLinksBlock(relevant) }
      : { found: false, links: [] };

    await this.redisSet(cacheKey, result, QUERY_CACHE_TTL);
    return result;
  }

  private filterValid(links: IKnowledgeLink[]): IKnowledgeLink[] {
    return links.filter(l => isValidUrl(l.url));
  }

  private async filterReachable(links: IKnowledgeLink[]): Promise<IKnowledgeLink[]> {
    if (!links.length) return [];

    const limit  = pLimit(LINK_CHECK_CONCURRENCY);
    const checks = await Promise.allSettled(
      links.map(link =>
        limit(async () => {
          const ok = await this.isReachable(link.url);
          return ok ? link : null;
        }),
      ),
    );

    return checks
      .filter(
        (r): r is PromiseFulfilledResult<IKnowledgeLink | null> => r.status === 'fulfilled',
      )
      .map(r => r.value)
      .filter((v): v is IKnowledgeLink => v !== null);
  }

  private async isReachable(url: string, timeoutMs = LINK_CHECK_TIMEOUT_MS): Promise<boolean> {
    if (!isValidUrl(url)) return false;

    const cacheKey = `url-alive:${url}`;

    const cached = await this.redisGet<boolean>(cacheKey);
    if (cached !== null) return cached;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), timeoutMs);

    let reachable = false;

    try {
      const headRes = await fetch(url, {
        method: 'HEAD', redirect: 'follow', signal: controller.signal,
      });

      this.logger.log('Link HEAD check', { url, status: headRes.status });

      if (this.isAllowedStatus(headRes.status)) {
        reachable = true;
      } else {
        const getRes = await fetch(url, {
          method: 'GET', redirect: 'follow', signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 LinkChecker/1.0' },
        });
        this.logger.log('Link GET check', { url, status: getRes.status });
        reachable = this.isAllowedStatus(getRes.status);
      }
    } catch (err: any) {
      this.logger.warn('Link check failed', { url, error: err?.message ?? String(err) });
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }

    const ttl = reachable ? REACHABILITY_TTL_OK : REACHABILITY_TTL_ERR;
    await this.redisSet(cacheKey, reachable, ttl);

    return reachable;
  }

  private isAllowedStatus(status: number): boolean {
    return [200, 201, 202, 204, 301, 302, 307, 308].includes(status);
  }

  private linkScore(link: IKnowledgeLink, query: string, keywords: string[]): number {
    let score = 0;

    const label      = link.label.toLowerCase();
    const context    = link.context.toLowerCase();
    const sourceFile = link.sourceFile.toLowerCase();

    if (query.includes(label)) score += 10;

    for (const kw of keywords) {
      if (link.keywords.some(k => k === kw || k.startsWith(kw))) score += 3;
      if (label.includes(kw))      score += 2;
      if (context.includes(kw))    score += 1;
      if (sourceFile.includes(kw)) score += 1;
    }

    if (link.linkType === 'image' && /фото|image|photo|зображ|скрин/i.test(query)) score += 5;
    if (link.linkType === 'video' && /відео|video|запис/i.test(query))              score += 5;

    return score;
  }

  private rankLinks(links: IKnowledgeLink[], query: string, keywords: string[]): IKnowledgeLink[] {
    const q = query.toLowerCase();
    return [...links].sort((a, b) => this.linkScore(b, q, keywords) - this.linkScore(a, q, keywords));
  }

  private formatLinksBlock(links: IKnowledgeLink[]): string {
    if (!links.length) return '';
    return links.map(l => `${l.label}**: ${l.url}`).join('\n');
  }

  private async redisGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get<T>(key);

      return raw ?? null;
    } catch (err: any) {
      this.logger.warn('LinkService: Redis get failed', { key, error: err?.message });
      return null;
    }
  }

  private async redisSet(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.set(
        key,
        value,
        { ex: ttl }
      );
    } catch (err: any) {
      this.logger.warn('LinkService: Redis set failed', { key, error: err?.message });
    }
  }

  private async bustLinkCache(): Promise<void> {
    try {
      const patterns = ['rag:links-query:*', 'rag:links-ctx:*'];
      for (const pattern of patterns) {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(cursor, {
            match: pattern,
            count: 100,
          });
          if (keys.length) await this.redis.del(...keys);
        } while (cursor !== '0');
      }
      this.logger.log('LinkService: link cache busted');
    } catch (err: any) {
      this.logger.warn('LinkService: cache bust failed', { error: err?.message });
    }
  }
}