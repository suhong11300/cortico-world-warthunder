import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { WT_DEFAULTS, type WtConfigSection } from '../src/config.ts';
import { WT } from '../src/definition.ts';
import { WtWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: Array<{ id: number; msg?: string }>; damage: Array<{ id: number; msg?: string }> };
  map?: unknown[];
  chat?: Array<{ id: number; msg?: string; sender?: string; enemy?: boolean; mode?: string }>;
  broken?: boolean;
}

/** 8111 的假服务:按 lastEvt / lastDmg 真过滤,和真接口语义一致。 */
function fakeFetch(read: () => Routes, capture?: string[]): typeof globalThis.fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (capture) capture.push(url);
    const routes = read();
    if (routes.broken) return { ok: false, status: 500, text: async () => 'boom' };
    let body: unknown = {};
    if (url.includes('/hudmsg')) {
      const evt = Number((url.match(/lastEvt=(-?\d+)/) ?? [])[1] ?? -1);
      const dmg = Number((url.match(/lastDmg=(-?\d+)/) ?? [])[1] ?? -1);
      const hud = routes.hud ?? { events: [], damage: [] };
      body = { events: hud.events.filter((item) => item.id > evt), damage: hud.damage.filter((item) => item.id > dmg) };
    } else if (url.includes('/gamechat')) {
      const cursor = Number((url.match(/lastId=(-?\d+)/) ?? [])[1] ?? 0);
      body = (routes.chat ?? []).filter((item) => item.id > cursor);
    } else if (url.includes('/state')) {
      body = routes.state ?? {};
    } else if (url.includes('/indicators')) {
      body = routes.indicators ?? {};
    } else if (url.includes('/map_obj.json')) {
      body = routes.map ?? [];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }) as unknown as typeof globalThis.fetch;
}

/** 假 spawn:记录调用,可选在 close 前用 args 造出脚本本该产出的文件。 */
type SpawnPlan = { out?: string; err?: string; code?: number; onSpawn?: (args: string[]) => void };
function fakeSpawn(plan: SpawnPlan) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const impl = ((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => undefined;
    calls.push({ cmd, args });
    setImmediate(() => {
      if (plan.onSpawn) plan.onSpawn(args);
      if (plan.out) stdout.emit('data', plan.out);
      if (plan.err) stderr.emit('data', plan.err);
      child.emit('close', plan.code ?? 0);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { impl, calls };
}
const inBattle = { valid: true, map_valid: true, vehicle_type: 'P-51D-30', game_mode: 'domination', army: 'usa' };
const inMenu = { valid: true, map_valid: false, vehicle_type: '', game_mode: '', army: '' };
const flying = { valid: true, speed: 480, altitude: 2100, type: 'P-51D-30' };

let scratchDir: string;
const dirs: string[] = [];
beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'wt-scratch-'));
});
afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Rig {
  world: WtWorld;
  host: FakeHost & { cognition?: { request: (req: { brief: string }) => Promise<{ text: string } | { error: string }> } };
  cfg: WtConfigSection;
}

function rig(
  patch: Partial<WtConfigSection> = {},
  read: () => Routes = () => ({}),
  capture?: string[],
  spawnImpl?: typeof import('node:child_process').spawn,
): Rig {
  const dataDir = mkdtempSync(join(tmpdir(), 'wt-data-'));
  dirs.push(dataDir);
  const cfg: WtConfigSection = { ...WT_DEFAULTS, ...patch };
  const world = new WtWorld({
    cfg,
    timezone: 'Asia/Shanghai',
    dataDir,
    now: () => 100_000,
    fetchImpl: fakeFetch(read, capture),
    ...(spawnImpl ? { spawnImpl } : {}),
  });
  const host = new FakeHost() as Rig['host'];
  return { world, host, cfg };
}

async function boot(
  patch: Partial<WtConfigSection> = {},
  read: () => Routes = () => ({}),
  capture?: string[],
  spawnImpl?: typeof import('node:child_process').spawn,
): Promise<Rig> {
  const rigged = rig(patch, read, capture, spawnImpl);
  await rigged.world.start(rigged.host);
  return rigged;
}

async function pollOnce(world: WtWorld): Promise<void> {
  await (world as unknown as { pollOnce(): Promise<void> }).pollOnce();
}

