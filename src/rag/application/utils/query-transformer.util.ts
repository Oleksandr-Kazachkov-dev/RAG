import { OllamaService } from '../../infrastructure/ollama/ollama.service';
import {
  extractQueryNameVariants,
  isEntityQuery,
  cyrillicToLatin,
} from './transliteration.util';

export interface TransformedQuery {
  original: string;
  expanded: string[];
  rephrased: string[];
  keywords: string[];
  isEntityQuery: boolean;
}

const QUERY_STOP_WORDS = new Set([
  'хто', 'що', 'який', 'яка', 'де', 'коли', 'чому', 'чи',

  // NOTE: 'why' intentionally excluded — it signals origin/reason queries
  'what', 'is', 'are', 'how', 'when', 'where', 'who', 'on', 'the', 'a', 'an', 'in', 'of',
  'tell', 'me', 'about', 'does', 'do', 'did',
]);

const UA_ENDINGS = [
  'ського', 'зького', 'цького',
  'ський', 'зький', 'цький',
  'ськими', 'зькими', 'цькими',
  'ієм', 'ієві', 'єві', 'єм',
  'ого', 'ої', 'ові', 'ою',
  'ами', 'ими', 'ові', 'ах',
  'ням', 'ням',
  'ів', 'ям',
  'ку', 'ки', 'ці', 'ці',
  'ні', 'ну',
  'ою', 'ою',
  'ти', 'ть',
  'ня', 'ні',
  'ів',
  'у', 'ю', 'і', 'а', 'я', 'е',
];

function uaStem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  for (const ending of UA_ENDINGS) {
    if (w.endsWith(ending) && w.length - ending.length >= 3) {
      return w.slice(0, w.length - ending.length);
    }
  }
  return w;
}

