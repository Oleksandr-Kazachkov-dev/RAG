import { Schemas } from '@qdrant/js-client-rest';
import { TextDocument } from "../../domain/entities/text-document.entity";
export declare class TextDocumentQdrantMapper {
    static toPoint(doc: TextDocument): {
        id: string;
        vector: number[];
        payload: {
            text: string;
            createdAt: string;
            model: string;
            chunkId: string | undefined;
            level: number | undefined;
            startIndex: number | undefined;
            endIndex: number | undefined;
            childIds: string[] | undefined;
            parentId: string | undefined;
            parentText: string | undefined;
            contextKeywords: string[] | undefined;
        };
    };
    static fromPoint(point: Schemas['ScoredPoint'] | Schemas['Record'], model?: string): TextDocument;
}
