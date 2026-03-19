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
exports.QdrantTextDocumentRepository = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const rag_qdrant_service_1 = require("../rag-qdrant.service");
const rag_config_1 = require("../../config/rag-config");
const text_document_qdrant_mapper_1 = require("../../mappers/text-document.qdrant.mapper");
const collection_config_vo_1 = require("../../../domain/value-objects/collection-config.vo");
let QdrantTextDocumentRepository = class QdrantTextDocumentRepository {
    constructor(qdrant, configService, logger) {
        this.qdrant = qdrant;
        this.configService = configService;
        this.logger = logger;
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        const vectorSize = ragConfig?.textRagVectorSize || 768;
        const hnswConfig = ragConfig?.textRagHnswConfig;
        this.collectionConfig = new collection_config_vo_1.CollectionConfig(ragConfig?.textRagCollectionName || 'rag_text', vectorSize, 'Cosine', hnswConfig
            ? { m: hnswConfig.m, efConstruct: hnswConfig.efConstruct, efSearch: hnswConfig.efSearch }
            : undefined);
    }
    async onModuleInit() {
        await this.qdrant.ensureCollectionWithConfig(this.collectionConfig);
        await Promise.all([
            this.qdrant.createPayloadIndex(this.collectionConfig.name, 'text', 'text'),
            this.qdrant.createPayloadIndex(this.collectionConfig.name, 'contextKeywords', 'keyword'),
            this.qdrant.createPayloadIndex(this.collectionConfig.name, 'level', 'integer'),
            this.qdrant.createPayloadIndex(this.collectionConfig.name, 'parentId', 'keyword'),
            this.qdrant.createPayloadIndex(this.collectionConfig.name, 'textLength', 'integer'),
        ]);
        this.logger.log(`Qdrant text collection "${this.collectionConfig.name}" ready (indexes ensured)`);
    }
    async saveMany(documents) {
        if (!documents.length)
            return;
        const EXPECTED_DIM = this.collectionConfig.vectorSize;
        const points = documents
            .map(doc => {
            const point = text_document_qdrant_mapper_1.TextDocumentQdrantMapper.toPoint(doc);
            point.payload.textLength = (point.payload).text?.length ?? 0;
            return point;
        })
            .filter(p => {
            const valid = Array.isArray(p.vector) &&
                p.vector.length === EXPECTED_DIM &&
                p.vector.every(v => typeof v === 'number' && Number.isFinite(v));
            if (!valid) {
                this.logger.warn('[QDRANT] Invalid vector, skipping', {
                    id: p.id,
                    vectorLength: p.vector?.length,
                });
            }
            return valid;
        });
        if (!points.length) {
            throw new Error('[QDRANT] No valid vectors to upsert (all embeddings are empty or invalid)');
        }
        const BATCH_SIZE = 64;
        const MAX_RETRIES = 3;
        for (let i = 0; i < points.length; i += BATCH_SIZE) {
            const batch = points.slice(i, i + BATCH_SIZE);
            let attempt = 0;
            while (true) {
                try {
                    await this.qdrant.upsert(this.collectionConfig.name, batch);
                    break;
                }
                catch (err) {
                    attempt++;
                    if (err?.data?.status?.error?.includes('Vector dimension error')) {
                        this.logger.error('[QDRANT] Vector dimension mismatch', {
                            batchFrom: i, batchTo: i + batch.length,
                            error: err.data.status.error,
                        });
                        throw err;
                    }
                    if (attempt > MAX_RETRIES) {
                        this.logger.error(`[QDRANT] Upsert failed after ${MAX_RETRIES} retries (batch ${i}–${i + batch.length})`, err);
                        throw err;
                    }
                    this.logger.warn(`[QDRANT] Upsert attempt ${attempt}/${MAX_RETRIES} failed. Retrying…`);
                    await new Promise(r => setTimeout(r, 1_000 * attempt));
                }
            }
        }
    }
    async findByEmbedding(embedding, limit, options) {
        const filter = this.buildFilter(options?.onlyChildren, options?.filter);
        const results = await this.qdrant.search(this.collectionConfig.name, {
            vector: embedding.values,
            limit,
            searchMode: options?.searchMode ?? 'balanced',
            ...(options?.scoreThreshold !== undefined
                ? { score_threshold: options.scoreThreshold }
                : {}),
            ...(filter ? { filter } : {}),
        });
        return results
            .filter(r => !!r.payload && typeof (r.payload).model !== 'undefined')
            .map(r => text_document_qdrant_mapper_1.TextDocumentQdrantMapper.fromPoint(r, String(r.payload.model)));
    }
    async findAll(limit = 1_000) {
        const { documents } = await this.findAllPaginated(limit);
        return documents;
    }
    async findAllPaginated(limit = 100, offset) {
        const results = await this.qdrant.scroll(this.collectionConfig.name, {
            limit,
            offset,
        });
        const points = results.points || [];
        const documents = points
            .filter(p => !!p.payload && typeof p.payload.model !== 'undefined')
            .map(p => text_document_qdrant_mapper_1.TextDocumentQdrantMapper.fromPoint(p, String(p.payload.model)));
        return {
            documents,
            nextOffset: results.next_page_offset?.toString(),
        };
    }
    async deleteById(id) {
        await this.qdrant.deletePoints(this.collectionConfig.name, [id]);
    }
    buildFilter(onlyChildren, extra) {
        const conditions = [];
        if (onlyChildren) {
            conditions.push({
                should: [
                    { key: 'level', match: { value: 1 } },
                    { key: 'level', is_null: true },
                ],
            });
        }
        conditions.push({
            key: 'textLength',
            range: { gte: 80 },
        });
        if (extra)
            conditions.push(extra);
        if (!conditions.length)
            return undefined;
        return conditions.length === 1 ? conditions[0] : { must: conditions };
    }
};
exports.QdrantTextDocumentRepository = QdrantTextDocumentRepository;
exports.QdrantTextDocumentRepository = QdrantTextDocumentRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [rag_qdrant_service_1.RagQdrantService,
        config_1.ConfigService, Object])
], QdrantTextDocumentRepository);
//# sourceMappingURL=qdrant-text-document.repository.js.map