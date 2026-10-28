import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kb from '../src/kb.ts';
import { WT_DEFAULTS, WT_CONFIG_GROUP } from '../src/config.ts';
import { WtWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
const MiB = 1024 * 1024;
const dirs: string[] = [], worlds: WtWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.stop(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const directory = () => { const d = mkdtempSync(join(tmpdir(), 'wt-persona-capacity-')); dirs.push(d); return d; };
const entry = (n = 1) => ({ id: 'entry-' + n, kind: 'concept', name: '词条' + n, summary: '可检索的知识摘要' });
function response(payload: unknown) { return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }); }
const getKb = (payload: unknown, options: any = {}) => kb.fetchRemoteKb('http://127.0.0.1:18999/kb.json', { allowPrivate: true, fetchImpl: async () => response(payload), ...options });
function rig(autoBrief: boolean, speechStyle: string) {
  const cfg = { ...WT_DEFAULTS, autoBrief, speechStyle, llmMode: 'host', kbUrl: '', pollMs: 30000 } as any;
  const dir = directory();
  const routes: any = { '/state': { valid: true, map_valid: true, vehicle_type: 'fixture-plane' }, '/indicators': { valid: true, type: 'fixture-plane', speed: 100 }, '/mission.json': { status: 'running' }, '/map_info.json': { valid: true }, '/map_obj.json': [], '/hudmsg': { events: [], damage: [] } };
  const fetchImpl: typeof fetch = async input => response(routes[new URL(String(input)).pathname] ?? {});
  const world = new WtWorld({ cfg, dataDir: dir, timezone: 'Asia/Shanghai', fetchImpl }); worlds.push(world);
  const host = new FakeHost();
  return { cfg, dir, world, host, routes, fetchImpl, call: async (name: string, args = {}) => String(await world.tools().find(t => t.name === name)!.handler(args, {} as any)) };
}
describe('自动/手动 × 人格/模板', () => {
  it.each([[true, '人格'], [true, '模板'], [false, '人格'], [false, '模板']])('自动=%s 风格=%s，自动与手动遵守同一表达选择', async (automatic, style) => {
    const r = rig(automatic as boolean, style as string); await r.world.start(r.host);
    const snapshot = { vehicle: 'fixture-plane', speed: 0, altitude: 0, army: '', mode: '', enemies: 0, allies: 0 };
    r.host.events.length = 0;
    await (r.world as any).handleBattleEvent({ kind: 'kill', total: 4, streak: 2, detail: 'Ace destroyed Bob', snapshot });
    const kills = r.host.events.filter(e => e.type === 'wt.kill'); expect(kills.length).toBe(automatic ? 1 : 0);
    if (automatic) { expect(kills[0].text).toContain(style === '人格' ? '表达模式：人格' : '表达模式：模板'); expect(kills[0].text).toContain('本局第 4 个击毁'); }
    const manual = await r.call('wt_commentary'); expect(manual).toContain(style === '人格' ? '表达模式：人格' : '表达模式：模板');
    const status = await r.call('wt_status'); expect(status).toContain((automatic ? '自动' : '手动') + '＋' + style);
  });
  it('人格默认可选、可见上下文中有请求，不靠metadata也不要求插件后台cognition', async () => {
    const prop = WT_CONFIG_GROUP.schema.properties['worlds.wt.speechStyle'];
    expect(prop?.enum).toEqual(['人格', '模板']); expect((WT_DEFAULTS as any).speechStyle).toBe('人格');
    const r = rig(false, '人格'); await r.world.start(r.host);
    expect(r.world.envPromptVars()['wt.speech']).toContain('人格');
    expect(await r.call('wt_commentary')).toContain('现有Persona');
    expect(await r.call('wt_status')).toContain('主对话');
  });
  it('人格上下文不再以“不机械复读”暗示改写事实；原始仪表不推断运动状态', async () => {
    const r = rig(false, '人格'); await r.world.start(r.host);
    expect(r.world.envPromptVars()['wt.speech']).not.toContain('不机械复读');
    const output = await r.call('wt_commentary');
    expect(output).toContain('逐字'); expect(output).toContain('不省略'); expect(output).toContain('停止');
  });
  it('事实块字节保留，不为人格播报调用第二个模型', async () => {
    const r = rig(true, '人格'); let calls = 0;
    (r.host as any).cognition = { request: async () => { calls++; return { text: '速度300km/h，这局赢啦！' }; } };
    await r.world.start(r.host); r.host.events.length = 0;
    await (r.world as any).handleBattleEvent({ kind: 'kill', total: 4, streak: 2, detail: 'Ace destroyed Bob', snapshot: { vehicle: '', speed: 0, altitude: 0, army: '', mode: '', enemies: 0, allies: 0 } });
    const e = r.host.events.find(e => e.type === 'wt.kill')!;
    expect(e.text).toContain('【事实开始】\n' + e.meta?.factText + '\n【事实结束】');
    expect(e.text).not.toContain('这局赢啦'); expect(calls).toBe(0);
  });
  it('外部HUD不被改成internal，也不包可信人格操作', async () => {
    const r = rig(true, '人格'); await r.world.start(r.host); r.host.events.length = 0;
    await (r.world as any).handleBattleEvent({ kind: 'hud', detail: '占领了战区A' });
    expect(r.host.events[0].origin).toBe('external'); expect(r.host.events[0].text).not.toContain('表达模式');
  });
  it('llmMode=off仅关闭插件后台，不把主对话人格说成模板失效', async () => {
    const r = rig(false, '人格'); r.cfg.llmMode = 'off'; await r.world.start(r.host);
    const status = await r.call('wt_status'); expect(status).not.toContain('播报、解说与翻译都用固定模板'); expect(status).toContain('主对话Persona');
  });
  it('手动战局状态回执遵守热改风格，不只依赖旧ENV前缀', async () => {
    const r = rig(false, '人格'); await r.world.start(r.host);
    expect(await r.call('wt_battle_state')).toContain('表达模式：人格'); r.cfg.speechStyle = '模板';
    expect(await r.call('wt_battle_state')).toContain('表达模式：模板');
  });
});
describe('大知识库的容量与估算预算', () => {
  it('面板提供可调容量而不是修改全局Node堆', () => {
    for (const [key, def, max] of [['kbMaxDownloadMiB', 64, 256], ['kbMaxEntries', 100000, 500000], ['kbUpdateMemoryMiB', 512, 2048]] as const) {
      expect((WT_DEFAULTS as any)[key]).toBe(def);
      expect(WT_CONFIG_GROUP.schema.properties['worlds.wt.' + key]?.maximum).toBe(max);
    }
  });
  it('默认64MiB、100000条、512MiB预算；越界设置有硬上界', () => {
    expect(kb.KB_MAX_BYTES).toBe(64 * MiB); expect((kb as any).KB_MAX_ENTRIES).toBe(100000);
    expect(typeof (kb as any).resolveKbLimits).toBe('function');
    const limits = (kb as any).resolveKbLimits(); expect(limits.memoryBudgetBytes).toBe(512 * MiB);
    const large = (kb as any).resolveKbLimits({ maxBytes: Infinity, maxEntries: 99999999, memoryBudgetBytes: 99999 * MiB });
    expect(large.maxBytes).toBeLessThanOrEqual(256 * MiB); expect(large.maxEntries).toBeLessThanOrEqual(500000); expect(large.memoryBudgetBytes).toBeLessThanOrEqual(2048 * MiB);
  });
  it('2001条不再撞旧2000条上限', async () => {
    const result = await getKb({ version: 'larger', entries: Array.from({ length: 2001 }, (_, i) => entry(i)) }); expect(result.entries.length).toBe(2001);
  });
  it('调用者的条目上限生效，不仅改默认常量', async () => {
    await expect(getKb({ version: 'limited', entries: [entry(1), entry(2)] }, { limits: { maxEntries: 1 } })).rejects.toThrow(/条|上限/);
  });
  it('内存预算限制有效响应大小，不允许只改下载上限绕过', async () => {
    const payload = { version: 'budget', entries: [entry()], padding: 'x'.repeat(200000) };
    await expect(getKb(payload, { limits: { maxBytes: 64 * MiB, memoryBudgetBytes: MiB } })).rejects.toThrow(/预算|上限/);
  });
  it('本地文件读取也先受限，而不是无界readFile再检查', () => {
    const d = directory(); mkdirSync(join(d, 'wt')); writeFileSync(kb.kbPath(d), JSON.stringify({ version: 'disk', fetchedAt: '', entries: [entry()] }));
    expect((kb.readKbFile as any)(d, { maxBytes: 32 })).toBeNull();
    const view = (kb.loadKb as any)(d, { maxBytes: 32 }); expect(view.loadError).toMatch(/上限|超过/);
  });
  it('超限写入保持旧文件字节', () => {
    const d = directory(); kb.writeKbFile(d, { version: 'old', fetchedAt: '', entries: [entry()] } as any); const before = readFileSync(kb.kbPath(d));
    expect(() => (kb.writeKbFile as any)(d, { version: 'too-big', fetchedAt: '', entries: [entry(), entry(2)] }, { maxBytes: 64 })).toThrow();
    expect(readFileSync(kb.kbPath(d))).toEqual(before);
  });
  it('巨型嵌套数组在JSON.parse之前受限，不先展开aliases/tags', async () => {
    const spy = vi.spyOn(JSON, 'parse');
    try {
      await expect(getKb({ version: 'nested', entries: [{ ...entry(), aliases: Array(10000).fill('alias') }] })).rejects.toThrow(/数组|复杂|上限/);
      expect(spy.mock.calls.some(args => String(args[0]).includes('"aliases":['))).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it('不支持有界流的响应失败关闭，不使用res.text先分配大库', async () => {
    const fake = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: 'x', entries: [entry()] }) })) as any;
    await expect(kb.fetchRemoteKb('http://127.0.0.1:18999/kb.json', { allowPrivate: true, fetchImpl: fake })).rejects.toThrow(/流|有界/);
  });
  it('小文件中的未知对象树也计入预算，在JSON.parse前拒绝对象膨胀', async () => {
    const leaf = Array.from({ length: 128 }, () => ({}));
    const tree = Array.from({ length: 100 }, () => Array.from({ length: 128 }, () => leaf));
    await expect(getKb({ version: 'object-explosion', entries: [entry()], padding: tree }, { limits: { memoryBudgetBytes: 64 * MiB } })).rejects.toThrow(/预算|复杂|上限/);
  });
});

