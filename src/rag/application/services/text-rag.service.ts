import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from "@upstash/redis"
import { v4 as uuidv4 } from 'uuid';
import { OllamaService } from 'src/rag/infrastructure/ollama/ollama.service';
import { RagQdrantService } from 'src/rag/infrastructure/qdrant/rag-qdrant.service';
import { ITextDocumentRepository } from '../../domain/repositories/text-document.repository';
import { TextDocument } from '../../domain/entities/text-document.entity';
import { Embedding } from '../../domain/value-objects/embedding.vo';
import { chunkTextBySentences } from '../utils/text-chunk.util';
import { extractEmbedding } from '../utils/embedding.util';
import { extractFileText } from '../utils/file-text.util';
import { RAG_CONFIG, TRagConfig } from '../../infrastructure/config/rag-config';
import {
  IDeleteDocument,
  IDocumentWithEmbedding,
  IDocumentWithoutEmbedding,
  IGenerateAnswer,
  IStreamChunk,
  IUploadKnowledge,
} from '../common/interfaces/rag-documents.interfaces';
import { TextRagPort } from 'src/rag/domain/ports/textRagPort';
import { UploadFolderOptions } from '../commands/upload-folder.command';
import { PromptInjectionGuard } from '../guards/prompt-injection.guard';
import {
  semanticChunking,
  parentChildChunking,
  ChunkMetadata,
} from '../utils/advanced-chunking.util';
import { QueryTransformer, translateQueryToUkrainian } from '../utils/query-transformer.util';
import { Reranker } from '../utils/reranker.util';
import { HybridSearchEngine, HybridSearchResult } from '../utils/hybrid-search.util';
import { ContextualCompressor } from '../utils/contextual-compression.util';
import {
  IKnowledgeGraphService,
  KnowledgeGraphEntity,
} from '../../infrastructure/neo4j/neo4j-knowledge-graph.service';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import { IConversationSessionRepository } from 'src/rag/domain/ports/conversation-session.repository.port';
import { AskQuestionOptions } from '../commands/ask-question.command';
import {
  isEntityQuery,
  enrichKeywordsWithVariants,
  generateNameVariants,
  cyrillicToLatin,
} from '../utils/transliteration.util';
import { SearchMode } from '../../infrastructure/qdrant/rag-qdrant.service';
import { QueryClassifier, FineTuningParams, QueryClassification } from '../utils/query-classefire.util';
import { IConfidencePort } from '../../domain/ports/confidence.port';
import { LinkService } from './link.service';

const MIN_CHUNK_TEXT_LENGTH = 80;
const UPLOAD_CONCURRENCY    = 3;
const EMBED_BATCH_SIZE      = 10;
const MAX_CONTEXT_CHARS     = 6000;

const RRF_K = 60;

const KEYWORD_STOP_WORDS = new Set([
  'what', 'is', 'are', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'and', 'or', 'but', 'how', 'when',
  'where', 'who', 'which', 'does', 'do', 'did', 'has', 'have', 'had',
  'can', 'could', 'would', 'should', 'will', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 'tell', 'me', 'about',
  'що', 'як', 'де', 'коли', 'хто', 'чому', 'який', 'яка', 'яке', 'які',
  'чи', 'або', 'та', 'це', 'є', 'у', 'в', 'на', 'до', 'по', 'про', 'за',
]);

const FACTUAL_SCORE_THRESHOLD_CAP = 0.65;

// Max classification cache entries before LRU eviction
const CLASSIFICATION_CACHE_MAX = 500;

interface TrackCitation {
  id: string;
  documentId: string;
  text: string;
}

interface RetrieveInternalOptions extends Pick<
  AskQuestionOptions,
  | 'useHybridSearch'
  | 'useReranking'
  | 'rerankStrategy'
  | 'useQueryTransformation'
  | 'useContextualCompression'
  | 'useConversationMemory'
  | 'sessionId'
  | 'scoreThreshold'
  | 'filters'
> {
  limit?: number;
  _searchMode?: SearchMode | 'entity';
}

// Returned by prepareGenerationContext on success
interface PreparedContext {
  classification: QueryClassification;
  p: FineTuningParams;
  retrieved: IDocumentWithEmbedding[];
  prompt: string;
  generationParams: GenerationParams;
}

interface GenerationParams {
  temperature: number;
  topP: number | undefined;
  topK: number | undefined;
  maxTokens: number;
  repeatPenalty: number | undefined;
  seed: number | undefined;
}

