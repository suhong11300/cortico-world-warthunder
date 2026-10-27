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
    expect(line).toEqual({ killer: '迪特里希', victim: '勃兰特' });
    expect(parseKillLine('PlayerX destroyed PlayerY')).toEqual({ killer: 'PlayerX', victim: 'PlayerY' });
  });

  it('没有终局动词、或动词出现在开头时不给结果', () => {
    expect(parseKillLine('注意战术地图!')).toBeNull();
    expect(parseKillLine('击毁了 T-34')).toBeNull();
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
        { id: 1, msg: 'Ace destroyed T-34' },
        { id: 2, msg: 'PlayerX destroyed PlayerY' },
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
        { id: 1, msg: 'Ace destroyed T-34' },
        { id: 2, msg: 'Ace 摧毁了 T-34' },
        { id: 3, msg: 'Ace 击毁了 T-34' },
      ],
    };
    await watcher.poll();
    expect(watcher.tally.kills).toBe(1);
    // 换成另一个目标就照常计数
    routes.hud = { events: [], damage: [{ id: 4, msg: 'Ace destroyed IS-2' }] };
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
  it('坐标读 sx/sy,老客户端的 x/y 当兜底', async () => {
    const client = makeClient(() => ({
      map: [
        { icon: 'fighter', type: 'fighter', sx: 0.25, sy: 0.5, color: '#67D756' },
        { icon: 'fighter', type: 'fighter', x: 0.1, y: 0.2, color: '#67D756' },
      ],
    }));
    const objects = await client.mapObjects();
    expect(objects[0].x).toBeCloseTo(0.25);
    expect(objects[0].y).toBeCloseTo(0.5);
    expect(objects[1].x).toBeCloseTo(0.1);
  });

  it('0 敌时文案说明是该模式不显示敌方,不是数据坏了', () => {
    const zh = battleLine({ vehicle: 'T-80BVM', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 17 }, 'zh');
    expect(zh).toContain('地图可见 0 敌 / 17 友');
    expect(zh).toContain('0 属正常');
    const en = battleLine({ vehicle: 'T-80BVM', mode: '', army: '', speed: 0, altitude: 0, enemies: 3, allies: 17 }, 'en');
    expect(en).not.toContain('usually hides');
  });
});