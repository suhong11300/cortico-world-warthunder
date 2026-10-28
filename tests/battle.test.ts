import { describe, it, expect } from 'vitest';
import { BattleClient, BattleWatcher } from '../src/battle.ts';

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: Array<{ id: number; type?: string; msg?: string }>; damage: Array<{ id: number; type?: string; msg?: string }> };
  map?: unknown[];
  chat?: Array<{ id: number; msg?: string; sender?: string; enemy?: boolean; mode?: string }>;
  mission?: unknown;
  mapInfo?: unknown;
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
    } else if (url.includes('/mission.json')) {
      body = routes.mission ?? {};
    } else if (url.includes('/map_info.json')) {
      body = routes.mapInfo ?? {};
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
    expect(state).toEqual({ valid: true, mapValid: true, mapValidKnown: true, vehicle: 'P-51D-30', mode: 'domination', army: 'usa' });
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
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock, playerName: 'Ace' });
    await watcher.poll();

    routes.hud = { events: [], damage: [{ id: 1, msg: 'Ace destroyed T-34' }] };
    const kills = await watcher.poll();
    expect(kills.map((event) => event.kind)).toEqual(['kill']);
    expect(kills[0]).toMatchObject({ total: 1, streak: 1 });
    expect(watcher.tally).toEqual({ kills: 1, deaths: 0, bestStreak: 1 });

    routes.hud = { events: [], damage: [{ id: 2, msg: 'Ace shot down Bf 109' }] };
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

  it('同一具尸体只记一次阵亡,重生后再死才继续累加', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();

    // 存活 -> 失效 是一次边沿,记一次阵亡。
    routes.indicators = { valid: false, speed: 0, altitude: 0, type: 'P-51' };
    const first = await watcher.poll();
    expect(first.map((event) => event.kind)).toEqual(['death']);

    // 尸体状态持续失效:不管过多久都不该继续加死亡数(旧版 8 秒冷却会在这里反复计死)。
    clock += 5_000;
    expect(await watcher.poll()).toEqual([]);
    clock += 30_000;
    expect(await watcher.poll()).toEqual([]);
    expect(watcher.tally.deaths).toBe(1);

    // 重生:重新看到有效存活才重新武装,随后的失效才是第二次阵亡。
    routes.indicators = { valid: true, speed: 380, altitude: 900, type: 'P-51' };
    expect(await watcher.poll()).toEqual([]);
    routes.indicators = { valid: false, speed: 0, altitude: 0, type: 'P-51' };
    clock += 3_000;
    const second = await watcher.poll();
    expect(second.map((event) => event.kind)).toEqual(['death', 'behind']);
    expect(watcher.tally.deaths).toBe(2);
  });

  it('/indicators 缺 valid 字段时不当成阵亡', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();

    // 只回一半字段(真机上偶发):这是"读不到",不是"死了"。
    routes.indicators = { speed: 0, altitude: 0, type: 'P-51' } as unknown as Routes['indicators'];
    expect(await watcher.poll()).toEqual([]);
    clock += 12_000;
    expect(await watcher.poll()).toEqual([]);
    expect(watcher.tally.deaths).toBe(0);
  });

  it('离开战局推 leave,带本局战绩与时长', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock, playerName: 'Ace' });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 1, msg: 'Ace destroyed T-34' }] };
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

  it('连接中断只说明未知,不能凭断连宣布结算', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    routes.broken = true;
    const offline = await watcher.poll();
    expect(offline.map((event) => event.kind)).toEqual([]);
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

  it('refresh 只更新读数与采样标志,不消费入局转移', async () => {
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
    // 采样标志要跟着更新(否则 wt_battle_state 会在局里报「不在战局」);
    // 但入局/结算这类转移必须留给 poll,否则一次查询就会让后续 poll 跳过 reset/warmup。
    expect(watcher.observedInBattleNow).toBe(true);
    expect(watcher.inBattleNow).toBe(false);
    expect(watcher.tally.kills).toBe(0);
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
    expect(lines[0].mode).toBe('');
    expect(lines[1].mode).toBe('');
  });

  it('服务挂了或不是数组都返回空数组', async () => {
    expect(await makeClient(() => ({ broken: true })).gamechat(0)).toEqual([]);
    expect(await makeClient(() => ({ chat: [] })).gamechat(0)).toEqual([]);
  });
});

/** 下面两条按真机抓到的形状写：对局里 /state 恒为 { "valid": false }，判在局只能靠 /mission.json。 */
describe('真机形状的在局判定', () => {
  it('state 只有 valid:false 时,靠 mission 的 running 认出人在局里', async () => {
    const routes: Routes = {
      state: { valid: false },
      indicators: { valid: true, type: 'tankModels/ussr_t_80ue1_sm', speed: 29 },
      mission: { objectives: [{ primary: true, status: 'in_progress', text: '占领并守住战区' }], status: 'running' },
      mapInfo: { valid: true },
      map: [
        { type: 'airfield', icon: 'none', color: '23,77,255' },
        { type: 'MediumTank', icon: 'MediumTank', color: '250,12,0' },
        { type: 'Fighter', icon: 'Fighter', color: '23,77,255' },
        { type: 'respawn_base_tank', icon: 'respawn_base_tank', color: '250,12,0' },
        { type: 'Player', icon: 'Player', color: '250,200,30' },
      ],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000 });
    const events = await watcher.poll();
    expect(events.map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.inBattleNow).toBe(true);
    expect(watcher.currentSnapshot.vehicle).toBe('ussr_t_80ue1_sm');
    // 按颜色判：红色敌方 1 个（重生点不算单位），蓝色友方 1 个，黄色是自己
    expect(watcher.currentSnapshot.enemies).toBe(1);
    expect(watcher.currentSnapshot.allies).toBe(1);
  });

  it('机库里 mission 不在跑时,残留的地图单位不能算在战局', async () => {
    const routes: Routes = {
      state: { valid: false },
      mission: { objectives: [], status: 'menu' },
      mapInfo: { valid: false },
      map: [{ type: 'ground_model', icon: 'tank_enemy_mbt' }],
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000 });
    expect(await watcher.poll()).toEqual([]);
    expect(watcher.inBattleNow).toBe(false);
  });

  it('中文客户端只认终局动词:引燃不计,击毁了才计', async () => {
    const routes: Routes = {
      mission: { status: 'running', objectives: [] },
      mapInfo: { valid: true },
      indicators: { valid: true, type: 'tankModels/ussr_t_80ue1_sm', speed: 0 },
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Qing#11' });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(['enter']);
    // 预热会把游标推到最新，所以这些要在进局之后再加
    routes.hud?.damage.push({ id: 1701, msg: 'Qing#11 (M1A1 HC) 的攻击引燃了 ^LeCuk^ haoshuainiu (M1A2T)' });
    expect((await watcher.poll()).map((event) => event.kind)).not.toContain('kill');
    expect(watcher.tally.kills).toBe(0);
    routes.hud?.damage.push({ id: 1702, msg: 'Qing#11 (M1A1 HC) 击毁了 ^LeCuk^ haoshuainiu (M1A2T)' });
    expect((await watcher.poll()).map((event) => event.kind)).toContain('kill');
    expect(watcher.tally.kills).toBe(1);
  });
});