async function call(world: WtWorld, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = world.tools().find((item) => item.name === name);
  if (!tool) throw new Error('缺工具:' + name);
  return String(await tool.handler(args, { role: 'test', log: nullLogger() } as unknown as ToolCallContext));
}

describe('装配契约', () => {
  it('干装载没有失败项,也没有 enabled 约定警告', async () => {
    const report = await dryMountWorld(WT, { scratchDir });
    expect(report.failures).toEqual([]);
    expect(report.warnings.filter((line) => line.includes('enabled is not false'))).toEqual([]);
  });

  it('id 与十一个工具名都对得上', async () => {
    const { world } = rig();
    expect(world.id).toBe('wt');
    expect(world.tools().map((tool) => tool.name)).toEqual([
      'wt_status',
      'wt_search',
      'wt_vehicle',
      'wt_kb_status',
      'wt_kb_update',
      'wt_battle_state',
      'wt_commentary',
      'wt_chat',
      'wt_say',
      'wt_vision_probe',
      'wt_budget',
    ]);
  });

  it('默认值是禁用总闸、但自动播报开着,端口走 8111', () => {
    expect(WT_DEFAULTS.enabled).toBe(false);
    expect(WT_DEFAULTS.autoBrief).toBe(true);
    expect(WT_DEFAULTS.gamePort).toBe(8111);
    expect(WT_DEFAULTS.gameHost).toBe('127.0.0.1');
  });

  it('环境段给出九个占位符', async () => {
    const { world } = await boot();
    const vars = world.envPromptVars() ?? {};
    expect(Object.keys(vars).sort()).toEqual(['wt.battle', 'wt.budget', 'wt.chat', 'wt.kb', 'wt.now', 'wt.source', 'wt.status', 'wt.vehicle', 'wt.zone']);
    expect(vars['wt.status']).toBe('遥测离线');
    expect(vars['wt.kb']).toContain('53 条');
    await world.stop();
  });

  it('WebUI 挂上自己的配置组与提示词文档', async () => {
    const { world } = await boot();
    const ui = world.webUi();
    expect(ui.label).toBe('war thunder安东星助手');
    expect(ui.config?.[0].owner).toBe('world:wt');
    expect(ui.config?.[0].id).toBe('world:wt');
    expect(ui.promptDocs?.[0].key).toBe('worlds.wt.envPrompt');
    expect(ui.promptDocs?.[0].role).toBe('envPrompt');
    await world.stop();
  });
});

describe('挂载与播报', () => {
  it('挂载即投一条就绪事件', async () => {
    const { world, host } = await boot();
    expect(host.events.length).toBe(1);
    expect(host.events[0].type).toBe('wt.ready');
    expect(host.events[0].origin).toBe('internal');
    expect(host.pushOpts[0]).toEqual({ trigger: 'flush' });
    await world.stop();
  });

  it('进战局推 battle_started 并带上载具', async () => {
    const routes: Routes = { state: inBattle, indicators: flying };
    const { world, host } = await boot({}, () => routes);
    await pollOnce(world);
    expect(host.events.map((event) => event.type)).toEqual(['wt.ready', 'wt.battle_started']);
    expect((host.events[1] as { meta?: Record<string, unknown> }).meta?.vehicle).toBe('P-51D-30');
    await world.stop();
  });

  it('击毁推 kill,阵亡推 death', async () => {
    const routes: Routes = { state: inBattle, indicators: flying, hud: { events: [], damage: [] } };
    const { world, host } = await boot({}, () => routes);
    await pollOnce(world);

    routes.hud = { events: [], damage: [{ id: 3, msg: 'destroyed T-34' }] };
    await pollOnce(world);
    expect(host.events.at(-1)?.type).toBe('wt.kill');

    routes.indicators = { valid: false, speed: 0, altitude: 0, type: 'P-51D-30' };
    await pollOnce(world);
    expect(host.events.at(-1)?.type).toBe('wt.death');
    await world.stop();
  });

  it('关掉自动播报后只留就绪事件', async () => {
    const routes: Routes = { state: inBattle, indicators: flying };
    const { world, host } = await boot({ autoBrief: false }, () => routes);
    await pollOnce(world);
    expect(host.events.map((event) => event.type)).toEqual(['wt.ready']);
    await world.stop();
  });

  it('宿主有人格通道时播报文案走它,数字仍在素材里', async () => {
    const routes: Routes = { state: inBattle, indicators: flying };
    const { world, host } = await boot({}, () => routes);
    let brief = '';
    host.cognition = {
      request: async (req) => {
        brief = req.brief;
        return { text: '稳住，狗斗别丢能量。' };
      },
    };
    await pollOnce(world);
    expect(host.events.at(-1)?.text).toBe('稳住，狗斗别丢能量。');
    expect(brief).toContain('数字一个都不要改');
    await world.stop();
  });

  it('人格通道报错时退回模板文案,照样播', async () => {
    const routes: Routes = { state: inBattle, indicators: flying };
    const { world, host } = await boot({}, () => routes);
    host.cognition = { request: async () => ({ error: '人格没启用' }) };
    await pollOnce(world);
    const text = host.events.at(-1)?.text ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe('人格没启用');
    expect(host.events.at(-1)?.type).toBe('wt.battle_started');
    await world.stop();
  });
});

