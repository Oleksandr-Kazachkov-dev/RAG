import { UploadKnowledgeCommand } from '../commands/upload-knowledge.command';
import { TextRagPort } from "../../domain/ports/textRagPort";
import { LoggerPort } from "../../shared/application/ports/logger.port";
import { IUploadKnowledge } from '../common/interfaces/rag-documents.interfaces';
export declare class UploadKnowledgeHandler {
    private readonly textRag;
    private readonly logger;
    constructor(textRag: TextRagPort, logger: LoggerPort);
    execute(cmd: UploadKnowledgeCommand): Promise<IUploadKnowledge>;
}
