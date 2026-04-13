import { LoggerPort } from "../../shared/application/ports/logger.port";
import { IImageWithoutScore, IImageWithScore } from "../common/interfaces/image.interfaces";
import { IDocumentWithoutEmbedding, IDocumentWithEmbedding } from "../common/interfaces/rag-documents.interfaces";
import { GetAllDocumentsQuery, GetAllImagesQuery, GetImagesByKeywordQuery, RetrieveDocumentsQuery } from "./rag.queries";
import { ImageRagPort } from "../../domain/ports/image-rag.port";
import { TextRagPort } from "../../domain/ports/textRagPort";
export declare class GetAllDocumentsHandler {
    private readonly textRag;
    constructor(textRag: TextRagPort);
    execute(_query: GetAllDocumentsQuery): Promise<IDocumentWithoutEmbedding[]>;
}
export declare class GetAllImagesHandler {
    private readonly imageRag;
    constructor(imageRag: ImageRagPort);
    execute(query: GetAllImagesQuery): Promise<IImageWithoutScore[]>;
}
export declare class GetImagesByKeywordHandler {
    private readonly imageRag;
    private readonly logger;
    constructor(imageRag: ImageRagPort, logger: LoggerPort);
    execute(query: GetImagesByKeywordQuery): Promise<IImageWithScore[]>;
}
export declare class RetrieveDocumentsHandler {
    private readonly textRag;
    private readonly logger;
    constructor(textRag: TextRagPort, logger: LoggerPort);
    execute(query: RetrieveDocumentsQuery): Promise<IDocumentWithEmbedding[] | string>;
}
