const CYR_TO_LAT: Record<string, string> = {
  'а':'a',  'б':'b',  'в':'v',  'г':'h',  'ґ':'g',
  'д':'d',  'е':'e',  'є':'ie', 'ж':'zh', 'з':'z',
  'и':'y',  'і':'i',  'ї':'i',  'й':'i',  'к':'k',
  'л':'l',  'м':'m',  'н':'n',  'о':'o',  'п':'p',
  'р':'r',  'с':'s',  'т':'t',  'у':'u',  'ф':'f',
  'х':'kh', 'ц':'ts', 'ч':'ch', 'ш':'sh', 'щ':'shch',
  'ь':'',   'ю':'iu', 'я':'ia',
  'ё':'yo', 'э':'e',  'ъ':'',   'ы':'y',
};

const LAT_POPULAR: Record<string, string[]> = {
  'kh':   ['h', 'x'],
  'zh':   ['j'],
  'ch':   ['tch'],
  'sh':   ['sch'],
  'shch': ['sch'],
  'ts':   ['tz', 'c'],
  'ie':   ['ye', 'e', 'je'],
  'iu':   ['yu', 'ju'],
  'ia':   ['ya', 'ja'],
  'h':    ['kh', 'g', 'x'],
};

const UA_SUFFIXES = [
  'ієм','ієві','єві','єм','ій','ого','ої',
  'ові','ом','ою','ієї',
  'чі','ча','чу','чею',
  'а','у','и','і','є',
];

export function cyrillicToLatin(text: string): string {
  return text.toLowerCase().split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}

export function latinToCyrillicBestEffort(text: string): string {
  const steps: [RegExp, string][] = [
    [/shch/g,'щ'],[/zh/g,'ж'],[/kh/g,'х'],[/ch/g,'ч'],
    [/sh/g,'ш'],  [/ts/g,'ц'],[/ye|ie/g,'є'],[/yu|iu/g,'ю'],
    [/ya|ia/g,'я'],[/yi/g,'ї'],[/b/g,'б'],[/v/g,'в'],
    [/h/g,'г'],   [/g/g,'ґ'],[/d/g,'д'],[/z/g,'з'],[/k/g,'к'],
    [/l/g,'л'],   [/m/g,'м'],[/n/g,'н'],[/p/g,'п'],[/r/g,'р'],
    [/s/g,'с'],   [/t/g,'т'],[/f/g,'ф'],[/a/g,'а'],[/e/g,'е'],
    [/i/g,'і'],   [/o/g,'о'],[/u/g,'у'],[/y/g,'и'],
  ];
  let r = text.toLowerCase();
  for (const [re, cyr] of steps) r = r.replace(re, cyr);
  return r;
}

export function generateNameVariants(token: string): string[] {
  const clean = token.toLowerCase().trim()
    .replace(/[^a-zа-яіїєґёэъыa-z]/gi, '');
  if (clean.length < 2) return [];

  const variants = new Set<string>([clean]);

  const isCyrillic = /[а-яіїєґёэъы]/i.test(clean);
  const latinForm  = isCyrillic ? cyrillicToLatin(clean) : clean;
  const cyrForm    = isCyrillic ? clean : latinToCyrillicBestEffort(clean);

  variants.add(latinForm);
  variants.add(cyrForm);

  for (const [canonical, alts] of Object.entries(LAT_POPULAR)) {
    if (!latinForm.includes(canonical)) continue;
      
    const re = canonical === 'h'
      ? /(?<![sckzgdt])h/g
      : new RegExp(canonical, 'g');

    for (const alt of alts) {
      const v = latinForm.replace(re, alt);
      if (v !== latinForm) variants.add(v);
    }
  }

  if (latinForm.endsWith('ii')) {
    const stem = latinForm.slice(0, -2);
    variants.add(stem + 'y');
    variants.add(stem + 'iy');
    variants.add(stem + 'i');
    variants.add(stem + 'ey');
    variants.add(stem + 'ei');
    const gStem = stem.replace(/h$/, 'g');
    if (gStem !== stem) {
      variants.add(gStem + 'ii');
      variants.add(gStem + 'iy');
      variants.add(gStem + 'y');
      variants.add(gStem + 'ey');
      variants.add(gStem + 'ei');
    }
  } else if (latinForm.endsWith('iy')) {
    const stem = latinForm.slice(0, -2);
    variants.add(stem + 'y');
    variants.add(stem + 'ii');
    variants.add(stem + 'i');
    variants.add(stem + 'ey');
    variants.add(stem + 'ei');
    const gStem = stem.replace(/h$/, 'g');
    if (gStem !== stem) {
      variants.add(gStem + 'ii');
      variants.add(gStem + 'iy');
      variants.add(gStem + 'y');
      variants.add(gStem + 'ey');
      variants.add(gStem + 'ei');
    }
  } else if (latinForm.endsWith('y') && latinForm.length > 3) {
    const stem = latinForm.slice(0, -1);
    variants.add(stem + 'ii');
    variants.add(stem + 'iy');
    variants.add(stem + 'i');
  }

  for (const suffix of UA_SUFFIXES) {
    if (cyrForm.endsWith(suffix) && cyrForm.length - suffix.length >= 3) {
      const stem = cyrForm.slice(0, cyrForm.length - suffix.length);
      variants.add(stem);
      variants.add(cyrillicToLatin(stem));
    }
  }

  return [...new Set(variants)].filter(v => v.length >= 2);
}

