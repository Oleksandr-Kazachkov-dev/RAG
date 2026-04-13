import { AskQuestionOptions } from "../../application/commands/ask-question.command";
import { IDeleteDocument, IDocumentWithEmbedding, IDocumentWithoutEmbedding, IGenerateAnswer, IStreamChunk, IUploadKnowledge } from "../../application/common/interfaces/rag-documents.interfaces";
import { IUploadedFile } from '../interfaces/upload-folder.interface';
import { UploadFolderOptions } from "../../application/commands/upload-folder.command";
export interface TextRagPort {
    uploadKnowledgeFromFile(file: Express.Multer.File, options?: {
        chunkingStrategy?: 'simple' | 'semantic' | 'parent-child';
        enableKnowledgeGraph?: boolean;
    }): Promise<IUploadKnowledge>;
    retrieve(query: string, limit?: number, options?: Pick<AskQuestionOptions, 'useHybridSearch' | 'useReranking' | 'rerankStrategy' | 'useQueryTransformation' | 'useContextualCompression' | 'useConversationMemory' | 'sessionId' | 'scoreThreshold' | 'filters'>): Promise<Array<IDocumentWithEmbedding> | string>;
    getAllDocuments(): Promise<Array<IDocumentWithoutEmbedding>>;
    generateAnswer(question: string, options?: AskQuestionOptions): Promise<IGenerateAnswer | string>;
    streamableGenerateAnswer(question: string, options?: AskQuestionOptions): AsyncGenerator<IStreamChunk>;
    deleteById(id: string): Promise<IDeleteDocument>;
    uploadMarkdownFolder(files: IUploadedFile[], options: UploadFolderOptions | undefined): Promise<{
        totalChunks: number;
        filesProcessed: number;
    }>;
}
