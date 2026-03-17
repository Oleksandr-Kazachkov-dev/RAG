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
exports.OllamaService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const axios_retry_1 = require("axios-retry");
const rag_config_1 = require("../config/rag-config");
(0, axios_retry_1.default)(axios_1.default, {
    retries: 3,
    retryDelay: axios_retry_1.default.exponentialDelay,
    retryCondition: (err) => axios_retry_1.default.isNetworkOrIdempotentRequestError(err) ||
        err.code === 'ECONNABORTED' ||
        ((err.response?.status ?? 0) >= 500),
});
let OllamaService = class OllamaService {
    constructor(configService, logger) {
        this.configService = configService;
        this.logger = logger;
        this.timeout = 60_000;
        this.visionTimeout = 120_000;
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        this.baseURL =
            ragConfig?.ollamaBaseUrl || 'https://ollama.com';
        this.apiKey = process.env.OLLAMA_API_KEY;
        this.textEmbedModel =
            ragConfig?.ollamaEmbedModelText || 'nomic-embed-text';
        this.chatModel =
            ragConfig?.ollamaChatModel || 'llama3';
        this.visionModel =
            ragConfig?.ollamaVisionModel || 'llama3';
        if (!this.apiKey) {
            this.logger.warn('OLLAMA_API_KEY is not set!');
        }
    }
    getHeaders() {
        return this.apiKey
            ? { Authorization: `Bearer ${this.apiKey}` }
            : {};
    }
    async embed(prompt) {
        try {
            const MAX_CHARS = 3000;
            const safePrompt = prompt.length > MAX_CHARS ? prompt.slice(0, MAX_CHARS) : prompt;
            const response = await axios_1.default.post(`${this.baseURL}/api/embeddings`, { model: this.textEmbedModel, prompt: safePrompt }, {
                timeout: this.timeout,
                headers: this.getHeaders(),
            });
            const embedding = response.data?.embedding;
            if (!Array.isArray(embedding) || embedding.length === 0) {
                this.logger.warn('Empty embedding, skipping chunk');
                return null;
            }
            return embedding;
        }
        catch (error) {
            this.logger.warn('Embedding skipped', {
                error: this.getErrorMessage(error),
            });
            return null;
        }
    }
    async extractKeywords(text) {
        try {
            const response = await axios_1.default.post(`${this.baseURL}/api/chat`, {
                model: this.chatModel,
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You extract search keywords from text.',
                            'Return ONLY JSON array like ["cat","dog"]',
                            '3–10 keywords max',
                        ].join('\n'),
                    },
                    { role: 'user', content: text },
                ],
                temperature: 0,
                stream: false,
            }, {
                timeout: this.timeout,
                headers: this.getHeaders(),
            });
            const content = response.data?.message?.content;
            if (typeof content !== 'string') {
                throw new Error('Invalid LLM response');
            }
            return JSON.parse(content);
        }
        catch (error) {
            this.logger.error('Failed to extract keywords', error);
            throw error;
        }
    }
    async getRagResponseByPrompt(prompt, options = {}) {
        try {
            const messages = [];
            if (options.systemPrompt) {
                messages.push({ role: 'system', content: options.systemPrompt });
            }
            messages.push({ role: 'user', content: prompt });
            const requestBody = {
                model: this.chatModel,
                messages,
                stream: false,
                options: {
                    temperature: options.temperature ?? 0,
                    top_p: options.topP,
                    top_k: options.topK,
                    num_predict: options.maxTokens,
                    repeat_penalty: options.repeatPenalty,
                    seed: options.seed,
                },
            };
            Object.keys(requestBody.options).forEach((key) => {
                if (requestBody.options[key] === undefined) {
                    delete requestBody.options[key];
                }
            });
            const response = await axios_1.default.post(`${this.baseURL}/api/chat`, requestBody, {
                timeout: this.timeout,
                headers: this.getHeaders(),
            });
            if (!response.data?.message?.content) {
                throw new Error('Invalid LLM response');
            }
            return response.data.message.content;
        }
        catch (error) {
            this.logger.error('LLM request failed', {
                error: this.getErrorMessage(error),
            });
            throw new Error(`LLM failed: ${this.getErrorMessage(error)}`);
        }
    }
    async *getRagResponseByPromptStream(prompt, options = {}) {
        const messages = [];
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });
        const response = await axios_1.default.post(`${this.baseURL}/api/chat`, {
            model: this.chatModel,
            messages,
            stream: true,
        }, {
            responseType: 'stream',
            timeout: this.timeout,
            headers: this.getHeaders(),
        });
        let tail = '';
        for await (const chunk of response.data) {
            tail += chunk.toString();
            const lines = tail.split('\n');
            tail = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                    yield parsed.message.content;
                }
                if (parsed.done)
                    return;
            }
        }
    }
    async describeImage(file) {
        try {
            const base64 = file.buffer.toString('base64');
            const response = await axios_1.default.post(`${this.baseURL}/api/chat`, {
                model: this.visionModel,
                messages: [
                    {
                        role: 'user',
                        content: 'Describe this image briefly.',
                        images: [base64],
                    },
                ],
            }, {
                timeout: this.visionTimeout,
                headers: this.getHeaders(),
            });
            return response.data?.message?.content;
        }
        catch (error) {
            this.logger.error('Image detection failed', {
                error: this.getErrorMessage(error),
            });
            throw new Error('Image detection failed');
        }
    }
    async healthCheck() {
        try {
            const res = await axios_1.default.get(`${this.baseURL}/api/tags`, {
                timeout: 5000,
                headers: this.getHeaders(),
            });
            return res.status === 200;
        }
        catch {
            return false;
        }
    }
    async listModels() {
        try {
            const res = await axios_1.default.get(`${this.baseURL}/api/tags`, {
                timeout: 5000,
                headers: this.getHeaders(),
            });
            return res.data?.models?.map((m) => m.name) || [];
        }
        catch {
            return [];
        }
    }
    getErrorMessage(error) {
        if (error instanceof axios_1.AxiosError) {
            return error.response?.data?.error || error.message;
        }
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
};
exports.OllamaService = OllamaService;
exports.OllamaService = OllamaService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [config_1.ConfigService, Object])
], OllamaService);
//# sourceMappingURL=ollama.service.js.map