const QUESTION_STOP_WORDS = new Set([
  'що', 'як', 'де', 'коли', 'хто', 'чому', 'який', 'яка', 'яке', 'які',
  'чи', 'або', 'та', 'це', 'є', 'у', 'в', 'на', 'до', 'по', 'про', 'за',
  'із', 'зі', 'від', 'між', 'під', 'над', 'при', 'через', 'після', 'перед',
  'таке', 'такий', 'така', 'такі', 'собою', 'себе', 'його', 'її', 'їх',
  'мене', 'тебе', 'нас', 'вас', 'всі', 'все', 'цей', 'ця', 'ці', 'той',
  'розкажи', 'розкажіть', 'підкажи', 'підкажіть', 'поясни', 'поясніть',
  'опиши', 'опишіть', 'покажи', 'покажіть', 'дай', 'дайте', 'поверни',
  'поверніть', 'перелічи', 'перелічіть', 'знайди', 'знайдіть',
  'порівняй', 'порівняйте', 'допоможи', 'допоможіть',
  'what', 'how', 'where', 'when', 'who', 'why', 'which', 'is', 'are',
  'does', 'do', 'did', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to',
  'for', 'with', 'about', 'this', 'that', 'these', 'those',
  'tell', 'show', 'give', 'list', 'find', 'explain', 'describe',
  'node', 'react', 'vue', 'angular', 'python', 'java', 'docker', 'linux',
  'api', 'sql', 'aws', 'git', 'css', 'html', 'json', 'rest', 'graphql',
  'typescript', 'javascript', 'kotlin', 'swift', 'golang', 'rust', 'php',
  'mongodb', 'postgres', 'redis', 'nginx', 'kubernetes', 'terraform',
]);

/**
 * Non-person context words: if any of these appear in the query, the
 * capitalised token is likely a company / product / tool name — NOT a human.
 */
const NON_PERSON_CONTEXT = new Set([
  'company', 'компанія', 'компанії', 'компанію', 'компанієї',
  'name', 'назва', 'назви', 'назву', 'named', 'called',
  'brand', 'бренд', 'product', 'продукт', 'tool', 'інструмент',
  'platform', 'платформа', 'system', 'систем', 'academy', 'академі',
  'department', 'відділ', 'департамент', 'team', 'команд',
  'origin', 'history', 'meaning', 'founded', 'заснування',
  'onix', // always treat "Onix" as a non-person subject
]);

export function isEntityQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length > 80) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 5) return false;

  // If the query contains non-person context words → not an entity (human) query
  const lowerTokens = tokens.map(t => t.toLowerCase().replace(/[?!.,;:]/g, ''));
  const hasNonPersonContext = lowerTokens.some(t => NON_PERSON_CONTEXT.has(t));
  if (hasNonPersonContext) return false;

  const nameTokens = tokens.filter(
    t => /^[А-ЯІЇЄҐA-Z]/u.test(t) && !QUESTION_STOP_WORDS.has(t.toLowerCase()),
  );
  return nameTokens.length >= 1;
}

export function extractQueryNameVariants(query: string): string[] {
  const tokens = query.split(/\s+/).filter(
    t => /^[А-ЯІЇЄҐA-Z]/u.test(t) && t.length >= 2,
  );
  const all = tokens.flatMap(t =>
    generateNameVariants(t.replace(/[^a-zA-Zа-яіїєґёэъыА-ЯІЇЄҐ]/gi, '')),
  );
  return [...new Set(all)];
}

export function enrichKeywordsWithVariants(keywords: string[]): string[] {
  const enriched = new Set<string>(keywords.map(k => k.toLowerCase()));
  for (const kw of keywords) {
    for (const part of kw.toLowerCase().split(/\s+/)) {
      if (part.length >= 3) {
        for (const v of generateNameVariants(part)) enriched.add(v);
      }
    }
  }
  return [...enriched];
}