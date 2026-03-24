import { OnModuleInit } from '@nestjs/common';
import { CommandBusPort } from './shared/application/ports/command-bus.port';
import { AskQuestionHandler } from './application/handlers/ask-question.handler';
import { UploadKnowledgeHandler } from './application/handlers/upload-knowledge.handler';
import { DeleteDocumentHandler } from './application/handlers/delete-document.handler';
import { ProcessImagesHandler } from './application/handlers/process-images.handler';
import { DeleteImageHandler } from './application/handlers/delete-image.handler';
import { UploadFolderHandler } from './application/handlers/upload-folder.handler';
import { GetAllDocumentsHandler, GetAllImagesHandler, GetImagesByKeywordHandler, RetrieveDocumentsHandler } from './application/queries/rag-query.handlers';
import { ExtractLinksHandler } from './application/handlers/extract-links.handler';
export declare class RagModule implements OnModuleInit {
    private readonly bus;
    private readonly askQuestion;
    private readonly uploadKnowledge;
    private readonly deleteDocument;
    private readonly processImages;
    private readonly deleteImage;
    private readonly uploadFolder;
    private readonly getAllDocuments;
    private readonly getAllImages;
    private readonly getImagesByKeyword;
    private readonly retrieveDocuments;
    private readonly extractLinks;
    constructor(bus: CommandBusPort, askQuestion: AskQuestionHandler, uploadKnowledge: UploadKnowledgeHandler, deleteDocument: DeleteDocumentHandler, processImages: ProcessImagesHandler, deleteImage: DeleteImageHandler, uploadFolder: UploadFolderHandler, getAllDocuments: GetAllDocumentsHandler, getAllImages: GetAllImagesHandler, getImagesByKeyword: GetImagesByKeywordHandler, retrieveDocuments: RetrieveDocumentsHandler, extractLinks: ExtractLinksHandler);
    onModuleInit(): void;
}
