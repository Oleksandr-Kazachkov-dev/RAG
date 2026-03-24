import { Injectable, Inject } from '@nestjs/common';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import {
  IKnowledgeLink,
  IKnowledgeLinkRepository,
} from 'src/rag/domain/interfaces/knowledge-link.interface';
import {
  extractLinksFromMarkdown,
  isLinkQuery,
} from '../utils/link-extractor.util';

export interface LinkSearchResult {
  found:  boolean;
  links:  IKnowledgeLink[];
  block?: string;
}

@Injectable()
export class LinkService {

  constructor(
    @Inject('IKnowledgeLinkRepository')
    private readonly repo: IKnowledgeLinkRepository,
    @Inject('LoggerPort')
    private readonly logger: LoggerPort,
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

    return { filesProcessed: files.length, linksIndexed };
  }

  async findLinksForQuery(query: string): Promise<LinkSearchResult> {
    if (!isLinkQuery(query)) return { found: false, links: [] };

    const keywords = this.extractQueryKeywords(query);
    this.logger.log('LinkService: searching by query', { keywords });

    const links = await this.repo.findByKeywords(keywords);

    if (!links.length) return { found: true, links: [] };

    const ranked = this.rankLinks(links, query);
    const block  = this.formatLinksBlock(ranked.slice(0, 5));

    return { found: true, links: ranked, block };
  }

  async findLinksForContext(query: string): Promise<LinkSearchResult> {
    const keywords = this.extractQueryKeywords(query);
    if (!keywords.length) return { found: false, links: [] };

    this.logger.log('LinkService: context search', { keywords });

    const links = await this.repo.findByKeywords(keywords);
    if (!links.length) return { found: false, links: [] };

    const ranked = this.rankLinks(links, query);
    const block  = this.formatLinksBlock(ranked.slice(0, 5));
    return { found: true, links: ranked, block };
  }

  private extractQueryKeywords(query: string): string[] {
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

  private rankLinks(links: IKnowledgeLink[], query: string): IKnowledgeLink[] {
    const q = query.toLowerCase();
    return [...links].sort((a, b) => this.linkScore(b, q) - this.linkScore(a, q));
  }

  private linkScore(link: IKnowledgeLink, query: string): number {
    let score = 0;
    const label = link.label.toLowerCase();

    if (query.includes(label)) score += 10;

    for (const kw of link.keywords) {
      if (query.includes(kw)) score += 2;
    }

    if (link.linkType === 'image' && /фото|image|photo|зображ|скрин/i.test(query)) score += 5;
    if (link.linkType === 'video' && /відео|video|запис/i.test(query))              score += 5;

    return score;
  }

  private formatLinksBlock(links: IKnowledgeLink[]): string {
    if (!links.length) return '';

    const lines = links.map(l => {
      const icon =
        l.linkType === 'image' ? '🖼️' :
        l.linkType === 'video' ? '🎬' : '🔗';
      return `${icon} **${l.label}**: ${l.url}`;
    });

    return '\n\n---\n**Посилання:**\n' + lines.join('\n');
  }
}
