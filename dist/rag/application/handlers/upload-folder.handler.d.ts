import { LoggerPort } from "../../shared/application/ports/logger.port";
import { UploadFolderCommand } from '../commands/upload-folder.command';
import { TextRagPort } from "../../domain/ports/textRagPort";
export declare class UploadFolderHandler {
    private readonly textRag;
    private readonly logger;
    constructor(textRag: TextRagPort, logger: LoggerPort);
    execute(cmd: UploadFolderCommand): Promise<{
        totalChunks: number;
        filesProcessed: number;
    }>;
}
