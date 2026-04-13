import { LoggerPort } from "../../shared/application/ports/logger.port";
import { LinkService } from '../services/link.service';
import { IndexLinksCommand } from '../commands/extract-links.command';
export declare class ExtractLinksHandler {
    private readonly logger;
    private readonly linkService;
    constructor(logger: LoggerPort, linkService: LinkService);
    execute(command: IndexLinksCommand): Promise<{
        filesProcessed: number;
        linksIndexed: number;
    }>;
}
