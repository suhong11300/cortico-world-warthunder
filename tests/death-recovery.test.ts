import { describe, it, expect } from 'vitest';
import { BattleClient, BattleWatcher, computeSelfDeaths, computeSelfKills } from '../src/battle.ts';
import type { HudEvent } from '../src/battle.ts';

interface HudLine {
  id: number;
  time?: number;
  type?: string;
  msg?: string;
}

interface Routes {
  state?: unknown;
  indicators?: unknown;
  hud?: { events: HudLine[]; damage: HudLine[] };
  map?: unknown[];
  mission?: unknown;
  mapInfo?: unknown;
  chat?: Array<{ id: number; msg?: string; sender?: string; enemy?: boolean; mode?: string }>;
}

/** 与真机一样按 lastEvt / lastDmg 过滤：传 -1 就是全量。 */
function makeClient(read: () => Routes) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    const routes = read();
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

const inBattle = { valid: true, map_valid: true, vehicle_type: 'T-80U-E1', game_mode: 'domination', army: 'ussr' };
const alive = { valid: true, known: true };
const dead = { valid: false, known: true };

function toEvents(lines: HudLine[]): HudEvent[] {
  return lines.map((line) => ({ id: line.id, time: line.time ?? 0, type: line.type ?? '', msg: line.msg ?? '', sender: '' }));
}

describe('computeSelfDeaths:阵亡也走全量重算', () => {
  it('victim 是我才算,幂等键带 d: 前缀', () => {
    const feed = toEvents([
      { id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' },
      { id: 9, time: 12, msg: 'Ace 击毁了 豹2A6' },
    ]);
    const hits = computeSelfDeaths(feed, { afterId: -1, playerName: 'Ace' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.killer).toBe('Enemy1');
    expect(hits[0]?.key).toBe('d:enemy1>ace#1');
  });

  it('别人的阵亡不认领', () => {
    const feed = toEvents([
      { id: 5, time: 10, msg: 'Enemy1 击毁了 Bomber2 (T-34)' },
    ]);
    expect(computeSelfDeaths(feed, { afterId: -1, playerName: 'Ace' }).length).toBe(0);
  });

  it('没配昵称时一条都不认', () => {
    const feed = toEvents([{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace' }]);
    expect(computeSelfDeaths(feed, { afterId: -1, playerName: '' }).length).toBe(0);
  });

  it('名字里的零宽字符与大小写不影响匹配', () => {
    const feed = toEvents([{ id: 5, time: 10, msg: 'Enemy\u200b1 击毁了 ACE' }]);
    const hits = computeSelfDeaths(feed, { afterId: -1, playerName: 'ace' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.killer).toBe('Enemy1');
  });

  it('自己把自己打掉只算击杀,不重复算阵亡', () => {
    const feed = toEvents([{ id: 5, time: 10, msg: 'Ace 击毁了 Ace' }]);
    expect(computeSelfDeaths(feed, { afterId: -1, playerName: 'Ace' }).length).toBe(0);
    expect(computeSelfKills(feed, { afterId: -1, playerName: 'Ace' }).length).toBe(1);
  });

  it('同一次阵亡的连发播报只算一次', () => {
    const feed = toEvents([
      { id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' },
      { id: 6, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' },
    ]);
    expect(computeSelfDeaths(feed, { afterId: -1, playerName: 'Ace' }).length).toBe(1);
  });

  it('两次真阵亡算两次,occurrence 递增', () => {
    const feed = toEvents([
      { id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' },
      { id: 60, time: 140, msg: 'Enemy1 击毁了 Ace (M1A1)' },
    ]);
    const hits = computeSelfDeaths(feed, { afterId: -1, playerName: 'Ace' });
    expect(hits.length).toBe(2);
    expect(hits.map((hit) => hit.occurrence)).toEqual([1, 2]);
  });
});

describe('BattleWatcher:阵亡计数不再漏也不再重', () => {
  it('feed 里我被打掉会入账,并喊一次阵亡', async () => {
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' }] };
    const out = await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
    expect(out.filter((event) => event.kind === 'death').length).toBe(1);
  });

  it('同一批 feed 连拉多轮只算一次', async () => {
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' }] };
    await watcher.poll();
    await watcher.poll();
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
  });

  it('indicators 先计、feed 随后认领时不重复累加', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => clock });
    await watcher.poll();
    clock = 101_500;
    routes.indicators = dead;
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
    clock = 103_000;
    routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' }] };
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
    clock = 130_000;
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
  });

  it('feed 认领之后 indicators 同轮的失效不会再计一次', async () => {
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.indicators = dead;
    routes.hud = { events: [], damage: [{ id: 5, time: 10, msg: 'Enemy1 击毁了 Ace (M1A1)' }] };
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
  });

  it('indicators 失效本身仍然兜底计一次(坠机这类 feed 里没有击毁行)', async () => {
    let clock = 100_000;
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => clock });
    await watcher.poll();
    clock = 101_500;
    routes.indicators = dead;
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
    clock = 103_000;
    routes.indicators = alive;
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
  });

  it('游戏重启后 feed id 回退,新的阵亡仍然入账', async () => {
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 100, time: 900, msg: 'Enemy1 击毁了 Ace (M1A1)' }] };
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(1);
    routes.hud = { events: [], damage: [{ id: 2, time: 3, msg: 'Enemy2 击毁了 Ace (T-80U)' }] };
    await watcher.poll();
    expect(watcher.tally.deaths).toBe(2);
  });

  it('三杀一死的真实形状:kills 与 deaths 各归各', async () => {
    const routes: Routes = { state: inBattle, indicators: alive, hud: { events: [], damage: [] } };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = {
      events: [],
      damage: [
        { id: 10, time: 20, msg: 'Ace 击毁了 豹2A6 (Leopard 2A6)' },
        { id: 11, time: 21, msg: 'Enemy1 击毁了 Ace (Su-30MK2)' },
        { id: 20, time: 40, msg: 'Ace 击毁了 FK-2000 (FK-2000)' },
        { id: 30, time: 60, msg: 'Ace 击毁了 FK-2000 (FK-2000)' },
      ],
    };
    await watcher.poll();
    expect(watcher.tally.kills).toBe(3);
    expect(watcher.tally.deaths).toBe(1);
  });
});
