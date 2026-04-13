import { Response } from 'express';
import { CommandBusPort } from '../../shared/application/ports/command-bus.port';
import { AskQuestionHandler } from '../../application/handlers/ask-question.handler';
import { ApiResponse } from '../api-response/api-response';
import { AskDto } from '../dto/ask.dto';
import { IGenerateAnswer, IUploadKnowledge, IDocumentWithoutEmbedding, IDocumentWithEmbedding } from "../../application/common/interfaces/rag-documents.interfaces";
import { RetrieveDto } from '../dto/retrieve.dto';
import { UploadFolderDto } from '../dto/upload-folder.dto';
export declare class RagDocumentsController {
    private readonly commandBus;
    private readonly askQuestionHandler;
    constructor(commandBus: CommandBusPort, askQuestionHandler: AskQuestionHandler);
    askQuestion(dto: AskDto): Promise<ApiResponse<IGenerateAnswer>>;
    askQuestionStream(dto: AskDto, res: Response): Promise<void>;
    uploadFile(file: Express.Multer.File, chunkingStrategy?: 'simple' | 'semantic' | 'parent-child', enableKnowledgeGraph?: string): Promise<ApiResponse<IUploadKnowledge>>;
    getAllDocuments(): Promise<ApiResponse<Array<IDocumentWithoutEmbedding>>>;
    deleteDocument(id: string): Promise<ApiResponse<null>>;
    uploadFolder(files: Express.Multer.File[], dto: UploadFolderDto): Promise<ApiResponse<unknown>>;
    retrieve(dto: RetrieveDto): Promise<ApiResponse<IDocumentWithEmbedding[]>>;
}
