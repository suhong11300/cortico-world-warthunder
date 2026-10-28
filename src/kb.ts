import { mkdirSync, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fetchGuarded } from './guard.ts';
import { join } from 'node:path';
import { KB_SEED, KB_SEED_VERSION } from './kb-seed.ts';
import type { KbEntry, KbKind } from './kb-types.ts';
import { resolveKbLimits, checkKbBudget, preflightKbJson, type KbLimitInput } from './kb-limits.ts';
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
  const byId = new Map<string, KbEntry>();
  for (const entry of KB_SEED) byId.set(entry.id, entry);
  for (const entry of remote) byId.set(entry.id, entry);
  return [...byId.values()];
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
export async function fetchRemoteKb(url: string, opts: FetchKbOptions = {}): Promise<RemoteKb> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!url.trim()) throw new Error('没有配置知识库源');
  const controller = new AbortController();
  const limits = resolveKbLimits(opts.limits);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60000);
  try {
    // 走带闸门的 fetch:每一跳重定向都重新校验协议、私网与 DNS 解析结果。
    const res = await fetchGuarded(url, {
      ...(opts.allowPrivate === true ? { allowPrivate: true } : {}),
      fetchImpl,
      signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error('知识库源返回 HTTP ' + res.status);
    signal.throwIfAborted();
    const text = await readBodyCapped(res, limits.maxBytes, signal);
    // 先拒绝高复杂度载荷，避免JSON.parse展开巨型嵌套数组。
    preflightKbJson(text, Buffer.byteLength(text, 'utf8'), limits);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('知识库源返回的不是 JSON');
    }
    return parseRemoteKb(payload, limits);
  } finally {
    clearTimeout(timer);
  }
}
