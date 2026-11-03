import { closeSync, mkdirSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchRemoteKb, kbPath, kbView, readKbFile, writeKbFile, type FetchKbOptions, type KbView } from './kb.ts';
import { resolveKbLimits } from './kb-limits.ts';
import { normalizeKbSource } from './guard.ts';

/**
 * 知识库源支持一次填多个：逗号、分号、空白或换行分隔，按顺序尝试，第一个成功即用。
 *
 * 国内直连 raw.githubusercontent 常被重置、jsDelivr 时通时断；把 gh-proxy 前缀放在
 * 第一个、原始地址放第二个，就能在一个源走不通时自动落到另一个。
 */
export function splitKbSources(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\s,，;；]+/)) {
    const item = part.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

export interface KbUpdateOptions extends FetchKbOptions {
  url: string;
  fetchedAt: string;
  /** 提交前再次核对热配置与World生命周期。 */
  isCurrent: () => boolean;
}
interface Result { view: KbView; skipped: number; via: string }
const flights = new Map<string, { identity: string; promise: Promise<Result> }>();

/** 所有入口共用同一物理路径的单飞；锁跨进程，失败不删除他人锁或旧库。 */
export function updateKbTransaction(dataDir: string, opts: KbUpdateOptions): Promise<Result> {
  const path = kbPath(dataDir); mkdirSync(dirname(path), { recursive: true });
  const canonicalDir = realpathSync(dirname(path));
  const canonical = join(canonicalDir, 'kb.json');
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const limits = resolveKbLimits(opts.limits);
  const identity = JSON.stringify([opts.url, opts.allowPrivate === true, limits]);
  const existing = flights.get(key);
  if (existing) {
    if (existing.identity !== identity) return Promise.reject(new Error('知识库更新正忙，请等待原事务结束后重试'));
    return existing.promise;
  }
  // 让map先登记，再启动异步事务，避免同步失败留下悬挂身份。
  const promise = Promise.resolve().then(async () => {
    const lock = canonical + '.lock'; let fd: number;
    try { fd = openSync(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('知识库更新锁被占用；确认无更新进程后再人工清理残留锁');
      throw error;
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      if (!opts.isCurrent() || opts.signal?.aborted) throw new Error('知识库配置或生命周期已变化，取消更新');
      // 多个源按顺序试：一个被墙或 404 就换下一个，全挂才报错。
      const sources = splitKbSources(opts.url);
      if (sources.length === 0) throw new Error('没有可用的知识库源');
      const attempts: string[] = [];
      let remote: Awaited<ReturnType<typeof fetchRemoteKb>> | null = null;
      let via = '';
      for (const source of sources) {
        // 手填 wiki.warthunder.com 这类写法在这里补成 https 地址，随后交给 fetchGuarded 再校验。
        const clean = normalizeKbSource(source);
        const startedAt = Date.now();
        try {
          remote = await fetchRemoteKb(clean, { ...opts, limits });
          via = clean;
          attempts.push(clean + ' 成功(' + (Date.now() - startedAt) + 'ms)');
          break;
        } catch (error) {
          attempts.push(clean + ' 失败(' + (Date.now() - startedAt) + 'ms):' + (error instanceof Error ? error.message : String(error)));
          if (!opts.isCurrent() || opts.signal?.aborted) break;
        }
      }
      if (!remote) throw new Error('所有知识库源都不可用 → ' + attempts.join('；'));
      if (!opts.isCurrent() || opts.signal?.aborted) throw new Error('知识库配置或生命周期已变化，保留旧库');
      // 玩家用 wt_kb_ingest 整理进来的词条（id 以 ing- 开头）是本地资产：
      // 远程更新只刷新远程来源，不能把本地整理的词条冲掉；同名的以本地为准。
      const keyOf = (entry: { kind: string; name: string }): string => entry.kind + '|' + entry.name.replace(/[\s\u3000]+/g, '').toLowerCase();
      const local = (readKbFile(dataDir, limits)?.entries ?? []).filter((entry) => entry.id.startsWith('ing-'));
      const localKeys = new Set(local.map(keyOf));
      const entries = [...remote.entries.filter((entry) => !localKeys.has(keyOf(entry))), ...local];
      const file = { version: remote.version, fetchedAt: opts.fetchedAt, entries };
      const view = kbView(file); // 合并分配成功后才允许替换磁盘文件。
      if (realpathSync(dirname(path)) !== canonicalDir) throw new Error('知识库目录在更新期间变化，保留旧库');
      writeKbFile(dataDir, file, limits);
      return { view, skipped: remote.skipped, via };
    } finally { closeSync(fd); unlinkSync(lock); }
  }).finally(() => { if (flights.get(key)?.promise === promise) flights.delete(key); });
  flights.set(key, { identity, promise }); return promise;
}
