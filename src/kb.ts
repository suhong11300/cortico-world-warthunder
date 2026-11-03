import { mkdirSync, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fetchGuarded, normalizeKbSource } from './guard.ts';
import { join } from 'node:path';
import { KB_SEED, KB_SEED_VERSION } from './kb-seed.ts';
import type { KbEntry, KbKind } from './kb-types.ts';
import { resolveKbLimits, checkKbBudget, preflightKbJson, type KbLimitInput, type KbLimits } from './kb-limits.ts';
export { resolveKbLimits, KB_MAX_BYTES, KB_MAX_ENTRIES, type KbLimitInput } from './kb-limits.ts';

/** 知识库落在 <dataDir>/wt/kb.json 的内容,只有远程更新成功才写。 */
export interface KbFile {
  version: string;
  fetchedAt: string;
  entries: KbEntry[];
}

export interface KbView {
  entries: KbEntry[];
  /** 当前生效版本:有远程就是远程版本,否则内置版本。 */
  version: string;
  remoteVersion: string | null;
  remoteCount: number;
  fetchedAt: string;
  loadError?: string;
}

export interface KbCounts {
  concept: number;
  vehicle: number;
  play: number;
  total: number;
}

export interface KbHit {
  entry: KbEntry;
  score: number;
}

export interface RemoteKb {
  version: string;
  entries: KbEntry[];
  skipped: number;
}

export const KB_DIR = 'wt';
export const KB_FILE = 'kb.json';
const KINDS: KbKind[] = ['concept', 'vehicle', 'play'];

/** <dataDir>/wt/kb.json 的绝对路径。 */
export function kbPath(dataDir: string): string {
  return join(dataDir, KB_DIR, KB_FILE);
}

/** 读远程那份;文件不存在或内容坏了都返回 null,不影响内置词条。 */
function readKbChecked(dataDir: string, input?: KbLimitInput): KbFile {
  const limits = resolveKbLimits(input), fd = openSync(kbPath(dataDir), 'r');
  try {
    const stat = fstatSync(fd); if (!stat.isFile()) throw new Error('知识库不是普通文件');
    checkKbBudget(stat.size, 0, limits);
    const buffer = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < buffer.length) { const n = readSync(fd, buffer, size, buffer.length - size, null); if (!n) break; size += n; }
    const after = fstatSync(fd);
    if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('知识库读取期间发生变化');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    preflightKbJson(raw, size, limits);
    const payload = JSON.parse(raw), parsed = parseRemoteKb(payload, limits);
    return { version: parsed.version, fetchedAt: asOptionalString(payload.fetchedAt, 80) ?? '', entries: parsed.entries };
  } finally { closeSync(fd); }
}
export function readKbFile(dataDir: string, limits?: KbLimitInput): KbFile | null {
  try { return readKbChecked(dataDir, limits); } catch { return null; }
}

/** 先写 .tmp 再 rename,避免半截文件。 */
export function writeKbFile(dataDir: string, file: KbFile, input?: KbLimitInput): void {
  const limits = resolveKbLimits(input);
  checkKbBudget(0, file.entries.length, limits);
  const target = kbPath(dataDir);
  mkdirSync(join(dataDir, KB_DIR), { recursive: true });
  const tmp = target + '.' + randomUUID() + '.tmp';
  let fd: number | undefined, owned = false, bytes = 0, batch = '';
  const flush = () => {
    if (!batch) return;
    const buffer = Buffer.from(batch, 'utf8'); bytes += buffer.length; checkKbBudget(bytes, file.entries.length, limits);
    let offset = 0; while (offset < buffer.length) offset += writeSync(fd!, buffer, offset, buffer.length - offset);
    batch = '';
  };
  try {
    fd = openSync(tmp, 'wx'); owned = true;
    batch = '{"version":' + JSON.stringify(cleanText(file.version, 40)) + ',"fetchedAt":' + JSON.stringify(cleanText(file.fetchedAt, 80)) + ',"entries":[';
    for (let i = 0; i < file.entries.length; i++) {
      // 每次只规范化一条，不先构造整个库的第二份JSON字符串/清洗数组。
      const entry = parseRemoteKb({ version: 'write', entries: [file.entries[i]] }, limits).entries[0];
      batch += (i ? ',' : '') + JSON.stringify(entry); if (batch.length >= 32768) flush();
    }
    batch += ']}'; flush(); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(tmp, target); owned = false;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (owned) { try { unlinkSync(tmp); } catch { /* 原文件不动，仅清理自己创建的临时文件。 */ } }
  }
}

