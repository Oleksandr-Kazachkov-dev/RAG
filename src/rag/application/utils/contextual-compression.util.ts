import { OllamaService } from '../../infrastructure/ollama/ollama.service';

export interface CompressedContext {
  original: string;
  compressed: string;
  relevantSentences: string[];
  compressionRatio: number;
}

export class ContextualCompressor {
  constructor(private readonly ollamaService: OllamaService) {}

  async compressContext(
    query: string,
    documents: Array<{ id: string; text: string }>,
    options: {
      maxTokens?: number;
      method?: 'extractive' | 'abstractive' | 'hybrid';
    } = {},
  ): Promise<CompressedContext[]> {
    const { maxTokens = 500, method = 'extractive' } = options;

    return Promise.all(
      documents.map((doc) =>
        this.compressSingleDocument(query, doc.text, maxTokens, method),
      ),
    );
  }

  private async compressSingleDocument(
    query: string,
    text: string,
    maxTokens: number,
    method: 'extractive' | 'abstractive' | 'hybrid',
  ): Promise<CompressedContext> {
    switch (method) {
      case 'extractive':
        return this.extractiveCompression(query, text, maxTokens);
      case 'abstractive':
        return this.abstractiveCompression(query, text, maxTokens);
      case 'hybrid':
        return this.hybridCompression(query, text, maxTokens);
    }
  }

  private async extractiveCompression(
    query: string,
    text: string,
    maxTokens: number,
  ): Promise<CompressedContext> {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    if (sentences.length === 0) {
      return { original: text, compressed: '', relevantSentences: [], compressionRatio: 0 };
    }

    const queryWords = new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zа-яіїєґ]/gi, ''))
        .filter((w) => w.length > 2),
    );

    const prescored = sentences
      .map((s) => {
        const words = s.toLowerCase().split(/\s+/);
        const tf = words.filter((w) =>
          queryWords.has(w.replace(/[^a-zа-яіїєґ]/gi, '')),
        ).length;
        return { s, tf };
      })
      .sort((a, b) => b.tf - a.tf)
      .slice(0, 15)
      .map((x) => x.s);

    const [queryEmbedding, ...candEmbeddings] = await Promise.all([
      this.ollamaService.embed(query),
      ...prescored.map((s) => this.ollamaService.embed(s.trim())),
    ]);

    const reranked = prescored
      .map((s, i) => ({
        s,
        score:
          queryEmbedding && candEmbeddings[i]
            ? this.cosineSimilarity(queryEmbedding, candEmbeddings[i]!)
            : 0,
      }))
      .sort((a, b) => b.score - a.score);

    const relevantSentences: string[] = [];
    let wordCount = 0;
    for (const { s } of reranked) {
      const wc = s.split(/\s+/).length;
      if (wordCount + wc > maxTokens) break;
      relevantSentences.push(s);
      wordCount += wc;
    }

    const compressed = relevantSentences.join(' ');
    return {
      original: text,
      compressed,
      relevantSentences,
      compressionRatio: text.length > 0 ? compressed.length / text.length : 0,
    };
  }

  private async abstractiveCompression(
    query: string,
    text: string,
    maxTokens: number,
  ): Promise<CompressedContext> {
    const maxWords = Math.floor(maxTokens * 0.75);

    const prompt = `
      Given this query: "${query}"

      Extract and summarize only the information from the following text that is relevant to answering the query.
      Keep it under ${maxWords} words and preserve key details.

      Text:
      ${text.slice(0, 2000)}

      Relevant summary:`;

    const compressed = await this.ollamaService.getRagResponseByPrompt(prompt);

    return {
      original: text,
      compressed: compressed.trim(),
      relevantSentences: compressed.match(/[^.!?]+[.!?]+/g) || [],
      compressionRatio: compressed.length / text.length,
    };
  }

  private async hybridCompression(
    query: string,
    text: string,
    maxTokens: number,
  ): Promise<CompressedContext> {
    const extractive = await this.extractiveCompression(
      query,
      text,
      Math.floor(maxTokens * 1.5),
    );

    if (extractive.compressed.length > maxTokens * 4) {
      return this.abstractiveCompression(query, extractive.compressed, maxTokens);
    }

    return extractive;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }
}