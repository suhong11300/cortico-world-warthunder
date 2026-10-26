import { describe, it, expect } from 'vitest';
import { BattleClient, BattleWatcher } from '../src/battle.ts';

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: Array<{ id: number; type?: string; msg?: string }>; damage: Array<{ id: number; type?: string; msg?: string }> };
  map?: unknown[];
  chat?: Array<{ id: number; msg?: string; sender?: string; enemy?: boolean; mode?: string }>;
  broken?: boolean;
}

/** 按 lastEvt / lastDmg 真的过滤,和 8111 的语义一致,这样预热与增量才有意义。 */
function makeClient(read: () => Routes) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    const routes = read();
    if (routes.broken) return { ok: false, status: 500, text: async () => 'boom' };
    let body: unknown = {};
    if (url.includes('/hudmsg')) {
      const evt = Number((url.match(/lastEvt=(-?\d+)/) ?? [])[1] ?? -1);
      const dmg = Number((url.match(/lastDmg=(-?\d+)/) ?? [])[1] ?? -1);
      const hud = routes.hud ?? { events: [], damage: [] };
      body = {
        events: hud.events.filter((item) => item.id > evt),
        damage: hud.damage.filter((item) => item.id > dmg),
      };
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
  return new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
}

const inBattle = { valid: true, map_valid: true, vehicle_type: 'P-51D-30', game_mode: 'domination', army: 'usa' };
const inMenu = { valid: true, map_valid: false, vehicle_type: '', game_mode: '', army: '' };

describe('8111 客户端', () => {
  it('把 state 的字段名映射成驼峰', async () => {
    const client = makeClient(() => ({ state: inBattle }));
    const state = await client.state();
    expect(state).toEqual({ valid: true, mapValid: true, vehicle: 'P-51D-30', mode: 'domination', army: 'usa' });
  });

  it('非 200 一律当没连上,返回 null', async () => {
    const client = makeClient(() => ({ broken: true }));
    expect(await client.state()).toBeNull();
    expect(await client.indicators()).toBeNull();
    expect(await client.mapObjects()).toEqual([]);
  });

  it('响应体前面带垃圾字符时也能解析出 JSON', async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200, text: async () => 'undef/*x*/{"valid":true,"speed":12.5,"altitude":300,"type":"P-51"}' })) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
    const indicators = await client.indicators();
    expect(indicators?.speed).toBe(12.5);
    expect(indicators?.type).toBe('P-51');
  });

  it('hudmsg 里没有 id 的条目被丢掉', async () => {
    const client = makeClient(() => ({
      hud: { events: [{ id: 3, msg: 'A captured B' }, { id: -1, msg: '没有 id' }], damage: [{ id: 4, msg: 'destroyed T-34' }] },
    }));
    const hud = await client.hud(-1, -1);
    expect(hud.events.length).toBe(1);
    expect(hud.damage.length).toBe(1);
    expect(hud.damage[0].msg).toContain('destroyed');
  });
});