/** 远程同 id 覆盖内置,远程独有的追加在后面。 */
export function mergeKb(remote: KbEntry[] | null): KbEntry[] {
  if (!remote || remote.length === 0) return KB_SEED.slice();
  // 名字归一化：AI 整理的「虎式 H1」与内置「虎式H1」是同一个东西，不能并存两条。
  const keyOf = (entry: KbEntry): string => entry.kind + '|' + entry.name.replace(/[\s\u3000]+/g, '').toLowerCase();
  const merged: KbEntry[] = KB_SEED.slice();
  const idIndex = new Map<string, number>();
  merged.forEach((entry, index) => idIndex.set(entry.id, index));
  const appended: KbEntry[] = [];
  for (const entry of remote) {
    const at = idIndex.get(entry.id);
    if (at !== undefined) merged[at] = entry;
    else appended.push(entry);
  }
  const byKey = new Map<string, KbEntry>();
  for (const entry of merged) byKey.set(keyOf(entry), entry);
  for (const entry of appended) byKey.set(keyOf(entry), entry);
  return [...byKey.values()];
}

export function kbView(file: KbFile | null, loadError?: string): KbView {
  if (!file || file.entries.length === 0) {
    return { entries: KB_SEED.slice(), version: KB_SEED_VERSION, remoteVersion: null, remoteCount: 0, fetchedAt: '', ...(loadError ? { loadError } : {}) };
  }
  return { entries: mergeKb(file.entries), version: file.version || KB_SEED_VERSION, remoteVersion: file.version, remoteCount: file.entries.length, fetchedAt: file.fetchedAt };
}
export function loadKb(dataDir: string, limits?: KbLimitInput): KbView {
  try { return kbView(readKbChecked(dataDir, limits)); }
  catch (error) { return kbView(null, (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : String((error as Error).message)); }
}

export function kbCounts(entries: KbEntry[]): KbCounts {
  const counts: KbCounts = { concept: 0, vehicle: 0, play: 0, total: entries.length };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** 英文按词切,中文给出整串与所有 2-gram,这样「历史空战」也能命中「空战历史」。 */
export function tokenizeQuery(query: string): string[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  const tokens = new Set<string>();
  for (const chunk of text.split(/[\s,，、;；|/]+/)) {
    if (!chunk) continue;
    if (/^[a-z0-9.+-]+$/.test(chunk)) {
      tokens.add(chunk);
      continue;
    }
    tokens.add(chunk);
    for (let i = 0; i + 2 <= chunk.length; i += 1) tokens.add(chunk.slice(i, i + 2));
  }
  return [...tokens];
}

function haystackOf(entry: KbEntry): { name: string; aliases: string; tags: string; summary: string; extra: string } {
  const extra = [entry.br, entry.nation, entry.category].filter((part): part is string => typeof part === 'string').join(' ');
  return {
    name: entry.name.toLowerCase(),
    aliases: (entry.aliases ?? []).join(' ').toLowerCase(),
    tags: (entry.tags ?? []).join(' ').toLowerCase(),
    summary: entry.summary.toLowerCase(),
    extra: extra.toLowerCase(),
  };
}

/** 名称命中权重最高,简介命中最低;整串命中额外加权。 */
export function scoreEntry(entry: KbEntry, tokens: string[], whole: string): number {
  if (tokens.length === 0) return 0;
  const hay = haystackOf(entry);
  let score = 0;
  if (whole) {
    if (hay.name === whole) score += 200;
    else if (hay.name.includes(whole)) score += 120;
    if (hay.aliases === whole) score += 120;
    else if (hay.aliases.includes(whole)) score += 90;
    if (hay.tags.includes(whole)) score += 50;
    if (hay.summary.includes(whole)) score += 40;
    if (hay.extra.includes(whole)) score += 30;
  }
  for (const token of tokens) {
    if (hay.name.includes(token)) score += 18;
    else if (hay.aliases.includes(token)) score += 14;
    else if (hay.tags.includes(token)) score += 8;
    else if (hay.summary.includes(token)) score += 5;
    else if (hay.extra.includes(token)) score += 4;
  }
  return score;
}

export function searchKb(entries: KbEntry[], query: string, limit = 5): KbHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const whole = query.trim().toLowerCase();
  const hits: KbHit[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, tokens, whole);
    if (score > 0) hits.push({ entry, score });
  }
  hits.sort((a, b) => (b.score - a.score) || (a.entry.name.length - b.entry.name.length) || a.entry.id.localeCompare(b.entry.id));
  return hits.slice(0, Math.max(1, limit));
}

