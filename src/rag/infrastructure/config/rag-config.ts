import { registerAs } from '@nestjs/config';

export const RAG_CONFIG = 'rag-config';

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

  qdrantUrl: string;

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

export const ragConfig = registerAs(RAG_CONFIG, (): TRagConfig => {
  const {
    OLLAMA_BASE_URL,
    OLLAMA_EMBED_MODEL_TEXT,
    OLLAMA_EMBED_MODEL_IMAGE,
    OLLAMA_CHAT_MODEL,
    OLLAMA_VISION_MODEL,

    QDRANT_URL,

    S3_ENDPOINT,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_BUCKET_NAME,
    S3_REGION,
    S3_USE_SSL,
    S3_PUBLIC_URL,

    TEXT_RAG_COLLECTION_NAME,
    TEXT_RAG_DEFAULT_LIMIT,
    TEXT_RAG_VECTOR_SIZE,
    TEXT_RAG_HNSW_M,
    TEXT_RAG_HNSW_EF_CONSTRUCT,
    TEXT_RAG_HNSW_EF_SEARCH,
    TEXT_RAG_MIN_SCORE_THRESHOLD,

    IMAGE_RAG_COLLECTION_NAME,
    IMAGE_RAG_VECTOR_SIZE,
    IMAGE_RAG_MIN_SCORE_THRESHOLD,
    IMAGE_RAG_HNSW_M,
    IMAGE_RAG_HNSW_EF_CONSTRUCT,
    IMAGE_RAG_HNSW_EF_SEARCH,
  } = process.env;

  const parseHnswConfig = (
    m?: string,
    efConstruct?: string,
    efSearch?: string,
  ): HnswConfig | undefined => {
    if (!m || !efConstruct) return undefined;
    return {
      m: Number(m),
      efConstruct: Number(efConstruct),
      efSearch: efSearch ? Number(efSearch) : undefined,
    };
  };

  return {
    ollamaBaseUrl: OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    ollamaEmbedModelText: OLLAMA_EMBED_MODEL_TEXT || 'nomic-embed-text',
    ollamaEmbedModelImage: OLLAMA_EMBED_MODEL_IMAGE || 'clip-text',
    ollamaChatModel: OLLAMA_CHAT_MODEL || 'gemma3:4b',
    ollamaVisionModel: OLLAMA_VISION_MODEL || 'llama3.2-vision',
    

    qdrantUrl: QDRANT_URL || 'http://localhost:6333',

    s3Endpoint: S3_ENDPOINT,
    s3AccessKey: S3_ACCESS_KEY ?? '',
    s3SecretKey: S3_SECRET_KEY ?? '',
    s3BucketName: S3_BUCKET_NAME || 'rag-images',
    s3Region: S3_REGION || 'us-east-1',
    s3UseSsl: S3_USE_SSL === 'true',

    s3PublicUrl: S3_PUBLIC_URL,

    textRagCollectionName: TEXT_RAG_COLLECTION_NAME || 'rag_text',
    textRagDefaultLimit: TEXT_RAG_DEFAULT_LIMIT
      ? Number(TEXT_RAG_DEFAULT_LIMIT)
      : 6,
    textRagVectorSize: TEXT_RAG_VECTOR_SIZE
      ? Number(TEXT_RAG_VECTOR_SIZE)
      : 768,
    textRagHnswConfig: parseHnswConfig(
      TEXT_RAG_HNSW_M,
      TEXT_RAG_HNSW_EF_CONSTRUCT,
      TEXT_RAG_HNSW_EF_SEARCH,
    ),
    textRagScoreThreshold: TEXT_RAG_MIN_SCORE_THRESHOLD 
      ? Number(TEXT_RAG_MIN_SCORE_THRESHOLD) 
      : 0.65,

    imageRagCollectionName: IMAGE_RAG_COLLECTION_NAME || 'rag_images',
    imageRagVectorSize: IMAGE_RAG_VECTOR_SIZE
      ? Number(IMAGE_RAG_VECTOR_SIZE)
      : 768,
    imageRagMinScoreThreshold: IMAGE_RAG_MIN_SCORE_THRESHOLD
      ? Number(IMAGE_RAG_MIN_SCORE_THRESHOLD)
      : 0.55,
    imageRagHnswConfig: parseHnswConfig(
      IMAGE_RAG_HNSW_M,
      IMAGE_RAG_HNSW_EF_CONSTRUCT,
      IMAGE_RAG_HNSW_EF_SEARCH,
    ),
  };
});
