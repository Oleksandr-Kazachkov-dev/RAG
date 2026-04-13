import { CommandBusPort } from '../../shared/application/ports/command-bus.port';
import { ApiResponse } from '../api-response/api-response';
import { IUploadImage, IImageWithScore, IImageWithoutScore, IDeleteImage } from "../../application/common/interfaces/image.interfaces";
export declare class RagImagesController {
    private readonly commandBus;
    constructor(commandBus: CommandBusPort);
    uploadImages(files: Express.Multer.File[]): Promise<ApiResponse<IUploadImage>>;
    searchImages(query: string, limit?: string): Promise<ApiResponse<IImageWithScore[]>>;
    getAllImages(limit?: string): Promise<ApiResponse<IImageWithoutScore[]>>;
    deleteImage(id: string): Promise<ApiResponse<IDeleteImage>>;
}