const SYNONYM_MAP: Record<string, string[]> = {
  'hrm system':    ['hrm', 'посилання', 'лінка', 'link', 'url', 'https'],
  'лінк':          ['посилання', 'link', 'url', 'сайт', 'https', 'http'],
  'лінка':         ['посилання', 'link', 'url', 'сайт', 'https', 'http'],
  'посилан':       ['link', 'url', 'лінка', 'сайт', 'https', 'http'],
  'сайт':          ['link', 'url', 'посилання', 'лінка', 'https'],

  'salary review': ['salary review', 'зарплатний перегляд', 'підвищення зп', 'підвищення зарплати', 'саларі ревю', 'перегляд зарплати', 'review'],
  'саларі':        ['salary review', 'salary', 'зарплата', 'зп', 'підвищення'],
  'ревю':          ['review', 'salary review', 'перегляд'],
  'salary':        ['salary review', 'зарплата', 'зп', 'оплата праці', 'саларі'],
  'зарплат':       ['salary', 'salary review', 'оплата праці', 'зп', 'підвищення зарплати', 'перегляд зарплати'],
  'зп':            ['salary', 'зарплата', 'salary review'],
  'підвищен':      ['salary review', 'зарплата', 'підвищення зп', 'підвищення зарплати', 'збільшення'],
  'збільши':       ['підвищення зарплати', 'salary review', 'зарплата'],
  'збільшен':      ['підвищення зарплати', 'salary review'],
  'перегляд':      ['salary review', 'review', 'підвищення зарплати'],
  'коли':          [],
  'оплат':         ['salary', 'зарплата', 'фінанси', 'оплата праці'],

  'відпустк':      ['vacation', 'відпустка', 'pto', 'paid time off', 'annual leave', 'days off', 'оформлення відпустки', 'запит на відпустку'],
  'vacation':      ['відпустка', 'pto', 'annual leave', 'оформлення відпустки'],
  'pto':           ['відпустка', 'vacation', 'days off'],
  'оформи':        ['оформлення', 'заявка', 'запит', 'процес'],
  'оформлен':      ['заявка', 'запит', 'процес', 'інструкція'],
  'відкоти':       ['скасування відпустки', 'відкликання відпустки', 'повернення з відпустки', 'cancel vacation'],
  'скасуван':      ['скасування відпустки', 'cancel vacation', 'відкликання'],
  'кількість днів': ['кількість днів відпустки'],
  'скільки днів':  ['кількість днів відпустки', 'days off', 'annual leave days', 'дні відпустки'],
  'днів відпустк': ['кількість днів відпустки', 'annual leave days', 'скільки днів'],

  'лікарнян':      ['sick leave', 'sick day', 'medical leave', 'лікарняний', 'оплачуваний лікарняний', 'аппрув лікарняного'],
  'sick leave':    ['лікарняний', 'sick day', 'medical leave', 'оплачуваний'],
  'sick':          ['лікарняний', 'sick leave', 'medical leave'],
  'хвор':          ['лікарняний', 'sick leave', 'medical leave'],
  'аппрув':        ['approval', 'затвердження', 'підтвердження', 'погодження', 'approv'],
  'approv':        ['аппрув', 'затвердження', 'підтвердження'],
  'затвердж':      ['аппрув', 'approval', 'підтвердження', 'погодження'],

  'графік':        ['робочий графік', 'schedule', 'work hours', 'робочі години', 'hours of work', 'розклад'],
  'schedule':      ['графік', 'робочий час', 'work hours'],
  'робочий час':   ['графік', 'schedule', 'work hours', 'години роботи'],
  'hours':         ['графік', 'робочий час', 'schedule'],

  'країн':         ['remote work', 'work abroad', 'робота з іншої країни', 'remote', 'relocation'],
  'закордон':      ['remote work', 'work abroad', 'work from another country'],
  'remote':        ['робота з іншої країни', 'дистанційна робота', 'work abroad'],
  'relocation':    ['переїзд', 'робота з іншої країни', 'remote work'],
  'дистанційн':    ['remote', 'remote work', 'work from home'],

  'навчан':        ['training', 'learning', 'освіта', 'курси', 'розвиток', 'компенсація навчання', 'education'],
  'навчальн':      ['training', 'learning', 'курси'],
  'training':      ['навчання', 'освіта', 'курси', 'розвиток'],
  'learning':      ['навчання', 'курси', 'training'],
  'курс':          ['навчання', 'training', 'education', 'компенсація'],
  'компенсац':     ['компенсація навчання', 'відшкодування', 'оплата курсів', 'reimbursement'],
  'оплачуєтьс':   ['компенсація', 'оплата', 'reimbursement'],
  'оплачуван':     ['компенсація', 'оплата', 'reimbursement', 'paid'],

  'коворкінг':     ['coworking', 'coworking space', 'оренда місця', 'робоче місце', 'офіс'],
  'coworking':     ['коворкінг', 'оренда місця', 'робоче місце'],
  'фоп':           ['фоп', 'фізична особа підприємець', 'підприємець', 'fop', 'freelancer', 'оплата з фоп'],
  'fop':           ['фоп', 'фізична особа підприємець'],

  'wifi':          ['wi-fi', 'wifi', 'wireless', 'мережа', 'підключення', 'пароль wifi', 'офісний wifi'],
  'wi-fi':         ['wifi', 'wireless', 'мережа', 'пароль'],
  'підключи':      ['підключення', 'налаштування', 'connect', 'setup'],
  'пароль':        ['password', 'пароль', 'доступ', 'credentials'],
  'не працює':     ['підтримка', 'support', 'help desk', 'технічна підтримка', 'звернення'],
  'підтримк':      ['support', 'help desk', 'технічна підтримка', 'куди звертатись'],
  'звернут':       ['підтримка', 'support', 'help desk', 'куди звертатись', 'контакти'],
  'help desk':     ['підтримка', 'технічна підтримка', 'звернення'],

  'задач':         ['task', 'ticket', 'завдання', 'задача', 'lifecycle', 'цикл задачі'],
  'цикл':          ['lifecycle', 'life cycle', 'процес', 'flow', 'workflow', 'життєвий цикл'],
  'lifecycle':     ['цикл задачі', 'life cycle', 'процес задачі', 'flow'],
  'workflow':      ['процес', 'цикл', 'flow', 'задача'],

  'назв':          ['назва компанії', 'company name', 'история', 'historія', 'history', 'origin', 'why called', 'meaning'],
  'компан':        ['company', 'organization', 'onix', 'назва', 'brand', 'бренд'],
  'history':       ['назва компанії', 'компанія', 'historія', 'заснування', 'origin', 'founded'],
  'заснуван':      ['founded', 'history', 'назва компанії', 'historія', 'origin', 'create'],
  'розкаж':        ['розповісти', 'опис', 'інформація', 'tell me about'],
  'historі':       ['history', 'назва компанії', 'заснування', 'origin'],

  // English "why name / origin / meaning" queries
  'why':           ['origin', 'history', 'reason', 'meaning', 'founded', 'назва компанії', 'заснування'],
  'origin':        ['history', 'founded', 'назва компанії', 'заснування', 'meaning', 'why called'],
  'meaning':       ['origin', 'назва', 'company name', 'history'],
  'called':        ['name', 'назва', 'origin', 'meaning'],
  'named':         ['name', 'назва', 'origin', 'meaning'],
  'brand':         ['назва компанії', 'company name', 'бренд', 'origin'],
  'бренд':         ['brand', 'назва компанії', 'company name', 'origin'],

  'департамент':   ['department', 'division'],
  'команда':       ['team', 'group'],
  'team':          ['команда', 'відділ'],
  'department':    ['відділ', 'департамент'],
  'head':          ['керівник', 'lead', 'head of'],
  'керівник':      ['head', 'lead', 'manager'],
  'менеджер':      ['manager', 'pm'],
  'manager':       ['менеджер'],
  'проект':        ['project'],
  'project':       ['проект'],
  'завдан':        ['task', 'ticket', 'завдання'],
  'task':          ['завдання', 'задача'],
  'онбординг':     ['onboarding', 'адаптація', 'перший день'],
  'onboarding':    ['онбординг', 'адаптація'],
  'звільнен':      ['offboarding', 'resignation', 'notice period'],
  'offboarding':   ['звільнення', 'resignation'],
  'review':        ['ревю', 'salary review', 'перегляд'],

  'node':          ['nodejs', 'node.js', 'Awesome Node Team', 'Node.Js', 'ant'],
  'react':         ['reactjs', 'react.js', 'frontend'],
  'angular':       ['angularjs', 'frontend'],
  'vue':           ['vuejs', 'vue.js', 'frontend'],
  'python':        ['py'],
  'typescript':    ['ts', 'javascript'],
  'розробник':     ['developer', 'programmer', 'engineer'],
  'developer':     ['розробник', 'програміст'],
  'grow':          ['Employee growth process'],
};

