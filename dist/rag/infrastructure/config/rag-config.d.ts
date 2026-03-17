export declare const RAG_CONFIG = "rag-config";
export interface HnswConfig {
    m: number;
    efConstruct: number;
    efSearch?: number;
}
export type TRagConfig = {
    ollamaBaseUrl: string;
    ollamaEmbedModelText: string;
    ollamaEmbedModelImage: string;
    ollamaChatModel: string;
    ollamaVisionModel: string;
    ollamaApiKey: string | undefined;
    qdrantUrl: string;
    qdrantApiKey: string | undefined;
    s3Endpoint: string | undefined;
    s3AccessKey: string;
    s3SecretKey: string;
    s3BucketName: string;
    s3Region: string;
    s3UseSsl: boolean;
    s3PublicUrl?: string;
    textRagCollectionName: string;
    textRagDefaultLimit: number;
    textRagVectorSize: number;
    textRagHnswConfig?: HnswConfig;
    textRagScoreThreshold: number;
    imageRagCollectionName: string;
    imageRagVectorSize: number;
    imageRagMinScoreThreshold: number;
    imageRagHnswConfig?: HnswConfig;
};
export declare const ragConfig: (() => TRagConfig) & import("@nestjs/config").ConfigFactoryKeyHost<TRagConfig>;
