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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagQdrantService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const js_client_rest_1 = require("@qdrant/js-client-rest");
const qdrant_collection_config_mapper_1 = require("./mappers/qdrant-collection-config.mapper");
const rag_config_1 = require("../config/rag-config");
const EF_BY_MODE = {
    precise: 512,
    balanced: 256,
    wide: 64,
};
const DEFAULT_SCORE_THRESHOLD_BY_MODE = {
    precise: 0.75,
    balanced: 0.65,
    wide: 0.50,
};
let RagQdrantService = class RagQdrantService {
    constructor(configService) {
        this.configService = configService;
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        this.client = new js_client_rest_1.QdrantClient({
            url: ragConfig?.qdrantUrl,
            apiKey: ragConfig?.qdrantApiKey,
        });
    }
    async ensureCollectionWithConfig(config) {
        const existing = await this.client.getCollections();
        if (existing.collections.some((c) => c.name === config.name))
            return;
        const qdrantConfig = qdrant_collection_config_mapper_1.QdrantCollectionConfigMapper.toQdrantConfig(config);
        await this.client.createCollection(config.name, qdrantConfig);
    }
    async createPayloadIndex(collectionName, fieldName, fieldType) {
        try {
            await this.client.createPayloadIndex(collectionName, {
                field_name: fieldName,
                field_schema: fieldType,
            });
        }
        catch (err) {
            const msg = err?.data?.status?.error ??
                err?.response?.data?.status?.error ??
                err?.message ??
                '';
            const alreadyExists = msg.toLowerCase().includes('already exists') ||
                msg.toLowerCase().includes('field already exists');
            if (!alreadyExists)
                throw err;
        }
    }
    async upsert(collectionName, points) {
        return this.client.upsert(collectionName, { points: points });
    }
    async search(collectionName, params) {
        const mode = params.searchMode ?? 'balanced';
        const ef = EF_BY_MODE[mode];
        const scoreThreshold = params.score_threshold === null
            ? undefined
            : params.score_threshold !== undefined
                ? params.score_threshold
                : DEFAULT_SCORE_THRESHOLD_BY_MODE[mode];
        return this.client.search(collectionName, {
            vector: params.vector,
            limit: params.limit,
            filter: params.filter,
            score_threshold: scoreThreshold,
            with_vector: params.with_vector ?? false,
            params: {
                hnsw_ef: ef,
                exact: false,
                ...(params.params ?? {}),
            },
        });
    }
    async scroll(collectionName, params) {
        return this.client.scroll(collectionName, {
            limit: params.limit,
            offset: params.offset,
            filter: params.filter,
            with_payload: params.with_payload ?? true,
            with_vector: false,
        });
    }
    async getPoints(collectionName, ids) {
        const result = await this.client.retrieve(collectionName, {
            ids,
            with_payload: true,
            with_vector: false,
        });
        return result;
    }
    async deletePoints(collectionName, ids) {
        return this.client.delete(collectionName, { points: ids });
    }
};
exports.RagQdrantService = RagQdrantService;
exports.RagQdrantService = RagQdrantService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], RagQdrantService);
//# sourceMappingURL=rag-qdrant.service.js.map