import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BattleClient, BattleWatcher, computeSelfKills, isSelfDeath, isSelfKill, parseKillLine } from '../src/battle.ts';
import { battleLine } from '../src/copy.ts';
import { WtWorld } from '../src/world.ts';
import { WT_DEFAULTS } from '../src/config.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { contradictsFacts } from '../src/llm.ts';

const active = { valid: true, map_valid: true, vehicle_type: 'fixture-plane' };
const dirs: string[] = [];
const worlds: WtWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function rig() {
  let now = 100_000;
  const routes: Record<string, any> = {
    '/state': { ...active }, '/indicators': { valid: true, type: 'aircraftModels/fixture-plane', speed: 100 },
    '/mission.json': { status: 'running' }, '/map_info.json': { valid: true }, '/map_obj.json': [],
    '/hudmsg': { events: [], damage: [] }, '/gamechat': [],
  };
  const fetchImpl: typeof fetch = async (input) => {
    if (routes.offline) throw new Error('fixture connection refused');
    const path = new URL(String(input)).pathname;
    if (routes.failPaths?.includes(path)) throw new Error('fixture endpoint unavailable');
    if (path === '/hudmsg' && routes.hudGate) { routes.onHud?.(); await routes.hudGate; }
    return new Response(JSON.stringify(routes[path] ?? {}), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  };
  const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
  const watcher = new BattleWatcher({ client, now: () => now, playerName: 'Ace' });
  return { routes, client, watcher, fetchImpl, now: () => now, tick: (ms = 1500) => { now += ms; } };
}
const row = (id: number, time: number, msg: string) => ({ id, time, msg, type: '', sender: '' });
describe('实战入场占位数据', () => {
  it.each([true, false])('占位与feed同拍=%s 时，真实重生后的新失效边沿仍可计数', async (samePoll) => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'] = { events: [], damage: [row(1, 101, 'Bob destroyed Ace')] };
    if (samePoll) r.routes['/indicators'] = { valid: true, type: 'dummy_plane' };
    r.tick(); await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(1);
    if (!samePoll) {
      r.routes['/indicators'] = { valid: true, type: 'dummy_plane' };
      r.tick(); await r.watcher.poll();
    }
    r.routes['/indicators'] = { valid: true, type: 'aircraftModels/fixture-plane' };
    r.tick(); await r.watcher.poll();
    r.routes['/indicators'] = { valid: false };
    r.tick(); await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(2);
  });

  it('dummy_plane 的飞机速度高度不作为真实载具读数，生成坦克后恢复', async () => {
    const r = rig();
    r.routes['/state'] = { valid: true, 'IAS, km/h': 300, 'H, m': 831 };
    r.routes['/indicators'] = { valid: true, army: 'air', type: 'dummy_plane' };
    await r.watcher.poll();
    const snapshot = r.watcher.currentSnapshot;
    expect(snapshot.vehicle).toBe('');
    expect(snapshot.readings?.speed.value).toBeNull();
    expect(snapshot.readings?.altitude.value).toBeNull();
    expect(battleLine(snapshot, 'zh')).toContain('载具待生成');
    expect(battleLine(snapshot, 'en')).toContain('awaiting vehicle');
    r.routes['/state'] = { valid: false };
    r.routes['/indicators'] = { valid: true, army: 'tank', type: 'tankModels/ussr_t_34_57_1943', speed: 23 };
    r.tick(); await r.watcher.poll();
    expect(r.watcher.currentSnapshot.vehicle).toBe('ussr_t_34_57_1943');
    expect(r.watcher.currentSnapshot.readings?.speed.value).toBe(23);
  });

  it('加载占位的 valid:true 不武装一次虚假的阵亡', async () => {
    const r = rig();
    r.routes['/indicators'] = { valid: true, type: 'dummy_plane' };
    await r.watcher.poll();
    r.routes['/indicators'] = { valid: false };
    r.tick(10000); await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(0);
  });

  it('真实载具与失效之间出现占位样本时不跨未知阶段推断阵亡', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/indicators'] = { valid: true, type: 'dummy_plane' };
    r.tick(10000); await r.watcher.poll();
    r.routes['/indicators'] = { valid: false };
    r.tick(10000); await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(0);
  });
});
async function worldRig() {
  const r = rig(); const dir = mkdtempSync(join(tmpdir(), 'wt-accuracy-')); dirs.push(dir);
  const cfg = { ...WT_DEFAULTS, playerName: 'Ace', llmMode: 'off' as const, pollMs: 30000 };
  const world = new WtWorld({ cfg, timezone: 'Asia/Shanghai', dataDir: dir, fetchImpl: r.fetchImpl, now: r.now });
  worlds.push(world); const host = new FakeHost(); await world.start(host); host.events = [];
  const call = async (name: string, args = {}) => String(await world.tools().find(x => x.name === name)!.handler(args, {} as any));
  return { ...r, world, host, call, cfg };
}

