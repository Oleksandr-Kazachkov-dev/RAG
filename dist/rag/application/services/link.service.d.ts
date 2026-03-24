import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import { IKnowledgeLink, IKnowledgeLinkRepository } from 'src/rag/domain/interfaces/knowledge-link.interface';
export interface LinkSearchResult {
    found: boolean;
    links: IKnowledgeLink[];
    block?: string;
}
export declare class LinkService {
    private readonly repo;
    private readonly logger;
    constructor(repo: IKnowledgeLinkRepository, logger: LoggerPort);
    indexLinksFromFiles(files: Array<{
        originalname: string;
        buffer: Buffer;
    }>): Promise<{
        filesProcessed: number;
        linksIndexed: number;
    }>;
    findLinksForQuery(query: string): Promise<LinkSearchResult>;
    findLinksForContext(query: string): Promise<LinkSearchResult>;
    private extractQueryKeywords;
    private rankLinks;
    private linkScore;
    private formatLinksBlock;
}
