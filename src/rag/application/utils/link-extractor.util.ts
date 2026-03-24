import { IKnowledgeLink, LinkType } from 'src/rag/domain/interfaces/knowledge-link.interface';

export interface ExtractedLink {
  url:      string;
  label:    string;
  context:  string;
  linkType: LinkType;
  keywords: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i;
const VIDEO_HOST = /youtu\.?be|vimeo\.com|loom\.com|wistia\.com/i;

function detectLinkType(url: string): LinkType {
  if (IMAGE_EXT.test(url)) return 'image';
  if (VIDEO_EXT.test(url) || VIDEO_HOST.test(url)) return 'video';
  return 'url';
}

function extractContext(text: string, matchIndex: number, windowChars = 200): string {
  const start = Math.max(0, matchIndex - windowChars);
  const end   = Math.min(text.length, matchIndex + windowChars);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function buildKeywords(label: string, url: string): string[] {
  const kws = new Set<string>();

  label
    .toLowerCase()
    .split(/[\s\-_/|,;:()[\]{}]+/)
    .flatMap(w => w.split(/(?=[A-Z])/))
    .map(w => w.trim())
    .filter(w => w.length > 1)
    .forEach(w => kws.add(w));

  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const TLD    = new Set(['com', 'ua', 'net', 'org', 'io', 'co', 'app', 'dev', 'www']);

    parsed.hostname
      .split('.')
      .filter(p => p.length > 2 && !TLD.has(p))
      .forEach(p => kws.add(p.toLowerCase()));

    parsed.pathname
      .split(/[/\-_?&#=+]/)
      .filter(p => p.length > 2 && !/^\d+$/.test(p))
      .map(p => p.toLowerCase())
      .forEach(p => kws.add(p));
  } catch {
    url
      .split(/[/\-_?&#=+.]/)
      .filter(p => p.length > 2 && !/^\d+$/.test(p))
      .map(p => p.toLowerCase())
      .forEach(p => kws.add(p));
  }

  return [...kws].slice(0, 30);
}

export function extractLinksFromMarkdown(
  content: string,
  sourceFile: string,
): Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>[] {
  const results = new Map<string, Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>>();

  const add = (url: string, label: string, matchIndex: number) => {
    url = url.trim();
    if (!url || url.startsWith('#')) return;
    if (url.startsWith('mailto:')) return;

    const key = `${url}::${label.trim().toLowerCase()}`;
    if (results.has(key)) return;

    results.set(key, {
      url,
      label:      label.trim() || url,
      context:    extractContext(content, matchIndex),
      sourceFile,
      linkType:   detectLinkType(url),
      keywords:   buildKeywords(label || url, url),
    });
  };

  const imgRe  = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  const autoRe = /<(https?:\/\/[^>]+)>/g;
  const bareRe = /(?<![(\["])https?:\/\/[^\s"'<>)\]]+/g;

  let m: RegExpExecArray | null;

  while ((m = imgRe.exec(content)) !== null)  add(m[2], m[1] || 'image', m.index);
  while ((m = linkRe.exec(content)) !== null) add(m[2], m[1], m.index);
  while ((m = autoRe.exec(content)) !== null) add(m[1], m[1], m.index);
  while ((m = bareRe.exec(content)) !== null) add(m[0], m[0], m.index);

  return [...results.values()];
}

export function isLinkQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /посилання|лінк[аи]?|сайт|url\b|link\b|адрес[аи]|куди|де знайти|де відкрити/i.test(q) ||
    /where.*link|give.*link|what.*url|send.*link|find.*link|open.*link/i.test(q) ||
    /\b(hrm|goals|figma|confluence|jira|slack|notion|drive|gitlab|github)\b/i.test(q)
  );
}
