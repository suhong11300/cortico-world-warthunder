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
      hud: { events: [{ id: 3, msg: 'A captured B' }, { id: -1, msg: '没有 id' }], damage: [{ id: 4, msg: ' destroyed T-34 (M4A1)' }] },
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
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 480, altitude: 2100, type: 'P-51D-30' }, hud: { events: [], damage: [{ id: 5, msg: ' destroyed 老早以前 (M4A1)' }] }, map: [] };
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

    routes.hud = { events: [], damage: [{ id: 1, msg: 'Ace destroyed T-34 (M4A1)' }] };
    const kills = await watcher.poll();
    expect(kills.map((event) => event.kind)).toEqual(['kill']);
    expect(kills[0]).toMatchObject({ total: 1, streak: 1 });
    expect(watcher.tally).toEqual({ kills: 1, deaths: 0, bestStreak: 1 });

    routes.hud = { events: [], damage: [{ id: 2, msg: 'Ace shot down Bf 109 (M4A1)' }] };
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
    const watcher = new BattleWatcher({ inferDeathFromIndicators: true, client: makeClient(() => routes), now: () => clock });
    await watcher.poll();

    // 存活 -> 失效 是一次边沿,记一次阵亡。要看两拍：切视角/换车只抖一拍。
    routes.indicators = { valid: false, speed: 0, altitude: 0, type: 'P-51' };
    expect(await watcher.poll()).toEqual([]);
    clock += 1_500;
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
    expect(await watcher.poll()).toEqual([]);
    clock += 1_500;
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
    routes.hud = { events: [], damage: [{ id: 1, msg: 'Ace destroyed T-34 (M4A1)' }] };
    await watcher.poll();

    clock += 120_000;
    routes.state = inMenu;
    // 离场的强证据是地图端点：机库里 /state 与 /mission.json 都可能还像"在局"。
    routes.mapInfo = { valid: false };
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
    routes.hud = { events: [{ id: 7, msg: 'PlayerX destroyed PlayerY (M4A1)' }], damage: [] };
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

/**
 * 入局播报原来在加载画面那一拍就发出去：/indicators.type 还是 dummy_plane，
 * 于是整条成了「载具待生成 · 速度未读到 · 高度未读到 · 过载未读到」，
 * 而一局只有一次 enter，之后再没有更正的机会。下面三条盯着「等就绪 / 最多等 20 拍且超时只报一句 / 没进就别报离场」。
 */