/** 载具查询:先精确对名称与别名,再退化成检索结果里的第一条载具。 */
export function findVehicle(entries: KbEntry[], name: string): KbEntry | null {
  const whole = name.trim().toLowerCase();
  if (!whole) return null;
  for (const entry of entries) {
    if (entry.kind !== 'vehicle') continue;
    if (entry.name.toLowerCase() === whole) return entry;
    if ((entry.aliases ?? []).some((alias) => alias.toLowerCase() === whole)) return entry;
  }
  for (const entry of entries) {
    if (entry.kind !== 'vehicle') continue;
    if (entry.name.toLowerCase().includes(whole)) return entry;
    if ((entry.aliases ?? []).some((alias) => alias.toLowerCase().includes(whole))) return entry;
  }
  for (const hit of searchKb(entries, name, 5)) {
    if (hit.entry.kind === 'vehicle') return hit.entry;
  }
  return null;
}

/**
 * 清洗一段外部文本。
 *
 * 知识库源是别人给的 JSON,词条正文会原样进工具回执、进而进模型上下文:
 * 控制字符会打乱排版,零宽字符能让"看不见的指令"藏在搜索结果里,超长正文会撑爆输入预算。
 * 统一在这里去控制字符、压平空白、截断长度。
 */
export function cleanText(value: string, maxLength: number): string {
  const flat = value.slice(0, Math.max(256, maxLength * 4))
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > maxLength ? flat.slice(0, maxLength) : flat;
}

function asStringList(value: unknown, maxLength = 40): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 128) throw new Error('知识库数组超过结构上限');
  const out: string[] = [];
  for (const item of value) { if (typeof item !== 'string') continue; const clean = cleanText(item, maxLength); if (clean) out.push(clean); if (out.length >= 8) break; }
  return out.length > 0 ? out : undefined;
}

function asOptionalString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = cleanText(value, maxLength);
  return clean.length > 0 ? clean : undefined;
}

/** 校验远程载荷;不合法只跳过单条,整体形状错了才抛。 */
export function parseRemoteKb(payload: unknown, input?: KbLimitInput): RemoteKb {
  const limits = resolveKbLimits(input);
  if (typeof payload !== 'object' || payload === null) throw new Error('知识库载荷不是对象');
  const record = payload as Record<string, unknown>;
  const version = asOptionalString(record.version, 40);
  if (!version) throw new Error('知识库载荷缺少 version');
  const rawEntries = record.entries;
  if (!Array.isArray(rawEntries)) throw new Error('知识库载荷缺少 entries 数组');
  checkKbBudget(0, rawEntries.length, limits);
  const entries: KbEntry[] = [];
  let skipped = 0;
  for (const raw of rawEntries) {
    if (typeof raw !== 'object' || raw === null) {
      skipped += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const id = asOptionalString(item.id, 80);
    const name = asOptionalString(item.name, 80);
    const summary = asOptionalString(item.summary, 600);
    const kind = asOptionalString(item.kind, 16);
    if (!id || !name || !summary || !kind || !KINDS.includes(kind as KbKind)) {
      skipped += 1;
      continue;
    }
    const entry: KbEntry = { id, kind: kind as KbKind, name, summary };
    const aliases = asStringList(item.aliases, 40);
    if (aliases) entry.aliases = aliases.slice(0, 8);
    const tags = asStringList(item.tags, 24);
    if (tags) entry.tags = tags.slice(0, 8);
    const br = asOptionalString(item.br, 32);
    if (br) entry.br = br;
    const nation = asOptionalString(item.nation, 32);
    if (nation) entry.nation = nation;
    const category = asOptionalString(item.category, 40);
    if (category) entry.category = category;
    entries.push(entry);
  }
  if (entries.length === 0) throw new Error('知识库载荷里没有一条合法词条');
  return { version, entries, skipped };
}

export interface FetchKbOptions {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 由调用方(worlds.wt.kbAllowPrivate)决定;关着时只能取公网 http(s)。 */
  allowPrivate?: boolean;
  limits?: KbLimitInput;
  signal?: AbortSignal;
  /** sitemap 源最多展开多少页；默认 20，上限 200。 */
  maxPages?: number;
}

/**
 * 把一张网页变成词条。
 *
 * 目的很朴素:用户填的是「一个能读到内容的网址」,不该要求对方先做成自家 JSON 格式。
 * 这里剥掉脚本与样式,按段落/小标题/列表项切块,每块一条 concept 词条,
 * 词条名取该块开头一小段,正文就是块本身——搜「攻顶弹」「修理费」这类词时
 * 命中段落比命中整个页面有用。
 *
 * 页面重复抓取不会产生重复词条:id 由「规范化 URL + 块序号」决定,合并时按 id 覆盖。
 */
export function parseHtmlKb(html: string, url: string, input?: KbLimitInput): RemoteKb {
  const limits = resolveKbLimits(input);
  const title = decodeHtmlEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()).slice(0, 80);
  // 纯前端渲染站（如 wiki.warthunder.com）的 HTML 只有菜单与页脚：
  // 抽出来的段落看着像正文，其实全是导航项，入库只会污染词库。
  const anchorCount = (html.match(/<a[\s>]/gi) ?? []).length;
  const paragraphCount = (html.match(/<p[\s>]/gi) ?? []).length;
  if (anchorCount > 80 && paragraphCount * 6 < anchorCount) {
    throw new Error('这个地址是导航页:正文由前端脚本渲染,直接抓 HTML 只能拿到菜单;请改填该站的 JSON 接口或具体词条页');
  }
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  const blocks: string[] = [];
  const pattern = /<(?:p|h[1-4]|li|dd|blockquote)[^>]*>([\s\S]*?)<\/(?:p|h[1-4]|li|dd|blockquote)>/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const text = decodeHtmlEntities(match[1]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text.length < 12) continue;
    blocks.push(text.slice(0, 600));
    if (blocks.length >= 60) break;
  }
  if (blocks.length === 0) throw new Error('网页里没有可读的段落(可能是纯脚本页或需要登录)');
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'web';
    }
  })();
  const stem = host + new URL(url, 'http://x/').pathname + '#' + String(title || 'page');
  const entries: KbEntry[] = blocks.map((text, index) => ({
    id: 'web-' + hashKey(stem + '|' + String(index)),
    kind: 'concept',
    name: (title ? title + ' · ' : '') + text.slice(0, 24),
    summary: text,
    tags: ['网页', host],
  }));
  checkKbBudget(0, entries.length, limits);
  return { version: 'web:' + host + '@' + String(entries.length), entries, skipped: 0 };
}

