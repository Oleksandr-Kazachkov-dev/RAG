import { ConfigService } from '@nestjs/config';
import { IImageDocumentRepository } from '../../domain/repositories/image-document.repository';
import { IUploadedFile } from "../../domain/interfaces/upload-folder.interface";
import { LoggerPort } from "../../shared/application/ports/logger.port";
import { IUploadImage, IDeleteImage, IImageWithScore, IImageWithoutScore } from '../common/interfaces/image.interfaces';
import { IStoragePort } from "../../domain/ports/storage.port";
import { IChatLlmPort } from "../../domain/ports/chat-llm.port";
import { IEmbeddingPort } from "../../domain/ports/embedding.port";
import { ImageRagPort } from "../../domain/ports/image-rag.port";
export declare class ImageRagService implements ImageRagPort {
    private readonly configService;
    private readonly embeddingPort;
    private readonly chatLlm;
    private readonly storage;
    private readonly imageRepository;
    private readonly logger;
    constructor(configService: ConfigService, embeddingPort: IEmbeddingPort, chatLlm: IChatLlmPort, storage: IStoragePort, imageRepository: IImageDocumentRepository, logger: LoggerPort);
    uploadImages(files: IUploadedFile[]): Promise<IUploadImage>;
    deleteImageById(id: string): Promise<IDeleteImage>;
    getImagesByKeyword(query: string, limit?: number): Promise<Array<IImageWithScore>>;
    getAllImages(limit?: number): Promise<Array<IImageWithoutScore>>;
}