function reciprocalRankFusion(
  allResults: Array<Array<{ id: string; score: number }>>,
  k = RRF_K,
): Map<string, number> {
  const rrfScores = new Map<string, number>();
  for (const results of allResults) {
    const sorted = [...results].sort((a, b) => b.score - a.score);
    sorted.forEach((r, rank) => {
      rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return rrfScores;
}

@Injectable()
export class TextRagService implements TextRagPort {
  private queryTransformer: QueryTransformer;
  private reranker: Reranker;
  private hybridSearch: HybridSearchEngine;
  private contextualCompressor: ContextualCompressor;
  private queryClassifier: QueryClassifier;

  // ── Classification cache (LRU-lite: evict oldest when full) ──────────────
  private readonly classificationCache = new Map<string, QueryClassification>();

  constructor(
    private readonly configService: ConfigService,
    private readonly ollama: OllamaService,
    private readonly qdrantService: RagQdrantService,
    @Inject('ITextDocumentRepository')
    private readonly textRepository: ITextDocumentRepository,
    @Inject('IConversationSessionRepository')
    private readonly conversationRepository: IConversationSessionRepository,
    @Inject('IKnowledgeGraphPort')
    private readonly knowledgeGraph: IKnowledgeGraphService,
    @Inject('LoggerPort')
    private readonly logger: LoggerPort,
    @Inject('IConfidencePort')
    private readonly confidencePort: IConfidencePort,
    private readonly linkService: LinkService,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {
    this.queryTransformer     = new QueryTransformer(this.ollama, this.redis);
    this.reranker             = new Reranker(this.ollama);
    this.hybridSearch         = new HybridSearchEngine(this.qdrantService, this.configService);
    this.contextualCompressor = new ContextualCompressor(this.ollama);
    this.queryClassifier      = new QueryClassifier(this.ollama);
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async uploadKnowledgeFromFile(
    file: Express.Multer.File,
    options?: UploadFolderOptions,
  ): Promise<IUploadKnowledge> {
    const ragConfig  = this.configService.get<TRagConfig>(RAG_CONFIG);
    const embedModel = ragConfig?.ollamaEmbedModelText || 'nomic-embed-text';
    const {
      chunkingStrategy     = 'simple',
      enableKnowledgeGraph = false,
    } = options || {};

    const text = await extractFileText(file);
    this.logger.log('Processing file', { name: file.originalname, strategy: chunkingStrategy });

    let savedCount = 0;

    if (chunkingStrategy === 'semantic') {
      savedCount = await this.uploadWithSemantic(text, embedModel);
    } else if (chunkingStrategy === 'parent-child') {
      savedCount = await this.uploadWithParentChild(file, text, embedModel, options);
    } else {
      savedCount = await this.uploadWithSimple(text, embedModel);
    }

    this.logger.log(`Saved ${savedCount} documents to vector store`);

    if (enableKnowledgeGraph) {
      this.logger.log('Extracting knowledge graph...');
      await this.extractKnowledgeGraph(text, file.originalname);
    }

    return { chunks: savedCount };
  }

  async uploadMarkdownFolder(
    files: Express.Multer.File[],
    options?: UploadFolderOptions,
  ): Promise<{ totalChunks: number; filesProcessed: number }> {
    let totalChunks    = 0;
    let filesProcessed = 0;
    let filesFailed    = 0;

    for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
      const batch   = files.slice(i, i + UPLOAD_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(file => this.uploadKnowledgeFromFile(file, options)),
      );

      for (let j = 0; j < results.length; j++) {
        const res  = results[j];
        const file = batch[j];
        if (res.status === 'fulfilled') {
          this.logger.log('File processed', { name: file.originalname, chunks: res.value.chunks });
          totalChunks += res.value.chunks;
          filesProcessed++;
        } else {
          this.logger.error(`Failed to process ${file.originalname}`, res.reason);
          filesFailed++;
        }
      }
    }

    if (filesFailed > 0) {
      this.logger.warn('uploadMarkdownFolder: some files failed', {
        filesProcessed,
        filesFailed,
        total: files.length,
      });
    }

    return { totalChunks, filesProcessed };
  }

  private async uploadWithSimple(text: string, embedModel: string): Promise<number> {
    const rawChunks = chunkTextBySentences(text, { minWords: 20, maxWords: 150 });
    const chunks    = rawChunks.filter(t => t.trim().length >= MIN_CHUNK_TEXT_LENGTH);
    this.logger.log(`Generated ${chunks.length} simple chunks (after min-length filter)`);
    return this.embedAndSaveChunks(chunks, embedModel);
  }

  private async uploadWithSemantic(text: string, embedModel: string): Promise<number> {
    const semanticChunks = await semanticChunking(text, this.ollama, {
      minChunkSize: 100,
      maxChunkSize: 500,
    });
    const chunks = semanticChunks
      .map(c => c.text)
      .filter(t => t.trim().length >= MIN_CHUNK_TEXT_LENGTH);
    this.logger.log(`Generated ${chunks.length} semantic chunks (after min-length filter)`);
    return this.embedAndSaveChunks(chunks, embedModel);
  }

  private async uploadWithParentChild(
    file: Express.Multer.File,
    text: string,
    embedModel: string,
    options?: UploadFolderOptions,
  ): Promise<number> {
    const ragConfig  = this.configService.get<TRagConfig>(RAG_CONFIG);
    const vectorSize = ragConfig?.textRagVectorSize ?? 768;
    const pcOpts     = options?.parentChild ?? {};
    const fileId     = this.buildFileId(file.originalname);

    const rawText  = file.buffer.toString('utf-8');
    const keywords = await this.prepareKeywordsForFile(text, file.originalname, rawText);
    this.logger.log(`Keywords ready for ${file.originalname}`, {
      total:  keywords.length,
      sample: keywords.slice(0, 12),
    });

    const collectedParents: Array<{ text: string; metadata: ChunkMetadata }> = [];
    const collectedChildren: Array<{ text: string; metadata: ChunkMetadata }> = [];

    await parentChildChunking(
      text,
      async (chunk: { text: string; metadata: ChunkMetadata }) => {
        if (chunk.metadata.level === 0) {
          collectedParents.push(chunk);
        } else {
          collectedChildren.push(chunk);
        }
      },
      {
        parentSize:         pcOpts.parentSize         ?? 4000,
        childSize:          pcOpts.childSize          ?? 1200,
        overlap:            pcOpts.overlap            ?? 150,
        storeParentText:    pcOpts.storeParentText    ?? true,
        useMarkdownHeaders: pcOpts.useMarkdownHeaders ?? true,
        fileId,
      },
    );

    if (collectedParents.length > 0) {
      const parentDocs = collectedParents.map(chunk =>
        TextDocument.create(
          chunk.metadata.chunkId,
          chunk.text,
          new Array(vectorSize).fill(0),
          embedModel,
          new Date(),
          chunk.metadata.chunkId,
          0,
          chunk.metadata.startIndex,
          chunk.metadata.endIndex,
          chunk.metadata.childIds,
          undefined,
          undefined,
          keywords,
        ),
      );
      await this.textRepository.saveMany(parentDocs);
      this.logger.log(`Saved ${parentDocs.length} parent blocks`);
    }

    const validChildren = collectedChildren.filter(chunk => {
      const hasUrl = /https?:\/\/\S+|\b[\w-]+\.[\w-]+\.\w{2,}\b/.test(chunk.text);
      if (chunk.text.trim().length < MIN_CHUNK_TEXT_LENGTH && !hasUrl) {
        this.logger.log(
          `Skipping micro-chunk (${chunk.text.trim().length} chars): "${chunk.text.trim().slice(0, 60)}"`,
        );
        return false;
      }
      return true;
    });

    let savedCount = 0;

    for (let i = 0; i < validChildren.length; i += EMBED_BATCH_SIZE) {
      const batch      = validChildren.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await Promise.all(batch.map(c => this.ollama.embed(c.text)));

      const docs = batch.map((chunk, idx) =>
        TextDocument.create(
          uuidv4(),
          chunk.text,
          extractEmbedding(embeddings[idx]),
          embedModel,
          new Date(),
          chunk.metadata.chunkId,
          chunk.metadata.level,
          chunk.metadata.startIndex,
          chunk.metadata.endIndex,
          chunk.metadata.childIds,
          chunk.metadata.parentId,
          chunk.metadata.parentText,
          keywords,
        ),
      );

      await this.textRepository.saveMany(docs);
      savedCount += docs.length;
    }

    this.logger.log(`Saved ${savedCount} child chunks (parent-child strategy)`);
    return savedCount;
  }

  private async prepareKeywordsForFile(
    normalizedText: string,
    filename: string,
    rawText: string,
  ): Promise<string[]> {
    const [textKws, pathKws] = await Promise.all([
      this.extractTextKeywords(normalizedText),
      this.extractFilepathKeywords(filename),
    ]);

    const headerKws = this.extractHeaderKeywords(rawText);
    const urlKws    = this.extractUrlKeywords(rawText);

    const merged    = [...new Set([...textKws, ...pathKws, ...headerKws, ...urlKws])];
    const sanitized = this.sanitizeKeywords(merged);
    const enriched  = enrichKeywordsWithVariants(sanitized);

    this.logger.log('Keyword pipeline result', {
      fromText:      textKws.length,
      fromPath:      pathKws.length,
      fromHeaders:   headerKws.length,
      fromUrls:      urlKws.length,
      afterSanitize: sanitized.length,
      afterEnrich:   enriched.length,
    });

    return enriched;
  }

  private sanitizeKeywords(keywords: string[]): string[] {
    return keywords.filter(kw => {
      if (!/[a-zA-Z\u0400-\u04FF]/u.test(kw)) return false;
      if (kw.includes('\uFFFD')) return false;
      if (/%[0-9a-f]{2}/i.test(kw)) return false;

      const chars   = kw.replace(/\s/g, '');
      const total   = chars.length;
      if (total === 0) return false;

      const mojibake = (kw.match(/[\u00C0-\u00FF]/g) ?? []).length;
      if (mojibake / total > 0.3) return false;

      const nonWord = (kw.match(/[^\w\u0400-\u04FF\s\-]/gu) ?? []).length;
      if (nonWord / total > 0.4) return false;

      return true;
    });
  }

  private extractNameTokens(query: string): string[][] {
    const STOPS = new Set([
      'who', 'what', 'where', 'when', 'why', 'how', 'which', 'is', 'are', 'was',
      'were', 'does', 'do', 'did', 'has', 'have', 'had', 'the', 'a', 'an', 'and',
      'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
      'tell', 'me', 'about', 'describe', 'explain', 'give', 'list', 'show',
      'find', 'get', 'can', 'could', 'please', 'you', 'know', 'say',
      'this', 'that', 'these', 'those', 'he', 'she', 'they', 'his', 'her',
      'що', 'як', 'де', 'коли', 'хто', 'чому', 'який', 'яка', 'яке', 'які',
      'чи', 'або', 'та', 'це', 'є', 'у', 'в', 'на', 'до', 'по', 'про', 'за',
      'розкажи', 'підкажи', 'поясни', 'опиши', 'покажи', 'дай', 'знайди',
      'такий', 'така', 'таке', 'такі', 'про',
    ]);

    return query
      .replace(/[?!.,;:'"]/g, '')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !STOPS.has(t.toLowerCase()))
      .map(t => generateNameVariants(t));
  }

  private extractHeaderKeywords(rawText: string): string[] {
    const HEADER_RE = /^#{1,3}\s+(.+)$/gm;
    const keywords  = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = HEADER_RE.exec(rawText)) !== null) {
      const line = m[1].replace(/[*_`~]/g, '');
      line
        .split(/[\s\-–—/|,;:()[\]{}]+/)
        .flatMap(w => w.split(/(?=[A-Z])/))
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 1)
        .forEach(w => keywords.add(w));
    }

    return [...keywords].slice(0, 40);
  }

  private extractUrlKeywords(text: string): string[] {
    const keywords = new Set<string>();
    let m: RegExpExecArray | null;

    const URL_RE = /https?:\/\/([^\s"'<>]+)/g;
    while ((m = URL_RE.exec(text)) !== null) {
      this.splitDomainParts(m[1], keywords);
    }

    const DOMAIN_RE = /\b((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.){1,5}[a-zA-Z]{2,10})\b/g;
    const fullUrlRanges: Array<[number, number]> = [];
    for (const urlMatch of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      fullUrlRanges.push([urlMatch.index!, urlMatch.index! + urlMatch[0].length]);
    }
    while ((m = DOMAIN_RE.exec(text)) !== null) {
      const start = m.index!;
      const inUrl = fullUrlRanges.some(([s, e]) => start >= s && start < e);
      if (!inUrl) {
        this.splitDomainParts(m[1], keywords);
      }
    }

    return [...keywords].slice(0, 50);
  }

  private splitDomainParts(raw: string, out: Set<string>): void {
    const TLD = new Set(['com', 'ua', 'net', 'org', 'io', 'co', 'www', 'http', 'https']);
    raw
      .split(/[./\-_?&#=+:→[\]()\\ |,\s]/)
      .map(s => s.toLowerCase().trim())
      .filter(s =>
        s.length > 1 &&
        s.length < 30 &&
        !/^\d+$/.test(s) &&
        !/%[0-9a-f]{2}/i.test(s) &&
        !/^[a-z0-9]{20,}$/.test(s) &&
        !TLD.has(s),
      )
      .forEach(s => out.add(s));
  }

  private async extractTextKeywords(text: string): Promise<string[]> {
    const sample = text.slice(0, 2000);
    try {
      const prompt =
        `Extract 10-15 most important keywords from this document text.\n` +
        `Focus on: main topics, technologies, key processes, important terminology.\n` +
        `Return ONLY comma-separated lowercase keywords in both Ukrainian and English.\n` +
        `Do NOT translate or modify proper names (person names, company names).\n` +
        `Example: react, frontend, компоненти, components, state, стан\n\n` +
        `Text:\n${sample}\n\nKeywords:`;

      const response = await this.ollama.getRagResponseByPrompt(prompt, {
        temperature: 0.2, maxTokens: 150,
      });

      const keywords = response
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(k => k.length > 2 && k.length < 30);

      return [...new Set(keywords)].slice(0, 20);
    } catch (error) {
      this.logger.warn('Text keyword extraction failed, falling back to frequency', {
        error: error.message,
      });
      return this.frequencyKeywords(sample);
    }
  }

  private async extractFilepathKeywords(filepath: string): Promise<string[]> {
    const keywords = new Set<string>();
    for (const part of filepath.replace(/\.md$/i, '').split(/[/\\]/)) {
      part
        .split(/[\s_-]+/)
        .flatMap(w => w.split(/(?=[A-Z])/))
        .map(w => w.toLowerCase())
        .filter(w => w.length > 2)
        .forEach(w => keywords.add(w));
    }
    return [...keywords].slice(0, 10);
  }

  private frequencyKeywords(sample: string): string[] {
    const STOP = new Set(['який', 'якщо', 'також', 'this', 'that', 'which']);
    const words = sample
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && !STOP.has(w));
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
  }

  private async embedAndSaveChunks(
    chunks: string[],
    embedModel: string,
    batchSize = 100,
  ): Promise<number> {
    const documents: TextDocument[] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch      = chunks.slice(i, Math.min(i + batchSize, chunks.length));
      const embeddings = await Promise.all(batch.map(c => this.ollama.embed(c)));
      const batchDocs  = batch.map((chunk, idx) =>
        TextDocument.create(
          uuidv4(), chunk, extractEmbedding(embeddings[idx]), embedModel, new Date(),
        ),
      );
      documents.push(...batchDocs);
      await this.textRepository.saveMany(batchDocs);
    }
    return documents.length;
  }

  private buildFileId(originalname: string): string {
    return originalname
      .replace(/\.md$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase()
      .substring(0, 50);
  }

  private async classifyQuery(query: string): Promise<QueryClassification> {
    const key = `classification:${query.trim().toLowerCase().slice(0, 120)}`;

    try {
      const cached = await this.redis.get<QueryClassification>(key);

      if (cached) {
        return cached;
      }
    } catch (err: any) {
      this.logger.warn('classifyQuery: Redis get failed', { error: err?.message });
    }

    const result = await this.queryClassifier.classify(query);

    try {
      await this.redis.set(
        key,
        JSON.stringify(result),
        { ex: 60 * 60 }
      );
    } catch (err: any) {
      this.logger.warn('classifyQuery: Redis set failed', { error: err?.message });
    }

    return result;
  }

  async retrieve(
    query: string,
    limit?: number,
    options?: RetrieveInternalOptions,
  ): Promise<Array<IDocumentWithEmbedding> | string> {
    const ragConfig      = this.configService.get<TRagConfig>(RAG_CONFIG);
    const effectiveLimit = limit ?? options?.limit ?? ragConfig?.textRagDefaultLimit ?? 6;

    const {
      useHybridSearch,
      useReranking,
      rerankStrategy,
      useQueryTransformation,
      useContextualCompression,
      useConversationMemory,
      sessionId,
      scoreThreshold,
      _searchMode,
    } = options || {};

    const entityQuery    = isEntityQuery(query);
    const collectionName = ragConfig?.textRagCollectionName;
    if (!collectionName) return 'RAG text collection name is not configured';

    const searchMode: SearchMode | 'entity' = _searchMode ?? (entityQuery ? 'entity' : 'balanced');

    let keywords: string[]       = [];
    let queriesToEmbed: string[] = [query];

    let uaStartIndex = -1;
    let uaTranslations: string[] = [];

    if (useQueryTransformation) {
      try {
        const transformed = await this.queryTransformer.transformQuery(query);

        keywords = transformed.keywords.filter(
          kw => kw.length > 2 && !KEYWORD_STOP_WORDS.has(kw.toLowerCase()),
        );

        const isShortQuery = query.trim().split(/\s+/).length <= 3;
        queriesToEmbed = isShortQuery
          ? [transformed.original, ...transformed.expanded.slice(0, 1)].filter(Boolean)
          : [
              transformed.original,
              ...transformed.expanded.slice(0, 2),
              ...transformed.rephrased.slice(0, 1),
            ].filter(Boolean).slice(0, 4);

        uaTranslations = translateQueryToUkrainian(query);

        if (uaTranslations.length > 0) {
          this.logger.log('EN→UA query translation', { query, uaTranslations });

          const beforeLen = queriesToEmbed.length;
          queriesToEmbed = [...new Set([...queriesToEmbed, ...uaTranslations])].slice(0, 6);

          if (queriesToEmbed.length > beforeLen) {
            uaStartIndex = beforeLen;
          }
        }
      } catch {
        keywords = [];
      }
    }

    if (useConversationMemory && sessionId) {
      const history = await this.conversationRepository.getHistory(sessionId, 2);
      if (history.length > 0) {
        queriesToEmbed.push(
          `${query}\n\nPrevious: ${history.map(t => t.query).join('; ')}`,
        );
        queriesToEmbed = queriesToEmbed.slice(0, 6);
      }
    }

    const embeddings       = await Promise.all(queriesToEmbed.map(q => this.ollama.embed(q)));
    const primaryEmbedding = new Embedding(extractEmbedding(embeddings[0]));

    let results: Array<{ id: string; text: string; score: number }> = [];

    const effectivenessLimit = (searchMode === 'entity' ? 6 : 4) * effectiveLimit;

    if (useHybridSearch) {
      let allSearchResults = await Promise.all(
        embeddings.map(emb =>
          this.hybridSearch.search(
            collectionName,
            new Embedding(extractEmbedding(emb)),
            keywords,
            effectivenessLimit,
            {
              searchMode,
              minTextLength:  MIN_CHUNK_TEXT_LENGTH,
              originalQuery:  query,
              ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
            },
          ),
        ),
      );

      const isCompletelyEmpty = allSearchResults.every(arr => arr!.length === 0);

      if (isCompletelyEmpty) {
        allSearchResults = await Promise.all(
          embeddings.map(emb =>
            this.hybridSearch.search(
              collectionName,
              new Embedding(extractEmbedding(emb)),
              keywords,
              effectivenessLimit,
              {
                searchMode,
                minTextLength:  MIN_CHUNK_TEXT_LENGTH,
                originalQuery:  query,
              },
            ),
          ),
        );
      }

      const validResults = allSearchResults.filter(Boolean) as NonNullable<typeof allSearchResults[0]>[];

      if (validResults.length === 0) return 'There is no relevant information in knowledge';

      const resultById = new Map<string, HybridSearchResult>();
      const perQueryForRrf: Array<Array<{ id: string; score: number }>> = [];

      for (const searchResults of validResults) {
        if (searchResults.length === 0) continue;
        perQueryForRrf.push(
          searchResults.map(r => {
            if (!resultById.has(r.id)) resultById.set(r.id, r);
            return { id: r.id, score: r.hybridScore };
          }),
        );
      }

      const rrfScores = reciprocalRankFusion(perQueryForRrf);

      if (uaStartIndex >= 0 && uaTranslations.length > 0 && collectionName) {
        try {
          const uaEmbeddings   = embeddings.slice(uaStartIndex);
          const uaSearchResults = await Promise.all(
            uaEmbeddings.map(emb =>
              this.qdrantService.search(collectionName, {
                vector:          extractEmbedding(emb),
                limit:           effectivenessLimit,
                searchMode:      'wide',
                score_threshold: null,
              }),
            ),
          );
          let uaAdded = 0;
          for (const points of uaSearchResults) {
            for (const p of points) {
              const id   = p.id.toString();
              const text = (p.payload?.text as string) ?? '';
              if (text.trim().length < MIN_CHUNK_TEXT_LENGTH) continue;

              if (!resultById.has(id)) {
                resultById.set(id, {
                  id,
                  text,
                  parentText:   p.payload?.parentText as string | undefined,
                  parentId:     p.payload?.parentId  as string | undefined,
                  vectorScore:  p.score ?? 0,
                  keywordScore: 0,
                  hybridScore:  p.score ?? 0,
                });
                uaAdded++;
              }

              const existingRrf = rrfScores.get(id) ?? 0;
              rrfScores.set(id, existingRrf + (p.score ?? 0) * 0.9 / (RRF_K + 1));
            }
          }
          this.logger.log('UA vector search merged', { uaAdded, total: rrfScores.size });
        } catch (err: any) {
          this.logger.warn('UA vector search failed', { error: err?.message });
        }
      }

      results = [...rrfScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, rrfScore]) => ({
          id,
          text:  resultById.get(id)?.text ?? '',
          score: rrfScore,
        }))
        .filter(r => r.text.length > 0);

    } else {
      const vectorResults = await this.textRepository.findByEmbedding(
        primaryEmbedding,
        effectiveLimit * 3,
        {
          ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
          searchMode: entityQuery ? 'wide' : 'balanced',
        },
      );

      results = vectorResults.map(doc => ({
        id:    doc.id,
        text:  doc.text,
        score: doc.score ?? 0,
      }));

      results = results.filter(r => {
        if (r.text.trim().length < MIN_CHUNK_TEXT_LENGTH) return false;
        if (/^\[[^\]]{2,60}\][\s\\]*$/.test(r.text.trim())) return false;
        return true;
      });

      const topScores   = results.slice(0, 3).map(r => r.score ?? 0);
      const avgTopScore = topScores.length
        ? topScores.reduce((a, b) => a + b, 0) / topScores.length
        : 0;

      const entityKeywordMissing = entityQuery && keywords.length > 0 &&
        !results.slice(0, 3).some(r =>
          keywords.some(kw => r.text.toLowerCase().includes(kw.toLowerCase())),
        );

      if (avgTopScore < 0.72 || entityKeywordMissing) {
        const hybridFallback = await this.hybridSearch.search(
          collectionName, primaryEmbedding, keywords, effectiveLimit * 3,
          {
            searchMode,
            minTextLength: MIN_CHUNK_TEXT_LENGTH,
            originalQuery: query,
            ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
          },
        );
        if (!hybridFallback) return 'There is no relevant information in knowledge';
        results = hybridFallback.map(r => ({ id: r.id, text: r.text, score: r.hybridScore }));
      }
    }

    if (results.length === 0) return 'There is no relevant information in knowledge';

    if (useReranking && rerankStrategy !== 'none' && results.length > effectiveLimit && searchMode !== 'wide') {
      const reranked = await this.reranker.rerank(query, results, {
        topK:   effectiveLimit,
        method: rerankStrategy === 'cross_encoder' ? 'listwise'
              : rerankStrategy === 'llm_based'     ? 'llm'
              : 'hybrid',
      });
      results = reranked.map(r => ({ id: r.item.id, text: r.item.text, score: r.finalScore }));
    }

    const scoreFloor = (useReranking && rerankStrategy !== 'none') ? 0.0163 : 0.01;

    results = results.filter(r => r.score > scoreFloor);
    results = results.filter(r => (r as any).level !== 0);
    results = results.slice(0, effectiveLimit);

    if (searchMode === 'wide' || searchMode === 'entity') {
      const nameTokenGroups = this.extractNameTokens(query);
      if (nameTokenGroups.length > 0) {
        const chunkMatches = (text: string, groups: string[][]): boolean => {
          const lower        = text.toLowerCase();
          const translitText = cyrillicToLatin(lower);

          if (searchMode === 'entity') {
            return groups.every(variants =>
              variants.some(v => {
                const vLower = v.toLowerCase();
                return lower.includes(vLower) || translitText.includes(cyrillicToLatin(vLower));
              }),
            );
          }
          return groups.some(variants =>
            variants.some(v => {
              const vLower = v.toLowerCase();
              return lower.includes(vLower) || translitText.includes(cyrillicToLatin(vLower));
            }),
          );
        };

        let filtered = results.filter((r, i) => {
          const match = chunkMatches(r.text, nameTokenGroups);
          this.logger.log('FILTER CHECK =>', { index: i, text: r.text, match });
          return match;
        });

        if (filtered.length === 0) {
          const surnameGroup = nameTokenGroups[nameTokenGroups.length - 1];
          filtered = results.filter(r => {
            const lower        = r.text.toLowerCase();
            const translitText = cyrillicToLatin(lower);
            return surnameGroup.some(v => {
              const vLower = v.toLowerCase();
              return lower.includes(vLower) || translitText.includes(cyrillicToLatin(vLower));
            });
          });
        }

        if (filtered.length > 0) {
          this.logger.log('EntityPostFilter', {
            query,
            groups: nameTokenGroups.map(g => g.slice(0, 4)),
            before: results.length,
            after:  filtered.length,
          });
          results = filtered;
        } else {
          this.logger.warn('EntityPostFilter: no name match found, returning unfiltered results', {
            query,
            nameGroups:  nameTokenGroups.map(g => g[0]),
            topResult:   results[0]?.text.slice(0, 80),
            resultCount: results.length,
          });
        }
      }
    }

    const shouldCompress = useContextualCompression && searchMode !== 'entity';
    if (shouldCompress) {
      try {
        const compressed = await this.contextualCompressor.compressContext(
          query,
          results.map(r => ({ id: r.id, text: r.text })),
        );
        results = results.map((r, i) => ({
          ...r,
          text: compressed?.[i]?.compressed ?? r.text,
        }));
      } catch { }
    }

    return results as IDocumentWithEmbedding[];
  }

  async getAllDocuments(): Promise<IDocumentWithoutEmbedding[]> {
    const documents = await this.textRepository.findAll();
    return documents.map(doc => ({
      id:        doc.id,
      text:      doc.text,
      createdAt: doc.createdAt.toISOString(),
      model:     doc.model,
    }));
  }

  // ── Shared generation context ─────────────────────────────────────────────
  //
  // Both generateAnswer and streamableGenerateAnswer call this.
  // Returns PreparedContext on success, or { earlyExit: string } when the
  // pipeline should short-circuit (no results / injection etc.).

  private async prepareGenerationContext(
    query: string,
    options?: AskQuestionOptions,
  ): Promise<PreparedContext | { earlyExit: string }> {
    const classification = await this.classifyQuery(query);
    const p: FineTuningParams = classification.params;

    this.logger.log('QueryClassification', {
      query:      query.slice(0, 60),
      type:       classification.type,
      confidence: classification.confidence,
      params: {
        searchMode: p.searchMode, limit: p.limit, threshold: p.scoreThreshold,
        temperature: p.temperature, topP: p.topP, topK: p.topK,
        maxTokens: p.maxTokens, repeatPenalty: p.repeatPenalty, seed: p.seed,
      },
    });

    const retrieveOptions: RetrieveInternalOptions = {
      limit:                    p.limit,
      scoreThreshold:           p.scoreThreshold,
      useHybridSearch:          p.useHybridSearch,
      useReranking:             p.useReranking,
      rerankStrategy:           p.rerankStrategy,
      useQueryTransformation:   p.useQueryTransformation,
      useContextualCompression: p.useContextualCompression,
      useConversationMemory:    p.useConversationMemory,
      filters:                  options?.filters,
      sessionId:                options?.sessionId,
      _searchMode:              p.searchMode,
    };

    // Kick off retrieve and links lookup in parallel
    const [rawRetrieved, linksResult] = await Promise.all([
      this.retrieve(query, undefined, retrieveOptions),
      this.linkService
        .findLinksForQuery(query)
        .then(r => (r.found ? r : this.linkService.findLinksForContext(query)))
        .catch((err: any) => {
          this.logger.warn('prepareGenerationContext: linkService failed', { error: err?.message });
          return { found: false, block: '' };
        }),
    ]);

    if (typeof rawRetrieved === 'string') {
      return { earlyExit: rawRetrieved };
    }

    // ── Score filtering (factual queries only) ──────────────────────────────
    const effectiveThreshold =
      classification.type === 'factual'
        ? Math.min(p.scoreThreshold, FACTUAL_SCORE_THRESHOLD_CAP)
        : p.scoreThreshold;

    const applyFilter = classification.type === 'factual' && classification.confidence > 0.8;

    const preFiltered =
      applyFilter && effectiveThreshold
        ? rawRetrieved.filter(el => (el.score ?? 0) >= effectiveThreshold)
        : rawRetrieved;

    const postFilterResults =
      preFiltered.length > 0
        ? preFiltered
        : (() => {
            this.logger.warn('Score filter removed all results, falling back to unfiltered', {
              rawCount:  rawRetrieved.length,
              threshold: effectiveThreshold,
            });
            return rawRetrieved.slice(0, 3);
          })();

    const retrieved = p.useParentExpansion
      ? await this.expandToParentContext(postFilterResults)
      : postFilterResults;

    if (retrieved.length === 0) {
      return { earlyExit: 'Відповідь відсутня у наданій інформації.' };
    }

    // ── Knowledge graph ──────────────────────────────────────────────────────
    const useKG = options?.useKnowledgeGraph ?? p.useKnowledgeGraph;
    const kgContext = useKG ? await this.queryKnowledgeGraph(query) : undefined;

    // ── Build prompt ─────────────────────────────────────────────────────────
    const context = retrieved
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, classification.type === 'entity' ? 10 : 7)
      .map(doc => doc.text)
      .join('\n\n');

    let prompt = this.buildPrompt(classification.type, context, query);

    if (kgContext) {
      prompt +=
        `\n\n<knowledge_graph>\n${kgContext}\n</knowledge_graph>\n` +
        `(Граф знань надає додатковий контекст про сутності, але пріоритет — документальний контекст вище.)`;
    }

    if (options?.conversationHistory?.length) {
      const historyBlock =
        '\n====================\nІСТОРІЯ РОЗМОВИ:\n' +
        options.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') +
        '\n';
      prompt += `\n\n<conversation_history>\n${historyBlock}\n</conversation_history>`;
    }

    if (classification.type !== 'entity') {
      prompt += `\n\n<linksResult>\n${linksResult.block}\n</linksResult>

<links_usage_rules>
  - Використовуй linksResult лише якщо хоча б одне посилання прямо відповідає на запит
  - Якщо посилання лише дотично пов'язані — НЕ використовуй їх
  - Не вставляй посилання, якщо відповідь і так повна без них
  - Максимум 1–3 посилання
</links_usage_rules>`;
    }

    prompt += `\n\n<question>${query}</question>\n\nВідповідь (структурована, на основі контексту):`;

    return {
      classification,
      p,
      retrieved,
      prompt,
      generationParams: {
        temperature:   p.temperature,
        topP:          p.topP,
        topK:          p.topK,
        maxTokens:     p.maxTokens,
        repeatPenalty: p.repeatPenalty,
        seed:          p.seed,
      },
    };
  }

  // ── Confidence check (extracted so it's independently testable) ───────────

  private async runConfidenceCheck(
    query: string,
    answer: string,
    retrieved: IDocumentWithEmbedding[],
  ): Promise<void> {
    const verification = await this.confidencePort.verify(
      answer,
      retrieved.map(r => r.text),
    );

    this.logger.log('Stream_Confidence', {
      score:    verification.confidence.score,
      tier:     verification.confidence.tier,
      grounded: verification.grounded,
      verdict:  verification.llmVerdict,
    });

    if (
      !verification.grounded &&
      verification.llmVerdict === 'NO' &&
      verification.confidence.score < 0.4
    ) {
      this.logger.warn('Stream_Confidence: potential hallucination detected', {
        query:   query.slice(0, 80),
        score:   verification.confidence.score,
        verdict: verification.llmVerdict,
      });
    }
  }

  // ── Persist session turn (non-blocking helper) ────────────────────────────

  private persistSessionTurn(sessionId: string, query: string, answer: string): void {
    setImmediate(() => {
      this.ollama
        .embed(query)
        .then(emb =>
          this.conversationRepository.addTurn(
            sessionId, query, answer, extractEmbedding(emb),
          ),
        )
        .catch(err => this.logger.warn('Session embed failed', { error: err?.message }));
    });
  }

  // ── Prompt templates ──────────────────────────────────────────────────────

  private buildPrompt(
    type: 'entity' | 'factual' | 'wide',
    context: string,
    query: string,
  ): string {
    const PROMPTS: Record<typeof type, string> = {
      entity: `
      Ти — асистент корпоративної бази знань.

      ТВОЄ ГОЛОВНЕ ПРАВИЛО:
      Використовуй ТІЛЬКИ інформацію з <context>.
      ЗАБОРОНЕНО вигадувати будь-які факти поза контекстом.

      <context>
      ${context}
      </context>

      ЗАВДАННЯ:

      1. Проаналізуй ВЕСЬ контекст
      2. Збери ВСЮ інформацію, що стосується сутності (людини / об'єкта)
      3. ОБ'ЄДНАЙ її в цілісне узагальнення
      4. Структуруй відповідь за змістом (ролі, дії, процеси, деталі тощо)

      ФОРМАТ ВІДПОВІДІ:

      - короткий вступ (хто/що це)
      - далі логічні підрозділи (сам обери структуру)
      - під кожним — узагальнена інформація

      ВАЖЛИВО:

      ❌ НЕ МОЖНА:
      - писати "ось фрагменти", "у документі сказано"
      - просто перераховувати шматки тексту
      - дублювати однакові факти

      ✅ ПОТРІБНО:
      - писати як готове пояснення для людини
      - об'єднувати інформацію з різних частин контексту

      Якщо інформації немає — відповідай:
      "Інформація відсутня в базі знань"

      Питання:
      ${query}

      Відповідь:
      `,
      factual: `
      Ти — асистент корпоративної бази знань.

      Відповідай ТІЛЬКИ на основі <context>.
      ЗАБОРОНЕНО вигадувати інформацію.

      <context>
      ${context}
      </context>

      ЗАВДАННЯ:

      1. Уважно прочитай ВЕСЬ контекст — навіть якщо відповідь згадана лише побіжно
      2. Визнач точну відповідь на питання
      3. Якщо інформація розкидана по кількох місцях — ОБ'ЄДНАЙ її в одну відповідь
      4. Якщо є часткова інформація — дай часткову відповідь, не мовчи

      ВАЖЛИВО:

      ❌ НЕ МОЖНА:
      - писати "у контексті сказано"
      - давати список фрагментів
      - копіювати шматки тексту без узагальнення
      - відмовлятись відповідати якщо є хоч якась релевантна інформація

      ✅ ПОТРІБНО:
      - сформулювати єдину чітку відповідь
      - якщо інформація часткова — відповісти на те, що є, і додати:
        "Для уточнення зверніться до відповідного відділу або менеджера."

      Тільки якщо контекст ВЗАГАЛІ не містить нічого по темі питання:
      "Ця інформація відсутня в базі знань. Зверніться до HR або свого менеджера."

      Питання:
      ${query}

      Відповідь:
      `,
      wide: `
      Ти — асистент корпоративної бази знань.

      Створи цілісну, структуровану та практично корисну відповідь на основі НАДАНОГО КОНТЕКСТУ.

      ## ГОЛОВНЕ ПРАВИЛО
      Використовуй ТІЛЬКИ інформацію з <context>.
      Не додавай жодних фактів, припущень, пояснень, прикладів або деталей, яких немає в контексті.
      Якщо певний аспект теми не покритий — просто не згадуй його.

      <context>
      ${context}
      </context>

      ## ПИТАННЯ
      ${query}

      ## ЩО ПОТРІБНО ЗРОБИТИ
      - Уважно проаналізуй ВЕСЬ контекст
      - Визнач головну тему та всі важливі підтеми
      - Об'єднай інформацію з різних фрагментів у логічні змістовні блоки
      - Прибери повтори, дублікати та фрагментарність
      - Якщо фрагменти доповнюють один одного — синтезуй їх у повний опис
      - Якщо є інструкція або процедура — оформи її як послідовність кроків
      - Якщо є правила, умови, винятки або обмеження — виділи їх окремо
      - Якщо контекст розкриває лише частину теми — максимально повно розкрий саме цю частину

      ## ЯК ПИСАТИ
      Пиши як готову сторінку внутрішньої бази знань або робочу інструкцію.

      Відповідь має бути: змістовною, цілісною, логічною, без повторів, без води,
      без сирого стилю з фрагментів, без мета-коментарів.

      ## НЕ МОЖНА
      Не пиши: "у контексті зазначено", "з наданої інформації видно", "ось що знайдено",
      "контекст містить", "у документах сказано".

      Не можна: перелічувати уривки, посилатися на документи, писати як search results dump,
      відмовлятись через неповний контекст, згадувати що контекст частковий.

      ## ПРІОРИТЕТИ
      1. Точність  2. Повнота в межах контексту  3. Логічна структура
      4. Практична корисність  5. Читабельність

      ## ФОРМАТ ВІДПОВІДІ

      ## Короткий вступ
      Стисло поясни суть теми.

      ## Основна частина
      Розбий матеріал на логічні підтеми та поясни їх як завершений матеріал.

      ## Процес / кроки
      Показуй лише якщо в контексті є процедура або інструкція.

      ## Важливі умови / правила / винятки
      Показуй лише якщо вони є в контексті.

      ## Практичні примітки
      Показуй лише якщо в контексті є важливі нюанси використання або операційні деталі.

      Відповідь:
      `,
    };

    return PROMPTS[type];
  }

  // ── generateAnswer ────────────────────────────────────────────────────────

  async generateAnswer(
    query: string,
    options?: AskQuestionOptions,
  ): Promise<IGenerateAnswer | { answer: string }> {
    try {
      PromptInjectionGuard.assertSafe(query);
    } catch (err: any) {
      return { answer: err?.message ?? 'Prompt injection detected' };
    }

    const ctx = await this.prepareGenerationContext(query, options);

    if ('earlyExit' in ctx) {
      return { answer: ctx.earlyExit };
    }

    const { classification, p, retrieved, prompt, generationParams } = ctx;
    const { temperature, topP, topK, maxTokens, repeatPenalty, seed } = generationParams;

    const answer = await this.ollama.getRagResponseByPrompt(prompt, {
      temperature,
      topP,
      topK,
      maxTokens,
      repeatPenalty,
      seed,
    });

    const useCitations = options?.useCitationTracking ?? p.useCitationTracking;
    let citations: TrackCitation[] = [];
    let formattedAnswer = answer;

    if (useCitations) {
      const tracked   = this.trackCitations(answer, retrieved);
      citations       = tracked.citations;
      formattedAnswer = tracked.formattedAnswer;
    }

    if (options?.sessionId) {
      const embedding = await this.ollama.embed(query);
      await this.conversationRepository.addTurn(
        options.sessionId, query, answer, extractEmbedding(embedding),
      );
    }

    const topScore = retrieved[0]?.score;

    return {
      answer:         formattedAnswer,
      formattedAnswer,
      citations,
      relevantChunks: retrieved.length,
      confidence:     typeof topScore === 'number' ? topScore : undefined,
      queryType:       classification.type,
      queryConfidence: classification.confidence,
      generationParams,
      conversationContext: !!options?.sessionId,
      ...(options?.includeSources && {
        sources: retrieved.map(doc => ({
          id:       doc.id,
          text:     doc.text,
          score:    doc.score,
          metadata: doc.metadata,
        })),
      }),
    };
  }

  // ── streamableGenerateAnswer ──────────────────────────────────────────────

  async *streamableGenerateAnswer(
    query: string,
    options?: AskQuestionOptions,
  ): AsyncGenerator<IStreamChunk> {
    try {
      PromptInjectionGuard.assertSafe(query);
    } catch (err: any) {
      yield { event: 'error', error: err?.message ?? 'Prompt injection detected' };
      return;
    }

    const ctx = await this.prepareGenerationContext(query, options);

    if ('earlyExit' in ctx) {
      yield { event: 'metadata', metadata: { relevantChunks: 0, citations: [] } };
      yield { event: 'token',    token: ctx.earlyExit };
      yield { event: 'done',     metadata: { relevantChunks: 0, citations: [] } };
      return;
    }

    const { classification, p, retrieved, prompt, generationParams } = ctx;
    const { temperature, topP, topK, maxTokens, repeatPenalty, seed } = generationParams;

    // Emit metadata before first token so the client can show context info immediately
    yield {
      event: 'metadata',
      metadata: {
        relevantChunks:   retrieved.length,
        confidence:       retrieved[0]?.score,
        queryType:        classification.type,
        queryConfidence:  classification.confidence,
        generationParams,
        conversationContext: !!options?.sessionId,
        ...(options?.includeSources && {
          sources: retrieved.map(doc => ({
            id:       doc.id,
            text:     doc.text,
            score:    doc.score,
            metadata: doc.metadata,
          })),
        }),
      },
    };

    // Stream tokens
    let fullAnswer = '';
    try {
      for await (const token of this.ollama.getRagResponseByPromptStream(prompt, {
        temperature,
        topP,
        topK,
        maxTokens,
        repeatPenalty,
        seed,
      })) {
        fullAnswer += token;
        yield { event: 'token', token };
      }
    } catch (err: any) {
      yield { event: 'error', error: err?.message ?? 'LLM streaming failed' };
      return;
    }

    // Fire-and-forget confidence check — doesn't block done event
    this.runConfidenceCheck(query, fullAnswer, retrieved).catch(() => {});

    // Citations
    const useCitations = options?.useCitationTracking ?? p.useCitationTracking;
    const citations = useCitations
      ? this.trackCitations(fullAnswer, retrieved).citations
      : [];

    // Persist conversation turn (non-blocking)
    if (options?.sessionId) {
      this.persistSessionTurn(options.sessionId, query, fullAnswer);
    }

    yield { event: 'done', metadata: { citations, relevantChunks: retrieved.length } };
  }

  // ── deleteById ────────────────────────────────────────────────────────────

  async deleteById(id: string): Promise<IDeleteDocument> {
    await this.textRepository.deleteById(id);
    return { deletedDocumentId: id };
  }

  // ── Citation tracking ─────────────────────────────────────────────────────

  private trackCitations(
    answer: string,
    retrievedDocs: Array<{ id: string; text: string }>,
  ): { citations: TrackCitation[]; formattedAnswer: string } {
    const citations: TrackCitation[] = [];
    let formattedAnswer = answer;

    retrievedDocs.forEach((doc, idx) => {
      const sentences = doc.text.match(/[^.!?…]+[.!?…]+/g) || [];
      sentences.forEach(sentence => {
        if (sentence.length < 20) return;
        if (this.findSimilarContent(answer, sentence)) {
          citations.push({ id: `cite_${idx}`, documentId: doc.id, text: sentence });
        }
      });
    });

    if (citations.length > 0) {
      const docIndices = new Map<string, number>();
      let currentIndex = 1;
      citations.forEach(cite => {
        if (!docIndices.has(cite.documentId)) docIndices.set(cite.documentId, currentIndex++);
      });
      citations.forEach(cite => {
        const index  = docIndices.get(cite.documentId);
        const anchor = cite.text.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        formattedAnswer = formattedAnswer.replace(
          new RegExp(anchor),
          match => `${match} [${index}]`,
        );
      });
    }

    return { citations, formattedAnswer };
  }

  private findSimilarContent(haystack: string, needle: string): boolean {
    const needleWords = needle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (needleWords.length === 0) return false;
    const haystackLower = haystack.toLowerCase();
    const matched = needleWords.filter(word => haystackLower.includes(word));
    return matched.length / needleWords.length > 0.6;
  }

  // ── Parent context expansion ──────────────────────────────────────────────

  private async expandToParentContext(
    results: Array<IDocumentWithEmbedding>,
  ): Promise<Array<IDocumentWithEmbedding>> {
    const parentIds = [...new Set(
      results.filter(r => r.parentId).map(r => r.parentId!),
    )];

    const parentTexts = new Map<string, string>();
    if (parentIds.length > 0) {
      try {
        const ragConfig      = this.configService.get<TRagConfig>(RAG_CONFIG);
        const collectionName = ragConfig?.textRagCollectionName;
        if (collectionName) {
          const parentPoints = await this.qdrantService.getPoints(collectionName, parentIds);
          for (const p of parentPoints) {
            parentTexts.set(p.id.toString(), (p.payload as any)?.text ?? '');
          }
        }
      } catch (err) {
        this.logger.warn('expandToParentContext: batch fetch failed', { err });
      }
    }

    const parentGroups = new Map<string, { doc: IDocumentWithEmbedding; children: string[] }>();
    const noParent: Array<IDocumentWithEmbedding> = [];

    for (const doc of results) {
      if (!doc.parentId) { noParent.push(doc); continue; }
      if (!parentGroups.has(doc.parentId)) {
        parentGroups.set(doc.parentId, { doc, children: [] });
      }
      parentGroups.get(doc.parentId)!.children.push(doc.text);
    }

    const merged: Array<IDocumentWithEmbedding> = [];
    for (const [parentId, { doc, children }] of parentGroups) {
      const pText          = parentTexts.get(parentId) ?? doc.parentText ?? '';
      const uniqueChildren = [...new Set(children)];
      const combinedText   = pText
        ? `${pText}\n\n${uniqueChildren.join('\n\n')}`
        : uniqueChildren.join('\n\n');

      if (!pText) {
        this.logger.warn('expandToParentContext: parent text not found', {
          parentId,
          childCount: uniqueChildren.length,
        });
      }

      merged.push({
        ...doc,
        text: combinedText.slice(0, MAX_CONTEXT_CHARS),
      } as IDocumentWithEmbedding);
    }

    return [...merged, ...noParent];
  }

  // ── Knowledge graph ───────────────────────────────────────────────────────

  private async extractKnowledgeGraph(text: string, documentId: string): Promise<void> {
    try {
      const { entities, relationships } = await this.extractEntitiesAndRelations(text, documentId);
      this.logger.log('KG extraction complete', {
        entities: entities.length, relationships: relationships.length,
      });
      for (const entity of entities)      await this.knowledgeGraph.addEntity(entity);
      for (const rel    of relationships) await this.knowledgeGraph.addRelationship(rel);
    } catch (error) {
      this.logger.warn('Knowledge graph extraction failed', { error });
    }
  }

  private async extractEntitiesAndRelations(
    text: string,
    sourceDocument: string,
  ): Promise<{
    entities: KnowledgeGraphEntity[];
    relationships: Array<{ id: string; fromEntityId: string; toEntityId: string; type: string }>;
  }> {
    const sample = text.slice(0, 4000);
    const prompt = `
      Extract named entities and their relationships from this document text.
      ENTITY TYPES: person, organization, location, technology, concept, product
      RELATIONSHIP TYPES: WORKS_ON, MEMBER_OF, LOCATED_IN, USES, MANAGES, PART_OF, CREATED_BY
      STRICT RULES:
      - ONLY include real named people, organizations, locations, technologies/products
      - EXCLUDE: usernames, durations, bare numbers, sentences over 60 chars
      - EXCLUDE anything with only dots/underscores (system usernames)
      Text: ${sample}
      Respond with ONLY valid JSON, no markdown:
      {"entities":[{"name":"...","type":"..."}],"relations":[{"from":"...","relation":"...","to":"..."}]}`;

    try {
      const response  = await this.ollama.getRagResponseByPrompt(prompt, { temperature: 0, maxTokens: 800 });
      const clean     = response.replace(/```(?:json)?/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { entities: [], relationships: [] };

      const parsed: {
        entities?: Array<{ name: string; type: string }>;
        relations?: Array<{ from: string; relation: string; to: string }>;
      } = JSON.parse(jsonMatch[0]);

      const rawEntities  = Array.isArray(parsed.entities)  ? parsed.entities  : [];
      const rawRelations = Array.isArray(parsed.relations)  ? parsed.relations : [];

      const entities: KnowledgeGraphEntity[] = rawEntities
        .filter(e => e?.name && e?.type && !this.isNoisyEntity(e.name, e.type))
        .map(e => ({
          id:             this.buildCanonicalId(e.name, e.type),
          name:           e.name,
          type:           e.type.toLowerCase(),
          sourceDocument,
        }));

      const nameToId = new Map<string, string>(entities.map(e => [e.name.toLowerCase(), e.id]));

      const relationships = rawRelations
        .filter(r => r?.from && r?.to && r?.relation)
        .map(r => {
          const fromId = nameToId.get(r.from.toLowerCase());
          const toId   = nameToId.get(r.to.toLowerCase());
          if (!fromId || !toId || fromId === toId) return null;
          return {
            id:           `${fromId}__${r.relation.toUpperCase()}__${toId}`,
            fromEntityId: fromId,
            toEntityId:   toId,
            type:         r.relation.toUpperCase(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      return { entities, relationships };
    } catch (error) {
      this.logger.warn('Entity extraction failed', { error });
      return { entities: [], relationships: [] };
    }
  }

  private isNoisyEntity(name: string, type: string): boolean {
    const t = name.trim();
    if (t.length < 2 || t.length > 60) return true;
    if (/[!?]/.test(t)) return true;
    if (!/\s/.test(t) && /[._]/.test(t)) return true;
    if (/^\d+(\s+\S{1,6})?$/.test(t)) return true;
    if (type === 'concept' && /\d/.test(t)) return true;
    return false;
  }

  private buildCanonicalId(name: string, type: string): string {
    const slug = cyrillicToLatin(name)
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `${slug}_${type.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }

  private async queryKnowledgeGraph(query: string): Promise<string> {
    try {
      const relevantEntities = await this.knowledgeGraph.queryEntities(query);
      this.logger.log('KG entities', { count: relevantEntities.length });
      if (!relevantEntities.length) return '';
      return relevantEntities.map(e => {
        const relTypes = e.properties?.relTypes as string[] | undefined;
        return relTypes?.length
          ? `${e.name} is a ${e.type} (connected via: ${relTypes.join(', ')})`
          : `${e.name} is a ${e.type}`;
      }).join('. ') + '.';
    } catch (error) {
      this.logger.warn('Knowledge graph query failed', { error });
      return '';
    }
  }
}