/** 32 位字符串散列,只用来做稳定 id。 */
export function hashKey(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z#0-9]+);/g, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .trim();
}

/**
 * 读响应体并累计"真实字节数"。
 *
 * 之前是把整段 text 读进来再比长度——`text.length` 是 UTF-16 码元数，不是字节数，
 * 一段 2.5MB 的 ASCII 只有 90 万字符，限额形同不存在；而且读完才判，脏数据已经进内存。
 * 现在边读边累加字节，超限立刻中止。
 */
async function readBodyCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const body = (res as unknown as { body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } }).body;
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader) {
    throw new Error('知识库源不支持有界响应流');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  const parts: string[] = []; let pending = '';
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try { for (;;) {
    signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
    if (chunk.done) break;
    const bytes = chunk.value ?? new Uint8Array();
    total += bytes.byteLength;
    if (total > maxBytes) {
      throw new Error('知识库源响应体超过字节上限 ' + maxBytes + '(已读 ' + total + ' 字节)');
    }
    pending += decoder.decode(bytes, { stream: true });
    if (pending.length >= 32768) { parts.push(pending); pending = ''; }
  }
  parts.push(pending + decoder.decode()); return parts.join('');
  } finally { signal.removeEventListener('abort', abort); abort(); }
}

/** 有界流拉取后，结构预检再JSON.parse；默认60秒。 */
const SITEMAP_MAX_LOCS = 500;
const SITEMAP_MAX_CHILD_MAPS = 5;
const SITEMAP_PAGE_CONCURRENCY = 4;
const SITEMAP_ASSET_RE = /\.(?:xml|jpe?g|png|gif|svg|webp|zip|gz|pdf|mp4|mp3)(?:[?#].*)?$/i;

/** 从 sitemap 或 urlset 里取出页面地址；去重、只留 http(s)、默认最多 500 条。 */
export function parseSitemapLocs(xml: string, limit = SITEMAP_MAX_LOCS): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = decodeHtmlEntities(match[1]!.trim());
    if (!/^https?:/i.test(loc)) continue;
    if (out.includes(loc)) continue;
    out.push(loc);
    if (out.length >= limit) break;
  }
  return out;
}