describe('工具', () => {
  it('wt_status 报出遥测、知识库与额度', async () => {
    const { world } = await boot();
    const text = await call(world, 'wt_status');
    expect(text).toContain('战争雷霆百科');
    expect(text).toContain('8111');
    expect(text).toContain('知识库:v1.0.0');
    expect(text).toContain('预算');
    await world.stop();
  });

  it('wt_status 在遥测断开后直说没连上', async () => {
    const { world } = await boot({}, () => ({ broken: true }));
    await pollOnce(world);
    const text = await call(world, 'wt_status');
    expect(text).toContain('没连上');
    expect(text).toContain('不在战局');
    await world.stop();
  });

  it('wt_search 能检索到野马,也能回答没找到', async () => {
    const { world } = await boot();
    const hit = await call(world, 'wt_search', { query: '野马' });
    expect(hit).toContain('P-51D-30 野马');
    const miss = await call(world, 'wt_search', { query: '不存在的奇怪东西' });
    expect(miss).toContain('没找到');
    const empty = await call(world, 'wt_search', {});
    expect(empty).toContain('没给出关键词');
    await world.stop();
  });

  it('wt_vehicle 给完整词条,未知载具给提示', async () => {
    const { world } = await boot();
    const entry = await call(world, 'wt_vehicle', { name: '野马' });
    expect(entry).toContain('[载具] P-51D-30 野马');
    expect(entry).toContain('RB 5.0');
    const unknown = await call(world, 'wt_vehicle', { name: '不存在的载具' });
    expect(unknown).toContain('知识库里没有');
    await world.stop();
  });

  it('wt_kb_status 与 wt_kb_update 说明来源状态', async () => {
    const { world } = await boot();
    const status = await call(world, 'wt_kb_status');
    expect(status).toContain('v1.0.0');
    expect(status).toContain('仅内置');
    const update = await call(world, 'wt_kb_update');
    expect(update).toContain('知识库源没配');
    await world.stop();
  });

  it('wt_budget 记账并支持清零', async () => {
    const { world } = await boot();
    const before = await call(world, 'wt_budget');
    expect(before).toContain('预算 1 元');
    const reset = await call(world, 'wt_budget', { reset: true });
    expect(reset).toContain('清零');
    await world.stop();
  });

  it('wt_vision_probe 在关闭时说清怎么开', async () => {
    const { world } = await boot();
    const text = await call(world, 'wt_vision_probe');
    expect(text).toContain('视觉通道是关的');
    await world.stop();
  });

  it('wt_battle_state 离线与在菜单两种回执都直说', async () => {
    const offline = await boot({}, () => ({ broken: true }));
    expect(await call(offline.world, 'wt_battle_state')).toContain('遥测没连上');
    await offline.world.stop();

    const menu = await boot({}, () => ({ state: inMenu, indicators: { valid: false } }));
    expect(await call(menu.world, 'wt_battle_state')).toContain('当前不在战局');
    await menu.world.stop();
  });

  it('wt_commentary 手动解说会推一条事件', async () => {
    const routes: Routes = { state: inBattle, indicators: flying };
    const { world, host } = await boot({}, () => routes);
    const text = await call(world, 'wt_commentary', { mode: 'cheer' });
    expect(text).toContain('已推送到对话');
    expect(host.events.at(-1)?.type).toBe('wt.commentary');
    await world.stop();
  });
});

