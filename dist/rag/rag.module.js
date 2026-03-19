"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const rag_config_1 = require("./infrastructure/config/rag-config");
const ollama_module_1 = require("./infrastructure/ollama/ollama.module");
const s3_module_1 = require("./infrastructure/s3/s3.module");
const s3_storage_service_1 = require("./infrastructure/s3/s3.storage.service");
const qdrant_module_1 = require("./infrastructure/qdrant/qdrant.module");
const prisma_module_1 = require("./infrastructure/prisma/prisma.module");
const neo4j_module_1 = require("./infrastructure/neo4j/neo4j.module");
const qdrant_text_document_repository_1 = require("./infrastructure/qdrant/repositories/qdrant-text-document.repository");
const qdrant_image_document_repository_1 = require("./infrastructure/qdrant/repositories/qdrant-image-document.repository");
const neo4j_knowledge_graph_service_1 = require("./infrastructure/neo4j/neo4j-knowledge-graph.service");
const text_rag_service_1 = require("./application/services/text-rag.service");
const image_rag_service_1 = require("./application/services/image-rag.service");
const command_bus_module_1 = require("./shared/infrastructure/command-bus.module");
const ask_question_handler_1 = require("./application/handlers/ask-question.handler");
const upload_knowledge_handler_1 = require("./application/handlers/upload-knowledge.handler");
const delete_document_handler_1 = require("./application/handlers/delete-document.handler");
const process_images_handler_1 = require("./application/handlers/process-images.handler");
const delete_image_handler_1 = require("./application/handlers/delete-image.handler");
const upload_folder_handler_1 = require("./application/handlers/upload-folder.handler");
const rag_query_handlers_1 = require("./application/queries/rag-query.handlers");
const ask_question_command_1 = require("./application/commands/ask-question.command");
const upload_knowledge_command_1 = require("./application/commands/upload-knowledge.command");
const delete_document_command_1 = require("./application/commands/delete-document.command");
const process_images_command_1 = require("./application/commands/process-images.command");
const delete_image_command_1 = require("./application/commands/delete-image.command");
const upload_folder_command_1 = require("./application/commands/upload-folder.command");
const rag_queries_1 = require("./application/queries/rag.queries");
const rag_documents_controller_1 = require("./presentation/controllers/rag-documents.controller");
const image_controller_1 = require("./presentation/controllers/image.controller");
const console_logger_adapter_1 = require("./shared/application/ports/console.logger.adapter");
const ollama_chat_adapter_1 = require("./infrastructure/ollama/ollama-chat.adapter");
const ollama_embedding_adapter_1 = require("./infrastructure/ollama/ollama-embedding.adapter");
const confidence_service_1 = require("./application/services/confidence.service");
const chat_controller_1 = require("./presentation/controllers/chat.controller");
let RagModule = class RagModule {
    constructor(bus, askQuestion, uploadKnowledge, deleteDocument, processImages, deleteImage, uploadFolder, getAllDocuments, getAllImages, getImagesByKeyword, retrieveDocuments) {
        this.bus = bus;
        this.askQuestion = askQuestion;
        this.uploadKnowledge = uploadKnowledge;
        this.deleteDocument = deleteDocument;
        this.processImages = processImages;
        this.deleteImage = deleteImage;
        this.uploadFolder = uploadFolder;
        this.getAllDocuments = getAllDocuments;
        this.getAllImages = getAllImages;
        this.getImagesByKeyword = getImagesByKeyword;
        this.retrieveDocuments = retrieveDocuments;
    }
    onModuleInit() {
        this.bus.register(ask_question_command_1.AskQuestionCommand, this.askQuestion);
        this.bus.register(upload_knowledge_command_1.UploadKnowledgeCommand, this.uploadKnowledge);
        this.bus.register(delete_document_command_1.DeleteDocumentCommand, this.deleteDocument);
        this.bus.register(process_images_command_1.ProcessImagesCommand, this.processImages);
        this.bus.register(delete_image_command_1.DeleteImageCommand, this.deleteImage);
        this.bus.register(upload_folder_command_1.UploadFolderCommand, this.uploadFolder);
        this.bus.register(rag_queries_1.GetAllDocumentsQuery, this.getAllDocuments);
        this.bus.register(rag_queries_1.GetAllImagesQuery, this.getAllImages);
        this.bus.register(rag_queries_1.GetImagesByKeywordQuery, this.getImagesByKeyword);
        this.bus.register(rag_queries_1.RetrieveDocumentsQuery, this.retrieveDocuments);
    }
};
exports.RagModule = RagModule;
exports.RagModule = RagModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forFeature(rag_config_1.ragConfig),
            ollama_module_1.OllamaModule,
            s3_module_1.S3Module,
            qdrant_module_1.QdrantModule,
            prisma_module_1.PrismaModule,
            neo4j_module_1.Neo4jModule,
            command_bus_module_1.RagCommandBusModule,
        ],
        providers: [
            { provide: 'LoggerPort', useClass: console_logger_adapter_1.ConsoleLoggerAdapter },
            { provide: 'IEmbeddingPort', useClass: ollama_embedding_adapter_1.OllamaEmbeddingAdapter },
            { provide: 'IChatLlmPort', useClass: ollama_chat_adapter_1.OllamaChatAdapter },
            { provide: 'ITextDocumentRepository', useExisting: qdrant_text_document_repository_1.QdrantTextDocumentRepository },
            { provide: 'IImageDocumentRepository', useExisting: qdrant_image_document_repository_1.QdrantImageDocumentRepository },
            { provide: 'IStoragePort', useExisting: s3_storage_service_1.S3StorageService },
            { provide: 'IKnowledgeGraphPort', useClass: neo4j_knowledge_graph_service_1.Neo4jKnowledgeGraphService },
            { provide: 'TextRagPort', useClass: text_rag_service_1.TextRagService },
            { provide: 'ImageRagPort', useClass: image_rag_service_1.ImageRagService },
            { provide: 'IConfidencePort', useExisting: confidence_service_1.ConfidenceService },
            confidence_service_1.ConfidenceService,
            ask_question_handler_1.AskQuestionHandler,
            upload_knowledge_handler_1.UploadKnowledgeHandler,
            delete_document_handler_1.DeleteDocumentHandler,
            process_images_handler_1.ProcessImagesHandler,
            delete_image_handler_1.DeleteImageHandler,
            upload_folder_handler_1.UploadFolderHandler,
            rag_query_handlers_1.GetAllDocumentsHandler,
            rag_query_handlers_1.GetAllImagesHandler,
            rag_query_handlers_1.GetImagesByKeywordHandler,
            rag_query_handlers_1.RetrieveDocumentsHandler,
        ],
        controllers: [
            rag_documents_controller_1.RagDocumentsController,
            image_controller_1.RagImagesController,
            chat_controller_1.ChatController
        ],
    }),
    __param(0, (0, common_1.Inject)('CommandBus')),
    __metadata("design:paramtypes", [Object, ask_question_handler_1.AskQuestionHandler,
        upload_knowledge_handler_1.UploadKnowledgeHandler,
        delete_document_handler_1.DeleteDocumentHandler,
        process_images_handler_1.ProcessImagesHandler,
        delete_image_handler_1.DeleteImageHandler,
        upload_folder_handler_1.UploadFolderHandler,
        rag_query_handlers_1.GetAllDocumentsHandler,
        rag_query_handlers_1.GetAllImagesHandler,
        rag_query_handlers_1.GetImagesByKeywordHandler,
        rag_query_handlers_1.RetrieveDocumentsHandler])
], RagModule);
//# sourceMappingURL=rag.module.js.map