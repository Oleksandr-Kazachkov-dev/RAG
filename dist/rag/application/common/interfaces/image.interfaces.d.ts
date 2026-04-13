import { Embedding } from "../../../domain/value-objects/embedding.vo";
import { SimilarityScore } from "../../../domain/value-objects/similarity-score.vo";
export interface IUploadImage {
    imagesUploaded: number;
}
export interface IDeleteImage {
    deletedImageId: string;
}
export interface IImageWithScore extends IImageWithoutScore {
    s3Key: string;
    similarityScore?: SimilarityScore;
    embedding: Embedding | number[];
}
export interface IImageWithoutScore {
    id: string;
    s3Url: string;
    mimeType: string;
    description?: string;
    keywords: string[];
    createdAt: string;
    model: string;
}