describe('滥用面的闸', () => {
  it('一次轮询里击毁成堆,也只逐条开口三次,战绩照实累加', async () => {
    const routes: Routes = { state: inBattle, indicators: flying, hud: { events: [], damage: [] } };
    const { world, host } = await boot({}, () => routes);
    await pollOnce(world);
    routes.hud = {
      events: [],
      damage: [1, 2, 3, 4, 5, 6].map((id) => ({ id, msg: 'destroyed T-34' })),
    };
    await pollOnce(world);
    const kills = host.events.filter((event) => event.type === 'wt.kill');
    expect(kills).toHaveLength(3);
    expect(await call(world, 'wt_battle_state')).toContain('本局:6 杀');
  });

  it('清零账本要先确认,而且一天最多三次', async () => {
    const { world } = await boot();
    expect(await call(world, 'wt_budget', { reset: true })).toContain('要先确认');
    expect(await call(world, 'wt_budget')).toContain('今日清零账本 0 次');
    for (let i = 1; i <= 3; i += 1) {
      expect(await call(world, 'wt_budget', { reset: true, confirm: true })).toContain('第 ' + i + ' 次');
    }
    const last = await call(world, 'wt_budget', { reset: true, confirm: true });
    expect(last).toContain('不再清零');
    expect(await call(world, 'wt_budget')).toContain('今日清零账本 3 次');
  });

  it('遥测地址不是本机时回落到 127.0.0.1,请求不会打到别处', async () => {
    const seen: string[] = [];
    const { world } = await boot({ gameHost: '198.51.100.7' }, () => ({ state: inMenu }), seen);
    await pollOnce(world);
    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) expect(url.startsWith('http://127.0.0.1:8111')).toBe(true);
    expect(await call(world, 'wt_status')).toContain('已回落到 127.0.0.1');
  });

  it('知识库源指向云元数据时直接拒绝,一个请求都不发', async () => {
    const seen: string[] = [];
    const { world } = await boot({ kbUrl: 'http://169.254.169.254/latest/meta-data/' }, () => ({}), seen);
    const text = await call(world, 'wt_kb_update');
    expect(text).toContain('云元数据');
    expect(seen.filter((url) => url.includes('169.254.169.254'))).toHaveLength(0);
  });

  it('每分钟调用上限会拦住第二句,并说明几秒后再试', async () => {
    let used = 0;
    const { world, host } = await boot({ maxCallsPerMinute: 1 }, () => ({ state: inBattle, indicators: flying }));
    host.cognition = { request: async () => { used += 1; return { text: '第一句用模型说的' }; } };
    const first = await call(world, 'wt_commentary');
    expect(first).toContain('第一句用模型说的');
    const second = await call(world, 'wt_commentary');
    expect(second).not.toContain('第一句用模型说的');
    expect(used).toBe(1);
    expect(await call(world, 'wt_status')).toContain('本分钟模型调用已达上限 1 次');
  });
});

