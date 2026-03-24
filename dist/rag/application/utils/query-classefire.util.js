"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryClassifier = void 0;
const PROFILE_BY_TYPE = {
    entity: {
        limit: 16,
        scoreThreshold: 0.6,
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
        topP: 1,
        topK: 5,
        maxTokens: 10000,
        repeatPenalty: undefined,
        seed: undefined,
    },
    factual: {
        limit: 15,
        scoreThreshold: 0.9,
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
        limit: 12,
        scoreThreshold: 0.62,
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
function preGuardClassify(query) {
    const q = query.toLowerCase().replace(/[?!.,;:]/g, '').trim();
    const isNameOriginQuery = /\b(why|what|how)\b.{0,30}\b(name|called|named|mean|origin|history|founded|create)\b/i.test(q) ||
        /\b(name|назв).{0,20}\b(company|компан|brand|бренд)\b/i.test(q) ||
        /\b(company|компан).{0,20}\b(name|назв|called|mean)\b/i.test(q);
    if (isNameOriginQuery)
        return 'factual';
    const isAboutSomething = /\b(tell me about|describe|overview of|what is|what are)\b/i.test(q) ||
        /\b(розкажи|опиши|що таке|що це)\b/i.test(q);
    const hasNonPersonSubject = /\b(company|компан|organization|product|tool|department|відділ|команд|team|process|процес|academy|академі|platform|system|системи|software)\b/i.test(q);
    if (isAboutSomething && hasNonPersonSubject)
        return 'wide';
    return null;
}
class QueryClassifier {
    constructor(ollama) {
        this.ollama = ollama;
    }
    async classify(query) {
        const preGuard = preGuardClassify(query);
        if (preGuard !== null) {
            return this.build(preGuard, 0.9);
        }
        const prompt = `You are a query classifier for a Ukrainian corporate knowledge base RAG system.
Classify the query into EXACTLY ONE type. Reply ONLY with valid JSON — no markdown, no commentary.

TYPES:

  "entity"  — lookup of a SPECIFIC NAMED HUMAN PERSON only.
              Use ONLY when the subject is clearly an individual human being (first name, surname, nickname).
              Examples: "Хто такий Іван Петров?", "Find Olena Kovalenko", "Чеча",
                        "Розкажи про Дениса Шереметова", "що відомо про Марію Іваненко"

              ❌ NEVER "entity" for: company names, product names, tool names, department names,
                 brand names, or any non-human subject — even if they look like proper nouns.
              ❌ NOT entity: "розкажи про node департамент", "що робить HR відділ",
                             "why name company onix", "що таке onix", "tell me about onix",
                             "why is it called onix", "what does onix mean"

  "factual" — expects ONE short answer: a link, date, number, yes/no, policy rule.
              Also use for: questions about company name origin, founding date, brand meaning.
              Examples: "Який стек у backend?", "Дай посилання на hrm", "Коли salary review?",
                        "Скільки днів відпустки?", "Чи є sick leave?", "Як підключитись до wifi?",
                        "Коли заснована компанія?", "Як оплатити коворкінг з фоп?",
                        "А як тепер аппрувиться лікарняний?",
                        "why name company onix?", "what does the name onix mean?",
                        "when was onix founded?", "why is the company called onix?"

  "wide"    — comprehensive overview, listing, procedural, or comparative.
              Use for DEPARTMENT / TEAM / TOOL / PROCESS / COMPANY overviews, and step-by-step guides.
              Examples: "Розкажи про node департамент", "Що робить QA команда?",
                        "Як оформити відпустку?", "Який lifecycle задачі?",
                        "Як можна збільшити зарплату?", "Чи можна працювати з іншої країни?",
                        "Перелічи всіх розробників", "Які команди є в компанії?",
                        "Розкажи про HR відділ", "Що таке onix academy?",
                        "tell me about onix company", "describe the history of onix"

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