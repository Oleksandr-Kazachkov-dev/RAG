import { OllamaService } from '../../infrastructure/ollama/ollama.service';

export interface RerankedResult<T> {
  id?: string;
  text?: string;
  score?: number;
  item: T;
  originalScore: number;
  rerankScore: number;
  finalScore: number;
}

export interface RerankableItem {
  text: string;
  score?: number;
  vector?: number[];
}

export class Reranker {
  constructor(private readonly ollamaService: OllamaService) {}

  async rerank<T extends RerankableItem>(
    query: string,
    results: T[],
    options: {
      topK?:   number;
      method?: 'llm' | 'embedding' | 'hybrid' | 'listwise';
    } = {},
  ): Promise<RerankedResult<T>[]> {
    const { topK = results.length, method = 'hybrid' } = options;
    if (results.length === 0) return [];

    let reranked: RerankedResult<T>[];

    switch (method) {
      case 'listwise':
        reranked = await this.listwiseLlmRerank(query, results, topK);
        break;
      case 'llm':
        reranked = await this.llmRerank(query, results);
        break;
      case 'embedding':
        reranked = await this.embeddingRerank(query, results);
        break;
      case 'hybrid':
      default:
        reranked = await this.hybridRerank(query, results);
        break;
    }

    return reranked.sort((a, b) => b.finalScore - a.finalScore).slice(0, topK);
  }

  private async listwiseLlmRerank<T extends RerankableItem>(
    query: string,
    results: T[],
    topK: number,
  ): Promise<RerankedResult<T>[]> {
    const truncate = (text: string, maxLen = 400): string => {
      if (text.length <= maxLen) return text;
      const cut = text.slice(0, maxLen);
      const lastDot = cut.lastIndexOf('.');
      return lastDot > maxLen * 0.6 ? cut.slice(0, lastDot + 1) : cut + '…';
    };

    const numbered = results
      .map((r, i) => `[${i + 1}] ${truncate(r.text)}`)
      .join('\n\n');

    const prompt =
      `You are a relevance ranking expert for a Ukrainian-language knowledge base.\n\n` +
      `RANKING RULES (in priority order):\n` +
      `1. If the query contains a PERSON NAME — exact name match (in any script: ` +
      `   Cyrillic or Latin) is the HIGHEST priority signal.\n` +
      `2. Then rank by how fully the passage answers the query.\n` +
      `3. Ignore passages that only mention a topic category without content.\n\n` +
      `Query: "${query}"\n\n` +
      `Passages:\n${numbered}\n\n` +
      `Return ONLY a JSON array of passage numbers ranked best-to-worst.\n` +
      `Example: [3,1,5,2,4]\n` +
      `Array:`;

    try {
      const response = await this.ollamaService.getRagResponseByPrompt(prompt, {
        temperature: 0,
        maxTokens: 120,
      });
      const match = response.match(/\[[\d,\s]+\]/);
      if (!match) throw new Error('no rank array in response');

      const ranks: number[] = JSON.parse(match[0]);
      const validRanks = ranks.filter(r => r >= 1 && r <= results.length);

      const ranked = validRanks.map((rank, position) => ({
        item: results[rank - 1],
        originalScore: results[rank - 1].score ?? 0,
        rerankScore: 1 - position / results.length,
        finalScore:  1 - position / results.length,
      }));

      const includedIndices = new Set(validRanks.map(r => r - 1));
      const missing = results
        .map((item, i) => ({ item, i }))
        .filter(({ i }) => !includedIndices.has(i))
        .map(({ item }) => ({
          item,
          originalScore: item.score ?? 0,
          rerankScore: 0,
          finalScore: 0,
        }));

      return [...ranked, ...missing];
    } catch {
      return results.map(item => ({
        item,
        originalScore: item.score ?? 0,
        rerankScore: item.score ?? 0,
        finalScore: item.score ?? 0,
      }));
    }
  }

  private async llmRerank<T extends RerankableItem>(
    query: string,
    results: T[],
  ): Promise<RerankedResult<T>[]> {
    const CONCURRENCY = 3;
    const output: RerankedResult<T>[] = [];

    for (let i = 0; i < results.length; i += CONCURRENCY) {
      const batch = results.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (result): Promise<RerankedResult<T>> => {
          const textSample = result.text.length > 500
            ? result.text.slice(0, 500).replace(/\s\S*$/, '') + '…'
            : result.text;

          const prompt =
            `On a scale of 0 to 10, rate how relevant this text is to the query.\n` +
            `If the query contains a person name, a passage that mentions that ` +
            `exact person (in any script) should score 9-10.\n\n` +
            `Query: "${query}"\n\nText: "${textSample}"\n\n` +
            `Respond with ONLY a single integer 0-10.`;
          try {
            const response = await this.ollamaService.getRagResponseByPrompt(prompt);
            const score = parseFloat(response.trim()) / 10;
            return {
              item: result,
              originalScore: result.score ?? 0,
              rerankScore: isNaN(score) ? 0.5 : score,
              finalScore:  isNaN(score) ? (result.score ?? 0.5) : score,
            };
          } catch {
            return {
              item: result,
              originalScore: result.score ?? 0,
              rerankScore: result.score ?? 0.5,
              finalScore:  result.score ?? 0.5,
            };
          }
        }),
      );
      output.push(...batchResults);
    }
    return output;
  }

  private async embeddingRerank<T extends RerankableItem>(
    query: string,
    results: T[],
  ): Promise<RerankedResult<T>[]> {
    const queryEmbedding = await this.ollamaService.embed(query);

    const similarities = await Promise.all(
      results.map(async (r) => {
        if (r.vector?.length && queryEmbedding) {
          return this.cosineSimilarity(queryEmbedding, r.vector);
        }
        const emb = await this.ollamaService.embed(r.text.slice(0, 400));
        return emb && queryEmbedding ? this.cosineSimilarity(queryEmbedding, emb) : 0;
      }),
    );

    return results.map((result, idx) => ({
      item:          result,
      originalScore: result.score ?? 0,
      rerankScore:   similarities[idx],
      finalScore:    similarities[idx],
    }));
  }

  private async hybridRerank<T extends RerankableItem>(
    query: string,
    results: T[],
  ): Promise<RerankedResult<T>[]> {
    const embeddingScores = await this.embeddingRerank(query, results);
    return embeddingScores.map(item => ({
      ...item,
      finalScore: item.originalScore * 0.3 + item.rerankScore * 0.7,
    }));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}