export interface IDocumentWithEmbedding {
  id: string;
  text: string;
  embedding: number[];
  createdAt: string;
  model: string;
  score?: number;
  metadata?: Record<string, any>;
  parentId?: string;
  parentText?: string;
}

export interface IDocumentWithoutEmbedding {
  id: string;
  text: string;
  createdAt: string;
  model: string;
  metadata?: Record<string, any>;
}

export interface ICitation {
  id: string;
  documentId: string;
  text: string;
}

export interface IGenerateAnswer {
  answer: string;
  formattedAnswer?: string;
  citations?: ICitation[];
  relevantChunks?: number;
  confidence?: number;
  queryType?: 'entity' | 'factual' | 'wide';
  queryConfidence?: number;
  generationParams?: {
    temperature: number;
    topP?: number;
    topK?: number;
    maxTokens: number;
    repeatPenalty?: number;
    seed?: number;
  };
  knowledgeGraphContext?: string;
  conversationContext?: boolean;
  sources?: Array<{
    id: string;
    text: string;
    score?: number;
    metadata?: Record<string, any>;
  }>;
}

export interface IUploadKnowledge {
  chunks: number;
  metadata?: Record<string, any>;
}

export interface IDeleteDocument {
  deletedDocumentId: string;
}

export type IStreamChunk =
  | {
      event: 'metadata';
      metadata: Partial<Omit<IGenerateAnswer, 'answer' | 'formattedAnswer' | 'sources'>>;
    }
  | {
      event: 'sources';
      sources: NonNullable<IGenerateAnswer['sources']>;
    }
  | {
      event: 'token';
      token: string;
    }
  | {
      event: 'citations';
      citations: ICitation[];
    }
  | {
      event: 'correction';
      correctedAnswer: string;
      reason: 'hallucination';
    }
  | {
      event: 'done';
      metadata: Partial<Omit<IGenerateAnswer, 'answer' | 'formattedAnswer' | 'sources'>>;
    }
  | {
      event: 'error';
      error: string;
    };