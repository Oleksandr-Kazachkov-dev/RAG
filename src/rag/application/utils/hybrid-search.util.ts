import { RagQdrantService, SearchMode } from '../../infrastructure/qdrant/rag-qdrant.service';
import { Embedding } from '../../domain/value-objects/embedding.vo';
import { ConfigService } from '@nestjs/config';

export interface HybridSearchResult {
  id: string;
  text: string;
  parentText?: string;
  parentId?: string;
  vectorScore: number;
  keywordScore: number;
  hybridScore: number;
  vector?: number[];
}

interface ModeConfig {
  vectorWeight: number;
  keywordWeight: number;
  minKeywordMatch: number;
  fetchMultiplier: number;
}

const MODE_CONFIG: Record<SearchMode | 'entity', ModeConfig> = {
  entity: {
    vectorWeight:    0.35,
    keywordWeight:   0.65,
    minKeywordMatch: 1,
    fetchMultiplier: 5,
  },
  precise: {
    vectorWeight:    0.9,
    keywordWeight:   0.1,
    minKeywordMatch: 2,
    fetchMultiplier: 2,
  },
  balanced: {
    vectorWeight:    0.75,
    keywordWeight:   0.25,
    minKeywordMatch: 1,
    fetchMultiplier: 3,
  },
  wide: {
    vectorWeight:    0.55,
    keywordWeight:   0.45,
    minKeywordMatch: 1,
    fetchMultiplier: 4,
  },
};

const BM25_K1 = 1.5;
const BM25_B  = 0.75;

function bm25Score(text: string, keywords: string[], avgDocLength: number): number {
  const words = text.split(/\s+/);
  const docLen = words.length;
  let score = 0;

  for (const kw of keywords) {
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tf = (text.match(new RegExp(escaped, 'gi')) || []).length;
    if (tf === 0) continue;
    const num = tf * (BM25_K1 + 1);
    const den = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLength));
    score += num / den;
  }
  return score;
}

function minMaxNorm(results: HybridSearchResult[], field: keyof HybridSearchResult): void {
  const vals = results.map(r => r[field] as number);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const range = max - min;
  for (const r of results) {
    (r as any)[`${field}Norm`] = range === 0 ? 1 : ((r[field] as number) - min) / range;
  }
}

export class HybridSearchEngine {
  constructor(
    private readonly qdrantService: RagQdrantService,
    private readonly configService: ConfigService,
  ) {}