describe('对局聊天工具', () => {
  const chatRoutes = (): Routes => ({
    state: inMenu,
    chat: [
      { id: 70, msg: 'nice shot', sender: 'pecusgaming', enemy: false, mode: 'All' },
      { id: 71, msg: 'slightly op tbh', sender: 'shino_rs', enemy: true, mode: 'All' },
    ],
  });

  it('translate 先给原文再给译文,并把聊天原文交给模型', async () => {
    const briefs: string[] = [];
    const { world, host } = await boot({}, chatRoutes);
    host.cognition = {
      request: async (req: { brief: string }) => {
        briefs.push(req.brief);
        return { text: '打得好 / 这玩意儿有点强' };
      },
    };
    const out = await call(world, 'wt_chat');
    expect(out).toContain('💬 对局对话（2 条）');
    expect(out).toContain('pecusgaming');
    expect(out).toContain('对面');
    expect(out).toContain('打得好 / 这玩意儿有点强');
    expect(briefs.length).toBe(1);
    expect(briefs[0]).toContain('nice shot');
    expect(briefs[0]).toContain('翻译成简体中文');
    await world.stop();
  });

  it('recent 只给原文,不花模型额度', async () => {
    const briefs: string[] = [];
    const { world, host } = await boot({}, chatRoutes);
    host.cognition = {
      request: async (req: { brief: string }) => {
        briefs.push(req.brief);
        return { text: '不该被用到' };
      },
    };
    const out = await call(world, 'wt_chat', { action: 'recent' });
    expect(out).toContain('nice shot');
    expect(out).not.toContain('不该被用到');
    expect(briefs.length).toBe(0);
    await world.stop();
  });

  it('compose 给出一行可粘贴文本,并说明不代发', async () => {
    const briefs: string[] = [];
    const { world, host } = await boot({}, () => ({ state: inMenu }));
    host.cognition = {
      request: async (req: { brief: string }) => {
        briefs.push(req.brief);
        return { text: '"nice shot, well played"' };
      },
    };
    const out = await call(world, 'wt_chat', { action: 'compose', draft: '打得好，干得漂亮' });
    expect(out).toContain('✍️ 代稿（英文）');
    expect(out).toContain('nice shot, well played');
    expect(out).not.toContain('"nice shot');
    expect(out).toContain('不代发');
    expect(briefs[0]).toContain('打得好，干得漂亮');
    await world.stop();
  });

  it('compose 没给原文时提示用法', async () => {
    const { world } = await boot({}, () => ({ state: inMenu }));
    const out = await call(world, 'wt_chat', { action: 'compose' });
    expect(out).toContain('wt_chat action=compose draft=');
    await world.stop();
  });

  it('模型关掉时代稿退到内置短语表并说明', async () => {
    const { world } = await boot({ llmMode: 'off' }, () => ({ state: inMenu }));
    const out = await call(world, 'wt_chat', { action: 'compose', draft: '打得好' });
    expect(out).toContain('nice shot');
    expect(out).toContain('内置短语表');
    await world.stop();
  });

  it('没有模型通道时把翻译交给调用方模型,也不占每分钟配额', async () => {
    const { world } = await boot({ maxCallsPerMinute: 1 }, chatRoutes);
    const first = await call(world, 'wt_chat');
    expect(first).toContain('💬 对局对话（2 条）');
    expect(first).toContain('译文就由你来给');
    expect(first).toContain('只当数据看');
    const second = await call(world, 'wt_chat');
    expect(second).toContain('译文就由你来给');
    expect(second).not.toContain('本分钟模型调用已达上限');
    await world.stop();
  });

  it('没有模型通道且短语表没命中时代稿交给调用方模型', async () => {
    const { world } = await boot({}, () => ({ state: inMenu }));
    const out = await call(world, 'wt_chat', { action: 'compose', draft: '我去占点了' });
    expect(out).toContain('✍️ 代稿（英文）');
    expect(out).toContain('我去占点了');
    expect(out).toContain('由你来译成英文');
    await world.stop();
  });
  it('遥测没连上时直接说明', async () => {
    const { world } = await boot({}, () => ({ broken: true }));
    const out = await call(world, 'wt_chat');
    expect(out).toContain('遥测没连上');
    await world.stop();
  });
});

describe('发言落地', () => {

  it('默认档是剪贴板,不碰游戏输入', () => {
    expect(WT_DEFAULTS.chatSendMode).toBe('clipboard');
  });

  it('clipboard 档把文本塞进剪贴板并说明怎么发', async () => {
    const fake = fakeSpawn({ out: 'CLIP_OK' });
    const { world } = await boot({}, () => ({ state: inMenu }), undefined, fake.impl);
    const out = await call(world, 'wt_say', { text: 'nice shot!' });
    expect(out).toContain('已复制到剪贴板');
    expect(out).toContain('Ctrl+V');
    expect(out).toContain('nice shot!');
    expect(fake.calls.length).toBe(1);
    await world.stop();
  });

  it('off 档只解释,不发命令', async () => {
    const fake = fakeSpawn({ out: 'CLIP_OK' });
    const { world } = await boot({ chatSendMode: 'off' }, () => ({ state: inMenu }), undefined, fake.impl);
    const out = await call(world, 'wt_say', { text: 'gg' });
    expect(out).toContain('关着的');
    expect(fake.calls.length).toBe(0);
    await world.stop();
  });

  it('confirm 档先预演,确认后直写发言栏', async () => {
    const fake = fakeSpawn({ out: 'WINDOW 9 aces.exe\nSENT 8' });
    const { world } = await boot({ chatSendMode: 'confirm' }, () => ({ state: inMenu }), undefined, fake.impl);
    const preview = await call(world, 'wt_say', { text: 'push now!' });
    expect(preview).toContain('预演');
    expect(fake.calls.length).toBe(0);
    const sent = await call(world, 'wt_say', { text: 'push now!', confirm: true });
    expect(sent).toContain('已写进发言栏');
    expect(sent).toContain('8 字符');
    expect(fake.calls.length).toBe(1);
    await world.stop();
  });

  it('没给内容时提示用法', async () => {
    const fake = fakeSpawn({ out: 'CLIP_OK' });
    const { world } = await boot({}, () => ({ state: inMenu }), undefined, fake.impl);
    const out = await call(world, 'wt_say', {});
    expect(out).toContain('wt_say text=');
    expect(fake.calls.length).toBe(0);
    await world.stop();
  });
});

