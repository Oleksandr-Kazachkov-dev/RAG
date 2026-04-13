import { IConfidencePort } from "../../domain/ports/confidence.port";
import { TextRagPort } from "../../domain/ports/textRagPort";
import { LoggerPort } from "../../shared/application/ports/logger.port";
import { AskQuestionCommand } from "../commands/ask-question.command";
import { IGenerateAnswer, IStreamChunk } from "../common/interfaces/rag-documents.interfaces";
export declare class AskQuestionHandler {
    private readonly textRag;
    private readonly logger;
    private readonly confidencePort;
    constructor(textRag: TextRagPort, logger: LoggerPort, confidencePort: IConfidencePort);
    execute(cmd: AskQuestionCommand): Promise<IGenerateAnswer>;
    streamableExecute(cmd: AskQuestionCommand): AsyncGenerator<IStreamChunk>;
}