describe('8111 attribution and replay fidelity', () => {
  it('does not attribute a different player whose name contains ours', () => {
    expect(isSelfKill({ killer: 'OtherAce', victim: 'Bob' }, 'Ace')).toBe(false);
    expect(isSelfDeath({ killer: 'Bob', victim: 'OtherAce' }, 'Ace')).toBe(false);
    expect(isSelfKill({ killer: '[SQ] Ace', victim: 'Bob' }, 'Ace')).toBe(true);
  });
  it('does not split an English verb inside a player name', () => {
    expect(parseKillLine('NotDestroyedAce destroyed Bob')).toEqual({ killer: 'NotDestroyedAce', victim: 'Bob' });
  });
  it('uses explicit time rather than adjacent IDs for distinct kills', () => {
    expect(computeSelfKills([row(1, 10, 'Ace destroyed Bob'), row(2, 60, 'Ace destroyed Bob')], { afterId: -1, playerName: 'Ace' })).toHaveLength(2);
  });
  it('counts a new same-pair kill after the full feed window slides', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(100, 100, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(200, 200, 'Ace destroyed Bob')]; await r.watcher.poll();
    expect(r.watcher.tally.kills).toBe(2);
  });
  it('counts a same-pair event after server IDs and time restart', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(100, 100, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 1, 'Ace destroyed Bob')]; await r.watcher.poll();
    expect(r.watcher.tally.kills).toBe(2);
  });
  it('applies kills and deaths in the original feed order', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(10, 20, 'Ace destroyed Bob'), row(11, 21, 'Enemy destroyed Ace'), row(20, 40, 'Ace destroyed Carol'), row(30, 60, 'Ace destroyed Dave')];
    const events = await r.watcher.poll();
    expect(events.filter(x => x.kind === 'kill' || x.kind === 'death').map(x => x.kind)).toEqual(['kill', 'death', 'kill', 'kill']);
    expect(r.watcher.tally).toEqual({ kills: 3, deaths: 1, bestStreak: 2 });
  });
  it('does not re-arm from a stale true indicator in the feed-death sample', async () => {
    const r = rig(); await r.watcher.poll(); r.tick();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Enemy destroyed Ace')]; await r.watcher.poll();
    r.tick(); r.routes['/indicators'] = { valid: false }; await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(1);
    r.tick(); r.routes['/indicators'] = { valid: true }; await r.watcher.poll();
    r.tick(); r.routes['/indicators'] = { valid: false }; await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(2);
  });
  it('does not interpret null as a confirmed invalid indicator', async () => {
    const r = rig(); await r.watcher.poll(); r.tick();
    r.routes['/indicators'] = { valid: null }; await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(0);
  });
  it('does not end a match or reset the tally just because telemetry disconnects', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes.offline = true; expect(await r.watcher.poll()).toEqual([]);
    r.routes.offline = false; await r.watcher.poll();
    expect(r.watcher.tally.kills).toBe(1);
  });
  it('does not replay a previously seen older subset as a new server epoch', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 1, 'Ace destroyed Bob'), row(100, 100, 'Ace destroyed Carol')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 1, 'Ace destroyed Bob')]; await r.watcher.poll();
    expect(r.watcher.tally.kills).toBe(2);
  });
  it('keeps match state when only indicators is available', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes.failPaths = ['/state', '/mission.json', '/map_info.json', '/map_obj.json'];
    expect(await r.watcher.poll()).toEqual([]);
    r.routes.failPaths = []; await r.watcher.poll(); expect(r.watcher.tally.kills).toBe(1);
  });
  it('still breaks the chronological streak when a feed death confirms an earlier indicator inference', async () => {
    const r = rig(); await r.watcher.poll(); r.tick();
    r.routes['/indicators'] = { valid: false }; await r.watcher.poll(); r.tick();
    r.routes['/hudmsg'].damage = [row(10, 10, 'Ace destroyed Bob'), row(11, 11, 'Enemy destroyed Ace')]; await r.watcher.poll();
    r.tick(); r.routes['/indicators'] = { valid: true }; await r.watcher.poll();
    r.tick(); r.routes['/hudmsg'].damage.push(row(20, 30, 'Ace destroyed Carol')); await r.watcher.poll();
    expect(r.watcher.tally).toEqual({ kills: 2, deaths: 1, bestStreak: 1 });
  });
  it('does not hold the feed-first invalid latch across arbitrarily long valid observations', async () => {
    const r = rig(); await r.watcher.poll(); r.tick();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Enemy destroyed Ace')]; await r.watcher.poll();
    r.tick(10000); await r.watcher.poll();
    r.tick(); r.routes['/indicators'] = { valid: false }; await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(2);
  });
  it('does not erase post-death kills when an older death confirmation arrives late', async () => {
    const r = rig(); await r.watcher.poll(); r.tick(); r.routes['/indicators'] = { valid: false }; await r.watcher.poll();
    r.tick(); r.routes['/indicators'] = { valid: true }; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(10, 20, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage.unshift(row(1, 10, 'Enemy destroyed Ace')); await r.watcher.poll();
    r.routes['/hudmsg'].damage.push(row(20, 30, 'Ace destroyed Carol')); await r.watcher.poll();
    expect(r.watcher.tally).toEqual({ kills: 2, deaths: 1, bestStreak: 2 });
  });
  it('retains the cross-response dedupe anchor when an old subset is replayed', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob'), row(100, 100, 'Other destroyed Carol')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(2, 11, 'Ace destroyed Bob')]; await r.watcher.poll();
    expect(r.watcher.tally.kills).toBe(1);
  });
  it('keeps new low-ID kills after old deaths in a restarted feed segment', async () => {
    const r = rig(); await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(90, 90, 'Ace destroyed OldTarget'), row(100, 100, 'Enemy destroyed Ace')]; await r.watcher.poll();
    r.routes['/hudmsg'].damage = [row(1, 1, 'Ace destroyed NewTarget')];
    const events = await r.watcher.poll();
    expect(events.find(x => x.kind === 'kill')).toMatchObject({ streak: 1 });
    expect(r.watcher.tally).toEqual({ kills: 2, deaths: 1, bestStreak: 1 });
  });
});

