import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ragConfig } from './infrastructure/config/rag-config';
import { OllamaModule } from './infrastructure/ollama/ollama.module';
import { S3Module } from './infrastructure/s3/s3.module';
import { S3StorageService } from './infrastructure/s3/s3.storage.service';
import { QdrantModule } from './infrastructure/qdrant/qdrant.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { Neo4jModule } from './infrastructure/neo4j/neo4j.module';
import { QdrantTextDocumentRepository } from './infrastructure/qdrant/repositories/qdrant-text-document.repository';
import { QdrantImageDocumentRepository } from './infrastructure/qdrant/repositories/qdrant-image-document.repository';
import { Neo4jKnowledgeGraphService } from './infrastructure/neo4j/neo4j-knowledge-graph.service';
import { TextRagService } from './application/services/text-rag.service';
import { ImageRagService } from './application/services/image-rag.service';
import { RagCommandBusModule } from './shared/infrastructure/command-bus.module';
import { CommandBusPort } from './shared/application/ports/command-bus.port';
import { AskQuestionHandler } from './application/handlers/ask-question.handler';
import { UploadKnowledgeHandler } from './application/handlers/upload-knowledge.handler';
import { DeleteDocumentHandler } from './application/handlers/delete-document.handler';
import { ProcessImagesHandler } from './application/handlers/process-images.handler';
import { DeleteImageHandler } from './application/handlers/delete-image.handler';
import { UploadFolderHandler } from './application/handlers/upload-folder.handler';
import {
  GetAllDocumentsHandler,
  GetAllImagesHandler,
  GetImagesByKeywordHandler,
  RetrieveDocumentsHandler,
} from './application/queries/rag-query.handlers';
import { AskQuestionCommand } from './application/commands/ask-question.command';
import { UploadKnowledgeCommand } from './application/commands/upload-knowledge.command';
import { DeleteDocumentCommand } from './application/commands/delete-document.command';
import { ProcessImagesCommand } from './application/commands/process-images.command';
import { DeleteImageCommand } from './application/commands/delete-image.command';
import { UploadFolderCommand } from './application/commands/upload-folder.command';
import {
  GetAllDocumentsQuery,
  GetAllImagesQuery,
  GetImagesByKeywordQuery,
  RetrieveDocumentsQuery,
} from './application/queries/rag.queries';
import { RagDocumentsController } from './presentation/controllers/rag-documents.controller';
import { RagImagesController } from './presentation/controllers/image.controller';
import { ConsoleLoggerAdapter } from './shared/application/ports/console.logger.adapter';
import { OllamaChatAdapter } from './infrastructure/ollama/ollama-chat.adapter';
import { OllamaEmbeddingAdapter } from './infrastructure/ollama/ollama-embedding.adapter';
import { ConfidenceService } from './application/services/confidence.service';
import { LinkService } from './application/services/link.service';
import { ChatController } from './presentation/controllers/chat.controller';
import { KnowledgeLinkPrismaRepository } from './domain/repositories/knowledge-link-prisma.repository';
import { LinksController } from './presentation/controllers/link.controller';
import { ExtractLinksHandler } from './application/handlers/extract-links.handler';
import { IndexLinksCommand } from './application/commands/extract-links.command';

@Module({
  imports: [
    ConfigModule.forFeature(ragConfig),
    OllamaModule,
    S3Module,
    QdrantModule,
    PrismaModule,
    Neo4jModule,
    RagCommandBusModule,
  ],
  providers: [
    { provide: 'LoggerPort',               useClass: ConsoleLoggerAdapter },
    { provide: 'IEmbeddingPort',           useClass: OllamaEmbeddingAdapter },
    { provide: 'IChatLlmPort',             useClass: OllamaChatAdapter },
    { provide: 'ITextDocumentRepository',  useExisting: QdrantTextDocumentRepository },
    { provide: 'IImageDocumentRepository', useExisting: QdrantImageDocumentRepository },
    { provide: 'IStoragePort',             useExisting: S3StorageService },
    { provide: 'IKnowledgeGraphPort',      useClass: Neo4jKnowledgeGraphService },
    { provide: 'TextRagPort',              useClass: TextRagService },
    { provide: 'ImageRagPort',             useClass: ImageRagService },
    { provide: 'IConfidencePort',          useExisting: ConfidenceService },
    { provide: 'IKnowledgeLinkRepository', useExisting: KnowledgeLinkPrismaRepository },
    KnowledgeLinkPrismaRepository,
    LinkService,
    ConfidenceService,
    AskQuestionHandler,
    UploadKnowledgeHandler,
    DeleteDocumentHandler,
    ProcessImagesHandler,
    DeleteImageHandler,
    UploadFolderHandler,
    GetAllDocumentsHandler,
    GetAllImagesHandler,
    GetImagesByKeywordHandler,
    RetrieveDocumentsHandler,
    ExtractLinksHandler,
  ],
  controllers: [
    RagDocumentsController,
    RagImagesController,
    ChatController,
    LinksController,
  ],
})
export class RagModule implements OnModuleInit {
  constructor(
    @Inject('CommandBus') private readonly bus: CommandBusPort,
    private readonly askQuestion: AskQuestionHandler,
    private readonly uploadKnowledge: UploadKnowledgeHandler,
    private readonly deleteDocument: DeleteDocumentHandler,
    private readonly processImages: ProcessImagesHandler,
    private readonly deleteImage: DeleteImageHandler,
    private readonly uploadFolder: UploadFolderHandler,
    private readonly getAllDocuments: GetAllDocumentsHandler,
    private readonly getAllImages: GetAllImagesHandler,
    private readonly getImagesByKeyword: GetImagesByKeywordHandler,
    private readonly retrieveDocuments: RetrieveDocumentsHandler,
    private readonly extractLinks: ExtractLinksHandler,
  ) {}

  onModuleInit(): void {
    this.bus.register(AskQuestionCommand,     this.askQuestion);
    this.bus.register(UploadKnowledgeCommand, this.uploadKnowledge);
    this.bus.register(DeleteDocumentCommand,  this.deleteDocument);
    this.bus.register(ProcessImagesCommand,   this.processImages);
    this.bus.register(DeleteImageCommand,     this.deleteImage);
    this.bus.register(UploadFolderCommand,    this.uploadFolder);
    this.bus.register(GetAllDocumentsQuery,   this.getAllDocuments);
    this.bus.register(GetAllImagesQuery,      this.getAllImages);
    this.bus.register(GetImagesByKeywordQuery, this.getImagesByKeyword);
    this.bus.register(RetrieveDocumentsQuery,  this.retrieveDocuments);
    this.bus.register(IndexLinksCommand,      this.extractLinks)
  }
}