  async search(
    collectionName: string,
    queryEmbedding: Embedding,
    keywords: string[],
    limit: number = 10,
    options: {
      vectorWeight?:    number;
      keywordWeight?:   number;
      minKeywordMatch?: number;
      searchMode?:      SearchMode | 'entity';
      scoreThreshold?:  number;
      minTextLength?:   number;
      originalQuery?:   string;  // raw query for direct text scroll
    } = {},
  ): Promise<HybridSearchResult[] | null> {
    const mode = options.searchMode ?? 'balanced';

    const qdrantMode: SearchMode = mode === 'entity' ? 'wide' : mode as SearchMode;
    const cfg = MODE_CONFIG[mode];

    const vectorWeight    = options.vectorWeight    ?? cfg.vectorWeight;
    const keywordWeight   = options.keywordWeight   ?? cfg.keywordWeight;
    const minKeywordMatch = options.minKeywordMatch ?? cfg.minKeywordMatch;
    const minTextLength   = options.minTextLength ?? 80;
    const fetchLimit      = limit * cfg.fetchMultiplier;

    const vectorResults = await this.qdrantService.search(collectionName, {
      vector:          queryEmbedding.values,
      limit:           fetchLimit,
      searchMode:      qdrantMode,
      score_threshold: null,
      with_vector:     true,
    });

    const useKeywordScroll = (mode === 'entity' || mode === 'balanced' || mode === 'wide') && keywords.length > 0;
    let keywordScrollPoints: Array<{ id: string; payload: Record<string, any> }> = [];
    if (useKeywordScroll) {
      // Search 1: by contextKeywords field (keyword index)
      const contextKwClauses = keywords.slice(0, 15).map(kw => ({
        key:   'contextKeywords',
        match: { value: kw.toLowerCase() },
      }));

      // Search 2: by full-text on the text field (text index)
      // Use words from the original query directly — most reliable for cross-lingual match
      const queryWords = options.originalQuery
        ? [...new Set(
            options.originalQuery
              .toLowerCase()
              .replace(/[?!.,;:'"]/g, '')
              .split(/\s+/)
              .filter(w => w.length > 2),
          )]
        : [];

      // Expand UA phrases to EN equivalents so English chunks are found
      const UA_TO_EN_SCROLL: Record<string, string[]> = {
        'назва компанії':                    ['company', 'name', 'brand', 'called', 'named'],
        'назва та історія компанії':         ['company', 'history', 'name', 'founded', 'established'],
        'заснування':                        ['founded', 'established', 'created'],
        'чому компанія так називається':     ['company', 'name', 'called', 'named', 'why'],
        'що означає назва компанії':         ['name', 'means', 'meaning', 'company'],
        'коли заснована компанія':           ['founded', 'established', 'created'],
        'історія компанії':                  ['history', 'company', 'established', 'founded'],
        'розкажи про':                       ['about', 'company', 'overview'],
        'онбординг адаптація перший день':   ['onboarding', 'first', 'day', 'adaptation'],
        'дистанційна робота remote':         ['remote', 'work', 'abroad', 'country'],
        'коворкінг оренда місця':            ['coworking', 'office', 'space'],
        'технічна підтримка help desk':      ['support', 'help', 'desk', 'technical'],
        'лікарняний sick leave':             ['sick', 'leave', 'medical'],
        'кількість днів відпустки':          ['vacation', 'days', 'leave', 'annual'],
      };

      const expandedForScroll = new Set<string>([
        // Words directly from the original query (highest priority)
        ...queryWords,
        // Expanded from keywords + UA→EN mapping
        ...keywords.flatMap(kw => {
          const kl = kw.toLowerCase();
          const words = kl.split(/\s+/).filter(w => w.length > 2);
          const enEquiv = UA_TO_EN_SCROLL[kl] ?? [];
          return [...words, ...enEquiv];
        }),
      ]);

      // Split multi-word keywords into single words and search text directly
      const textSearchWords = [...expandedForScroll].filter(w => w.length > 2).slice(0, 20);

      const textClauses = textSearchWords.map(word => ({
        key:   'text',
        match: { text: word },
      }));

      const allClauses = [...contextKwClauses, ...textClauses];

      try {
        const scrollResult = await this.qdrantService.scroll(collectionName, {
          limit:        200,
          with_payload: true,
          filter: {
            must:   [{ key: 'textLength', range: { gte: 20 } }],
            should: allClauses,
          },
        });
        keywordScrollPoints = (scrollResult.points ?? []).map(p => ({
          id:      p.id.toString(),
          payload: (p.payload ?? {}) as Record<string, any>,
        }));
      } catch {
      }
    }

    const vectorIds = new Set(vectorResults.map(r => r.id.toString()));

    const vectorUnified: HybridSearchResult[] = vectorResults.map(r => ({
      id:           r.id.toString(),
      text:         (r.payload?.text as string) || '',
      parentText:   r.payload?.parentText as string | undefined,
      parentId:     r.payload?.parentId as string | undefined,
      vectorScore:  r.score ?? 0,
      keywordScore: 0,
      hybridScore:  0,
      vector:       Array.isArray(r.vector) ? (r.vector as number[]) : undefined,
    }));

    const scrollUnified: HybridSearchResult[] = keywordScrollPoints
      .filter(p => !vectorIds.has(p.id))
      .map(p => ({
        id:           p.id,
        text:         (p.payload.text as string) || '',
        parentText:   p.payload.parentText as string | undefined,
        parentId:     p.payload.parentId as string | undefined,
        vectorScore:  0.01,
        keywordScore: 0,
        hybridScore:  0,
      }));

    const unified = [...vectorUnified, ...scrollUnified];
    if (!unified.length) return null;

    const meaningful = unified.filter(r => {
      const hasUrl = /https?:\/\/\S+|\b[\w-]+\.[\w.-]+\.\w{2,}\b/.test(r.text);
      if (r.text.trim().length < minTextLength && !hasUrl) return false;
      if (/^\[[^\]]{2,60}\][\s\\]*$/.test(r.text.trim())) return false;
      return true;
    });

    const working = meaningful.length > 0 ? meaningful : unified;

    if (keywords.length > 0) {
      // Expand keywords: for multi-word UA phrases, also include each word separately
      // so "назва компанії" → also matches "company", "name", "назва", "компанія"
      const UA_TO_EN_KEYWORD_MAP: Record<string, string[]> = {
        'назва компанії': ['company name', 'company', 'name', 'brand', 'called'],
        'назва та історія компанії': ['company', 'history', 'name', 'founded', 'established'],
        'заснування': ['founded', 'established', 'created', 'history'],
        'чому компанія так називається': ['company', 'name', 'called', 'why', 'named'],
        'що означає назва компанії': ['name', 'meaning', 'means', 'company'],
        'коли заснована компанія': ['founded', 'established', 'created', '2000'],
        'історія компанії': ['history', 'company', 'established', 'founded'],
        'розкажи про': ['about', 'company', 'overview'],
      };

      const expandedKeywords = new Set<string>(keywords.map(k => k.toLowerCase()));
      for (const kw of keywords) {
        const kl = kw.toLowerCase();
        // Add individual words from multi-word keywords
        kl.split(/\s+/).filter(w => w.length > 2).forEach(w => expandedKeywords.add(w));
        // Add EN translations for known UA phrases
        const enVariants = UA_TO_EN_KEYWORD_MAP[kl];
        if (enVariants) enVariants.forEach(v => expandedKeywords.add(v));
      }
      const allKeywords = [...expandedKeywords];

      const contextKwMap = new Map<string, string[]>();
      for (const r of vectorResults) {
        const ck = (r.payload?.contextKeywords as string[] | undefined) ?? [];
        contextKwMap.set(r.id.toString(), ck.map(k => k.toLowerCase()));
      }
      for (const p of keywordScrollPoints) {
        const ck = (p.payload.contextKeywords as string[] | undefined) ?? [];
        contextKwMap.set(p.id, ck.map(k => k.toLowerCase()));
      }

      const avgDocLen =
        working.reduce((acc, d) => acc + d.text.split(/\s+/).length, 0) / working.length;

      for (const doc of working) {
        const textLower  = doc.text.toLowerCase();
        const contextKws = contextKwMap.get(doc.id) ?? [];

        const matchedKws = allKeywords.filter(kw => {
          const kl = kw.toLowerCase();
          return textLower.includes(kl) || contextKws.some(ck => ck.includes(kl));
        });

        if (matchedKws.length >= minKeywordMatch) {
          doc.keywordScore =
            bm25Score(textLower, matchedKws, avgDocLen) +
            Math.min(matchedKws.length, allKeywords.length) * 0.5;

          const urlsInText = (doc.text.match(/https?:\/\/\S+|\b[\w-]+\.[\w.-]+\.\w{2,}\b/g) ?? [])
            .map(u => u.toLowerCase());
          const urlKeywordMatch = matchedKws.some(kw =>
            urlsInText.some(url => url.includes(kw.toLowerCase())),
          );
          if (urlKeywordMatch) doc.keywordScore += 2.0;
        }
      }
    }

    minMaxNorm(working, 'vectorScore');
    minMaxNorm(working, 'keywordScore');

    for (const doc of working) {
      const vn: number = (doc as any)['vectorScoreNorm'] ?? 0;
      const kn: number = (doc as any)['keywordScoreNorm'] ?? 0;
      doc.hybridScore = vectorWeight * vn + keywordWeight * kn;
    }

    const workingExpanded = working.map(el => ({
      ...el,
      text: el.parentText ? `${el.text} ${el.parentText}` : el.text,
    }));

    return workingExpanded
      .filter(r => options.scoreThreshold === undefined || r.hybridScore >= options.scoreThreshold)
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, limit);
  }
}