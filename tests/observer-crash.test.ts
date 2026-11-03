import { describe, it, expect } from 'vitest';
import { BattleClient, BattleWatcher, computeSelfDeaths, isSelfObserverCrash, parseKillLine } from '../src/battle.ts';

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: Array<{ id: number; type?: string; msg?: string; sender?: string; time?: number }>; damage: Array<{ id: number; type?: string; msg?: string; sender?: string; time?: number }> };
  map?: unknown[];
  mission?: unknown;
  mapInfo?: unknown;
}

function makeClient(read: () => Routes) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    const routes = read();
    let body: unknown = {};
    if (url.includes('/hudmsg')) {
      body = routes.hud ?? { events: [], damage: [] };
    } else if (url.includes('/gamechat')) {
      body = [];
    } else if (url.includes('/state')) {
      body = routes.state ?? {};
    } else if (url.includes('/indicators')) {
      body = routes.indicators ?? {};
    } else if (url.includes('/map_obj.json')) {
      body = routes.map ?? [];
    } else if (url.includes('/mission.json')) {
      body = routes.mission ?? {};
    } else if (url.includes('/map_info.json')) {
      body = routes.mapInfo ?? {};
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }) as unknown as typeof globalThis.fetch;
  return new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
}

const running = { objectives: null, status: 'running' };
const tankInd = { valid: true, known: true, type: 'tankModels/us_hstv_l', army: 'tank', speed: 0 };
const tankState = { valid: true, map_valid: true, vehicle_type: '', game_mode: 'domination', army: 'tank' };

const row = (id: number, time: number, msg: string) => ({ id, time, msg, type: 'kill', sender: 'Ace' });

describe('侦察机损毁不算玩家阵亡', () => {
  it('识别「自己 + 无人机 + 坠毁」的行', () => {
    expect(isSelfObserverCrash('Ace (微型侦察无人机) 已坠毁。', 'Ace')).toBe(true);
    expect(isSelfObserverCrash('Ace (T-80BVM) 已坠毁。', 'Ace')).toBe(false);
    expect(isSelfObserverCrash('Bob (微型侦察无人机) 已坠毁。', 'Ace')).toBe(false);
  });

  it('被击落的侦察机不进阵亡计数', () => {
    const damage = [row(10, 20, 'Bob 击落了 Ace (微型侦察无人机)')];
    expect(computeSelfDeaths(damage, { afterId: -1, playerName: 'Ace' })).toEqual([]);
  });

  it('坠毁后指示灯抖动不再记成一局阵亡', async () => {
    const routes: Routes = {
      mission: running,
      state: tankState,
      indicators: { ...tankInd },
      hud: { events: [], damage: [] },
    };
    let now = 1_000;
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => now, playerName: 'Ace', inferDeathFromIndicators: true });

    const first = await watcher.poll();
    expect(first.map((e) => e.kind)).toEqual(['enter']);

    // 侦察机坠毁：feed 里出现「自己 (无人机) 已坠毁」。
    now += 1_500;
    routes.hud = { events: [], damage: [row(10, 20, 'Ace (微型侦察无人机) 已坠毁。')] };
    expect((await watcher.poll()).map((e) => e.kind)).toEqual([]);

    // 视角切回主载具的瞬间，指示灯抖一次失效：吸收窗口内不计阵亡。
    now += 400;
    routes.indicators = { ...tankInd, valid: false };
    expect((await watcher.poll()).map((e) => e.kind)).toEqual([]);
    expect(watcher.tally.deaths).toBe(0);

    // 窗口过去，正常死亡才照常计入。
    now += 30_000;
    routes.hud = { events: [], damage: [row(10, 20, 'Ace (微型侦察无人机) 已坠毁。'), row(11, 40, 'Bob 击毁了 Ace (T-80BVM)')] };
    routes.indicators = { ...tankInd };
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
  });

  it('坠毁行本身既不进击杀也不进阵亡', () => {
    const line = parseKillLine('Ace (微型侦察无人机) 已坠毁。');
    expect(line).toBeNull();
  });

  it('真机形态「玩家名 (微型侦察无人机)」没有坠毁动词也认得', () => {
    expect(isSelfObserverCrash('^MyGO^ Ace (微型侦察无人机)', 'Ace')).toBe(true);
    // 2026-11-02 真机截图原文（末尾带飞机图标）。
    expect(isSelfObserverCrash('^MyGO^ 羽丘千早丰川祥 (微型侦察无人机) ✈', '羽丘千早丰川祥')).toBe(true);
    expect(isSelfObserverCrash('^MyGO^ Bob (微型侦察无人机)', 'Ace')).toBe(false);
    // 自己击毁别人的无人机是战功，不能当成自己的无人机损失。
    expect(isSelfObserverCrash('Ace (su_30mk2v) 击毁了 Bob (微型侦察无人机)', 'Ace')).toBe(false);
    // 别人打掉自己的无人机同样要开吸收窗口。
    expect(isSelfObserverCrash('Bob (T-80BVM) 击毁了 Ace (微型侦察无人机)', 'Ace')).toBe(true);
  });

  it('无动词的坠机行同样不记阵亡，吸收窗口照常生效', async () => {
    const routes: Routes = {
      mission: running,
      state: tankState,
      indicators: { ...tankInd },
      hud: { events: [], damage: [] },
    };
    let now = 5_000;
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => now, playerName: 'Ace', inferDeathFromIndicators: true });
    await watcher.poll();
    now += 1_500;
    routes.hud = { events: [], damage: [row(10, 20, '^MyGO^ Ace (微型侦察无人机)')] };
    expect((await watcher.poll()).map((e) => e.kind)).toEqual([]);
    now += 400;
    routes.indicators = { ...tankInd, valid: false };
    expect((await watcher.poll()).map((e) => e.kind)).toEqual([]);
    expect(watcher.tally.deaths).toBe(0);
  });

  it('切到侦察无人机视角时指示灯失效不计阵亡', async () => {
    const routes: Routes = {
      mission: running,
      state: tankState,
      indicators: { ...tankInd },
      hud: { events: [], damage: [] },
    };
    let now = 9_000;
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => now, playerName: 'Ace', inferDeathFromIndicators: true });
    await watcher.poll();
    now += 1_500;
    // 视角切到无人机：对局中 /state 只有 valid:false，载具名在 /indicators.type。
    routes.state = { valid: false, map_valid: true, vehicle_type: '', game_mode: 'domination', army: 'tank' };
    routes.indicators = { valid: false, known: true, type: 'uavModels/recon_uav', army: 'tank' };
    expect((await watcher.poll()).map((e) => e.kind)).toEqual([]);
    expect(watcher.tally.deaths).toBe(0);
  });
});
