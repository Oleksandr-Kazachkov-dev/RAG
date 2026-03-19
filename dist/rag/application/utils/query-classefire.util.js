"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryClassifier = void 0;
const PROFILE_BY_TYPE = {
    entity: {
        limit: 10,
        scoreThreshold: 0.5,
        searchMode: 'entity',
        useHybridSearch: true,
        useQueryTransformation: true,
        useReranking: true,
        rerankStrategy: 'hybrid',
        useContextualCompression: true,
        useParentExpansion: true,
        useKnowledgeGraph: true,
        useConversationMemory: false,
        useCitationTracking: true,
        temperature: 0,
        topP: undefined,
        topK: undefined,
        maxTokens: 10000,
        repeatPenalty: undefined,
        seed: undefined,
    },
    factual: {
        limit: 10,
        scoreThreshold: 0.8,
        searchMode: 'balanced',
        useHybridSearch: true,
        useQueryTransformation: true,
        useReranking: true,
        rerankStrategy: 'cross_encoder',
        useContextualCompression: true,
        useParentExpansion: true,
        useKnowledgeGraph: false,
        useConversationMemory: false,
        useCitationTracking: true,
        temperature: 0.3,
        topP: 0.85,
        topK: 20,
        maxTokens: 3200,
        repeatPenalty: 1.1,
        seed: undefined,
    },
    wide: {
        limit: 6,
        scoreThreshold: 0.72,
        searchMode: 'wide',
        useHybridSearch: true,
        useQueryTransformation: true,
        useReranking: true,
        rerankStrategy: 'hybrid',
        useContextualCompression: true,
        useParentExpansion: true,
        useKnowledgeGraph: true,
        useConversationMemory: false,
        useCitationTracking: true,
        temperature: 0.3,
        topP: 1,
        topK: 2,
        maxTokens: 7200,
        repeatPenalty: 1.2,
        seed: undefined,
    },
};
class QueryClassifier {
    constructor(ollama) {
        this.ollama = ollama;
    }
    async classify(query) {
        const prompt = `You are a query classifier for a Ukrainian corporate knowledge base RAG system.
Classify the query into EXACTLY ONE type. Reply ONLY with valid JSON — no markdown, no commentary.

TYPES:

  "entity"  — lookup of a SPECIFIC NAMED PERSON only.
              Use ONLY when the subject is clearly a human individual (name, surname, nickname).
              Examples: "Хто такий Іван Петров?", "Find Olena Kovalenko", "Чеча",
                        "Розкажи про Дениса Шереметова", "що відомо про Марію Іваненко"

              ❌ NOT entity: queries about departments, teams, tools, processes, companies.
              ❌ NOT entity: "розкажи про node департамент", "що робить HR відділ"

  "factual" — expects ONE short answer: a link, date, number, yes/no, policy rule.
              Examples: "Який стек у backend?", "Дай посилання на hrm", "Коли salary review?",
                        "Скільки днів відпустки?", "Чи є sick leave?", "Як підключитись до wifi?",
                        "Коли заснована компанія?", "Як оплатити коворкінг з фоп?",
                        "А як тепер аппрувиться лікарняний?"

  "wide"    — comprehensive overview, listing, procedural, or comparative.
              Use for DEPARTMENT / TEAM / TOOL / PROCESS overviews, and step-by-step guides.
              Examples: "Розкажи про node департамент", "Що робить QA команда?",
                        "Як оформити відпустку?", "Який lifecycle задачі?",
                        "Як можна збільшити зарплату?", "Чи можна працювати з іншої країни?",
                        "Перелічи всіх розробників", "Які команди є в компанії?",
                        "Розкажи про HR відділ", "Що таке onix academy?"

Query: "${query}"

JSON: {"type": "entity" | "factual" | "wide", "confidence": 0.0-1.0}`;
        try {
            const raw = await this.ollama.getRagResponseByPrompt(prompt, {
                temperature: 0,
                maxTokens: 60,
                topK: 1,
            });
            const match = raw.replace(/```(?:json)?/g, '').trim().match(/\{[\s\S]*?\}/);
            if (!match)
                return this.default();
            const parsed = JSON.parse(match[0]);
            if (!PROFILE_BY_TYPE[parsed.type])
                return this.default();
            const isLinkQuery = /посилання|лінк[аи]|сайт[іу]?\b|url\b|link\b/i.test(query);
            if (isLinkQuery && parsed.type === 'factual') {
                return this.build('factual', parsed.confidence, {
                    ...PROFILE_BY_TYPE.factual,
                    searchMode: 'entity',
                });
            }
            return this.build(parsed.type, Math.min(1, Math.max(0, parsed.confidence ?? 0.7)));
        }
        catch {
            return this.default();
        }
    }
    build(type, confidence, params) {
        return { type, confidence, params: params ?? PROFILE_BY_TYPE[type] };
    }
    default() {
        return this.build('factual', 0.5);
    }
}
exports.QueryClassifier = QueryClassifier;
//# sourceMappingURL=query-classefire.util.js.map