/**
 * 桌面宠物鸿酱 2026-10-27 的缺陷报告回归测试。
 *
 * 报告针对 0.2.7：P0 把全场击杀算成自己的、P1 中文事件被过滤 / 聊天阵营自相矛盾 /
 * 富文本没清、P2 小地图坐标字段与 0 敌文案。这里逐条钉住修好之后的行为。
 */
import { describe, it, expect } from 'vitest';
import {
  BattleClient,
  BattleWatcher,
  computeSelfDeaths,
  computeSelfKills,
  isSelfKill,
  normalizePlayerName,
  parseKillLine,
} from '../src/battle.ts';
import { battleLine, chatBlock, chatChannelLabel, chatChannelOf } from '../src/copy.ts';

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: Array<{ id: number; msg?: string }>; damage: Array<{ id: number; msg?: string }> };
  map?: unknown[];
  mission?: unknown;
  mapInfo?: unknown;
  chat?: Array<{ id: number; msg?: string; sender?: string; enemy?: boolean; mode?: string }>;
}

function makeClient(read: () => Routes) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    const routes = read();
    let body: unknown = {};
    if (url.includes('/hudmsg')) {
      const evt = Number((url.match(/lastEvt=(-?\\d+)/) ?? [])[1] ?? -1);
      const dmg = Number((url.match(/lastDmg=(-?\\d+)/) ?? [])[1] ?? -1);
      const hud = routes.hud ?? { events: [], damage: [] };
      body = { events: hud.events.filter((item) => item.id > evt), damage: hud.damage.filter((item) => item.id > dmg) };
    } else if (url.includes('/gamechat')) {
      const cursor = Number((url.match(/lastId=(-?\\d+)/) ?? [])[1] ?? 0);
      body = (routes.chat ?? []).filter((item) => item.id > cursor);
    } else if (url.includes('/state')) {
      body = routes.state ?? {};
    } else if (url.includes('/indicators')) {
      body = routes.indicators ?? {};
    } else if (url.includes('/mission.json')) {
      body = routes.mission ?? {};
    } else if (url.includes('/map_info.json')) {
      body = routes.mapInfo ?? {};
    } else if (url.includes('/map_obj.json')) {
      body = routes.map ?? [];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }) as unknown as typeof globalThis.fetch;
  return new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl });
}

const inBattle = { valid: true, map_valid: true, vehicle_type: 'P-51D-30', game_mode: 'domination', army: 'usa' };
const flying = { valid: true, speed: 480, altitude: 2100, type: 'P-51D-30' };

describe('P0 击杀归属:damage 是全场 kill feed', () => {
  it('中文播报拆得出发起者与被击毁者,并去掉载具括号', () => {
    const line = parseKillLine('迪特里希 (◄EMBT) 击毁了 勃兰特 (T-80BVM)');
    expect(line).toMatchObject({ killer: '迪特里希', victim: '勃兰特', killerTagged: true, victimTagged: true });
    expect(parseKillLine('PlayerX destroyed PlayerY (M4A1)')).toMatchObject({ killer: 'PlayerX', victim: 'PlayerY', victimTagged: true });
  });

  it('没有终局动词、或动词出现在开头时不给结果', () => {
    expect(parseKillLine('注意战术地图!')).toBeNull();
    expect(parseKillLine(' 击毁了 T-34 (M4A1)')).toBeNull();
    expect(parseKillLine('')).toBeNull();
  });

  it('isSelfKill 只认昵称命中,空昵称一律不认领', () => {
    const mine = { killer: 'Qing#11 (M1A1 HC)', victim: 'LeCuk' };
    expect(isSelfKill(mine, 'Qing#11')).toBe(true);
    expect(isSelfKill(mine, 'MyGO')).toBe(false);
    expect(isSelfKill(mine, '')).toBe(false);
  });

  it('零宽空格会让按名字匹配对不上,归一化后能对上', () => {
    const dirty = '^MyGO^ 羽\u200b丘千早丰川祥';
    expect(normalizePlayerName(dirty)).toBe(normalizePlayerName('^MyGO^ 羽丘千早丰川祥'));
  });

  it('别人的击杀不计进本局战绩', async () => {
    const routes: Routes = { state: inBattle, indicators: flying, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Ace' });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(['enter']);
    routes.hud = {
      events: [],
      damage: [
        { id: 1, msg: 'Ace destroyed T-34 (M4A1)' },
        { id: 2, msg: 'PlayerX destroyed PlayerY (M4A1)' },
        { id: 3, msg: '迪特里希 (◄EMBT) 击毁了 勃兰特 (T-80BVM)' },
      ],
    };
    const events = await watcher.poll();
    expect(events.filter((event) => event.kind === 'kill')).toHaveLength(1);
    expect(watcher.tally).toEqual({ kills: 1, deaths: 0, bestStreak: 1 });
  });

  it('同一次击毁连着吐多条播报,八秒内只算一次', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: flying, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => clock, playerName: 'Ace' });
    await watcher.poll();
    routes.hud = {
      events: [],
      damage: [
        { id: 1, msg: 'Ace destroyed T-34 (M4A1)' },
        { id: 2, msg: 'Ace 摧毁了 T-34 (M4A1)' },
        { id: 3, msg: 'Ace 击毁了 T-34 (M4A1)' },
      ],
    };
    await watcher.poll();
    expect(watcher.tally.kills).toBe(1);
    // 换成另一个目标就照常计数
    routes.hud = { events: [], damage: [{ id: 4, msg: 'Ace destroyed IS-2 (M4A1)' }] };
    await watcher.poll();
    expect(watcher.tally.kills).toBe(2);
  });
});

