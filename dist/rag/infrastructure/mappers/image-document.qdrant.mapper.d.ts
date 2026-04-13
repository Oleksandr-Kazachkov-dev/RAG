import { Schemas } from '@qdrant/js-client-rest';
import { ImageDocument } from "../../domain/entities/image-document.entity";
export declare class ImageDocumentQdrantMapper {
    static toPoint(doc: ImageDocument): {
        id: string;
        vector: number[];
        payload: {
            s3Url: string;
            s3Key: string;
            mimeType: string;
            description: string;
            keywords: string[];
            createdAt: string;
            model: string;
        };
    };
    static fromPoint(point: Schemas['ScoredPoint'] | Schemas['Record'], score?: number): ImageDocument;
}
