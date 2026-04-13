import { LoggerPort } from "../../shared/application/ports/logger.port";
import { DeleteDocumentCommand } from '../commands/delete-document.command';
import { TextRagPort } from "../../domain/ports/textRagPort";
import { IDeleteDocument } from '../common/interfaces/rag-documents.interfaces';
export declare class DeleteDocumentHandler {
    private readonly textRag;
    private readonly logger;
    constructor(textRag: TextRagPort, logger: LoggerPort);
    execute(cmd: DeleteDocumentCommand): Promise<IDeleteDocument>;
}
