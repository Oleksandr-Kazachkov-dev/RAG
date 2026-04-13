import { IDeleteImage, IImageWithScore, IImageWithoutScore, IUploadImage } from "../../application/common/interfaces/image.interfaces";
import { IUploadedFile } from "../interfaces/upload-folder.interface";
export interface ImageRagPort {
    deleteImageById(id: string): Promise<IDeleteImage>;
    getImagesByKeyword(query: string, limit?: number): Promise<Array<IImageWithScore>>;
    getAllImages(limit?: number): Promise<Array<IImageWithoutScore>>;
    uploadImages(files: IUploadedFile[]): Promise<IUploadImage>;
}