/** 判断响应是不是 sitemap：XML 内容类型，或以 <?xml / <sitemapindex / <urlset 开头。 */
export function isSitemapPayload(mime: string, text: string): boolean {
  if (mime.includes('xml')) return true;
  return /^\s*<(?:\?xml|sitemapindex|urlset)/i.test(text);
}

/** 有界拉取一个源，返回文本与 MIME。 */
export async function fetchSourceText(url: string, opts: FetchKbOptions, limits: KbLimits, signal: AbortSignal): Promise<{ text: string; mime: string }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const res = await fetchGuarded(url, {
    ...(opts.allowPrivate === true ? { allowPrivate: true } : {}),
    fetchImpl,
    signal,
    headers: { accept: 'application/json, text/html, application/xml;q=0.9, */*;q=0.5' },
  });
  if (!res.ok) throw new Error('知识库源返回 HTTP ' + res.status);
  signal.throwIfAborted();
  const text = await readBodyCapped(res, limits.maxBytes, signal);
  return { text, mime: (res.headers.get('content-type') || '').toLowerCase() };
}

/**
 * sitemap 源：把一个 sitemap 展开成若干页面，逐页抽段落入库。
 *
 * 文档站常有 sitemap.xml，但每一页仍是普通网页；这里只展开一层子图，
 * 页面并发 4，单页失败跳过，全空才算失败。
 */
async function fetchSitemapKb(url: string, rootText: string, opts: FetchKbOptions, limits: KbLimits): Promise<RemoteKb> {
  const maxPages = Math.min(200, Math.max(1, Math.trunc(opts.maxPages ?? 20)));
  const controller = new AbortController();
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  try {
    let locs = parseSitemapLocs(rootText);
    const nested = /<sitemapindex/i.test(rootText) || (locs.length > 0 && locs.every((loc) => /\.xml(?:[?#].*)?$/i.test(loc)));
    if (nested) {
      const merged: string[] = [];
      for (const child of locs.slice(0, SITEMAP_MAX_CHILD_MAPS)) {
        try {
          const got = await fetchSourceText(child, opts, limits, signal);
          for (const loc of parseSitemapLocs(got.text)) if (!merged.includes(loc)) merged.push(loc);
        } catch { /* 单个子图失败不影响其它 */ }
      }
      locs = merged;
    }
    const pages = locs.filter((loc) => !SITEMAP_ASSET_RE.test(loc)).slice(0, maxPages);
    if (pages.length === 0) throw new Error('sitemap 里没有可抓取的页面');
    const entries: KbEntry[] = [];
    let index = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const at = index++;
        if (at >= pages.length) return;
        const page = pages[at]!;
        try {
          const got = await fetchSourceText(page, opts, limits, signal);
          entries.push(...parseHtmlKb(got.text, page, limits).entries);
        } catch { /* 单页失败跳过 */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SITEMAP_PAGE_CONCURRENCY, pages.length) }, () => worker()));
    if (entries.length === 0) throw new Error('sitemap 各页面都没有可读段落');
    const kept = entries.slice(0, limits.maxEntries);
    checkKbBudget(0, kept.length, limits);
    const host = (() => { try { return new URL(url).host; } catch { return 'web'; } })();
    return { version: 'sitemap:' + host + '@' + String(pages.length) + '页/' + String(kept.length) + '条', entries: kept, skipped: entries.length - kept.length };
  } finally {
    clearTimeout(timer);
  }
}

/** 有界流拉取后，按内容类型分派：sitemap / 网页 / JSON；默认 60 秒。 */
export async function fetchRemoteKb(url: string, opts: FetchKbOptions = {}): Promise<RemoteKb> {
  const source = normalizeKbSource(url);
  if (!source.trim()) throw new Error('没有配置知识库源');
  const controller = new AbortController();
  const limits = resolveKbLimits(opts.limits);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  try {
    const got = await fetchSourceText(source, opts, limits, signal);
    if (isSitemapPayload(got.mime, got.text)) return fetchSitemapKb(source, got.text, opts, limits);
    if (got.mime.includes('html') || (!got.mime.includes('json') && /^\s*</.test(got.text))) {
      return parseHtmlKb(got.text, source, limits);
    }
    preflightKbJson(got.text, Buffer.byteLength(got.text, 'utf8'), limits);
    let payload: unknown;
    try {
      payload = JSON.parse(got.text);
    } catch {
      throw new Error('知识库源返回的不是 JSON');
    }
    return parseRemoteKb(payload, limits);
  } finally {
    clearTimeout(timer);
  }
}