describe('8111 readings and Coopanion-facing facts', () => {
  it('reads the explicitly unit-labelled state fields, including zero and negative altitude', async () => {
    const r = rig(); r.routes['/state'] = { ...active, 'IAS, km/h': 0, 'TAS, km/h': 20, 'H, m': -5 };
    await r.watcher.refresh(); const text = battleLine(r.watcher.currentSnapshot, 'zh');
    expect(text).toContain('IAS 0 km/h'); expect(text).toContain('-5 m'); expect(text).not.toContain('100 km/h');
  });
  it('does not assign km/h to a unitless indicators.speed value', async () => {
    const r = rig(); await r.watcher.refresh(); const text = battleLine(r.watcher.currentSnapshot, 'zh');
    expect(text).toContain('100'); expect(text).toContain('单位未确认'); expect(text).not.toContain('100 km/h');
  });
  it('does not infer the game mode from zero visible enemy objects', async () => {
    const r = rig(); r.routes['/map_obj.json'] = [{ type: 'tank', color: '23,77,255' }];
    await r.watcher.refresh(); const text = battleLine(r.watcher.currentSnapshot, 'zh');
    expect(text).toContain('0 敌'); expect(text).not.toContain('该模式');
  });
  it('never invents the first kill when cheer is requested at zero kills', async () => {
    const r = await worldRig(); const text = await r.call('wt_commentary', { mode: 'cheer' });
    expect(text).not.toContain('本局第 1'); expect(text).not.toContain('击毁一个');
  });
  it('refuses to announce stale battle readings after entering the menu', async () => {
    const r = await worldRig(); await r.call('wt_battle_state'); r.host.events = [];
    r.routes['/state'] = { valid: true, map_valid: false }; r.routes['/mission.json'] = { status: 'ended' }; r.routes['/map_info.json'] = { valid: false };
    const text = await r.call('wt_commentary');
    expect(text).toContain('不在战局'); expect(r.host.events).toHaveLength(0);
  });
  it('uses the same latest online observation in tools, status and environment', async () => {
    const r = await worldRig(); await r.call('wt_battle_state');
    expect(r.world.envPromptVars()['wt.status']).not.toContain('离线');
    expect(await r.call('wt_status')).toContain('在线');
    r.routes.offline = true; const text = await r.call('wt_commentary');
    expect(text).toContain('离线'); expect(r.world.envPromptVars()['wt.battle']).not.toContain('战局中:');
  });
  it('does not throw away an observed capture-zone HUD event', async () => {
    const r = await worldRig();
    await r.call('wt_battle_state');
    await (r.world as any).handleBattleEvent({ kind: 'hud', detail: '我方占领了战区 A' });
    expect(r.host.events.some(x => x.text.includes('我方占领了战区 A'))).toBe(true);
  });
  it('does not claim an ended mission is active because stale map objects remain', async () => {
    const r = rig(); r.routes['/state'] = { valid: false };
    r.routes['/mission.json'] = { status: 'ended' };
    r.routes['/map_obj.json'] = [{ type: 'tank', color: '23,77,255' }];
    await r.watcher.refresh(); expect(r.watcher.observedInBattleNow).toBe(false);
  });
  it('applies hot nickname and decoder changes to the client identity', async () => {
    const r = await worldRig(); await r.call('wt_battle_state');
    const first = (r.world as any).watcher; r.cfg.playerName = 'Bob';
    await r.call('wt_battle_state'); expect((r.world as any).watcher).not.toBe(first);
  });
  it('does not turn a missing chat channel into all-chat', async () => {
    const r = rig(); r.routes['/gamechat'] = [{ id: 1, msg: 'hello', sender: 'Bob' }];
    const chat = await r.client.gamechat(0); expect(chat[0].mode).toBe('');
  });
  it('does not let a model invent the first kill in zero-kill cheer', async () => {
    const r = await worldRig(); (r.cfg as any).llmMode = 'host';
    (r.host as any).cognition = { request: async () => ({ text: '本局第 1 杀,打得好！' }) };
    expect(await r.call('wt_commentary', { mode: 'cheer' })).not.toContain('第 1 杀');
  });
  it('does not allow fabricated zero or one merely because they are small numbers', () => {
    expect(contradictsFacts('第1杀', ['观测击毁0'])).toBe(true);
  });
  it('does not return cached match chat as current after reaching the menu', async () => {
    const r = await worldRig(); r.routes['/gamechat'] = [{ id: 1, msg: 'OLD-MATCH-MESSAGE', sender: 'Bob', mode: 'all' }];
    expect(await r.call('wt_chat', { action: 'recent' })).toContain('OLD-MATCH-MESSAGE');
    r.routes['/state'] = { valid: true, map_valid: false }; r.routes['/mission.json'] = { status: 'ended' }; r.routes['/map_info.json'] = { valid: false };
    const text = await r.call('wt_chat', { action: 'recent' });
    expect(text).not.toContain('OLD-MATCH-MESSAGE'); expect(text).toContain('不在战局');
  });
  it('keeps telemetry facts deterministic even when the model offers invented units or results', async () => {
    const r = await worldRig(); (r.cfg as any).llmMode = 'host'; let calls = 0;
    (r.host as any).cognition = { request: async () => { calls++; return { text: '速度100 km/h,本局100杀,这局赢了！' }; } };
    const text = await r.call('wt_commentary');
    expect(text).toContain('单位未确认'); expect(text).not.toContain('100杀'); expect(text).not.toContain('赢了'); expect(calls).toBe(0);
  });
  it('discards an old identity poll that finishes after a hot nickname change', async () => {
    const r = await worldRig(); await (r.world as any).pollOnce(); await Promise.resolve(); r.host.events = [];
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    r.routes.hudGate = new Promise<void>(resolve => { release = resolve; }); r.routes.onHud = started;
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob')];
    const oldPoll = (r.world as any).pollOnce(); await entered;
    r.cfg.playerName = 'Bob'; await r.call('wt_battle_state');
    release(); await oldPoll; await Promise.resolve();
    expect(r.host.events.some(x => x.type === 'wt.kill')).toBe(false);
  });
  it('detects a hot identity change at the commit boundary without another tool call', async () => {
    const r = await worldRig(); await (r.world as any).pollOnce(); await Promise.resolve(); r.host.events = [];
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    r.routes.hudGate = new Promise<void>(resolve => { release = resolve; }); r.routes.onHud = started;
    r.routes['/hudmsg'].damage = [row(1, 10, 'Ace destroyed Bob')];
    const oldPoll = (r.world as any).pollOnce(); await entered;
    r.cfg.playerName = 'Bob'; release(); await oldPoll; await Promise.resolve();
    expect(r.host.events.some(x => x.type === 'wt.kill')).toBe(false);
  });
});