describe('战局状态机', () => {
  it('首次进战局推 enter,并预热游标', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 480, altitude: 2100, type: 'P-51D-30' }, hud: { events: [], damage: [{ id: 5, msg: 'destroyed 老早以前' }] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });

    const first = await watcher.poll();
    expect(first.map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.inBattleNow).toBe(true);
    expect(watcher.online_now).toBe(true);
    expect(watcher.currentSnapshot.speed).toBe(480);

    const second = await watcher.poll();
    expect(second).toEqual([]);
    expect(watcher.tally.kills).toBe(0);
    void clock;
  });

  it('新增的击毁算进战绩与连击', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();

    routes.hud = { events: [], damage: [{ id: 1, msg: 'destroyed T-34' }] };
    const kills = await watcher.poll();
    expect(kills.map((event) => event.kind)).toEqual(['kill']);
    expect(kills[0]).toMatchObject({ total: 1, streak: 1 });
    expect(watcher.tally).toEqual({ kills: 1, deaths: 0, bestStreak: 1 });

    routes.hud = { events: [], damage: [{ id: 2, msg: 'shot down Bf 109' }] };
    const more = await watcher.poll();
    expect(more[0]).toMatchObject({ kind: 'kill', total: 2, streak: 2 });
    expect(watcher.tally.bestStreak).toBe(2);
  });

  it('不带击毁字样的消息不算战绩', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 1, altitude: 1, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 1, msg: 'hit T-34' }, { id: 2, msg: 'crit a wing' }] };
    const events = await watcher.poll();
    expect(events).toEqual([]);
    expect(watcher.tally.kills).toBe(0);
    void clock;
  });

  it('阵亡按冷却判一次,连死会追加 behind', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();

    routes.indicators = { valid: false, speed: 0, altitude: 0, type: 'P-51' };
    const first = await watcher.poll();
    expect(first.map((event) => event.kind)).toEqual(['death']);

    clock += 5_000;
    const cooling = await watcher.poll();
    expect(cooling).toEqual([]);

    clock += 10_000;
    const second = await watcher.poll();
    expect(second.map((event) => event.kind)).toEqual(['death', 'behind']);
    expect(watcher.tally.deaths).toBe(2);
  });

  it('离开战局推 leave,带本局战绩与时长', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 1, msg: 'destroyed T-34' }] };
    await watcher.poll();

    clock += 120_000;
    routes.state = inMenu;
    const left = await watcher.poll();
    expect(left.map((event) => event.kind)).toEqual(['leave']);
    const summary = (left[0] as { summary: { kills: number; deaths: number; seconds: number; vehicle: string } }).summary;
    expect(summary.kills).toBe(1);
    expect(summary.deaths).toBe(0);
    expect(summary.seconds).toBe(120);
    expect(summary.vehicle).toBe('P-51D-30');
    expect(watcher.inBattleNow).toBe(false);
  });

  it('游戏关掉时把在线状态置否,并补一条 leave', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    routes.broken = true;
    const offline = await watcher.poll();
    expect(offline.map((event) => event.kind)).toEqual(['leave']);
    expect(watcher.online_now).toBe(false);
    const again = await watcher.poll();
    expect(again).toEqual([]);
    void clock;
  });

  it('战场播报只当素材,不当战绩', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    routes.hud = { events: [{ id: 7, msg: 'PlayerX destroyed PlayerY' }], damage: [] };
    const events = await watcher.poll();
    expect(events.map((event) => event.kind)).toEqual(['hud']);
    expect(watcher.tally.kills).toBe(0);
  });

  it('refresh 更新读数但不产事件', async () => {
    const routes: Routes = {
      state: inBattle,
      indicators: { valid: true, speed: 512, altitude: 3300, type: 'P-51D-30' },
      hud: { events: [], damage: [] },
      map: [{ icon: 'aircraft_enemy_fighter', type: 'fighter' }, { icon: 'aircraft_friend_fighter', type: 'fighter' }, { icon: 'airfield', type: 'airfield' }],
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 1_000 });
    const snapshot = await watcher.refresh();
    expect(snapshot.speed).toBe(512);
    expect(snapshot.enemies).toBe(1);
    expect(snapshot.allies).toBe(1);
    expect(watcher.inBattleNow).toBe(false);
  });
});

describe('对局聊天', () => {
  it('按 lastId 增量取,字段按契约映射', async () => {
    const routes: Routes = {
      chat: [
        { id: 70, msg: 'hahaha', sender: 'pecusgaming', enemy: false, mode: 'All' },
        { id: 71, msg: 'slightly op tbh', sender: 'shino_rs', enemy: true, mode: 'Team' },
      ],
    };
    const client = makeClient(() => routes);
    const first = await client.gamechat(0);
    expect(first.length).toBe(2);
    expect(first[0]).toEqual({ id: 70, msg: 'hahaha', sender: 'pecusgaming', enemy: false, mode: 'All' });
    expect(first[1].enemy).toBe(true);
    expect(first[1].mode).toBe('Team');
    const second = await client.gamechat(70);
    expect(second.map((line) => line.id)).toEqual([71]);
  });

  it('缺字段补默认值,空正文丢弃,控制字符被洗掉', async () => {
    const routes: Routes = {
      chat: [
        { id: 5, msg: '  gg\u0000  ' },
        { id: 6, msg: '   ' },
        { id: 7, msg: 'hi', sender: 'a', mode: '' },
      ],
    };
    const lines = await makeClient(() => routes).gamechat(0);
    expect(lines.length).toBe(2);
    expect(lines[0].msg).toBe('gg');
    expect(lines[0].sender).toBe('');
    expect(lines[0].mode).toBe('All');
    expect(lines[1].mode).toBe('All');
  });

  it('服务挂了或不是数组都返回空数组', async () => {
    expect(await makeClient(() => ({ broken: true })).gamechat(0)).toEqual([]);
    expect(await makeClient(() => ({ chat: [] })).gamechat(0)).toEqual([]);
  });
});
