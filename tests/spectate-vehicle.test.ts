import { describe, expect, it } from 'vitest';
import { BattleClient, BattleWatcher } from '../src/battle.ts';

interface HudLine { id: number; time?: number; msg?: string }

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: HudLine[]; damage: HudLine[] };
  map?: unknown[];
  mapInfo?: unknown;
  mission?: unknown;
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

const inBattle = { valid: true, map_valid: true, vehicle_type: 'ussr_t_80u', game_mode: 'domination', army: 'ussr' };
const tank = (type: string) => ({ valid: true, type: `tankModels/${type}` });
const SELF_ICON = { type: 'tankModels/ussr_t_80u', color: '250,200,30', x: 0.5, y: 0.5 };

function rig(routes: Routes, start = 100_000) {
  let clock = start;
  const watcher = new BattleWatcher({
    inferDeathFromIndicators: true,
    client: makeClient(() => routes),
    playerName: 'Ace',
    now: () => clock,
  });
  return {
    routes,
    watcher,
    tick: (ms = 1500) => { clock += ms; },
    clock: () => clock,
  };
}

describe('切视角与换车不算阵亡', () => {
  it('指示灯只抖一拍不算阵亡', async () => {
    const r = rig({ state: inBattle, indicators: tank('ussr_t_80u'), map: [], mapInfo: { valid: true }, mission: { status: 'running' } });
    await r.watcher.poll();
    r.tick();
    r.routes.indicators = { valid: false };
    await r.watcher.poll();
    r.tick();
    r.routes.indicators = tank('ussr_t_80u');
    await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(0);
  });

  it('地图上还画着自己的图标时，持续失效也不记阵亡', async () => {
    const r = rig({ state: inBattle, indicators: tank('ussr_t_80u'), map: [SELF_ICON], mapInfo: { valid: true }, mission: { status: 'running' } });
    await r.watcher.poll();
    r.routes.indicators = { valid: false };
    for (let i = 0; i < 4; i += 1) {
      r.tick();
      await r.watcher.poll();
    }
    expect(r.watcher.tally.deaths).toBe(0);
  });

  it('换载具（占位 -> 新载具）不记阵亡，新载具被打掉才记一次', async () => {
    const r = rig({ state: inBattle, indicators: tank('ussr_t_80u'), map: [], mapInfo: { valid: true }, mission: { status: 'running' } });
    await r.watcher.poll();
    r.tick();
    r.routes.indicators = { valid: true, type: 'dummy_plane' };
    await r.watcher.poll();
    r.tick();
    r.routes.indicators = tank('ussr_t_72b');
    await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(0);
    r.routes.indicators = { valid: false };
    r.tick();
    await r.watcher.poll();
    r.tick();
    await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(1);
  });
});

describe('阵亡后观战不再重复计数', () => {
  it('feed 确认阵亡后切视角，指示灯持续失效也只记一次', async () => {
    const r = rig({ state: inBattle, indicators: tank('ussr_t_80u'), map: [], mapInfo: { valid: true }, mission: { status: 'running' }, hud: { events: [], damage: [] } });
    await r.watcher.poll();
    r.routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M4A1)' }] };
    r.tick();
    await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(1);
    r.routes.indicators = { valid: false };
    for (let i = 0; i < 5; i += 1) {
      r.tick();
      await r.watcher.poll();
    }
    expect(r.watcher.tally.deaths).toBe(1);
  });

  it('重生后再次失效，仍记第二次阵亡', async () => {
    const r = rig({ state: inBattle, indicators: tank('ussr_t_80u'), map: [], mapInfo: { valid: true }, mission: { status: 'running' }, hud: { events: [], damage: [] } });
    await r.watcher.poll();
    r.routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M4A1)' }] };
    r.tick();
    await r.watcher.poll();
    r.routes.indicators = { valid: false };
    r.tick();
    await r.watcher.poll();
    r.routes.indicators = tank('ussr_t_72b');
    r.tick();
    await r.watcher.poll();
    r.routes.indicators = { valid: false };
    r.tick();
    await r.watcher.poll();
    r.tick();
    await r.watcher.poll();
    expect(r.watcher.tally.deaths).toBe(2);
  });
});
