import { ConfigService } from '@nestjs/config';
import { OllamaService } from 'src/rag/infrastructure/ollama/ollama.service';
import { RagQdrantService } from 'src/rag/infrastructure/qdrant/rag-qdrant.service';
import { ITextDocumentRepository } from '../../domain/repositories/text-document.repository';
import { IDeleteDocument, IDocumentWithEmbedding, IDocumentWithoutEmbedding, IGenerateAnswer, IStreamChunk, IUploadKnowledge } from '../common/interfaces/rag-documents.interfaces';
import { TextRagPort } from 'src/rag/domain/ports/textRagPort';
import { UploadFolderOptions } from '../commands/upload-folder.command';
import { IKnowledgeGraphService } from '../../infrastructure/neo4j/neo4j-knowledge-graph.service';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import { IConversationSessionRepository } from 'src/rag/domain/ports/conversation-session.repository.port';
import { AskQuestionOptions } from '../commands/ask-question.command';
import { SearchMode } from '../../infrastructure/qdrant/rag-qdrant.service';
import { IConfidencePort } from '../../domain/ports/confidence.port';
interface RetrieveInternalOptions extends Pick<AskQuestionOptions, 'useHybridSearch' | 'useReranking' | 'rerankStrategy' | 'useQueryTransformation' | 'useContextualCompression' | 'useConversationMemory' | 'sessionId' | 'scoreThreshold' | 'filters'> {
    limit?: number;
    _searchMode?: SearchMode | 'entity';
}
export declare class TextRagService implements TextRagPort {
    private readonly configService;
    private readonly ollama;
    private readonly qdrantService;
    private readonly textRepository;
    private readonly conversationRepository;
    private readonly knowledgeGraph;
    private readonly logger;
    private readonly confidencePort;
    private queryTransformer;
    private reranker;
    private hybridSearch;
    private contextualCompressor;
    private queryClassifier;
    constructor(configService: ConfigService, ollama: OllamaService, qdrantService: RagQdrantService, textRepository: ITextDocumentRepository, conversationRepository: IConversationSessionRepository, knowledgeGraph: IKnowledgeGraphService, logger: LoggerPort, confidencePort: IConfidencePort);
    uploadKnowledgeFromFile(file: Express.Multer.File, options?: UploadFolderOptions): Promise<IUploadKnowledge>;
    uploadMarkdownFolder(files: Express.Multer.File[], options?: UploadFolderOptions): Promise<{
        totalChunks: number;
        filesProcessed: number;
    }>;
    private uploadWithSimple;
    private uploadWithSemantic;
    private uploadWithParentChild;
    private prepareKeywordsForFile;
    private sanitizeKeywords;
    private extractNameTokens;
    private extractHeaderKeywords;
    private extractUrlKeywords;
    private splitDomainParts;
    private extractTextKeywords;
    private extractFilepathKeywords;
    private frequencyKeywords;
    private embedAndSaveChunks;
    private buildFileId;
    retrieve(query: string, limit?: number, options?: RetrieveInternalOptions): Promise<Array<IDocumentWithEmbedding> | string>;
    getAllDocuments(): Promise<IDocumentWithoutEmbedding[]>;
    private buildPrompt;
    generateAnswer(query: string, options?: {
        limit?: number;
        scoreThreshold?: number;
        filters?: Array<{
            field: string;
            value: any;
            operator?: string;
        }>;
        useHybridSearch?: boolean;
        useReranking?: boolean;
        rerankStrategy?: 'cross_encoder' | 'llm_based' | 'none' | 'hybrid';
        useQueryTransformation?: boolean;
        useContextualCompression?: boolean;
        useConversationMemory?: boolean;
        useKnowledgeGraph?: boolean;
        useCitationTracking?: boolean;
        temperature?: number;
        topP?: number;
        topK?: number;
        maxTokens?: number;
        includeSources?: boolean;
        sessionId?: string;
        conversationHistory?: Array<{
            role: string;
            content: string;
        }>;
    }): Promise<IGenerateAnswer | {
        answer: string;
    }>;
    streamableGenerateAnswer(query: string, options?: {
        limit?: number;
        scoreThreshold?: number;
        filters?: Array<{
            field: string;
            value: any;
            operator?: string;
        }>;
        useHybridSearch?: boolean;
        useReranking?: boolean;
        rerankStrategy?: 'cross_encoder' | 'llm_based' | 'none' | 'hybrid';
        useQueryTransformation?: boolean;
        useContextualCompression?: boolean;
        useConversationMemory?: boolean;
        useKnowledgeGraph?: boolean;
        useCitationTracking?: boolean;
        temperature?: number;
        topP?: number;
        topK?: number;
        maxTokens?: number;
        includeSources?: boolean;
        sessionId?: string;
        conversationHistory?: Array<{
            role: string;
            content: string;
        }>;
    }): AsyncGenerator<IStreamChunk>;
    deleteById(id: string): Promise<IDeleteDocument>;
    private trackCitations;
    private findSimilarContent;
    private expandToParentContext;
    private extractKnowledgeGraph;
    private extractEntitiesAndRelations;
    private isNoisyEntity;
    private buildCanonicalId;
    private queryKnowledgeGraph;
}
export {};
