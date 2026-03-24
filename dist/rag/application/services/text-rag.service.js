"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextRagService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const uuid_1 = require("uuid");
const ollama_service_1 = require("../../infrastructure/ollama/ollama.service");
const rag_qdrant_service_1 = require("../../infrastructure/qdrant/rag-qdrant.service");
const text_document_entity_1 = require("../../domain/entities/text-document.entity");
const embedding_vo_1 = require("../../domain/value-objects/embedding.vo");
const text_chunk_util_1 = require("../utils/text-chunk.util");
const embedding_util_1 = require("../utils/embedding.util");
const file_text_util_1 = require("../utils/file-text.util");
const rag_config_1 = require("../../infrastructure/config/rag-config");
const prompt_injection_guard_1 = require("../guards/prompt-injection.guard");
const advanced_chunking_util_1 = require("../utils/advanced-chunking.util");
const query_transformer_util_1 = require("../utils/query-transformer.util");
const reranker_util_1 = require("../utils/reranker.util");
const hybrid_search_util_1 = require("../utils/hybrid-search.util");
const contextual_compression_util_1 = require("../utils/contextual-compression.util");
const transliteration_util_1 = require("../utils/transliteration.util");
const query_classefire_util_1 = require("../utils/query-classefire.util");
const MIN_CHUNK_TEXT_LENGTH = 80;
const UPLOAD_CONCURRENCY = 3;
const MAX_CONTEXT_CHARS = 6000;
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
let TextRagService = class TextRagService {
    constructor(configService, ollama, qdrantService, textRepository, conversationRepository, knowledgeGraph, logger, confidencePort) {
        this.configService = configService;
        this.ollama = ollama;
        this.qdrantService = qdrantService;
        this.textRepository = textRepository;
        this.conversationRepository = conversationRepository;
        this.knowledgeGraph = knowledgeGraph;
        this.logger = logger;
        this.confidencePort = confidencePort;
        this.queryTransformer = new query_transformer_util_1.QueryTransformer(this.ollama);
        this.reranker = new reranker_util_1.Reranker(this.ollama);
        this.hybridSearch = new hybrid_search_util_1.HybridSearchEngine(this.qdrantService, this.configService);
        this.contextualCompressor = new contextual_compression_util_1.ContextualCompressor(this.ollama);
        this.queryClassifier = new query_classefire_util_1.QueryClassifier(this.ollama);
    }
    async uploadKnowledgeFromFile(file, options) {
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        const embedModel = ragConfig?.ollamaEmbedModelText || 'nomic-embed-text';
        const { chunkingStrategy = 'simple', enableKnowledgeGraph = false, } = options || {};
        const text = await (0, file_text_util_1.extractFileText)(file);
        this.logger.log('Processing file', { name: file.originalname, strategy: chunkingStrategy });
        let savedCount = 0;
        if (chunkingStrategy === 'semantic') {
            savedCount = await this.uploadWithSemantic(text, embedModel);
        }
        else if (chunkingStrategy === 'parent-child') {
            savedCount = await this.uploadWithParentChild(file, text, embedModel, options);
        }
        else {
            savedCount = await this.uploadWithSimple(text, embedModel);
        }
        this.logger.log(`Saved ${savedCount} documents to vector store`);
        if (enableKnowledgeGraph) {
            this.logger.log('Extracting knowledge graph...');
            await this.extractKnowledgeGraph(text, file.originalname);
        }
        return { chunks: savedCount };
    }
    async uploadMarkdownFolder(files, options) {
        let totalChunks = 0;
        let filesProcessed = 0;
        for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
            const batch = files.slice(i, i + UPLOAD_CONCURRENCY);
            const results = await Promise.allSettled(batch.map(file => this.uploadKnowledgeFromFile(file, options)));
            for (let j = 0; j < results.length; j++) {
                const res = results[j];
                const file = batch[j];
                if (res.status === 'fulfilled') {
                    this.logger.log('File processed', { name: file.originalname, chunks: res.value.chunks });
                    totalChunks += res.value.chunks;
                }
                else {
                    this.logger.error(`Failed to process ${file.originalname}`, res.reason);
                }
                filesProcessed++;
            }
        }
        return { totalChunks, filesProcessed };
    }
    async uploadWithSimple(text, embedModel) {
        const rawChunks = (0, text_chunk_util_1.chunkTextBySentences)(text, { minWords: 20, maxWords: 150 });
        const chunks = rawChunks.filter(t => t.trim().length >= MIN_CHUNK_TEXT_LENGTH);
        this.logger.log(`Generated ${chunks.length} simple chunks (after min-length filter)`);
        return this.embedAndSaveChunks(chunks, embedModel);
    }
    async uploadWithSemantic(text, embedModel) {
        const semanticChunks = await (0, advanced_chunking_util_1.semanticChunking)(text, this.ollama, {
            minChunkSize: 100,
            maxChunkSize: 500,
        });
        const chunks = semanticChunks
            .map(c => c.text)
            .filter(t => t.trim().length >= MIN_CHUNK_TEXT_LENGTH);
        this.logger.log(`Generated ${chunks.length} semantic chunks (after min-length filter)`);
        return this.embedAndSaveChunks(chunks, embedModel);
    }
    async uploadWithParentChild(file, text, embedModel, options) {
        const pcOpts = options?.parentChild ?? {};
        const fileId = this.buildFileId(file.originalname);
        const rawText = file.buffer.toString('utf-8');
        const keywords = await this.prepareKeywordsForFile(text, file.originalname, rawText);
        this.logger.log(`Keywords ready for ${file.originalname}`, {
            total: keywords.length,
            sample: keywords.slice(0, 12),
        });
        let savedCount = 0;
        await (0, advanced_chunking_util_1.parentChildChunking)(text, async (chunk) => {
            if (chunk.metadata.level === 0) {
                const zeroEmbedding = new Array(768).fill(0);
                const parentDoc = text_document_entity_1.TextDocument.create(chunk.metadata.chunkId, chunk.text, zeroEmbedding, embedModel, new Date(), chunk.metadata.chunkId, 0, chunk.metadata.startIndex, chunk.metadata.endIndex, chunk.metadata.childIds, undefined, undefined, keywords);
                await this.textRepository.saveMany([parentDoc]);
                return;
            }
            const hasUrl = /https?:\/\/\S+|\b[\w-]+\.[\w-]+\.\w{2,}\b/.test(chunk.text);
            if (chunk.text.trim().length < MIN_CHUNK_TEXT_LENGTH && !hasUrl) {
                this.logger.log(`Skipping micro-chunk (${chunk.text.trim().length} chars): "${chunk.text.trim().slice(0, 60)}"`);
                return;
            }
            const embedding = await this.ollama.embed(chunk.text);
            const doc = text_document_entity_1.TextDocument.create((0, uuid_1.v4)(), chunk.text, (0, embedding_util_1.extractEmbedding)(embedding), embedModel, new Date(), chunk.metadata.chunkId, chunk.metadata.level, chunk.metadata.startIndex, chunk.metadata.endIndex, chunk.metadata.childIds, chunk.metadata.parentId, chunk.metadata.parentText, keywords);
            await this.textRepository.saveMany([doc]);
            savedCount++;
        }, {
            parentSize: pcOpts.parentSize ?? 4000,
            childSize: pcOpts.childSize ?? 1200,
            overlap: pcOpts.overlap ?? 150,
            storeParentText: pcOpts.storeParentText ?? true,
            useMarkdownHeaders: pcOpts.useMarkdownHeaders ?? true,
            fileId,
        });
        this.logger.log(`Saved ${savedCount} child chunks (parent-child strategy)`);
        return savedCount;
    }
    async prepareKeywordsForFile(normalizedText, filename, rawText) {
        const [textKws, pathKws] = await Promise.all([
            this.extractTextKeywords(normalizedText),
            this.extractFilepathKeywords(filename),
        ]);
        const headerKws = this.extractHeaderKeywords(rawText);
        const urlKws = this.extractUrlKeywords(rawText);
        const merged = [...new Set([...textKws, ...pathKws, ...headerKws, ...urlKws])];
        const sanitized = this.sanitizeKeywords(merged);
        const enriched = (0, transliteration_util_1.enrichKeywordsWithVariants)(sanitized);
        this.logger.log('Keyword pipeline result', {
            fromText: textKws.length,
            fromPath: pathKws.length,
            fromHeaders: headerKws.length,
            fromUrls: urlKws.length,
            afterSanitize: sanitized.length,
            afterEnrich: enriched.length,
        });
        return enriched;
    }
    sanitizeKeywords(keywords) {
        return keywords.filter(kw => {
            if (!/[a-zA-Z\u0400-\u04FF]/u.test(kw))
                return false;
            if (kw.includes('\uFFFD'))
                return false;
            if (/%[0-9a-f]{2}/i.test(kw))
                return false;
            const chars = kw.replace(/\s/g, '');
            const total = chars.length;
            if (total === 0)
                return false;
            const mojibake = (kw.match(/[\u00C0-\u00FF]/g) ?? []).length;
            if (mojibake / total > 0.3)
                return false;
            const nonWord = (kw.match(/[^\w\u0400-\u04FF\s\-]/gu) ?? []).length;
            if (nonWord / total > 0.4)
                return false;
            return true;
        });
    }
    extractNameTokens(query) {
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
            'такий', 'така', 'таке', 'такі', 'розкажи', 'про',
        ]);
        return query
            .replace(/[?!.,;:'"]/g, '')
            .split(/\s+/)
            .filter(t => t.length >= 2 && !STOPS.has(t.toLowerCase()))
            .map(t => (0, transliteration_util_1.generateNameVariants)(t));
    }
    extractHeaderKeywords(rawText) {
        const HEADER_RE = /^#{1,3}\s+(.+)$/gm;
        const keywords = new Set();
        let m;
        while ((m = HEADER_RE.exec(rawText)) !== null) {
            const line = m[1].replace(/[*_`~]/g, '');
            line
                .split(/[\s\-–—/|,;:()\[\]{}]+/)
                .flatMap(w => w.split(/(?=[A-Z])/))
                .map(w => w.trim().toLowerCase())
                .filter(w => w.length > 1)
                .forEach(w => keywords.add(w));
        }
        return [...keywords].slice(0, 40);
    }
    extractUrlKeywords(text) {
        const keywords = new Set();
        let m;
        const URL_RE = /https?:\/\/([^\s"'<>]+)/g;
        while ((m = URL_RE.exec(text)) !== null) {
            this.splitDomainParts(m[1], keywords);
        }
        const DOMAIN_RE = /\b((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.){1,5}[a-zA-Z]{2,10})\b/g;
        const fullUrlRanges = [];
        for (const urlMatch of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
            fullUrlRanges.push([urlMatch.index, urlMatch.index + urlMatch[0].length]);
        }
        while ((m = DOMAIN_RE.exec(text)) !== null) {
            const start = m.index;
            const inUrl = fullUrlRanges.some(([s, e]) => start >= s && start < e);
            if (!inUrl) {
                this.splitDomainParts(m[1], keywords);
            }
        }
        return [...keywords].slice(0, 50);
    }
    splitDomainParts(raw, out) {
        const TLD = new Set(['com', 'ua', 'net', 'org', 'io', 'co', 'www', 'http', 'https']);
        raw
            .split(/[./\-_?&#=+:→\[\]()\\ |,\s]/)
            .map(s => s.toLowerCase().trim())
            .filter(s => s.length > 1 &&
            s.length < 30 &&
            !/^\d+$/.test(s) &&
            !/%[0-9a-f]{2}/i.test(s) &&
            !/^[a-z0-9]{20,}$/.test(s) &&
            !TLD.has(s))
            .forEach(s => out.add(s));
    }
    async extractTextKeywords(text) {
        const sample = text.slice(0, 2000);
        try {
            const prompt = `Extract 10-15 most important keywords from this document text.\n` +
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
        }
        catch (error) {
            this.logger.warn('Text keyword extraction failed, falling back to frequency', {
                error: error.message,
            });
            return this.frequencyKeywords(sample);
        }
    }
    async extractFilepathKeywords(filepath) {
        const keywords = new Set();
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
    frequencyKeywords(sample) {
        const STOP = new Set(['який', 'якщо', 'також', 'this', 'that', 'which']);
        const words = sample
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 4 && !STOP.has(w));
        const freq = new Map();
        for (const w of words)
            freq.set(w, (freq.get(w) ?? 0) + 1);
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
    }
    async embedAndSaveChunks(chunks, embedModel, batchSize = 100) {
        const documents = [];
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
            const embeddings = await Promise.all(batch.map(c => this.ollama.embed(c)));
            const batchDocs = batch.map((chunk, idx) => text_document_entity_1.TextDocument.create((0, uuid_1.v4)(), chunk, (0, embedding_util_1.extractEmbedding)(embeddings[idx]), embedModel, new Date()));
            documents.push(...batchDocs);
            await this.textRepository.saveMany(batchDocs);
        }
        return documents.length;
    }
    buildFileId(originalname) {
        return originalname
            .replace(/\.md$/i, '')
            .replace(/[^a-zA-Z0-9]/g, '_')
            .toLowerCase()
            .substring(0, 50);
    }
    async retrieve(query, limit, options) {
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        const effectiveLimit = limit ?? options?.limit ?? ragConfig?.textRagDefaultLimit ?? 6;
        const { useHybridSearch, useReranking, rerankStrategy, useQueryTransformation, useContextualCompression, useConversationMemory, sessionId, scoreThreshold, _searchMode, } = options || {};
        const entityQuery = (0, transliteration_util_1.isEntityQuery)(query);
        const collectionName = ragConfig?.textRagCollectionName;
        if (!collectionName)
            return 'RAG text collection name is not configured';
        const searchMode = _searchMode ?? (entityQuery ? 'entity' : 'balanced');
        let keywords = [];
        let queriesToEmbed = [query];
        if (useQueryTransformation) {
            try {
                const transformed = await this.queryTransformer.transformQuery(query);
                console.log('transformed :>> ', transformed);
                keywords = transformed.keywords.filter(kw => kw.length > 2 && !KEYWORD_STOP_WORDS.has(kw.toLowerCase()));
                const isShortQuery = query.trim().split(/\s+/).length <= 3;
                queriesToEmbed = isShortQuery
                    ? [transformed.original, ...transformed.expanded.slice(0, 1)].filter(Boolean)
                    : [
                        transformed.original,
                        ...transformed.expanded.slice(0, 2),
                        ...transformed.rephrased.slice(0, 1),
                    ].filter(Boolean).slice(0, 4);
                const uaTranslations = (0, query_transformer_util_1.translateQueryToUkrainian)(query);
                if (uaTranslations.length > 0) {
                    this.logger.log('EN→UA query translation', { query, uaTranslations });
                    queriesToEmbed = [...new Set([...queriesToEmbed, ...uaTranslations])].slice(0, 6);
                }
            }
            catch {
                keywords = [];
            }
        }
        console.log('keywords :>> ', keywords);
        console.log('queriesToEmbed :>> ', queriesToEmbed);
        if (useConversationMemory && sessionId) {
            const history = await this.conversationRepository.getHistory(sessionId, 2);
            if (history.length > 0) {
                queriesToEmbed.push(`${query}\n\nPrevious: ${history.map(t => t.query).join('; ')}`);
                queriesToEmbed = queriesToEmbed.slice(0, 6);
            }
        }
        const embeddings = await Promise.all(queriesToEmbed.map(q => this.ollama.embed(q)));
        const primaryEmbedding = new embedding_vo_1.Embedding((0, embedding_util_1.extractEmbedding)(embeddings[0]));
        let results = [];
        const effectivenessLimit = (searchMode === 'entity' ? 6 : 4) * effectiveLimit;
        console.log('effectivenessLimit :>> ', effectivenessLimit);
        if (useHybridSearch) {
            const allSearchResults = await Promise.all(embeddings.map(emb => this.hybridSearch.search(collectionName, new embedding_vo_1.Embedding((0, embedding_util_1.extractEmbedding)(emb)), keywords, effectivenessLimit, {
                searchMode,
                minTextLength: MIN_CHUNK_TEXT_LENGTH,
                originalQuery: query,
                ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
            })));
            console.log('allSearchResults.length :>> ', allSearchResults.length);
            const validResults = allSearchResults.filter(Boolean);
            console.log('validResults.length :>> ', validResults.length);
            if (validResults.length === 0)
                return 'There is no relevant information in knowledge';
            const mergedMap = new Map();
            for (const searchResults of validResults) {
                for (const r of searchResults) {
                    const existing = mergedMap.get(r.id);
                    if (!existing || r.hybridScore > existing.hybridScore) {
                        mergedMap.set(r.id, r);
                    }
                }
            }
            console.log('mergedMap :>> ', mergedMap);
            const uaTranslations = (0, query_transformer_util_1.translateQueryToUkrainian)(query);
            if (uaTranslations.length > 0 && collectionName) {
                try {
                    const uaEmbeddings = await Promise.all(uaTranslations.map(ua => this.ollama.embed(ua)));
                    const uaSearchResults = await Promise.all(uaEmbeddings.map(emb => this.qdrantService.search(collectionName, {
                        vector: (0, embedding_util_1.extractEmbedding)(emb),
                        limit: effectivenessLimit,
                        searchMode: 'wide',
                        score_threshold: null,
                    })));
                    let uaAdded = 0;
                    for (const points of uaSearchResults) {
                        for (const p of points) {
                            const id = p.id.toString();
                            const text = p.payload?.text ?? '';
                            if (text.trim().length < MIN_CHUNK_TEXT_LENGTH)
                                continue;
                            const uaScore = p.score ?? 0;
                            const existing = mergedMap.get(id);
                            if (!existing || uaScore > existing.hybridScore) {
                                mergedMap.set(id, {
                                    id,
                                    text,
                                    parentText: p.payload?.parentText,
                                    parentId: p.payload?.parentId,
                                    vectorScore: uaScore,
                                    keywordScore: 0,
                                    hybridScore: uaScore,
                                });
                                uaAdded++;
                            }
                        }
                    }
                    this.logger.log('UA vector search merged', { uaAdded, total: mergedMap.size });
                }
                catch (err) {
                    this.logger.warn('UA vector search failed', { error: err?.message });
                }
            }
            console.log('uaTranslations :>> ', uaTranslations);
            results = [...mergedMap.values()]
                .sort((a, b) => b.hybridScore - a.hybridScore)
                .map(r => ({ id: r.id, text: r.text, score: r.hybridScore }));
        }
        else {
            const vectorResults = await this.textRepository.findByEmbedding(primaryEmbedding, effectiveLimit * 3, {
                ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
                searchMode: entityQuery ? 'wide' : 'balanced',
            });
            results = vectorResults.map(doc => ({
                id: doc.id,
                text: doc.text,
                score: doc.score ?? 0,
            }));
            results = results.filter(r => {
                if (r.text.trim().length < MIN_CHUNK_TEXT_LENGTH)
                    return false;
                if (/^\[[^\]]{2,60}\][\s\\]*$/.test(r.text.trim()))
                    return false;
                return true;
            });
            const topScores = results.slice(0, 3).map(r => r.score ?? 0);
            const avgTopScore = topScores.length
                ? topScores.reduce((a, b) => a + b, 0) / topScores.length
                : 0;
            const entityKeywordMissing = entityQuery && keywords.length > 0 &&
                !results.slice(0, 3).some(r => keywords.some(kw => r.text.toLowerCase().includes(kw.toLowerCase())));
            if (avgTopScore < 0.72 || entityKeywordMissing) {
                const hybridFallback = await this.hybridSearch.search(collectionName, primaryEmbedding, keywords, effectiveLimit * 3, {
                    searchMode,
                    minTextLength: MIN_CHUNK_TEXT_LENGTH,
                    originalQuery: query,
                    ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
                });
                if (!hybridFallback)
                    return 'There is no relevant information in knowledge';
                results = hybridFallback.map(r => ({ id: r.id, text: r.text, score: r.hybridScore }));
            }
        }
        if (results.length === 0)
            return 'There is no relevant information in knowledge';
        if (useReranking && rerankStrategy !== 'none' && results.length > effectiveLimit) {
            const reranked = await this.reranker.rerank(query, results, {
                topK: effectiveLimit,
                method: rerankStrategy === 'cross_encoder' ? 'listwise'
                    : rerankStrategy === 'llm_based' ? 'llm'
                        : 'hybrid',
            });
            results = reranked.map(r => ({ id: r.item.id, text: r.item.text, score: r.finalScore }));
        }
        results = results.filter(r => r.score > 0.1);
        results = results.filter(r => r.level !== 0);
        results = results.slice(0, effectiveLimit);
        if (searchMode === 'entity') {
            const nameTokenGroups = this.extractNameTokens(query);
            if (nameTokenGroups.length > 0) {
                const chunkMatches = (text, groups) => {
                    const lower = text.toLowerCase();
                    const translitText = (0, transliteration_util_1.cyrillicToLatin)(lower);
                    return groups.every(variants => variants.some(v => {
                        const vLower = v.toLowerCase();
                        return lower.includes(vLower) || translitText.includes((0, transliteration_util_1.cyrillicToLatin)(vLower));
                    }));
                };
                let filtered = results.filter(r => chunkMatches(r.text, nameTokenGroups));
                if (filtered.length === 0) {
                    const surnameGroup = nameTokenGroups[nameTokenGroups.length - 1];
                    filtered = results.filter(r => {
                        const lower = r.text.toLowerCase();
                        const translitText = (0, transliteration_util_1.cyrillicToLatin)(lower);
                        return surnameGroup.some(v => {
                            const vLower = v.toLowerCase();
                            return lower.includes(vLower) || translitText.includes((0, transliteration_util_1.cyrillicToLatin)(vLower));
                        });
                    });
                }
                if (filtered.length > 0) {
                    this.logger.log('EntityPostFilter', {
                        query,
                        groups: nameTokenGroups.map(g => g.slice(0, 4)),
                        before: results.length,
                        after: filtered.length,
                    });
                    results = filtered;
                }
            }
        }
        const shouldCompress = useContextualCompression && searchMode !== 'entity';
        if (shouldCompress) {
            try {
                const compressed = await this.contextualCompressor.compressContext(query, results.map(r => ({ id: r.id, text: r.text })));
                results = results.map((r, i) => ({
                    ...r,
                    text: compressed?.[i]?.compressed ?? r.text,
                }));
            }
            catch { }
        }
        return results;
    }
    async getAllDocuments() {
        const documents = await this.textRepository.findAll();
        return documents.map(doc => ({
            id: doc.id,
            text: doc.text,
            createdAt: doc.createdAt.toISOString(),
            model: doc.model,
        }));
    }
    buildPrompt(type, context, query) {
        const PROMPTS = {
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

      ФОРМАТ:

      - 1–3 речення
      - максимально конкретно
      - без зайвих деталей

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

      Використовуй ТІЛЬКИ інформацію з <context>.
      ЗАБОРОНЕНО вигадувати факти.

      <context>
      ${context}
      </context>

      ЗАВДАННЯ:

      1. Уважно прочитай ВЕСЬ контекст
      2. Визнач усі ключові теми
      3. ОБ'ЄДНАЙ інформацію у логічні блоки
      4. Побудуй цілісне пояснення теми
      5. Якщо контекст містить лише частину інформації — розкрий те, що є, повністю

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
      - відмовлятись відповідати через "неповний контекст"

      ✅ ПОТРІБНО:
      - писати як готову статтю / інструкцію
      - зшивати інформацію з різних місць
      - використовувати максимум контексту
      - якщо якийсь аспект не покритий — просто пропусти його без згадки

      Питання:
      ${query}

      Відповідь:
      `,
        };
        return PROMPTS[type];
    }
    async generateAnswer(query, options) {
        prompt_injection_guard_1.PromptInjectionGuard.assertSafe(query);
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        const classification = await this.queryClassifier.classify(query);
        const p = classification.params;
        this.logger.log('QueryClassification', {
            query: query.slice(0, 60),
            type: classification.type,
            confidence: classification.confidence,
            params: {
                searchMode: p.searchMode, limit: p.limit, threshold: p.scoreThreshold,
                temperature: p.temperature, topP: p.topP, topK: p.topK,
                maxTokens: p.maxTokens, repeatPenalty: p.repeatPenalty, seed: p.seed,
            },
        });
        const temperature = p.temperature;
        const topP = p.topP;
        const topK = p.topK;
        const maxTokens = p.maxTokens;
        const repeatPenalty = p.repeatPenalty;
        const seed = p.seed;
        const retrieveOptions = {
            limit: p.limit,
            scoreThreshold: p.scoreThreshold,
            useHybridSearch: p.useHybridSearch,
            useReranking: p.useReranking,
            rerankStrategy: p.rerankStrategy,
            useQueryTransformation: p.useQueryTransformation,
            useContextualCompression: p.useContextualCompression,
            useConversationMemory: p.useConversationMemory,
            filters: options?.filters,
            sessionId: options?.sessionId,
            _searchMode: p.searchMode,
        };
        const rawRetrieved = await this.retrieve(query, undefined, retrieveOptions);
        if (typeof rawRetrieved === 'string')
            return { answer: rawRetrieved };
        if (!Array.isArray(rawRetrieved))
            return { answer: String(rawRetrieved) };
        const configThreshold = ragConfig?.textRagScoreThreshold;
        const applyConfigFilter = classification.type === 'factual'
            && classification.confidence > 0.8;
        const effectiveThreshold = classification.type === 'factual'
            ? Math.min(p.scoreThreshold, FACTUAL_SCORE_THRESHOLD_CAP)
            : p.scoreThreshold;
        const filtered = applyConfigFilter
            ? rawRetrieved.filter(el => (el.score ?? 0) >= effectiveThreshold)
            : rawRetrieved;
        const postFilterResults = filtered.length > 0 ? filtered : (() => {
            this.logger.warn('Score filter removed all results, falling back to top-3 unfiltered', {
                rawCount: rawRetrieved.length,
                threshold: effectiveThreshold,
            });
            return rawRetrieved.slice(0, 3);
        })();
        const retrieved = p.useParentExpansion
            ? await this.expandToParentContext(postFilterResults)
            : postFilterResults;
        const useKG = options?.useKnowledgeGraph ?? p.useKnowledgeGraph;
        let kgContext;
        if (useKG)
            kgContext = await this.queryKnowledgeGraph(query);
        if (retrieved.length === 0) {
            return {
                answer: 'Відповідь відсутня у наданій інформації.',
                relevantChunks: 0,
                citations: [],
            };
        }
        const context = retrieved
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 8)
            .map(doc => doc.text)
            .join('\n\n');
        let prompt = this.buildPrompt(classification.type, context, query);
        if (kgContext) {
            prompt +=
                `\n\n<knowledge_graph>\n${kgContext}\n</knowledge_graph>\n` +
                    `(Граф знань надає додатковий контекст про сутності, але пріоритет — документальний контекст вище.)`;
        }
        if (options?.conversationHistory?.length) {
            const historyBlock = '\n====================\nІСТОРІЯ РОЗМОВИ:\n' +
                options.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') +
                '\n';
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
        let citations = [];
        let formattedAnswer = answer;
        if (useCitations) {
            const tracked = this.trackCitations(answer, retrieved);
            citations = tracked.citations;
            formattedAnswer = tracked.formattedAnswer;
        }
        if (options?.sessionId) {
            const embedding = await this.ollama.embed(query);
            await this.conversationRepository.addTurn(options.sessionId, query, answer, (0, embedding_util_1.extractEmbedding)(embedding));
        }
        const topScore = retrieved[0]?.score;
        return {
            answer: formattedAnswer,
            formattedAnswer,
            citations,
            relevantChunks: retrieved.length,
            confidence: typeof topScore === 'number' ? topScore : undefined,
            queryType: classification.type,
            queryConfidence: classification.confidence,
            generationParams: { temperature, topP, topK, maxTokens, repeatPenalty, seed },
            knowledgeGraphContext: kgContext,
            conversationContext: !!options?.sessionId,
            ...(options?.includeSources && {
                sources: retrieved.map(doc => ({
                    id: doc.id,
                    text: doc.text,
                    score: doc.score,
                    metadata: doc.metadata,
                })),
            }),
        };
    }
    async *streamableGenerateAnswer(query, options) {
        try {
            prompt_injection_guard_1.PromptInjectionGuard.assertSafe(query);
        }
        catch (err) {
            yield { event: 'error', error: err?.message ?? 'Prompt injection detected' };
            return;
        }
        const classification = await this.queryClassifier.classify(query);
        const p = classification.params;
        const temperature = p.temperature;
        const topP = p.topP;
        const topK = p.topK;
        const maxTokens = p.maxTokens;
        const repeatPenalty = p.repeatPenalty;
        const seed = p.seed;
        const retrieveOptions = {
            limit: p.limit,
            scoreThreshold: p.scoreThreshold,
            useHybridSearch: p.useHybridSearch,
            useReranking: p.useReranking,
            rerankStrategy: p.rerankStrategy,
            useQueryTransformation: p.useQueryTransformation,
            useContextualCompression: p.useContextualCompression,
            useConversationMemory: p.useConversationMemory,
            filters: options?.filters,
            sessionId: options?.sessionId,
            _searchMode: p.searchMode,
        };
        const rawRetrieved = await this.retrieve(query, undefined, retrieveOptions);
        if (typeof rawRetrieved === 'string') {
            yield { event: 'metadata', metadata: { relevantChunks: 0, citations: [] } };
            yield { event: 'token', token: rawRetrieved };
            yield { event: 'done', metadata: { relevantChunks: 0, citations: [] } };
            return;
        }
        const effectiveThreshold = classification.type === 'factual'
            ? Math.min(p.scoreThreshold, FACTUAL_SCORE_THRESHOLD_CAP)
            : p.scoreThreshold;
        const applyFilter = classification.type === 'factual'
            && classification.confidence > 0.8;
        const preFiltered = applyFilter && effectiveThreshold
            ? rawRetrieved.filter(el => (el.score ?? 0) >= effectiveThreshold)
            : rawRetrieved;
        const postFilterResults = preFiltered.length > 0 ? preFiltered : rawRetrieved.slice(0, 3);
        const retrieved = p.useParentExpansion
            ? await this.expandToParentContext(postFilterResults)
            : postFilterResults;
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
        let kgContext;
        if (useKG)
            kgContext = await this.queryKnowledgeGraph(query);
        const context = retrieved
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 8)
            .map(doc => doc.text)
            .join('\n\n');
        let prompt = this.buildPrompt(classification.type, context, query);
        if (kgContext) {
            prompt +=
                `\n\n<knowledge_graph>\n${kgContext}\n</knowledge_graph>\n` +
                    `(Граф знань надає додатковий контекст про сутності, але пріоритет — документальний контекст вище.)`;
        }
        if (options?.conversationHistory?.length) {
            const historyBlock = '\n====================\nІСТОРІЯ РОЗМОВИ:\n' +
                options.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n') +
                '\n';
            prompt += `\n\n<conversation_history>\n${historyBlock}\n</conversation_history>`;
        }
        prompt += `\n\n<question>${query}</question>\n\nВідповідь (структурована, на основі контексту):`;
        yield {
            event: 'metadata',
            metadata: {
                relevantChunks: retrieved.length,
                confidence: retrieved[0]?.score,
                queryType: classification.type,
                queryConfidence: classification.confidence,
                generationParams: { temperature, topP, topK, maxTokens, repeatPenalty, seed },
                knowledgeGraphContext: kgContext,
                conversationContext: !!options?.sessionId,
                ...(options?.includeSources && {
                    sources: retrieved.map(doc => ({
                        id: doc.id,
                        text: doc.text,
                        score: doc.score,
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
        }
        catch (err) {
            yield { event: 'error', error: err?.message ?? 'LLM streaming failed' };
            return;
        }
        try {
            const chunkTexts = retrieved.map(r => r.text);
            const verification = await this.confidencePort.verify(fullAnswer, chunkTexts);
            this.logger.log('Stream_Confidence', {
                score: verification.confidence.score,
                tier: verification.confidence.tier,
                grounded: verification.grounded,
                verdict: verification.llmVerdict,
            });
            if (!verification.grounded &&
                verification.llmVerdict === 'NO' &&
                verification.confidence.score < 0.4) {
                fullAnswer = 'Немає релевантної відповіді';
                yield { event: 'correction', correctedAnswer: fullAnswer, reason: 'hallucination' };
            }
        }
        catch (err) {
            this.logger.warn('Stream_Confidence failed', { error: err?.message });
        }
        const useCitations = options?.useCitationTracking ?? p.useCitationTracking;
        let citations = [];
        if (useCitations) {
            const tracked = this.trackCitations(fullAnswer, retrieved);
            citations = tracked.citations;
        }
        if (options?.sessionId) {
            const embedding = await this.ollama.embed(query);
            await this.conversationRepository.addTurn(options.sessionId, query, fullAnswer, (0, embedding_util_1.extractEmbedding)(embedding));
        }
        yield {
            event: 'done',
            metadata: {
                citations,
                relevantChunks: retrieved.length,
            },
        };
    }
    async deleteById(id) {
        await this.textRepository.deleteById(id);
        return { deletedDocumentId: id };
    }
    trackCitations(answer, retrievedDocs) {
        const citations = [];
        let formattedAnswer = answer;
        retrievedDocs.forEach((doc, idx) => {
            const sentences = doc.text.match(/[^.!?…]+[.!?…]+/g) || [];
            sentences.forEach(sentence => {
                if (sentence.length < 20)
                    return;
                if (this.findSimilarContent(answer, sentence)) {
                    citations.push({ id: `cite_${idx}`, documentId: doc.id, text: sentence });
                }
            });
        });
        if (citations.length > 0) {
            const docIndices = new Map();
            let currentIndex = 1;
            citations.forEach(cite => {
                if (!docIndices.has(cite.documentId))
                    docIndices.set(cite.documentId, currentIndex++);
            });
            citations.forEach(cite => {
                const index = docIndices.get(cite.documentId);
                const anchor = cite.text.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                formattedAnswer = formattedAnswer.replace(new RegExp(anchor, 'g'), match => `${match} [${index}]`);
            });
        }
        return { citations, formattedAnswer };
    }
    findSimilarContent(haystack, needle) {
        const needleWords = needle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (needleWords.length === 0)
            return false;
        const haystackLower = haystack.toLowerCase();
        const matched = needleWords.filter(word => haystackLower.includes(word));
        return matched.length / needleWords.length > 0.6;
    }
    async expandToParentContext(results) {
        const parentIds = [...new Set(results.filter(r => r.parentId).map(r => r.parentId))];
        const parentTexts = new Map();
        if (parentIds.length > 0) {
            try {
                const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
                const collectionName = ragConfig?.textRagCollectionName;
                if (collectionName) {
                    const parentPoints = await this.qdrantService.getPoints(collectionName, parentIds);
                    for (const p of parentPoints) {
                        parentTexts.set(p.id.toString(), p.payload?.text ?? '');
                    }
                }
            }
            catch (err) {
                this.logger.warn('expandToParentContext: batch fetch failed', { err });
            }
        }
        const parentGroups = new Map();
        const noParent = [];
        for (const doc of results) {
            if (!doc.parentId) {
                noParent.push(doc);
                continue;
            }
            if (!parentGroups.has(doc.parentId)) {
                parentGroups.set(doc.parentId, { doc, children: [] });
            }
            parentGroups.get(doc.parentId).children.push(doc.text);
        }
        const merged = [];
        for (const [parentId, { doc, children }] of parentGroups) {
            const pText = parentTexts.get(parentId) ?? doc.parentText ?? '';
            const uniqueChildren = [...new Set(children)];
            const combinedText = pText
                ? `${pText}\n\n${uniqueChildren.join('\n\n')}`
                : uniqueChildren.join('\n\n');
            merged.push({
                ...doc,
                text: combinedText.slice(0, MAX_CONTEXT_CHARS),
            });
        }
        return [...merged, ...noParent];
    }
    async extractKnowledgeGraph(text, documentId) {
        try {
            const { entities, relationships } = await this.extractEntitiesAndRelations(text, documentId);
            this.logger.log('KG extraction complete', {
                entities: entities.length, relationships: relationships.length,
            });
            for (const entity of entities)
                await this.knowledgeGraph.addEntity(entity);
            for (const rel of relationships)
                await this.knowledgeGraph.addRelationship(rel);
        }
        catch (error) {
            this.logger.warn('Knowledge graph extraction failed', { error });
        }
    }
    async extractEntitiesAndRelations(text, sourceDocument) {
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
            const response = await this.ollama.getRagResponseByPrompt(prompt, { temperature: 0, maxTokens: 800 });
            const clean = response.replace(/```(?:json)?/g, '').trim();
            const jsonMatch = clean.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                return { entities: [], relationships: [] };
            const parsed = JSON.parse(jsonMatch[0]);
            const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
            const rawRelations = Array.isArray(parsed.relations) ? parsed.relations : [];
            const entities = rawEntities
                .filter(e => e?.name && e?.type && !this.isNoisyEntity(e.name, e.type))
                .map(e => ({
                id: this.buildCanonicalId(e.name, e.type),
                name: e.name,
                type: e.type.toLowerCase(),
                sourceDocument,
            }));
            const nameToId = new Map(entities.map(e => [e.name.toLowerCase(), e.id]));
            const relationships = rawRelations
                .filter(r => r?.from && r?.to && r?.relation)
                .map(r => {
                const fromId = nameToId.get(r.from.toLowerCase());
                const toId = nameToId.get(r.to.toLowerCase());
                if (!fromId || !toId || fromId === toId)
                    return null;
                return {
                    id: `${fromId}__${r.relation.toUpperCase()}__${toId}`,
                    fromEntityId: fromId,
                    toEntityId: toId,
                    type: r.relation.toUpperCase(),
                };
            })
                .filter((r) => r !== null);
            return { entities, relationships };
        }
        catch (error) {
            this.logger.warn('Entity extraction failed', { error });
            return { entities: [], relationships: [] };
        }
    }
    isNoisyEntity(name, type) {
        const t = name.trim();
        if (t.length < 2 || t.length > 60)
            return true;
        if (/[!?]/.test(t))
            return true;
        if (!/\s/.test(t) && /[._]/.test(t))
            return true;
        if (/^\d+(\s+\S{1,6})?$/.test(t))
            return true;
        if (type === 'concept' && /\d/.test(t))
            return true;
        return false;
    }
    buildCanonicalId(name, type) {
        const slug = (0, transliteration_util_1.cyrillicToLatin)(name)
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        return `${slug}_${type.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    }
    async queryKnowledgeGraph(query) {
        try {
            const relevantEntities = await this.knowledgeGraph.queryEntities(query);
            this.logger.log('KG entities', { count: relevantEntities.length });
            if (!relevantEntities.length)
                return '';
            return relevantEntities.map(e => {
                const relTypes = e.properties?.relTypes;
                return relTypes?.length
                    ? `${e.name} is a ${e.type} (connected via: ${relTypes.join(', ')})`
                    : `${e.name} is a ${e.type}`;
            }).join('. ') + '.';
        }
        catch (error) {
            this.logger.warn('Knowledge graph query failed', { error });
            return '';
        }
    }
};
exports.TextRagService = TextRagService;
exports.TextRagService = TextRagService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)('ITextDocumentRepository')),
    __param(4, (0, common_1.Inject)('IConversationSessionRepository')),
    __param(5, (0, common_1.Inject)('IKnowledgeGraphPort')),
    __param(6, (0, common_1.Inject)('LoggerPort')),
    __param(7, (0, common_1.Inject)('IConfidencePort')),
    __metadata("design:paramtypes", [config_1.ConfigService,
        ollama_service_1.OllamaService,
        rag_qdrant_service_1.RagQdrantService, Object, Object, Object, Object, Object])
], TextRagService);
//# sourceMappingURL=text-rag.service.js.map