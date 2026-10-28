import { closeSync, mkdirSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchRemoteKb, kbPath, kbView, writeKbFile, type FetchKbOptions, type KbView } from './kb.ts';
import { resolveKbLimits } from './kb-limits.ts';

export interface KbUpdateOptions extends FetchKbOptions {
  url: string;
  fetchedAt: string;
  /** 提交前再次核对热配置与World生命周期。 */
  isCurrent: () => boolean;
}
interface Result { view: KbView; skipped: number }
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
      const remote = await fetchRemoteKb(opts.url, { ...opts, limits });
      if (!opts.isCurrent() || opts.signal?.aborted) throw new Error('知识库配置或生命周期已变化，保留旧库');
      const file = { version: remote.version, fetchedAt: opts.fetchedAt, entries: remote.entries };
      const view = kbView(file); // 合并分配成功后才允许替换磁盘文件。
      if (realpathSync(dirname(path)) !== canonicalDir) throw new Error('知识库目录在更新期间变化，保留旧库');
      writeKbFile(dataDir, file, limits);
      return { view, skipped: remote.skipped };
    } finally { closeSync(fd); unlinkSync(lock); }
  }).finally(() => { if (flights.get(key)?.promise === promise) flights.delete(key); });
  flights.set(key, { identity, promise }); return promise;
}
