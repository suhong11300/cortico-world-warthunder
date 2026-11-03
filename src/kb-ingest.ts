import {
  decodeHtmlEntities, fetchSourceText, hashKey, isSitemapPayload, parseSitemapLocs,
  readKbFile, resolveKbLimits, writeKbFile, type FetchKbOptions, type KbFile, type KbLimitInput,
} from './kb.ts';
import { assertFetchableUrl } from './guard.ts';
import type { KbEntry, KbKind } from './kb-types.ts';

/** 素材里的一节：小标题 + 该节正文。 */
export interface KbSection {
  heading: string;
  text: string;
}

/** 抓回来的可读素材，交给桌宠自己的模型整理成词条。 */
export interface KbMaterial {
  url: string;
  host: string;
  title: string;
  sections: KbSection[];
  chars: number;
  truncated: boolean;
  /** 拼好的正文，模型直接读这一段。 */
  text: string;
}

export interface MaterialOptions {
  fetchImpl?: typeof globalThis.fetch;
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** 素材总字符上限，默认 12000。 */
  maxChars?: number;
  /** sitemap 展开页数，默认 5，上限 20。 */
  pages?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_CHARS = 12000;
const MAX_SECTIONS = 80;
const SECTION_MAX_CHARS = 1200;
const KINDS: readonly KbKind[] = ['concept', 'vehicle', 'play'];
const KIND_ALIAS: Record<string, KbKind> = {
  vehicle: 'vehicle', tank: 'vehicle', plane: 'vehicle', aircraft: 'vehicle', ship: 'vehicle', helicopter: 'vehicle', 载具: 'vehicle', 坦克: 'vehicle', 飞机: 'vehicle',
  concept: 'concept', term: 'concept', mechanic: 'concept', 概念: 'concept', 词条: 'concept', 机制: 'concept',
  play: 'play', mode: 'play', gameplay: 'play', tactic: 'play', 玩法: 'play', 战术: 'play',
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.trunc(value)));
}

