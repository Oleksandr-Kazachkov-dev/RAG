import { LinkService } from '../../application/services/link.service';
import { IKnowledgeLink, IKnowledgeLinkRepository } from '../../domain/interfaces/knowledge-link.interface';
import { LoggerPort } from '../../shared/application/ports/logger.port';
import { ExtractLinksHandler } from "../../application/handlers/extract-links.handler";
export interface GetAllLinksResponse {
    total: number;
    links: IKnowledgeLink[];
}
export interface SearchLinksResponse {
    query: string;
    total: number;
    links: IKnowledgeLink[];
    block?: string;
}
export interface DeleteLinksResponse {
    sourceFile: string;
    deleted: boolean;
}
export interface IndexLinksResponse {
    filesProcessed: number;
    linksIndexed: number;
}
export declare class LinksController {
    private readonly linkService;
    private readonly repo;
    private readonly logger;
    private readonly handler;
    constructor(linkService: LinkService, repo: IKnowledgeLinkRepository, logger: LoggerPort, handler: ExtractLinksHandler);
    getAllLinks(sourceFile?: string): Promise<GetAllLinksResponse>;
    searchLinks(q?: string): Promise<SearchLinksResponse>;
    queryLinks(q?: string): Promise<SearchLinksResponse>;
    deleteBySourceFile(sourceFile: string): Promise<DeleteLinksResponse>;
    indexLinks(files: Express.Multer.File[]): Promise<IndexLinksResponse>;
}