const EN_TO_UA_QUERY_PATTERNS: Array<[RegExp, string]> = [
  [/why.{0,20}(name|called|named).{0,20}company/i,   'Розкажи історію назви компанії'],
  [/(name|origin|history).{0,20}company/i,            'Вибір назви компанії'],
  [/what.{0,20}(mean|means)/i,                        'що означає назва компанії'],
  [/(mean|means).{0,20}(name|company|brand)/i,        'що означає назва компанії'],
  [/when.{0,30}(founded|created|established)/i,       'коли заснована компанія'],
  [/(founded|created|established).{0,20}(company|it)/i, 'коли заснована компанія'],
  [/history.{0,20}company/i,                          'історія компанії'],
  [/company.{0,20}history/i,                          'історія компанії'],

  // Salary / review
  [/salary.{0,15}review/i,    'коли salary review підвищення зарплати'],
  [/when.{0,15}salary/i,      'коли перегляд зарплати'],
  [/pay.{0,15}raise/i,        'підвищення зарплати salary review'],

  // Vacation / leave
  [/how.{0,15}(many|much).{0,15}(vacation|leave|days off)/i, 'скільки днів відпустки'],
  [/vacation.{0,15}days/i,    'кількість днів відпустки'],
  [/sick.{0,10}leave/i,       'лікарняний sick leave'],
  [/how.{0,15}(apply|request|get).{0,15}(vacation|leave)/i, 'як оформити відпустку'],

  // Remote / work abroad
  [/work.{0,15}(abroad|remote|another country)/i,  'робота з іншої країни remote'],
  [/(remote|work from home)/i,                      'дистанційна робота remote'],

  // Onboarding / offboarding
  [/onboarding/i,   'онбординг адаптація перший день'],
  [/offboarding/i,  'звільнення offboarding notice period'],

  // Teams / departments
  [/what.{0,15}(team|department|division)/i,  'команди відділи департаменти'],
  [/(team|department).{0,15}(do|does|responsible)/i, 'що робить команда відділ'],

  [/tell.{0,10}(me|us).{0,10}about/i, 'розкажи про'],
  [/describe.{0,10}(the|your|our)/i,  'опиши'],
  [/what.{0,10}is.{0,10}(the|your|our)/i, 'що таке'],

  [/(coworking|co-working)/i,          'коворкінг оренда місця'],
  [/fop|individual entrepreneur/i,     'фоп фізична особа підприємець'],

  [/wifi|wi-fi|wireless/i,             'wifi підключення пароль мережа'],
  [/(help.?desk|tech.?support|it.?support)/i, 'технічна підтримка help desk'],
];

function isEnglishQuery(query: string): boolean {
  const letters = query.replace(/[^a-zA-Zа-яіїєґёэъыА-ЯІЇЄҐ]/g, '');
  if (letters.length === 0) return false;
  const latin = (query.match(/[a-zA-Z]/g) ?? []).length;
  return latin / letters.length > 0.5;
}

export function translateQueryToUkrainian(query: string): string[] {
  if (!isEnglishQuery(query)) return [];
  const results = new Set<string>();
  for (const [pattern, ua] of EN_TO_UA_QUERY_PATTERNS) {
    if (pattern.test(query)) {
      results.add(ua);
    }
  }
  return [...results];
}