describe('P1 中文事件与对局聊天', () => {
  it('中文客户端的占领提示不再被过滤', async () => {
    const routes: Routes = { state: inBattle, indicators: flying, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Ace' });
    await watcher.poll();
    routes.hud = { events: [{ id: 9, msg: '我方占领了战区 A' }], damage: [] };
    const events = await watcher.poll();
    expect(events.filter((event) => event.kind === 'hud')).toHaveLength(1);
  });

  it('聊天里的 color 标签清掉,网格坐标保留', async () => {
    const client = makeClient(() => ({
      chat: [{ id: 1, msg: '注意战术地图!<color=#FF00FF50> [e6]</color>', sender: '阿诺德', enemy: false, mode: '友军' }],
    }));
    const lines = await client.gamechat(0);
    expect(lines[0].msg).toBe('注意战术地图! [e6]');
    const text = chatBlock(lines.map((line) => ({ sender: line.sender, msg: line.msg, enemy: line.enemy, mode: line.mode })), 'zh');
    expect(text).toContain('[我方] 阿诺德');
    expect(text).toContain('[e6]');
    expect(text).not.toContain('color');
  });

  it('频道按中英两套文案归一,认不出的原样保留', () => {
    expect(chatChannelOf('友军')).toBe('team');
    expect(chatChannelOf('所有人')).toBe('all');
    expect(chatChannelOf('小队')).toBe('squad');
    expect(chatChannelOf('Team')).toBe('team');
    expect(chatChannelOf('某个新频道')).toBe('');
    expect(chatChannelLabel('所有人', 'zh')).toBe('全体');
    expect(chatChannelLabel('友军', 'en')).toBe('team');
    expect(chatChannelLabel('', 'zh')).toBe('对局');
  });
});

describe('P2 小地图读数', () => {
  it('坐标读 x/y,只有区域对象才退回 sx/sy', async () => {
    const client = makeClient(() => ({
      map: [
        // 单位：真机只给 x/y，地图外目标会超出 0..1。
        { icon: 'fighter', type: 'aircraft', x: 2.333, y: 4.667, color: '#67D756' },
        // 两种字段同时在时以 x/y 为准，不能拿机场角点当单位坐标。
        { icon: 'fighter', type: 'aircraft', x: 0.1, y: 0.2, sx: 0.9, sy: 0.8, color: '#67D756' },
        // 机场这类区域对象没有 x/y，只有起始角点。
        { icon: 'none', type: 'airfield', sx: 0.25, sy: -1.6, ex: 0.24, ey: -1.5, color: '#174DFF' },
      ],
    }));
    const objects = await client.mapObjects();
    expect(objects[0].x).toBeCloseTo(2.333);
    expect(objects[0].y).toBeCloseTo(4.667);
    expect(objects[1].x).toBeCloseTo(0.1);
    expect(objects[1].y).toBeCloseTo(0.2);
    expect(objects[2].x).toBeCloseTo(0.25);
    expect(objects[2].y).toBeCloseTo(-1.6);
  });

  it('可见对象数不进默认战局行,也不凭空判断游戏模式', () => {
    const zh = battleLine({ vehicle: 'T-80BVM', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 17 }, 'zh');
    expect(zh).toContain('T-80BVM');
    expect(zh).not.toContain('图上');
    expect(zh).not.toContain('非全场总数');
    expect(zh).not.toContain('该模式');
    const en = battleLine({ vehicle: 'T-80BVM', mode: '', army: '', speed: 0, altitude: 0, enemies: 3, allies: 17 }, 'en');
    expect(en).not.toContain('usually hides');
  });
});

describe('P8 判重窗口：id 为主、time 为辅', () => {
  const row = (id: number, time: number, msg: string) => ({ id, time, msg, type: '', sender: '' });

  it('两个不同战局里同一对玩家在相近秒数互相击毁，不会被当成重复而漏计', () => {
    // 真机实测：同一份全量 feed 里 time 跨局回绕(id 337 是 t333，id 343 却是 t153)，
    // 旧实现只在 time 差 <8s 时判重，两个战局同一秒发生的同 pair 击毁就会被合并成一条。
    const damage = [row(337, 300, 'Ace 击毁了 T-34 (M4A1)'), row(343, 300, 'Ace 击毁了 T-34 (M4A1)')];
    const kills = computeSelfKills(damage, { afterId: -1, playerName: 'Ace' });
    expect(kills).toHaveLength(2);
  });

  it('同一次击毁的多条播报 id 挨着且同一秒，仍然只算一条', () => {
    const damage = [row(337, 300, 'Ace 击毁了 T-34 (M4A1)'), row(338, 300, 'Ace 击落了 T-34 (M4A1)')];
    expect(computeSelfKills(damage, { afterId: -1, playerName: 'Ace' })).toHaveLength(1);
  });
});

describe('P9 在局判定：地图端点说没地图就不算在局', () => {
  it('mission 还报 running 但地图端点 valid:false，按不在局处理（机库就是这样）', async () => {
    // 真机 2026-11-02 机库：/state 与 /indicators 都 valid:true、/mission.json 仍报
    // status=running，只有 /map_info.json 是 {"valid":false}、/map_obj.json 是空数组。
    // 早先"三选一"的口径会把机库判成在战局，于是气泡说"在战局里"还挂出上一局的战绩。
    const routes: Routes = {
      state: { valid: true, 'IAS, km/h': 0, 'H, m': 32 },
      indicators: { valid: true, type: 'ah_64e', army: 'air' },
      mission: { status: 'running', objectives: null },
      mapInfo: { valid: false },
      map: [],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Ace' });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual([]);
    expect(watcher.inBattleNow).toBe(false);
  });

  it('地图端点读不到时（readMap 关），mission 的 running 仍算在局', async () => {
    const routes: Routes = {
      state: { valid: false },
      indicators: { valid: true, type: 'su_30mk2v_venezuela', army: 'air' },
      mission: { status: 'running', objectives: [{ text: '协助地面部队' }] },
      map: [],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Ace' });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(['enter']);
  });

  it('mission 已结束时，地图端点未就绪仍算离场，残留单位撑不起在局', async () => {
    const routes: Routes = {
      state: inBattle,
      indicators: flying,
      mission: { status: 'ended', objectives: [] },
      mapInfo: { valid: false },
      map: [],
      hud: { events: [], damage: [] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: 'Ace' });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual([]);
    expect(watcher.inBattleNow).toBe(false);
  });
});

describe('P10 零宽字符：真机 feed 的动词被 U+200B 拆开', () => {
  // 2026-11-02 真机 /hudmsg 155 条里 139 条含 U+200B：「击毁了」在字节层是 击+ZWSP+毁+ZWSP+了。
  // looksLikeKill 早先在原文上 includes("击毁了")，于是整份 feed 被判成没有击杀、战果恒 0/0。
  const killer = '^MyGO^ 羽丘千早丰川祥';
  const ZW = '\u200b';
  it('击杀：被零宽拆开的动词仍能归因到自己', () => {
    const msg = killer + " (▄\u200b苏-30MK2 AMV “侧\u200b卫-G”) 击\u200b毁\u200b了 昔涟 是爱 是桃子 (T-80BVM)";
    const hits = computeSelfKills([{ id: 500, time: 46, msg, type: '', sender: '' }], { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.victim).toBe('昔涟 是爱 是桃子');
  });

  it('AI 目标：同类真机行的 victim 只有载具名，不计入个人击杀', () => {
    const msg = killer + " (▄\u200b苏-30MK2 AMV “侧\u200b卫-G”) 击\u200b毁\u200b了 IPM1";
    const hits = computeSelfKills([{ id: 501, time: 47, msg, type: '', sender: '' }], { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(hits).toHaveLength(0);
  });
  it('阵亡：被零宽拆开的击落同样计入自己', () => {
    const msg = "Enemy (HSTV-L) 击" + ZW + "落" + ZW + "了 " + killer + " (HSTV-L)";
    const deaths = computeSelfDeaths([{ id: 360, time: 12, msg, type: '', sender: '' }], { afterId: -1, playerName: '羽丘千早丰川祥' });
    expect(deaths).toHaveLength(1);
  });
  it('无人机自行坠毁既不算击杀也不算阵亡', () => {
    const msg = killer + " (微型侦察无人机) 已" + ZW + "坠" + ZW + "毁。";
    const feed = [{ id: 504, time: 55, msg, type: '', sender: '' }];
    expect(computeSelfKills(feed, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
    expect(computeSelfDeaths(feed, { afterId: -1, playerName: '羽丘千早丰川祥' })).toHaveLength(0);
  });
});

describe('P12 接入前的不计：只认入局基线之后的新行', () => {
  const row = (id: number, time: number, msg: string) => ({ id, time, msg, type: "", sender: "" });
  const inBattleState = { valid: true, map_valid: true, vehicle_type: "fixture-plane" };
  const runningMission = { status: "running" };

  it("入局前已经打过的战绩一条都不算，之后的新行照常归因", async () => {
    const damage = [
      row(10, 200, "Ace destroyed Old1 (M4A1)"),
      row(11, 230, "Ace destroyed Old2 (M4A1)"),
      row(20, 5, "Ace destroyed T-34 (M4A1)"),
      row(21, 9, "Enemy destroyed Ace (M4A1)"),
      row(22, 20, "Ace destroyed T-62 (M4A1)"),
    ];
    const routes: Routes = {
      state: inBattleState,
      indicators: { valid: true, type: "fixture-plane" },
      mission: runningMission,
      mapInfo: { valid: true },
      map: [],
      hud: { events: [], damage },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: "Ace" });
    const events = await watcher.poll();
    expect(events.map((event) => event.kind)).toEqual(["enter"]);
    expect(watcher.tally).toEqual({ kills: 0, deaths: 0, bestStreak: 0 });

    (routes.hud as any).damage = [...damage, row(23, 30, "Ace destroyed IS-2 (M4A1)")];
    const next = await watcher.poll();
    expect(next.map((event) => event.kind)).toEqual(["kill"]);
    expect(watcher.tally.kills).toBe(1);
  });

  it("没离场就换了局：time 回退把旧局封存，新局从零起算", async () => {
    const first = [
      row(30, 10, "Ace destroyed T-34 (M4A1)"),
      row(31, 20, "Ace destroyed T-62 (M4A1)"),
    ];
    const routes: Routes = {
      state: inBattleState,
      indicators: { valid: true, type: "fixture-plane" },
      mission: runningMission,
      mapInfo: { valid: true },
      map: [],
      hud: { events: [], damage: [...first] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: "Ace" });
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(["enter"]);

    (routes.hud as any).damage = [...first, row(32, 30, "Ace destroyed IS-2 (M4A1)")];
    expect((await watcher.poll()).map((event) => event.kind)).toEqual(["kill"]);
    expect(watcher.tally.kills).toBe(1);

    // 第二局：time 从 0 重新计，id 继续涨，中间没抓到地图卸载那一瞬。
    (routes.hud as any).damage = [
      ...first,
      row(32, 30, "Ace destroyed IS-2 (M4A1)"),
      row(33, 4, "Ace destroyed M4 (M4A1)"),
      row(34, 8, "Ace destroyed T-34 (M4A1)"),
    ];
    const rotate = await watcher.poll();
    expect(rotate.map((event) => event.kind)).toEqual(["leave", "enter", "kill", "kill"]);
    const left = rotate[0] as { kind: string; summary: { kills: number } };
    expect(left.summary.kills).toBe(1);
    expect(watcher.tally).toEqual({ kills: 2, deaths: 0, bestStreak: 2 });

    // 切过之后旧行不再重复计入。
    expect((await watcher.poll()).map((event) => event.kind)).toEqual([]);
    expect(watcher.tally.kills).toBe(2);
  });

  it("上一局 enter 还挂着就切到下一局：只发一条 enter，也不补一条 leave", async () => {
    const first = [
      row(30, 10, "Ace destroyed T-34 (M4A1)"),
      row(31, 20, "Ace destroyed T-62 (M4A1)"),
    ];
    const routes: Routes = {
      state: inBattleState,
      // 加载画面：载具还是占位模型，这一拍不该播 enter
      indicators: { valid: true, type: "dummy_plane" },
      mission: runningMission,
      mapInfo: { valid: true },
      map: [],
      hud: { events: [], damage: [...first] },
    };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), now: () => 100_000, playerName: "Ace" });
    expect(await watcher.poll()).toEqual([]);

    // 还没播 enter 就又切局：真载具读出来了，feed 里 time 回退
    (routes as any).indicators = { valid: true, type: "fixture-plane" };
    (routes.hud as any).damage = [
      ...first,
      row(32, 30, "Ace destroyed IS-2 (M4A1)"),
      row(33, 4, "Ace destroyed M4 (M4A1)"),
      row(34, 8, "Ace destroyed T-34 (M4A1)"),
    ];
    const kinds = (await watcher.poll()).map((event) => event.kind);
    // 上一局根本没进过场，补一条 leave 就是凭空报离场
    expect(kinds).not.toContain("leave");
    // 一局只能有一条 enter：切局那条走挂起，不会再补出第二条
    expect(kinds.filter((kind) => kind === "enter")).toHaveLength(1);
    expect(kinds[0]).toBe("enter");
    // 下一条拍也不许再补
    expect((await watcher.poll()).map((event) => event.kind)).not.toContain("enter");
  });
});