function cleanLine(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** 名字归一化：去掉所有空白并小写，用来判重。 */
function nameKey(name: string): string {
  return name.replace(/[\s\u3000]+/g, '').toLowerCase();
}

function asList(value: unknown, maxItems = 8, maxLength = 24): string[] | undefined {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[、,，;；/|]+/)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const text = cleanLine(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

/** 剥掉脚本、样式与页头页脚，保留能读的正文块。 */
function stripChrome(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

/** 按 h1–h4 分节，段落与列表项归到当前节。 */
export function htmlSections(html: string, fallbackTitle = ''): { title: string; sections: KbSection[] } {
  const title = decodeHtmlEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()).slice(0, 80) || fallbackTitle;
  const cleaned = stripChrome(html);
  const sections: KbSection[] = [];
  let current: KbSection | null = null;
  const pattern = /<(h[1-4]|p|li|dd|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const tag = match[1]!.toLowerCase();
    const text = decodeHtmlEntities(match[2]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (tag.startsWith('h')) {
      // 标题过长多半是整段正文被塞进了标题标签。
      if (text.length <= 80) {
        current = { heading: text, text: '' };
        sections.push(current);
      }
      continue;
    }
    // 导航项、面包屑都是短句；正文段落才有信息量。
    if (text.length < (tag === 'li' ? 24 : 16)) continue;
    if (!current) {
      current = { heading: title || '正文', text: '' };
      sections.push(current);
    }
    const room = SECTION_MAX_CHARS - current.text.length;
    if (room <= 0) continue;
    current.text += (current.text ? '\n' : '') + text.slice(0, room);
  }
  return { title, sections: sections.filter((section) => section.text.length > 0) };
}

function joinSections(sections: KbSection[], maxChars: number): { text: string; truncated: boolean } {
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;
  for (const section of sections.slice(0, MAX_SECTIONS)) {
    const block = '## ' + section.heading + '\n' + section.text;
    if (used + block.length > maxChars) {
      const room = maxChars - used;
      if (room > 80) blocks.push(block.slice(0, room) + '…');
      truncated = true;
      break;
    }
    blocks.push(block);
    used += block.length + 2;
  }
  return { text: blocks.join('\n\n'), truncated };
}

/**
 * 抓一页（或一个 sitemap 的前几页）压成素材。
 *
 * 与 kb.ts 的 fetchRemoteKb 的区别：那边直接产出「段落既词条」的粗词库，
 * 这里只负责把可读正文捡出来，结构由桌宠的模型整理——玩家只给网址即可。
 */
export async function fetchKbMaterial(rawUrl: string, opts: MaterialOptions = {}): Promise<KbMaterial> {
  const url = assertFetchableUrl(rawUrl, { allowPrivate: opts.allowPrivate === true });
  const fetchOpts: FetchKbOptions = {
    timeoutMs: opts.timeoutMs ?? 45000,
    allowPrivate: opts.allowPrivate === true,
    limits: { maxBytes: 8 * 1024 * 1024, maxEntries: 20000 },
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  };
  const limits = resolveKbLimits(fetchOpts.limits);
  const controller = new AbortController();
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), fetchOpts.timeoutMs ?? 45000);
  const maxChars = clamp(opts.maxChars ?? DEFAULT_MAX_CHARS, 2000, 40000);
  try {
    const got = await fetchSourceText(url, fetchOpts, limits, signal);
    const host = (() => { try { return new URL(url).host; } catch { return 'web'; } })();
    let title = '';
    const sections: KbSection[] = [];
    if (isSitemapPayload(got.mime, got.text)) {
      const pages = parseSitemapLocs(got.text).slice(0, clamp(opts.pages ?? 5, 1, 20));
      if (pages.length === 0) throw new Error('sitemap 里没有可抓取的页面');
      for (const page of pages) {
        try {
          const one = await fetchSourceText(page, fetchOpts, limits, signal);
          const parsed = htmlSections(one.text, page);
          if (!title) title = parsed.title;
          for (const section of parsed.sections.slice(0, 6)) {
            sections.push({ heading: parsed.title + ' · ' + section.heading, text: section.text });
          }
        } catch {
          // 单个展开页失败不影响其它页；全失败时下面会自然报空。
        }
        if (sections.length >= MAX_SECTIONS) break;
      }
      if (sections.length === 0) throw new Error('sitemap 各页面都没有可读正文');
    } else if (got.mime.includes('html') || (!got.mime.includes('json') && /^\s*</.test(got.text))) {
      const parsed = htmlSections(got.text, url);
      title = parsed.title;
      sections.push(...parsed.sections);
      if (sections.length === 0) {
        throw new Error('页面里没有可读正文（可能是纯前端渲染页、需要登录，或正文全在脚本里）');
      }
    } else if (got.mime.includes('json')) {
      // JSON 已经是结构化数据：原样当素材，交给模型改写而不是硬拆字段。
      sections.push({ heading: 'JSON 原文', text: got.text.slice(0, SECTION_MAX_CHARS) });
      title = url;
    } else {
      sections.push({ heading: '原文', text: got.text.slice(0, SECTION_MAX_CHARS) });
      title = url;
    }
    const joined = joinSections(sections, maxChars);
    if (!joined.text.trim()) throw new Error('页面里没有可读正文');
    return { url, host, title: title || host, sections, chars: joined.text.length, truncated: joined.truncated, text: joined.text };
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型回复里抠出条目数组：容忍 ```json 围栏与前后解释文字。 */
export function parseEntriesPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.entries)) return record.entries;
    return [record];
  }
  if (typeof raw !== 'string') throw new Error('条目得是 JSON 数组');
  const text = raw.trim().replace(/^```(?:json|javascript)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    // 也接受单个对象。
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    if (objStart < 0 || objEnd <= objStart) throw new Error('条目得是 JSON 数组');
    const one: unknown = JSON.parse(text.slice(objStart, objEnd + 1));
    return Array.isArray(one) ? one : [one];
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('条目得是 JSON 数组');
  return parsed;
}

/** 一条词条的规范化：缺名、缺摘要、摘要过短的丢弃。 */
export function normalizeIngestedEntry(raw: unknown): KbEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const kindRaw = cleanLine(item.kind, 16).toLowerCase();
  const kind = KIND_ALIAS[kindRaw] ?? (KINDS.includes(kindRaw as KbKind) ? (kindRaw as KbKind) : 'concept');
  const name = cleanLine(item.name, 60);
  const summary = cleanLine(item.summary ?? item.text ?? item.body, 600);
  if (name.length < 2 || summary.length < 20) return null;
  // 名字里的空格、大小写差异不该造成两条重复词条，id 与合并键都用归一化后的名字。
  const entry: KbEntry = { id: 'ing-' + hashKey(kind + '|' + nameKey(name)), kind, name, summary };
  const aliases = asList(item.aliases);
  if (aliases) entry.aliases = aliases;
  const tags = asList(item.tags);
  if (tags) entry.tags = tags;
  const br = cleanLine(item.br, 32);
  if (br) entry.br = br;
  const nation = cleanLine(item.nation, 32);
  if (nation) entry.nation = nation;
  const category = cleanLine(item.category, 40);
  if (category) entry.category = category;
  return entry;
}

export interface IngestOutcome {
  added: number;
  replaced: number;
  dropped: number;
  reasons: string[];
  total: number;
  version: string;
}

/**
 * 把 AI 整理好的条目写进 <dataDir>/wt/kb.json。
 *
 * 合并规则：id 由「类型 + 名字」决定，所以同一个载具反复整理只会覆盖、不会重复；
 * 改过名的旧条目按「类型 + 新名」认不出来，这里额外按名字清一遍。
 */
export function ingestKbEntries(dataDir: string, raw: unknown, sourceUrl: string, opts: { maxEntries?: number; limits?: KbLimitInput } = {}): IngestOutcome {
  const limits = resolveKbLimits(opts.limits);
  const maxEntries = clamp(opts.maxEntries ?? 30, 1, 100);
  const payload = parseEntriesPayload(raw);
  if (payload.length > maxEntries) throw new Error('一次最多入库 ' + String(maxEntries) + ' 条，这次给了 ' + String(payload.length) + ' 条');
  const accepted: KbEntry[] = [];
  const reasons: string[] = [];
  let dropped = 0;
  for (const item of payload) {
    const entry = normalizeIngestedEntry(item);
    if (entry) accepted.push(entry);
    else {
      dropped += 1;
      if (reasons.length < 5) {
        const name = item && typeof item === 'object' ? cleanLine((item as Record<string, unknown>).name, 40) : '';
        reasons.push(name ? '「' + name + '」缺摘要或摘要不足 20 字' : '有一条不是对象或缺名字');
      }
    }
  }
  if (accepted.length === 0) throw new Error('没有可入库的条目：' + (reasons[0] ?? '格式不对'));
  const existing = readKbFile(dataDir, limits)?.entries ?? [];
  const byId = new Map<string, KbEntry>(existing.map((entry) => [entry.id, entry]));
  const keyOf = (entry: KbEntry): string => entry.kind + '|' + nameKey(entry.name);
  const incoming = new Set(accepted.map(keyOf));
  const acceptedIds = new Set(accepted.map((entry) => entry.id));
  for (const [id, entry] of [...byId]) {
    if (incoming.has(keyOf(entry)) && !acceptedIds.has(id)) byId.delete(id);
  }
  let added = 0;
  let replaced = 0;
  for (const entry of accepted) {
    if (byId.has(entry.id)) replaced += 1;
    else added += 1;
    byId.set(entry.id, entry);
  }
  const entries = [...byId.values()];
  const host = (() => { try { return new URL(sourceUrl).host; } catch { return 'web'; } })();
  const version = ('ingest:' + host + '@' + String(accepted.length) + '条').slice(0, 40);
  const file: KbFile = { version, fetchedAt: new Date().toISOString(), entries };
  writeKbFile(dataDir, file, limits);
  return { added, replaced, dropped, reasons, total: entries.length, version };
}