describe('入局播报等载具就绪再发', () => {
  const loadingState = { valid: true, map_valid: true };
  const placeholder = { valid: true, speed: 0, altitude: 0, type: 'dummy_plane' };
  const realIndicators = { valid: true, speed: 0, altitude: -49, type: 'tankModels/ussr_t_80ue1_sm' };

  function makeRoutes(indicators: unknown): Routes {
    return {
      state: loadingState,
      indicators,
      mapInfo: { valid: true },
      map: [],
      hud: { events: [], damage: [] },
    };
  }

  it('加载画面里还是 dummy_plane 时先压住 enter,读出来再发', async () => {
    let clock = 100_000;
    const routes = makeRoutes(placeholder);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });

    expect(await watcher.poll()).toEqual([]);
    // 人已经在局里了,只是载具名还没出来
    expect(watcher.inBattleNow).toBe(true);

    clock += 1500;
    routes.indicators = realIndicators;
    const second = await watcher.poll();
    expect(second.map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.currentSnapshot.vehicle).toBe('ussr_t_80ue1_sm');
    // 只发一次
    expect(await watcher.poll()).toEqual([]);
  });

  it('占位期不设上限：连占 100 拍也压着，等真载具出来再发完整一条', async () => {
    let clock = 100_000;
    const routes = makeRoutes(placeholder);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });

    // 2026-11-10 真机：20:22 那局加载超过 30 秒仍是 dummy_plane。占位期不计拍，等多久都等。
    for (let i = 0; i < 100; i += 1) {
      expect(await watcher.poll()).toEqual([]);
      clock += 1500;
    }
    routes.indicators = realIndicators;
    const after = await watcher.poll();
    expect(after.map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.currentSnapshot.vehicle).toBe('ussr_t_80ue1_sm');
    expect(await watcher.poll()).toEqual([]);
  });

  it('载具名有了但陆战速度还算不出来：等满上限后照发完整一行，不发半句', async () => {
    let clock = 300_000;
    // /indicators 不给 speed 字段、地图参数也没有 → 位移法无源，速度确实算不出来。
    const routes: Routes = {
      state: { valid: false },
      indicators: { valid: true, type: 'tankModels/it_centauro_rgo_120', army: 'tank' },
      // 地图端点说在局（strict 模式靠它判在局），但自机点还没上图 → 位移法没有源。
      mapInfo: { valid: true, map_min: [0, 0], map_max: [2048, 2048], grid_zero: [0, 0], grid_steps: [225, 225] },
      map: [],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });

    let rounds = 0;
    let events: Awaited<ReturnType<typeof watcher.poll>> = [];
    while (rounds < 80) {
      rounds += 1;
      clock += 1500;
      events = await watcher.poll();
      if (events.length > 0) break;
    }
    expect(events.map((event) => event.kind)).toEqual(['enter']);
    // 上限 60 拍：确实压了很久，但不是永远不发。
    expect(rounds).toBeGreaterThan(50);
    expect(rounds).toBeLessThanOrEqual(62);
    // 发的是完整一行：载具名在，速度写未读到（不再有「⚔️ 进战局」半句）。
    expect(watcher.currentSnapshot.vehicle).toBe('it_centauro_rgo_120');
    expect(watcher.currentSnapshot.groundSpeedKmh).toBeUndefined();
  });

  it('enter 还没发出去就离场时不补一条 leave', async () => {
    const routes = makeRoutes(placeholder);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000 });

    expect(await watcher.poll()).toEqual([]);
    // 真机离场信号是 map_info.valid=false（strict 模式下地图还在就算在局）
    routes.state = { valid: true, map_valid: false };
    routes.mapInfo = { valid: false };
    expect(await watcher.poll()).toEqual([]);
    expect(watcher.inBattleNow).toBe(false);
  });
});

/**
 * 陆战真机（2026-11-10，Carpathians 局）：/state 是 {valid:false}，/map_info.json 与 /map_obj.json
 * 都在，但自机颜色给的是 "#faC81E" 十六进制串，而 sideOf 只按逗号串解析——自己认不出来，
 * worldX/worldY 一直是 undefined，对地速度就永远「未读到」。下面三条钉住颜色解析与入局那一拍的等待。
 */
describe('陆战对地速度：颜色写法与入局等待', () => {
  // 端点是蛇形字段（真机 /map_info.json 原样），客户端再转驼峰。
  const mapInfo = { valid: true, map_min: [0, 0], map_max: [2048, 2048], grid_zero: [186.2, 1904.35], grid_steps: [225, 225] };
  const tankInd = { valid: true, type: 'it_freccia_hitfist_ows', army: 'tank' };
  // icon 默认用真机的 "Player"；验证颜色解析那条故意换掉，免得被 icon 兜底救过去。
  const selfRow = (color?: string, icon = 'Player') => ({
    type: 'ground_model',
    icon,
    x: 0.5,
    y: 0.5,
    dx: 0,
    dy: 1,
    ...(color ? { color } : {}),
  });
  const groundRoutes = (map: unknown[], indicators: unknown = tankInd): Routes => ({
    state: { valid: false },
    indicators,
    mapInfo,
    map,
    hud: { events: [], damage: [] },
  });

  it('自机颜色是十六进制串（#faC81E）也认得出，第二拍算出对地速度', async () => {
    let clock = 100_000;
    const routes = groundRoutes([selfRow('#faC81E', 'unit')]);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    // 第一拍：载具名已经读到，但没有上一拍位移可比，仍压住不发。
    expect(await watcher.poll()).toEqual([]);
    clock += 1500;
    // 0.005 个地图宽 = 10.24 m / 1.5 s ≈ 24.6 km/h
    (routes.map as Array<{ x: number }>)[0].x = 0.505;
    const second = await watcher.poll();
    expect(second.map((event) => event.kind)).toEqual(['enter']);
    const speed = watcher.currentSnapshot.groundSpeedKmh;
    expect(typeof speed).toBe('number');
    expect(speed as number).toBeGreaterThan(20);
    expect(speed as number).toBeLessThan(40);
  });

  it('站着不动报 0 km/h，不是「速度未读到」', async () => {
    let clock = 100_000;
    const routes = groundRoutes([selfRow('#faC81E')]);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    expect(await watcher.poll()).toEqual([]);
    clock += 1500;
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.currentSnapshot.groundSpeedKmh).toBe(0);
  });

  it('颜色完全给不出来时，icon 是 Player 也认自机', async () => {
    let clock = 100_000;
    const routes = groundRoutes([selfRow()]);
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    expect(await watcher.poll()).toEqual([]);
    clock += 1500;
    (routes.map as Array<{ x: number }>)[0].x = 0.51;
    await watcher.poll();
    expect(typeof watcher.currentSnapshot.groundSpeedKmh).toBe('number');
  });
});