describe('知识库事务与热配置', () => {
  function updateRig() { const r = rig(false, '人格'); r.cfg.kbUrl = 'http://127.0.0.1:18999/kb.json'; r.cfg.kbAllowPrivate = true; r.cfg.kbAutoUpdateHours = 0; return r; }
  it('同一路径的并发手动更新只下载一次，并共享已提交结果', async () => {
    const r = updateRig(); await r.world.start(r.host);
    let done!: (r: Response) => void; const gate = new Promise<Response>(resolve => { done = resolve; }); let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return gate; });
    const a = r.call('wt_kb_update', { force: true }), b = r.call('wt_kb_update', { force: true });
    await new Promise(resolve => setTimeout(resolve, 10)); done(response({ version: 'shared', entries: [entry()] }));
    expect(await a).toContain('更新到 vshared'); expect(await b).toContain('更新到 vshared'); expect(calls).toBe(1);
    expect(kb.readKbFile(r.dir)?.version).toBe('shared');
  });
  it.each(['source', 'limits', 'stop'])('%s在下载期间变化时不提交旧候选，旧库保留', async change => {
    const r = updateRig(); kb.writeKbFile(r.dir, { version: 'old', fetchedAt: '', entries: [entry()] } as any); await r.world.start(r.host);
    let done!: (r: Response) => void; const gate = new Promise<Response>(resolve => { done = resolve; }); vi.stubGlobal('fetch', () => gate);
    const pending = r.call('wt_kb_update', { force: true }); await new Promise(resolve => setTimeout(resolve, 10));
    if (change === 'source') r.cfg.kbUrl += '?new'; if (change === 'limits') r.cfg.kbMaxEntries = 1; if (change === 'stop') await r.world.stop();
    done(response({ version: 'new', entries: [entry(), entry(2)] })); expect(await pending).not.toContain('更新到 vnew');
    expect(kb.readKbFile(r.dir)?.version).toBe('old');
  });
  it('跨进程锁存在时不下载、不破坏旧库与他人锁', async () => {
    const r = updateRig(); kb.writeKbFile(r.dir, { version: 'old', fetchedAt: '', entries: [entry()] } as any); await r.world.start(r.host);
    const lock = kb.kbPath(r.dir) + '.lock'; writeFileSync(lock, 'other-process'); let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return response({ version: 'new', entries: [entry()] }); });
    expect(await r.call('wt_kb_update', { force: true })).toMatch(/忙|占用|锁/); expect(calls).toBe(0);
    expect(readFileSync(lock, 'utf8')).toBe('other-process'); expect(kb.readKbFile(r.dir)?.version).toBe('old');
  });
  it('同物理目录的两个World实例共享同一事务', async () => {
    const r = updateRig(); await r.world.start(r.host);
    const second = new WtWorld({ cfg: { ...r.cfg }, dataDir: r.dir, timezone: 'Asia/Shanghai', fetchImpl: r.fetchImpl }); worlds.push(second); await second.start(new FakeHost());
    let done!: (r: Response) => void; const gate = new Promise<Response>(resolve => { done = resolve; }); let calls = 0;
    vi.stubGlobal('fetch', () => { calls++; return gate; });
    const a = r.call('wt_kb_update', { force: true });
    const b = second.tools().find(t => t.name === 'wt_kb_update')!.handler({ force: true }, {} as any);
    await new Promise(resolve => setTimeout(resolve, 10)); done(response({ version: 'two-worlds', entries: [entry()] }));
    expect(await a).toContain('更新到 vtwo-worlds'); expect(await b).toContain('更新到 vtwo-worlds'); expect(calls).toBe(1);
  });
  it('启动更新和手动更新共用一次下载', async () => {
    const r = updateRig(); r.cfg.kbAutoUpdateHours = 24;
    let done!: (r: Response) => void; const gate = new Promise<Response>(resolve => { done = resolve; }); let calls = 0;
    vi.stubGlobal('fetch', () => { calls++; return gate; });
    await r.world.start(r.host); const manual = r.call('wt_kb_update', { force: true });
    await new Promise(resolve => setTimeout(resolve, 10)); done(response({ version: 'startup', entries: [entry()] }));
    expect(await manual).toContain('更新到 vstartup'); expect(calls).toBe(1);
  });
});