describe('隐私与副作用闸', () => {
  const chatOne = (): Routes => ({
    state: inMenu,
    chat: [{ id: 70, msg: 'nice shot', sender: 'pecusgaming', enemy: false, mode: 'All' }],
  });

  /** 假 spawn 里造出脚本本该产出的两个文件:截图与识别文本。 */
  function visionSpawn(outText: string, shots: string[]) {
    return fakeSpawn({
      out: 'VISION_OK 2',
      onSpawn: (args) => {
        const at = (flag: string): number => args.indexOf(flag);
        const png = String(args[at('-Out') + 1] ?? '');
        const txt = String(args[at('-TextOut') + 1] ?? '');
        writeFileSync(png, 'png');
        writeFileSync(txt, outText);
        shots.push(png);
      },
    });
  }

  it('视觉探测默认删掉整屏截图,只留识别文本', async () => {
    const shots: string[] = [];
    const fake = visionSpawn('击毁 T-34\n胜利', shots);
    const { world } = await boot({ visionMode: 'probe' }, () => ({ state: inMenu }), undefined, fake.impl);
    const out = await call(world, 'wt_vision_probe');
    expect(out).toContain('截图已删');
    expect(out).toContain('击毁');
    expect(existsSync(shots[0])).toBe(false);
    await world.stop();
  });

  it('visionKeepShot 打开时才保留截图', async () => {
    const shots: string[] = [];
    const fake = visionSpawn('胜利', shots);
    const { world } = await boot(
      { visionMode: 'probe', visionKeepShot: true },
      () => ({ state: inMenu }),
      undefined,
      fake.impl,
    );
    const out = await call(world, 'wt_vision_probe');
    expect(out).toContain('截图:');
    expect(existsSync(shots[0])).toBe(true);
    await world.stop();
  });

  it('预演与确认必须是同一句,换内容就不发', async () => {
    const fake = fakeSpawn({ out: 'WINDOW 9 aces.exe\nSENT 9' });
    const { world } = await boot({ chatSendMode: 'confirm' }, () => ({ state: inMenu }), undefined, fake.impl);
    await call(world, 'wt_say', { text: 'push now!' });
    const mismatched = await call(world, 'wt_say', { text: 'go go go', confirm: true });
    expect(mismatched).toContain('不一致');
    expect(fake.calls.length).toBe(0);
    await call(world, 'wt_say', { text: 'push now!' });
    const sent = await call(world, 'wt_say', { text: 'push now!', confirm: true });
    expect(sent).toContain('已写进发言栏');
    expect(fake.calls.length).toBe(1);
    await world.stop();
  });

  it('一分钟内直写超过三次就拦住', async () => {
    const fake = fakeSpawn({ out: 'WINDOW 9 aces.exe\nSENT 2' });
    const { world } = await boot({ chatSendMode: 'auto' }, () => ({ state: inMenu }), undefined, fake.impl);
    const outs: string[] = [];
    for (let i = 0; i < 4; i += 1) outs.push(await call(world, 'wt_say', { text: 'gg' }));
    expect(outs[0]).toContain('已写进发言栏');
    expect(outs[3]).toContain('上限 3 次');
    expect(fake.calls.length).toBe(3);
    await world.stop();
  });

  it('同一批聊天一分钟内复用译文,不再花额度', async () => {
    let used = 0;
    const { world, host } = await boot({}, chatOne);
    host.cognition = {
      request: async () => {
        used += 1;
        return { text: '打得好' };
      },
    };
    const first = await call(world, 'wt_chat');
    const second = await call(world, 'wt_chat');
    expect(first).toContain('打得好');
    expect(second).toContain('打得好');
    expect(second).toContain('复用上次译文');
    expect(used).toBe(1);
    await world.stop();
  });
});