/**
 * 陆战真机（2026-11-10 Centauro RGO 那局）：自机点要等 20 多秒才进 /map_obj，
 * 那段时间位移法无源可算；但 /indicators.speed 从进图第一拍就有值，而且坦克上就是 km/h。
 * 所以陆战/海战优先取它，位移法只当兜底。
 */
describe('陆战速度优先取 /indicators.speed', () => {
  const mapInfo = { valid: true, map_min: [0, 0], map_max: [2048, 2048], grid_zero: [186.2, 1904.35], grid_steps: [225, 225] };
  const movingInd = { valid: true, known: true, type: 'tankModels/it_centauro_rgo_120', army: 'tank', speed: 58.4 };

  it('自机点还没进地图也能报速度，第一拍就发进局', async () => {
    let clock = 200_000;
    const routes: Routes = {
      state: { valid: false },
      indicators: movingInd,
      mapInfo,
      // 真机样本：141 个对象里只有 capture_zone / respawn_base_*，没有 Player。
      map: [{ type: 'capture_zone', icon: 'none', x: 0.3, y: 0.6 }],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    const first = await watcher.poll();
    expect(first.map((event) => event.kind)).toEqual(['enter']);
    expect(watcher.currentSnapshot.groundSpeedKmh).toBe(58);
    // 载具名也认上了（indicators.type 有值），不再走「载具待生成」。
    expect(watcher.currentSnapshot.readings?.vehiclePending).not.toBe(true);
  });

  it('/indicators.speed 缺字段时回落地图位移法', async () => {
    let clock = 210_000;
    const routes: Routes = {
      state: { valid: false },
      indicators: { valid: true, known: true, type: 'tankModels/it_centauro_rgo_120', army: 'tank' },
      mapInfo,
      map: [{ type: 'ground_model', icon: 'Player', x: 0.5, y: 0.5 }],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    clock += 1500;
    (routes.map as Array<{ x: number }>)[0].x = 0.505;
    await watcher.poll();
    const speed = watcher.currentSnapshot.groundSpeedKmh as number;
    expect(speed).toBeGreaterThan(20);
    expect(speed).toBeLessThan(40);
  });

  it('空战不拿 /indicators.speed 当对地速度', async () => {
    let clock = 220_000;
    const routes: Routes = {
      state: { valid: true, 'IAS, km/h': 573, 'H, m': 576 },
      indicators: { valid: true, known: true, type: 'jf_17', army: 'air', speed: 500 },
      mapInfo,
      map: [],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock });
    await watcher.poll();
    expect(watcher.currentSnapshot.groundSpeedKmh).toBeUndefined();
    expect(watcher.currentSnapshot.army).toBe('air');
  });
});
