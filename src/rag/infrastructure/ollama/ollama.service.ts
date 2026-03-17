import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import {
  RAG_CONFIG,
  TRagConfig,
} from 'src/rag/infrastructure/config/rag-config';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';

axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    err.code === 'ECONNABORTED' ||
    ((err.response?.status ?? 0) >= 500),
});

export interface LLMOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stop?: string[];
  systemPrompt?: string;
  repeatPenalty?: number;
  seed?: number;
}

@Injectable()
export class OllamaService {
  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly textEmbedModel: string;
  private readonly chatModel: string | undefined;
  private readonly visionModel: string | undefined;
  private readonly timeout = 60_000;
  private readonly visionTimeout = 120_000;

  constructor(
    private readonly configService: ConfigService,
    @Inject('LoggerPort') private readonly logger: LoggerPort,
  ) {
    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);

    this.baseURL = ragConfig?.ollamaBaseUrl || 'https://ollama.com';

    this.textEmbedModel =
      ragConfig?.ollamaEmbedModelText || 'nomic-embed-text';

    this.chatModel =
      ragConfig?.ollamaChatModel;

    this.visionModel =
      ragConfig?.ollamaVisionModel;

    if (!this.apiKey) {
      this.logger.warn('OLLAMA_API_KEY is not set!');
    }
  }

  private getHeaders() {
    return this.apiKey
      ? { Authorization: `Bearer ${this.apiKey}` }
      : {};
  }

  async embed(prompt: string): Promise<number[] | null> {
    try {
      const MAX_CHARS = 3000;
      const safePrompt =
        prompt.length > MAX_CHARS ? prompt.slice(0, MAX_CHARS) : prompt;

      const response = await axios.post(
        `${this.baseURL}/api/embeddings`,
        { model: this.textEmbedModel, prompt: safePrompt },
        {
          timeout: this.timeout,
          headers: this.getHeaders(),
        },
      );

      const embedding = response.data?.embedding;

      if (!Array.isArray(embedding) || embedding.length === 0) {
        this.logger.warn('Empty embedding, skipping chunk');
        return null;
      }

      return embedding;
    } catch (error) {
      this.logger.warn('Embedding skipped', {
        error: this.getErrorMessage(error),
      });
      return null;
    }
  }

  async extractKeywords(text: string): Promise<string[]> {
    try {
      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        {
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
        },
        {
          timeout: this.timeout,
          headers: this.getHeaders(),
        },
      );

      const content = response.data?.message?.content;

      if (typeof content !== 'string') {
        throw new Error('Invalid LLM response');
      }

      return JSON.parse(content);
    } catch (error) {
      this.logger.error('Failed to extract keywords', error);
      throw error;
    }
  }

  async getRagResponseByPrompt(
    prompt: string,
    options: LLMOptions = {},
  ): Promise<string> {
    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }

      messages.push({ role: 'user', content: prompt });

      const requestBody: any = {
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

      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        requestBody,
        {
          timeout: this.timeout,
          headers: this.getHeaders(),
        },
      );

      if (!response.data?.message?.content) {
        throw new Error('Invalid LLM response');
      }

      return response.data.message.content;
    } catch (error) {
      this.logger.error('LLM request failed', {
        error: this.getErrorMessage(error),
      });
      throw new Error(`LLM failed: ${this.getErrorMessage(error)}`);
    }
  }

  async *getRagResponseByPromptStream(
    prompt: string,
    options: LLMOptions = {},
  ): AsyncGenerator<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await axios.post(
      `${this.baseURL}/api/chat`,
      {
        model: this.chatModel,
        messages,
        stream: true,
      },
      {
        responseType: 'stream',
        timeout: this.timeout,
        headers: this.getHeaders(),
      },
    );

    let tail = '';

    for await (const chunk of response.data as AsyncIterable<Buffer>) {
      tail += chunk.toString();

      const lines = tail.split('\n');
      tail = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        const parsed = JSON.parse(line);

        if (parsed.message?.content) {
          yield parsed.message.content;
        }

        if (parsed.done) return;
      }
    }
  }

  async describeImage(file: Express.Multer.File): Promise<string> {
    try {
      const base64 = file.buffer.toString('base64');

      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        {
          model: this.visionModel,
          messages: [
            {
              role: 'user',
              content: 'Describe this image briefly.',
              images: [base64],
            },
          ],
        },
        {
          timeout: this.visionTimeout,
          headers: this.getHeaders(),
        },
      );

      return response.data?.message?.content;
    } catch (error) {
      this.logger.error('Image detection failed', {
        error: this.getErrorMessage(error),
      });
      throw new Error('Image detection failed');
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await axios.get(
        `${this.baseURL}/api/tags`,
        {
          timeout: 5000,
          headers: this.getHeaders(),
        },
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await axios.get(
        `${this.baseURL}/api/tags`,
        {
          timeout: 5000,
          headers: this.getHeaders(),
        },
      );

      return res.data?.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      return error.response?.data?.error || error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}