import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { QueryTransformer } from '../utils/query-transformer.util';
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
} from '../utils/transliteration.util';
import { SearchMode } from '../../infrastructure/qdrant/rag-qdrant.service';
import { QueryClassifier, FineTuningParams } from '../utils/query-classefire.util';

const MIN_CHUNK_TEXT_LENGTH = 80;

const UPLOAD_CONCURRENCY = 3;

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

@Injectable()
export class TextRagService implements TextRagPort {
  private queryTransformer: QueryTransformer;
  private reranker: Reranker;
  private hybridSearch: HybridSearchEngine;
  private contextualCompressor: ContextualCompressor;
  private queryClassifier: QueryClassifier;

  private static readonly CYRILLIC_TO_LATIN: Record<string, string> = {
    'а': 'a',  'б': 'b',  'в': 'v',  'г': 'h',  'ґ': 'g',
    'д': 'd',  'е': 'e',  'є': 'ye', 'ж': 'zh', 'з': 'z',
    'и': 'y',  'і': 'i',  'ї': 'yi', 'й': 'y',  'к': 'k',
    'л': 'l',  'м': 'm',  'н': 'n',  'о': 'o',  'п': 'p',
    'р': 'r',  'с': 's',  'т': 't',  'у': 'u',  'ф': 'f',
    'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ь': '',   'ю': 'yu', 'я': 'ya', 'ё': 'yo', 'э': 'e',
    'ъ': '',   'ы': 'y',
  };

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
  ) {
    this.queryTransformer     = new QueryTransformer(this.ollama);
    this.reranker             = new Reranker(this.ollama);
    this.hybridSearch         = new HybridSearchEngine(this.qdrantService, this.configService);
    this.contextualCompressor = new ContextualCompressor(this.ollama);
    this.queryClassifier      = new QueryClassifier(this.ollama);
  }

  private cyrillicToLatin(text: string): string {
    return text
      .toLowerCase()
      .split('')
      .map(c => TextRagService.CYRILLIC_TO_LATIN[c] ?? c)
      .join('');
  }

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
        } else {
          this.logger.error(`Failed to process ${file.originalname}`, res.reason);
        }
        filesProcessed++;
      }
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
    const pcOpts = options?.parentChild ?? {};
    const fileId = this.buildFileId(file.originalname);

    const rawText = file.buffer.toString('utf-8');
    const keywords = await this.prepareKeywordsForFile(text, file.originalname, rawText);
    this.logger.log(`Keywords ready for ${file.originalname}`, {
      total: keywords.length,
      sample: keywords.slice(0, 12),
    });

    let savedCount = 0;

    await parentChildChunking(
      text,
      async (chunk: { text: string; metadata: ChunkMetadata }) => {
        if (chunk.metadata.level === 0) return;

        const hasUrl = /https?:\/\/\S+|\b[\w-]+\.[\w-]+\.\w{2,}\b/.test(chunk.text);
        if (chunk.text.trim().length < MIN_CHUNK_TEXT_LENGTH && !hasUrl) {
          this.logger.log(
            `Skipping micro-chunk (${chunk.text.trim().length} chars): "${chunk.text.trim().slice(0, 60)}"`,
          );
          return;
        }

        const embedding = await this.ollama.embed(chunk.text);

        const doc = TextDocument.create(
          uuidv4(), chunk.text, extractEmbedding(embedding), embedModel, new Date(),
          chunk.metadata.chunkId,
          chunk.metadata.level,
          chunk.metadata.startIndex,
          chunk.metadata.endIndex,
          chunk.metadata.childIds,
          chunk.metadata.parentId,
          chunk.metadata.parentText,
          keywords,
        );

        await this.textRepository.saveMany([doc]);
        savedCount++;
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

      const chars     = kw.replace(/\s/g, '');
      const total     = chars.length;
      if (total === 0) return false;

      const mojibake  = (kw.match(/[\u00C0-\u00FF]/g) ?? []).length;
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
      'такий', 'така', 'таке', 'такі', 'розкажи', 'про'
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
      .split(/[./\-_?&#=+:→[\]()\\|,\s]/)
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

    if (useQueryTransformation) {
      try {
        const transformed = await this.queryTransformer.transformQuery(query);
        keywords          = transformed.keywords;
        queriesToEmbed    = [
          transformed.original,
          ...transformed.expanded,
          ...transformed.rephrased,
        ].filter(Boolean).slice(0, 5);
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

    const embeddings= await Promise.all(queriesToEmbed.map(q => this.ollama.embed(q)));
    const primaryEmbedding = new Embedding(extractEmbedding(embeddings[0]));

    let results: Array<{ id: string; text: string; score: number }> = [];

    const effectivenessLimit = (searchMode === 'entity' ? 6 : 4) * effectiveLimit;

    if (useHybridSearch) {
      const allSearchResults = await Promise.all(
        embeddings.map(emb =>
          this.hybridSearch.search(
            collectionName,
            new Embedding(extractEmbedding(emb)),
            keywords,
            effectivenessLimit,
            {
              searchMode,
              minTextLength: MIN_CHUNK_TEXT_LENGTH,
              ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
            },
          ),
        ),
      );

      const validResults = allSearchResults.filter(Boolean) as NonNullable<typeof allSearchResults[0]>[];
      if (validResults.length === 0) return 'There is no relevant information in knowledge';

      const mergedMap = new Map<string, HybridSearchResult>();
      for (const searchResults of validResults) {
        for (const r of searchResults) {
          const existing = mergedMap.get(r.id);
          if (!existing || r.hybridScore > existing.hybridScore) {
            mergedMap.set(r.id, r);
          }
        }
      }
      results = [...mergedMap.values()]
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .map(r => ({ id: r.id, text: r.text, score: r.hybridScore }));
        
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
            ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
          },
        );
        if (!hybridFallback) return 'There is no relevant information in knowledge';
        results = hybridFallback.map(r => ({ id: r.id, text: r.text, score: r.hybridScore }));
      }
    }

    if (results.length === 0) return 'There is no relevant information in knowledge';

    if (useReranking && rerankStrategy !== 'none' && results.length > effectiveLimit) {
      const reranked = await this.reranker.rerank(query, results, {
        topK:   effectiveLimit,
        method: rerankStrategy === 'cross_encoder' ? 'listwise'
              : rerankStrategy === 'llm_based'     ? 'llm'
              : 'hybrid',
      });
      results = reranked.map(r => ({ id: r.item.id, text: r.item.text, score: r.finalScore }));
    }

    results = results.slice(0, effectiveLimit);
    if (searchMode === 'entity') {
      const nameTokenGroups = this.extractNameTokens(query);
      if (nameTokenGroups.length > 0) {

        const chunkMatches = (text: string, groups: string[][]): boolean => {
          const lower        = text.toLowerCase();
          const translitText = this.cyrillicToLatin(lower);
          return groups.every(variants =>
            variants.some(v => {
              const vLower = v.toLowerCase();
              return lower.includes(vLower) || translitText.includes(this.cyrillicToLatin(vLower));
            }),
          );
        };

        let filtered = results.filter(r => chunkMatches(r.text, nameTokenGroups));

        if (filtered.length === 0) {
          const surnameGroup = nameTokenGroups[nameTokenGroups.length - 1];

          filtered = results.filter(r => {
            const lower        = r.text.toLowerCase();
            const translitText = this.cyrillicToLatin(lower);
            return surnameGroup.some(v => {
              const vLower = v.toLowerCase();
              return lower.includes(vLower) || translitText.includes(this.cyrillicToLatin(vLower));
            });
          });
        }

        if (filtered.length > 0) {
          this.logger.log('EntityPostFilter', {
            query,
            groups:  nameTokenGroups.map(g => g.slice(0, 4)),
            before:  results.length,
            after:   filtered.length,
          });
          results = filtered;
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

  async generateAnswer(
    query: string,
    options?: {
      limit?: number;
      scoreThreshold?: number;
      filters?: Array<{ field: string; value: any; operator?: string }>;
      useHybridSearch?: boolean;
      useReranking?: boolean;
      rerankStrategy?: 'cross_encoder' | 'llm_based' | 'none' | 'hybrid';
      useQueryTransformation?: boolean;
      useContextualCompression?: boolean;
      useConversationMemory?: boolean;
      useKnowledgeGraph?: boolean;
      useCitationTracking?: boolean;
      temperature?: number;
      topP?: number;
      topK?: number;
      maxTokens?: number;
      includeSources?: boolean;
      sessionId?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
    },
  ): Promise<IGenerateAnswer | { answer: string }> {
    PromptInjectionGuard.assertSafe(query);

    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);

    const classification = await this.queryClassifier.classify(query);
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

    const temperature   = p.temperature;
    const topP          = p.topP;
    const topK          = p.topK;
    const maxTokens     = p.maxTokens;
    const repeatPenalty = p.repeatPenalty;
    const seed          = p.seed;

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

    const rawRetrieved = await this.retrieve(query, undefined, retrieveOptions);

    if (typeof rawRetrieved === 'string') return { answer: rawRetrieved };
    if (!Array.isArray(rawRetrieved)) return { answer: String(rawRetrieved) };

    const configThreshold  = ragConfig?.textRagScoreThreshold;
    const applyConfigFilter = classification.type === 'factual';

    const filtered = configThreshold && applyConfigFilter
      ? rawRetrieved.filter(el => (el.score ?? 0) >= p.scoreThreshold)
      : rawRetrieved;

    const retrieved = p.useParentExpansion
      ? this.expandToParentContext(filtered)
      : filtered;

    const useKG = options?.useKnowledgeGraph ?? p.useKnowledgeGraph;
    let kgContext: string | undefined;
    if (useKG) kgContext = await this.queryKnowledgeGraph(query);

    if (retrieved.length === 0) {
      return {
        answer:         'Відповідь відсутня у наданій інформації.',
        relevantChunks: 0,
        citations:      [],
      };
    }

    const context = retrieved
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8)
      .map(doc => doc.text)
      .join('\n\n');

    let historyBlock = '';
    if (options?.conversationHistory?.length) {
      historyBlock =
        '\n====================\nІСТОРІЯ РОЗМОВИ:\n' +
        options.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') +
        '\n';
    }

    const PROMPTS: Record<typeof classification.type, string> = {
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
      2. Збери ВСЮ інформацію, що стосується сутності (людини / об’єкта)
      3. ОБ’ЄДНАЙ її в цілісне узагальнення
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
      - об’єднувати інформацію з різних частин контексту
      
      Якщо інформації немає:
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
      
      1. Проаналізуй весь контекст
      2. Визнач точну відповідь на питання
      3. Якщо інформація розкидана — ОБ’ЄДНАЙ її
      
      ФОРМАТ:
      
      - 1–3 речення
      - максимально конкретно
      - без зайвих деталей
      
      ВАЖЛИВО:
      
      ❌ НЕ МОЖНА:
      - писати "у контексті сказано"
      - давати список фрагментів
      - копіювати шматки тексту без узагальнення
      
      ✅ ПОТРІБНО:
      - сформулювати єдину чітку відповідь
      
      Якщо недостатньо даних:
      "Недостатньо інформації у базі знань"
      
      Питання:
      ${query}
      
      Відповідь:
      `,
      wide: `
      Ти — асистент корпоративної бази знань.
      
      Використовуй ТІЛЬКИ інформацію з <context>.
      ЗАБОРОНЕНО вигадувати факти.
      
      <context>
      ${context}
      </context>
      
      ЗАВДАННЯ:
      
      1. Уважно прочитай ВЕСЬ контекст
      2. Визнач усі ключові теми
      3. ОБ’ЄДНАЙ інформацію у логічні блоки
      4. Побудуй цілісне пояснення теми
      
      ФОРМАТ ВІДПОВІДІ:
      
      ## Короткий вступ
      Стислий опис теми
      
      ## Основна частина
      Кілька логічних підтем (сам визначаєш структуру)
      
      - під кожною темою — узагальнення, а НЕ цитати
      
      ## (опційно) Процес / кроки
      Якщо є інструкції — подай як послідовність дій
      
      ВАЖЛИВО:
      
      ❌ НЕ МОЖНА:
      - "Ось фрагменти..."
      - список знайдених шматків тексту
      - посилання на документи
      - повтори
      
      ✅ ПОТРІБНО:
      - писати як готову статтю / інструкцію
      - зшивати інформацію з різних місць
      - використовувати максимум контексту
      
      ДОДАТКОВО:
      
      Перед відповіддю подумай:
      "Як пояснити це людині без доступу до контексту?"
      
      Якщо частина інформації відсутня — просто пропусти її.
      
      Питання:
      ${query}
      
      Відповідь:
      `,
    };

    let prompt = PROMPTS[classification.type];

    if (kgContext) {
      prompt +=
        `\n\n<knowledge_graph>\n${kgContext}\n</knowledge_graph>\n` +
        `(Граф знань надає додатковий контекст про сутності, але пріоритет — документальний контекст вище.)`;
    }

    if (historyBlock) {
      prompt += `\n\n<conversation_history>\n${historyBlock}\n</conversation_history>`;
    }

    prompt += `\n\n<question>${query}</question>\n\nВідповідь (структурована, на основі контексту):`;

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
      generationParams: { temperature, topP, topK, maxTokens, repeatPenalty, seed },
      knowledgeGraphContext: kgContext,
      conversationContext:   !!options?.sessionId,
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

  async *streamableGenerateAnswer(
    query: string,
    options?: {
      limit?: number;
      scoreThreshold?: number;
      filters?: Array<{ field: string; value: any; operator?: string }>;
      useHybridSearch?: boolean;
      useReranking?: boolean;
      rerankStrategy?: 'cross_encoder' | 'llm_based' | 'none' | 'hybrid';
      useQueryTransformation?: boolean;
      useContextualCompression?: boolean;
      useConversationMemory?: boolean;
      useKnowledgeGraph?: boolean;
      useCitationTracking?: boolean;
      temperature?: number;
      topP?: number;
      topK?: number;
      maxTokens?: number;
      includeSources?: boolean;
      sessionId?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
    },
  ): AsyncGenerator<IStreamChunk> {
    try {
      PromptInjectionGuard.assertSafe(query);
    } catch (err: any) {
      yield { event: 'error', error: err?.message ?? 'Prompt injection detected' };
      return;
    }

    const classification = await this.queryClassifier.classify(query);
    const p: FineTuningParams = classification.params;

    const temperature   = p.temperature;
    const topP          = p.topP;
    const topK          = p.topK;
    const maxTokens     = p.maxTokens;
    const repeatPenalty = p.repeatPenalty;
    const seed          = p.seed;

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

    const rawRetrieved = await this.retrieve(query, undefined, retrieveOptions);

    console.log('rawRetrieved :>> ', rawRetrieved);

    if (typeof rawRetrieved === 'string') {
      yield { event: 'metadata', metadata: { relevantChunks: 0, citations: [] } };
      yield { event: 'token', token: rawRetrieved };
      yield { event: 'done', metadata: { relevantChunks: 0, citations: [] } };
      return;
    }

    const filtered = p.scoreThreshold
      ? rawRetrieved.filter(el => (el.score ?? 0) >= p.scoreThreshold)
      : rawRetrieved;

    const retrieved = p.useParentExpansion
      ? this.expandToParentContext(filtered)
      : filtered;

    if (retrieved.length === 0) {
      yield {
        event: 'metadata',
        metadata: { relevantChunks: 0, citations: [], queryType: classification.type },
      };
      yield { event: 'token', token: 'Відповідь відсутня у наданій інформації.' };
      yield { event: 'done', metadata: { relevantChunks: 0, citations: [] } };
      return;
    }

    const useKG = options?.useKnowledgeGraph ?? p.useKnowledgeGraph;
    let kgContext: string | undefined;
    if (useKG) kgContext = await this.queryKnowledgeGraph(query);

    const context = retrieved
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(doc => doc.text)
      .join('\n\n');

    let historyBlock = '';
    if (options?.conversationHistory?.length) {
      historyBlock =
        '\n====================\nІСТОРІЯ РОЗМОВИ:\n' +
        options.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') +
        '\n';
    }

    const PROMPTS: Record<typeof classification.type, string> = {
      entity: `
      Ти — асистент корпоративної бази знань.
      
      ГОЛОВНЕ ПРАВИЛО:
      Використовуй тільки інформацію з <context>.
      Використай весь надайний текст
      ЗАБОРОНЕНО вигадувати факти або використовувати зовнішні знання.
      
      Контекст може містити часткову або непряму інформацію.
      
      <context>
      ${context}
      </context>
      
      Питання:
      ${query}
      
      ЗАВДАННЯ:
      
      1. Знайди інформацію яка стосується людини з питання.
      2. Ігноруй факти які не стосуються цієї людини.
      3. Згрупуй інформацію у логічні підтеми.
      
      МОЖЛИВІ ПІДТЕМИ:
      
      - роль / позиція
      - досвід
      - минуле
      - обов'язки
      - проєкти
      - кар'єра
      - інша релевантна інформація
      
      ПРАВИЛА:
      
      - використовуй тільки інформацію з context
      - не копіюй текст дослівно
      - не повторюй однакові факти
      - якщо інформації немає — напиши "Інформація відсутня в базі знань"
      
      Відповідь:
      `,
      factual: `
      Ти — асистент корпоративної бази знань.
      
      Використовуй тільки інформацію з <context>.
      Заборонено вигадувати факти.
      
      Контекст може містити часткову або непряму інформацію — ігноруй усе, що не допомагає зрозуміти суть питання.
      
      <context>
      ${context}
      </context>
      
      Питання:
      ${query}
      
      Завдання:
      
      Проаналізуй контекст і сформуй коротку, зрозумілу відповідь на питання. 
      Якщо прямої персональної інформації немає, логічно поясни процес або правило, які стосуються питання. 
      Ігноруй деталі, які не важливі для користувача, такі як конкретні системи чи внутрішні назви проектів. 
      Відповідь повинна бути природною, як би ти пояснив колезі, 1–3 речення.
      
      Відповідь:
      `,
      wide: `
        Ти аналізуєш фрагменти корпоративної бази знань.
  
        Питання:
        ${query}

        Фрагменти:

        ${context}

        ЗАВДАННЯ:
        Вибери тільки ті фрагменти які реально допомагають відповісти на питання.

        Якщо нічого не підходить:
        NONE
      `
      };

    let prompt = PROMPTS[classification.type];

    if (kgContext) {
      prompt +=
        `\n\n<knowledge_graph>\n${kgContext}\n</knowledge_graph>\n` +
        `(Граф знань надає додатковий контекст про сутності, але пріоритет — документальний контекст вище.)`;
    }

    if (historyBlock) {
      prompt += `\n\n<conversation_history>\n${historyBlock}\n</conversation_history>`;
    }

    prompt += `\n\n<question>${query}</question>\n\nВідповідь (структурована, на основі контексту):`;

    yield {
      event: 'metadata',
      metadata: {
        relevantChunks:   retrieved.length,
        confidence:       retrieved[0]?.score,
        queryType:        classification.type,
        queryConfidence:  classification.confidence,
        generationParams: { temperature, topP, topK, maxTokens, repeatPenalty, seed },
        knowledgeGraphContext: kgContext,
        conversationContext:   !!options?.sessionId,
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

    const useCitations = options?.useCitationTracking ?? p.useCitationTracking;
    let citations: TrackCitation[] = [];
    if (useCitations) {
      const tracked = this.trackCitations(fullAnswer, retrieved);
      citations     = tracked.citations;
    }

    if (options?.sessionId) {
      const embedding = await this.ollama.embed(query);
      await this.conversationRepository.addTurn(
        options.sessionId, query, fullAnswer, extractEmbedding(embedding),
      );
    }

    yield {
      event: 'done',
      metadata: {
        citations,
        relevantChunks: retrieved.length,
      },
    };
  }

  async deleteById(id: string): Promise<IDeleteDocument> {
    await this.textRepository.deleteById(id);
    return { deletedDocumentId: id };
  }

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
          new RegExp(anchor, 'g'),
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

  private expandToParentContext(results: Array<IDocumentWithEmbedding>): Array<IDocumentWithEmbedding> {
    const parentGroups = new Map<string, { doc: IDocumentWithEmbedding; children: string[] }>();
    const noParent: Array<IDocumentWithEmbedding> = [];
  
    for (const doc of results) {
      if (!doc.parentId || !doc.parentText) {
        noParent.push(doc);
        continue;
      }
      if (!parentGroups.has(doc.parentId)) {
        parentGroups.set(doc.parentId, { doc, children: [] });
      }
      parentGroups.get(doc.parentId)!.children.push(doc.text);
    }

    const merged: Array<IDocumentWithEmbedding> = [];
    for (const { doc, children } of parentGroups.values()) {
      const combinedText = `${doc.parentText}\n\n${[...new Set(children)].join('\n\n')}`;
      merged.push({ ...doc, text: combinedText } as IDocumentWithEmbedding);
    }
  
    return [...merged, ...noParent];
  }

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
    const slug = this.cyrillicToLatin(name)
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