function expandWithSynonyms(query: string): string[] {
  const lowerQuery = query.toLowerCase().replace(/[?!.,;:]/g, '');
  const keywords   = new Set<string>();
  const tokens     = lowerQuery.split(/\s+/).map(t => t.replace(/[^a-zа-яіїєґёэъы0-9.\-]/gi, ''));

  tokens.forEach(t => { if (t.length > 2) keywords.add(t); });

  for (const [phrase, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (phrase.includes(' ') && lowerQuery.includes(phrase)) {
      synonyms.forEach(s => keywords.add(s.toLowerCase()));
    }
  }

  for (const token of tokens) {
    if (token.length <= 2) continue;

    if (SYNONYM_MAP[token]) {
      SYNONYM_MAP[token].forEach(s => keywords.add(s.toLowerCase()));
    }

    const stem = uaStem(token);
    if (stem !== token && SYNONYM_MAP[stem]) {
      SYNONYM_MAP[stem].forEach(s => keywords.add(s.toLowerCase()));
    }
  }

  for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (key.includes(' ')) continue;
    for (const token of tokens) {
      if (token.length <= 2) continue;
      const stem = uaStem(token);
      if (token.startsWith(key) || stem.startsWith(key) || key.startsWith(stem)) {
        synonyms.forEach(s => keywords.add(s.toLowerCase()));
        break;
      }
    }
  }

  return [...keywords].filter(k => k.length > 2);
}

export class QueryTransformer {
  constructor(private readonly ollamaService: OllamaService) {}

  async transformQuery(query: string): Promise<TransformedQuery> {
    const entity = isEntityQuery(query);

    const [expanded, rephrased, keywords] = await Promise.all([
      this.expandQuery(query, entity),
      this.rephraseQuery(query, entity),
      this.extractKeywords(query, entity),
    ]);

    return { original: query, expanded, rephrased, keywords, isEntityQuery: entity };
  }

  private async expandQuery(query: string, isEntity: boolean): Promise<string[]> {
    if (isEntity) {
      const variants: string[] = [];

      let latinQuery = query;
      for (const token of query.split(/\s+/)) {
        if (/^[А-ЯІЇЄҐ]/u.test(token)) {
          const clean = token.replace(/[^а-яіїєґёэъыА-ЯІЇЄҐ]/gi, '');
          if (clean.length > 2) {
            const lat = cyrillicToLatin(clean);
            const latinToken = lat.charAt(0).toUpperCase() + lat.slice(1);
            latinQuery = latinQuery.replace(token, latinToken);
          }
        }
      }
      if (latinQuery !== query) variants.push(latinQuery);

      const nameTokens = query.split(/\s+/).filter(
        t => /^[А-ЯІЇЄҐA-Z]/u.test(t) && !QUERY_STOP_WORDS.has(t.toLowerCase()),
      );

      if (nameTokens.length > 1) {
        variants.push(nameTokens[nameTokens.length - 1]);
        variants.push(nameTokens[0]);
      }

      return [...new Set(variants)].slice(0, 4);
    }

    const prompt =
      `Given the search query: "${query}"\n\n` +
      `Generate 3 expanded versions that include synonyms, related terms, ` +
      `and alternative phrasings.\n` +
      `Format: one query per line, no numbers or bullets.`;

    try {
      const response = await this.ollamaService.getRagResponseByPrompt(prompt);
      return response
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l !== query)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  private async rephraseQuery(query: string, isEntity: boolean): Promise<string[]> {
    if (isEntity) return [];

    const tokenCount = query.trim().split(/\s+/).length;
    if (tokenCount <= 4) return [];

    const prompt =
      `Rephrase this question in 2 different ways while keeping the same meaning: "${query}"\n\n` +
      `Provide only the rephrased questions, one per line, no numbers.` +
      `Translate text to ukrainian`;

    try {
      const response = await this.ollamaService.getRagResponseByPrompt(prompt);
      return response
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l !== query)
    } catch {
      return [];
    }
  }

  private async extractKeywords(query: string, isEntity: boolean): Promise<string[]> {
    const baseKeywords = expandWithSynonyms(query);

    if (isEntity) {
      const nameVariants = extractQueryNameVariants(query);
      const allKeywords  = [...new Set([...baseKeywords, ...nameVariants])];
      return allKeywords.slice(0, 25);
    }

    const prompt =
      `Extract the 5 most important keywords from this query: "${query}"\n\n` +
      `List only the keywords separated by commas. ` +
      `Do NOT translate or modify proper names.`;
    try {
      const response = await this.ollamaService.getRagResponseByPrompt(prompt);
      const llmKeywords = response
        .split(',')
        .map(kw => kw.trim().toLowerCase())
        .filter(kw => kw.length > 0);

      const allKeywords = [...new Set([...baseKeywords, ...llmKeywords])];
      return allKeywords.slice(0, 20);
    } catch {
      return baseKeywords.slice(0, 10);
    }
  }
}