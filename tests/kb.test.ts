import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KB_SEED, KB_SEED_VERSION } from '../src/kb-seed.ts';
import {
  fetchRemoteKb,
  findVehicle,
  kbCounts,
  kbPath,
  loadKb,
  mergeKb,
  parseRemoteKb,
  readKbFile,
  searchKb,
  tokenizeQuery,
  writeKbFile,
} from '../src/kb.ts';
import type { KbEntry } from '../src/kb-types.ts';
// 固定2MiB小夹具测试按字节拒绝，不因生产默认调大而分配多份64MiB字符串。
const TEST_MAX_BYTES = 2 * 1024 * 1024;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-kb-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('内置知识库', () => {
  it('种子有 53 条,分车/概念/玩法三类', () => {
    expect(KB_SEED.length).toBe(53);
    const counts = kbCounts(KB_SEED);
    expect(counts.vehicle).toBe(20);
    expect(counts.concept).toBe(23);
    expect(counts.play).toBe(10);
    expect(counts.total).toBe(53);
  });

  it('每条都有 id / 名称 / 摘要,载具都带战斗评级', () => {
    for (const entry of KB_SEED) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(10);
      if (entry.kind === 'vehicle') expect(entry.br, entry.id).toBeTruthy();
    }
  });
});

describe('检索', () => {
  it('用别名也能拉到载具,排在最前', () => {
    const hits = searchKb(KB_SEED, '野马', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe('veh-p51d30');
  });

  it('中文整串与 2-gram 都会进分词', () => {
    const tokens = tokenizeQuery('空战历史');
    expect(tokens).toContain('空战历史');
    expect(tokens).toContain('空战');
    expect(tokens).toContain('历史');
  });

  it('英文按词切,不做 2-gram', () => {
    expect(tokenizeQuery('Mustang br')).toEqual(['mustang', 'br']);
  });

  it('空查询与纯空白返回空结果', () => {
    expect(searchKb(KB_SEED, '   ', 5)).toEqual([]);
  });

  it('limit 生效,默认上限不会超过条目总数', () => {
    const hits = searchKb(KB_SEED, '战斗机', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    const all = searchKb(KB_SEED, '战斗机', 99);
    expect(all.length).toBeGreaterThan(2);
  });

  it('找不到就返回空数组,不抛错', () => {
    expect(searchKb(KB_SEED, 'zzzzqqqq', 5)).toEqual([]);
  });

  it('findVehicle 认全名与别名,未知返回 null', () => {
    expect(findVehicle(KB_SEED, 'P-51D-30 野马')?.id).toBe('veh-p51d30');
    expect(findVehicle(KB_SEED, 'Mustang')?.id).toBe('veh-p51d30');
    expect(findVehicle(KB_SEED, '多拉')?.id).toBe('veh-fw190d9');
    expect(findVehicle(KB_SEED, '不存在的东西')).toBeNull();
    expect(findVehicle(KB_SEED, '   ')).toBeNull();
  });

  it('findVehicle 不会把概念词条当成载具', () => {
    const concept = KB_SEED.find((entry) => entry.kind === 'concept');
    expect(concept).toBeTruthy();
    const found = findVehicle(KB_SEED, concept!.name);
    if (found) expect(found.kind).toBe('vehicle');
  });
});

describe('远程知识库', () => {
  const good: KbEntry = { id: 'veh-custom', kind: 'vehicle', name: '自定义载具', summary: '远程补进来的示例词条,用来验证合并顺序与覆盖。', br: 'RB 1.0' };

  it('合法载荷解析出条目,skipped 为 0', () => {
    const remote = parseRemoteKb({ version: '2.0.0', entries: [good] });
    expect(remote.version).toBe('2.0.0');
    expect(remote.entries.length).toBe(1);
    expect(remote.entries[0].name).toBe('自定义载具');
    expect(remote.skipped).toBe(0);
  });

  it('坏条目跳过并计数,好条目保留', () => {
    const remote = parseRemoteKb({ version: '2.0.0', entries: [good, { id: 'x' }, null, { id: 'y', kind: 'nope', name: 'n', summary: 's' }] });
    expect(remote.entries.length).toBe(1);
    expect(remote.skipped).toBe(3);
  });

  it('缺 version / 缺 entries / 全非法都报错', () => {
    expect(() => parseRemoteKb({ entries: [good] })).toThrow();
    expect(() => parseRemoteKb({ version: '2.0.0' })).toThrow();
    expect(() => parseRemoteKb({ version: '2.0.0', entries: [{ id: 'x' }] })).toThrow();
    expect(() => parseRemoteKb(null)).toThrow();
  });

  it('远程同 id 覆盖内置,新 id 追加', () => {
    const patched: KbEntry = { id: 'veh-p51d30', kind: 'vehicle', name: 'P-51D-30 野马', summary: '远程改过的摘要。', br: 'RB 5.3' };
    const merged = mergeKb([patched, good]);
    const hits = merged.filter((entry) => entry.id === 'veh-p51d30');
    expect(hits.length).toBe(1);
    expect(hits[0].summary).toBe('远程改过的摘要。');
    expect(merged.some((entry) => entry.id === 'veh-custom')).toBe(true);
  });

  it('落盘后 loadKb 换成远程版本,远程为空时仍用种子', () => {
    const before = loadKb(dir);
    expect(before.version).toBe(KB_SEED_VERSION);
    expect(before.remoteVersion).toBeNull();

    writeKbFile(dir, { version: '3.1.0', fetchedAt: '2026-10-27T02:00:00.000Z', entries: [good] });
    const after = loadKb(dir);
    expect(after.version).toBe('3.1.0');
    expect(after.remoteVersion).toBe('3.1.0');
    expect(after.remoteCount).toBe(1);
    expect(after.entries.some((entry) => entry.id === 'veh-custom')).toBe(true);
    expect(after.entries.length).toBe(KB_SEED.length + 1);
    expect(readKbFile(dir)?.fetchedAt).toBe('2026-10-27T02:00:00.000Z');
  });

  it('落盘的 JSON 坏掉时当没有远程库,不抛错', () => {
    const target = kbPath(dir);
    mkdirSync(join(dir, 'wt'), { recursive: true });
    writeFileSync(target, '{ 这不是 JSON', 'utf8');
    expect(readKbFile(dir)).toBeNull();
    expect(loadKb(dir).version).toBe(KB_SEED_VERSION);
  });

  it('fetchRemoteKb 成功取回,HTTP 报错、非 JSON、超大响应都抛错', async () => {
    const ok = (async () => new Response(JSON.stringify({ version: '9.9.9', entries: [good] }))) as typeof globalThis.fetch;
    const loaded = await fetchRemoteKb('https://example.com/kb.json', { fetchImpl: ok });
    expect(loaded.version).toBe('9.9.9');

    const bad = (async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof globalThis.fetch;
    await expect(fetchRemoteKb('https://example.com/kb.json', { fetchImpl: bad })).rejects.toThrow('HTTP 503');

    const notJson = (async () => new Response('hello')) as typeof globalThis.fetch;
    await expect(fetchRemoteKb('https://example.com/kb.json', { fetchImpl: notJson })).rejects.toThrow('不是 JSON');

    const huge = 'x'.repeat(TEST_MAX_BYTES + 10);
    const big = (async () => new Response(huge)) as typeof globalThis.fetch;
    await expect(fetchRemoteKb('https://example.com/kb.json', { fetchImpl: big, limits: { maxBytes: TEST_MAX_BYTES } })).rejects.toThrow('字节上限 2097152');

    await expect(fetchRemoteKb('   ', { fetchImpl: ok })).rejects.toThrow();
  });
});

describe('知识库源的重定向与限额', () => {
  it('重定向到内网的那一跳会被拒绝', async () => {
    const fake = (async () => ({
      ok: false,
      status: 302,
      headers: { get: () => 'http://127.0.0.1:9200/kb.json' },
      text: async () => '',
    })) as unknown as typeof globalThis.fetch;
    await expect(fetchRemoteKb('https://example.com/kb.json', { fetchImpl: fake })).rejects.toThrow('内网');
  });

  it('限额按真实字节算,不是按 JS 字符数', async () => {
    // 2.1MB 的纯 ASCII 只有约 73 万字符，旧实现用 text.length 判会直接放行。
    const huge = '汉'.repeat(Math.floor(TEST_MAX_BYTES / 3) + 4096);
    const fake = (async () => new Response(huge)) as typeof globalThis.fetch;
    await expect(fetchRemoteKb('https://example.com/kb.json', { fetchImpl: fake, limits: { maxBytes: TEST_MAX_BYTES } })).rejects.toThrow('字节上限 2097152');
  });
});
