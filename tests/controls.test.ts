import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BattleClient } from '../src/battle.ts';
import { WT_CONFIG_GROUPS, WT_DEFAULTS } from '../src/config.ts';
import { WtWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
const worlds: WtWorld[] = [], dirs: string[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.stop(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function rig(patch: Record<string, unknown> = {}) {
  let now = 100000;
  const cfg = { ...WT_DEFAULTS, llmMode: 'off', kbUrl: '', ...patch } as any;
  const seen: string[] = [];
  const routes: Record<string, unknown> = { '/state': { valid: true, map_valid: true, vehicle_type: 'fixture-plane' }, '/indicators': { valid: true, type: 'fixture-plane' }, '/mission.json': { status: 'running' }, '/map_info.json': { valid: true }, '/map_obj.json': [], '/hudmsg': { events: [], damage: [] }, '/gamechat': [] };
  const fetchImpl: typeof fetch = async input => { const path = new URL(String(input)).pathname; seen.push(path); return new Response(JSON.stringify(routes[path] ?? {})); };
  const dir = mkdtempSync(join(tmpdir(), 'wt-controls-')); dirs.push(dir);
  const world = new WtWorld({ cfg, dataDir: dir, timezone: 'Asia/Shanghai', fetchImpl, now: () => now }); worlds.push(world);
  const host = new FakeHost();
  const call = async (name: string, args = {}) => String(await world.tools().find(t => t.name === name)!.handler(args, {} as any));
  const poll = async () => { await (world as any).pollOnce(); for (let i = 0; i < 100 && (world as any).draftBusy; i++) await new Promise(r => setTimeout(r, 1)); };
  return { cfg, seen, routes, fetchImpl, world, host, call, poll, tick: () => { now += 1500; } };
}
describe('人类时间显示与原值兼容', () => {
  it.each([['pollMs', 1.5], ['commentaryEveryMs', 45]] as const)('%s 使用宿主秒换算而不改存储单位', (key, seconds) => {
    const prop = Object.assign({}, ...WT_CONFIG_GROUPS.map((group) => group.schema.properties))['worlds.wt.' + key];
    expect(prop['x-scale']).toBe(1000);
    expect(prop['x-suffix']).toBe('秒');
    expect(prop.multipleOf).toBe(1);
    expect(WT_DEFAULTS[key] / prop['x-scale']!).toBe(seconds);
    expect(prop.title).not.toMatch(/ms|毫秒/i);
  });
});
describe('读取范围是实际请求闸门', () => {
  it.each(['body', 'translation'])('已有缓存后在途%s关闭聊天，不借额外env调用也能清缓存', async mode => {
    const r = rig({ llmMode: 'host' }); r.routes['/gamechat'] = [{ id: 1, msg: 'cached-before-disable', sender: 'P' }];
    let blocking = false, entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    (r.world as any).opts.fetchImpl = async (input: unknown) => {
      const response = await r.fetchImpl(input as any);
      if (blocking && mode === 'body' && String(input).includes('/gamechat')) { entered(); await gate; }
      return response;
    };
    (r.host as any).cognition = { request: async () => { entered(); await gate; return { text: 'pending-translation' }; } };
    await r.world.start(r.host); expect(await r.call('wt_chat', { action: 'recent' })).toContain('cached-before-disable');
    r.routes['/gamechat'] = [{ id: 99, msg: 'pending-secret', sender: 'P' }]; blocking = true;
    const pending = r.call('wt_chat', { action: mode === 'body' ? 'recent' : 'translate' });
    await started; r.cfg.readChat = false; release(); expect(await pending).toContain('读取已关闭');
    r.cfg.readChat = true; r.routes['/gamechat'] = [];
    expect(r.world.envPromptVars()['wt.chat']).not.toContain('cached-before-disable');
    const text = await r.call('wt_chat');
    expect(text).not.toContain('cached-before-disable'); expect(text).not.toContain('pending-secret');
  });

  it.each(['disabled', 'reopened', 'identity'])('在途聊天响应不能在清理后回填旧缓存: %s', async mode => {
    const r = rig(); r.routes['/gamechat'] = [{ id: 99, msg: 'secret-old-scope', sender: 'P' }];
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    (r.world as any).opts.fetchImpl = async (input: unknown) => {
      const response = await r.fetchImpl(input as any);
      if (String(input).includes('/gamechat')) { entered(); await gate; }
      return response;
    };
    await r.world.start(r.host); const pending = r.call('wt_chat'); await started;
    if (mode === 'identity') r.cfg.playerName = 'another-observer'; else r.cfg.readChat = false;
    r.world.envPromptVars();
    if (mode === 'reopened') { r.cfg.readChat = true; r.world.envPromptVars(); }
    release(); expect(await pending).not.toContain('secret-old-scope');
    r.cfg.readChat = true; r.routes['/gamechat'] = [];
    expect(r.world.envPromptVars()['wt.chat']).not.toContain('secret-old-scope');
    expect(await r.call('wt_chat')).not.toContain('secret-old-scope');
  });

  it.each(['behind', 'result', 'manual'])('HUD关闭时%s出口不把未知击毁说成0', async outlet => {
    const r = rig({ readHud: false, chatterLevel: 'commentary' }); await r.world.start(r.host); await r.poll();
    for (let i = 0; i < 2; i++) {
      r.routes['/indicators'] = { valid: false }; r.tick(); await r.poll();
      r.routes['/indicators'] = { valid: true, type: 'fixture-plane' }; r.tick(); await r.poll();
    }
    if (outlet === 'behind') expect(r.host.events.filter(e => e.type === 'wt.behind')).toEqual([]);
    if (outlet === 'manual') expect(await r.call('wt_commentary', { mode: 'urge' })).toContain('击毁未知');
    if (outlet === 'result') {
      r.routes['/mission.json'] = { status: 'ended' }; r.tick(); await r.poll();
      const event = r.host.events.find(e => e.type === 'wt.result');
      expect(event?.text).toContain('击杀未知'); expect(event?.meta?.kills).toBeNull();
    }
    expect(r.seen).not.toContain('/hudmsg');
  });

  it.each([['readVehicle', ['/state', '/indicators']], ['readMap', ['/map_info.json', '/map_obj.json']], ['readMission', ['/mission.json']]] as const)('World将%s同时应用于轮询和手动查询', async (key, paths) => {
    const r = rig({ [key]: false }); await r.world.start(r.host); await r.poll(); await r.call('wt_battle_state');
    for (const path of paths) expect(r.seen).not.toContain(path);
    expect(r.seen.length).toBeGreaterThan(0);
  });

  it('在途采样后关闭读取，旧轮询不能继续请求HUD或提交事件', async () => {
    const r = rig({ autoBrief: false });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    (r.world as any).opts.fetchImpl = async (input: unknown) => {
      if (String(input).includes('/state')) { entered(); await gate; }
      return r.fetchImpl(input as any);
    };
    await r.world.start(r.host); const pending = r.poll(); await started;
    r.cfg.readTelemetry = false; release(); await pending;
    expect(r.seen).not.toContain('/hudmsg'); expect(r.host.events).toEqual([]);
    expect(await r.call('wt_battle_state')).toContain('读取已关闭');
  });
  it.each(['vehicle', 'map', 'mission', 'hud', 'chat'])('关闭%s 时不请求对应端点', async blocked => {
    const r = rig();
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl: r.fetchImpl, canRead: (scope: string) => scope !== blocked } as any);
    await Promise.all([client.state(), client.indicators(), client.mission(), client.mapInfo(), client.mapObjects(), client.hud(-1, -1), client.gamechat(0)]);
    const paths: Record<string, string[]> = { vehicle: ['/state', '/indicators'], map: ['/map_info.json', '/map_obj.json'], mission: ['/mission.json'], hud: ['/hudmsg'], chat: ['/gamechat'] };
    for (const path of paths[blocked]) expect(r.seen).not.toContain(path);
    expect(r.seen.length).toBe(7 - paths[blocked].length);
  });
  it('读取总闸关闭：后台与手动均不联网，明确说读取关闭', async () => {
    const r = rig({ readTelemetry: false, autoBrief: false }); await r.world.start(r.host);
    await r.poll();
    for (const tool of ['wt_battle_state', 'wt_commentary', 'wt_chat']) expect(await r.call(tool)).toContain('读取已关闭');
    expect(await r.call('wt_status')).toContain('读取已关闭');
    expect(r.world.envPromptVars()['wt.status']).toContain('读取已关闭');
    expect(r.seen).toEqual([]); expect(r.host.events).toEqual([]);
  });
  it('关闭聊天读取：手动也不能绕过，其他遥测仍能读', async () => {
    const r = rig({ readChat: false }); await r.world.start(r.host);
    expect(await r.call('wt_chat')).toContain('聊天读取已关闭');
    expect(r.seen).not.toContain('/gamechat');
    expect(await r.call('wt_battle_state')).toContain('fixture-plane');
  });
  it('禁用战果日志不把未读取的个人击毁显示成已测零', async () => {
    const r = rig({ readHud: false }); await r.world.start(r.host); await r.poll();
    const text = await r.call('wt_battle_state');
    expect(text).toContain('战果日志读取关闭');
    expect(r.seen).not.toContain('/hudmsg');
  });
  it('热关闭读取废弃旧缓存，下一次手动查询不再发请求', async () => {
    const r = rig(); await r.world.start(r.host); await r.poll();
    r.cfg.readTelemetry = false; r.seen.length = 0;
    expect(await r.call('wt_battle_state')).toContain('读取已关闭');
    expect(r.world.envPromptVars()['wt.battle']).not.toContain('fixture-plane');
    expect(r.seen).toEqual([]);
  });
});
describe('主动播报与手动读取分离', () => {
  it('定时刷新在途时关闭播报开关，不提交刷新后的主动事件', async () => {
    const r = rig({ chatterLevel: 'commentary' });
    let blocking = false, entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    (r.world as any).opts.fetchImpl = async (input: unknown) => {
      if (blocking && String(input).includes('/state')) { entered(); await gate; }
      return r.fetchImpl(input as any);
    };
    await r.world.start(r.host); await r.poll(); r.host.events.length = 0; blocking = true;
    const pending = (r.world as any).commentaryOnce(); await started;
    r.cfg.broadcastCommentary = false; release(); await pending;
    expect(r.host.events).toEqual([]);
  });
  it('important档位不启动或推送定时讲解，与界面说明一致', async () => {
    const r = rig({ chatterLevel: 'important' }); await r.world.start(r.host); await r.poll(); r.host.events.length = 0;
    expect((r.world as any).commentaryTimer).toBeUndefined();
    await (r.world as any).commentaryOnce(); expect(r.host.events).toEqual([]);
  });

  it.each(['readChat', 'readTelemetry', 'playerName'])('翻译在途时热改%s，不返回旧聊天或译文', async key => {
    const r = rig({ llmMode: 'host' });
    r.routes['/gamechat'] = [{ id: 1, msg: 'secret-chat', sender: 'P', mode: 'Team' }];
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    (r.host as any).cognition = { request: async () => { entered(); await gate; return { text: 'translated-secret' }; } };
    await r.world.start(r.host);
    const pending = r.call('wt_chat', { action: 'translate' });
    await started; r.cfg[key] = key === 'playerName' ? 'another-observer' : false; release();
    const text = await pending;
    expect(text).not.toContain('secret-chat'); expect(text).not.toContain('translated-secret');
    expect(text).toMatch(/读取已关闭|身份已改变/);
  });

  it('自动播报总闸关闭也不发启动欢迎语，但允许手动查询', async () => {
    const r = rig({ autoBrief: false }); await r.world.start(r.host);
    expect(r.host.events).toEqual([]);
    expect(await r.call('wt_battle_state')).toContain('fixture-plane');
  });
  it.each([
    ['broadcastEntryExit', { kind: 'enter' }], ['broadcastEntryExit', { kind: 'leave', summary: { kills: 0, deaths: 0, seconds: 1 } }],
    ['broadcastKills', { kind: 'kill', total: 1, streak: 1, detail: 'Ace destroyed Bob (M4A1)' }], ['broadcastDeaths', { kind: 'death', total: 1 }],
    ['broadcastWarnings', { kind: 'behind', kills: 0, deaths: 3 }], ['broadcastHud', { kind: 'hud', detail: '占领了战区A' }],
  ])('%s 关闭只禁对应主动事件', async (key, event) => {
    const r = rig({ [key as string]: false, chatterLevel: 'commentary' }); await r.world.start(r.host); r.host.events.length = 0;
    const snapshot = { vehicle: 'fixture-plane', speed: 0, altitude: 0, enemies: 0, allies: 0, army: '', mode: '' };
    await (r.world as any).handleBattleEvent({ ...event, snapshot });
    expect(r.host.events).toEqual([]);
    expect(await r.call('wt_commentary')).toContain('fixture-plane');
  });
  it('关闭定时战况仍允许手动讲解', async () => {
    const r = rig({ broadcastCommentary: false, chatterLevel: 'commentary' }); await r.world.start(r.host); await r.poll(); r.host.events.length = 0;
    await (r.world as any).commentaryOnce(); expect(r.host.events).toEqual([]);
    expect(await r.call('wt_commentary')).toContain('fixture-plane');
  });
});

describe('战局状态只报事实', () => {
  it('不传 fields 只报基础三项，声明了哪几项就只报哪几项', async () => {
    const r = rig(); await r.world.start(r.host); await r.poll();
    const text = await r.call('wt_battle_state');
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^🎮 载具：/);
    expect(lines[1]).toMatch(/^📊 状态：/);
    expect(lines[2]).toMatch(/^🎯 战绩：/);
    for (const gone of ['读取范围', '未接入', '归因', '限制', '读于', '位置', '战局']) expect(text).not.toContain(gone);
    expect(text).toContain('得分 未知');
    for (const hidden of ['载具状态', '车组']) expect(text).not.toContain(hidden);

    // 声明两项就只回这两项：不再挂上默认的载具/状态/战绩。
    const more = (await r.call('wt_battle_state', { fields: 'position,situation' })).split('\n');
    expect(more).toHaveLength(2);
    expect(more[0]).toMatch(/^📍 位置：/);
    expect(more[1]).toMatch(/^⚔️ 战局：/);

    // 单个细项同理：只回载具状态这一行。
    const detail = (await r.call('wt_battle_state', { fields: 'detail' })).split('\n');
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatch(/^🛠 载具状态：/);

    // 「状态」这类泛化词仍给基础三项。
    const generic = (await r.call('wt_battle_state', { fields: '状态' })).split('\n');
    expect(generic).toHaveLength(3);
    expect(generic[0]).toMatch(/^🎮 载具：/);

    // 点名问成员：给车组人数，并说明队友名单不在 8111 的返回里。
    const crew = (await r.call('wt_battle_state', { fields: '成员' })).split('\n');
    expect(crew[0]).toMatch(/^🛠 载具状态：/);
    expect(crew.join('\n')).toContain('队友名单');

    // 认不出的词不猜，直接给可选项。
    expect(await r.call('wt_battle_state', { fields: '天气' })).toContain('没认出要报哪一项');
  });
});
