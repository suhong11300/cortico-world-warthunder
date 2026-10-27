import { describe, it, expect } from 'vitest';
import { BattleClient, BattleWatcher, computeSelfKills } from '../src/battle.ts';
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

/**
 * 和真机 8111 一样按 lastEvt / lastDmg 过滤:传 -1 就是全量。
 *
 * 这里刻意保留 time 字段 —— 真机的 time 是服务端相对秒数(不是 unix 时间),
 * 而同一次击毁的多条播报 time 相同或只差一秒,是判重的主要依据。
 */
function makeClient(read: () => Routes, onUrl?: (url: string) => void) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    onUrl?.(url);
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

const inBattle = { valid: true, map_valid: true, vehicle_type: 'P-51D-30', game_mode: 'domination', army: 'usa' };

/** 把测试夹具的行转成 watcher 看到的 HudEvent(time 缺省为 0,和旧夹具一致)。 */
function toEvents(lines: HudLine[]): HudEvent[] {
  return lines.map((line) => ({ id: line.id, time: line.time ?? 0, type: line.type ?? '', msg: line.msg ?? '', sender: '' }));
}

describe('computeSelfKills:全量重算的纯函数', () => {
  it('只认基线 id 之后的播报', () => {
    const feed = toEvents([
      { id: 5, time: 10, msg: 'Ace 击毁了 T-34' },
      { id: 9, time: 12, msg: 'Ace 击毁了 豹2A6' },
    ]);
    const hits = computeSelfKills(feed, { afterId: 6, playerName: 'Ace' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.victim).toBe('豹2A6');
  });

  it('同一次击毁的多条播报(time 相同)只算一次', () => {
    const feed = toEvents([
      { id: 20, time: 100, msg: 'Ace 击毁了 T-34' },
      { id: 21, time: 100, msg: 'Ace 击毁了 T-34' },
      { id: 22, time: 101, msg: 'Ace 击毁了 T-34' },
    ]);
    const hits = computeSelfKills(feed, { afterId: -1, playerName: 'Ace' });
    expect(hits.length).toBe(1);
    expect(hits[0]?.key).toBe('ace>t-34#1');
  });

  it('两次真击毁(time 隔 30 秒)算两次,幂等键带序号', () => {
    const feed = toEvents([
      { id: 30, time: 200, msg: 'Ace 击毁了 豹2A6' },
      { id: 40, time: 230, msg: 'Ace 击毁了 豹2A6' },
    ]);
    const hits = computeSelfKills(feed, { afterId: -1, playerName: 'Ace' });
    expect(hits.length).toBe(2);
    expect(hits.map((hit) => hit.occurrence)).toEqual([1, 2]);
    expect(hits[0]?.key).not.toBe(hits[1]?.key);
  });

  it('没有 time 时退化为 id 邻近判重', () => {
    const feed = toEvents([
      { id: 50, msg: 'Ace 击毁了 FK-2000' },
      { id: 51, msg: 'Ace 击毁了 FK-2000' },
      { id: 60, msg: 'Ace 击毁了 FK-2000' },
      { id: 70, msg: 'Ace 击毁了 FK-2000' },
    ]);
    const hits = computeSelfKills(feed, { afterId: -1, playerName: 'Ace' });
    expect(hits.length).toBe(3);
  });

  it('别人的击杀与空昵称一概不认领', () => {
    const feed = toEvents([{ id: 80, time: 300, msg: 'Bob 击毁了 T-34' }]);
    expect(computeSelfKills(feed, { afterId: -1, playerName: 'Ace' }).length).toBe(0);
    expect(computeSelfKills(feed, { afterId: -1, playerName: '' }).length).toBe(0);
  });
});

describe('BattleWatcher:击杀计数不再卡死', () => {
  it('每轮都按全量拉取,请求里不带增量游标', async () => {
    const seen: string[] = [];
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes, (url) => seen.push(url)), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    const hudUrls = seen.filter((url) => url.includes('/hudmsg'));
    expect(hudUrls.length).toBeGreaterThan(0);
    expect(hudUrls.every((url) => url.includes('lastDmg=-1') && url.includes('lastEvt=-1'))).toBe(true);
  });

  it('同一批 feed 连拉三轮只计一次', async () => {
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 11, time: 100, msg: 'Ace 击毁了 T-34' }] };
    await watcher.poll();
    await watcher.poll();
    await watcher.poll();
    expect(watcher.tally.kills).toBe(1);
  });

  it('游戏重启后 id 从 1 重新计数,回退检测重建基线,新击杀照常入账', async () => {
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [] };
    for (let id = 100; id <= 110; id += 1) routes.hud.damage.push({ id, time: id, msg: 'Bob 击毁了 目标' + id });
    await watcher.poll();
    routes.hud.damage.push({ id: 111, time: 111, msg: 'Ace 击毁了 T-80U-E1' });
    await watcher.poll();
    expect(watcher.tally.kills).toBe(1);
    // 游戏重启:hudmsg 的 id 从 1 重新计数,全部小于这一局记下的基线 111。
    routes.hud = { events: [], damage: [{ id: 1, time: 5, msg: 'Ace 击毁了 豹2A6' }, { id: 2, time: 6, msg: 'Bob 击毁了 目标' }] };
    const after = await watcher.poll();
    expect(after.filter((event) => event.kind === 'kill').length).toBe(1);
    expect(watcher.tally.kills).toBe(2);
  });

  it('服务端只回旧数据或回空,后续新击杀仍能进账', async () => {
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [], damage: [{ id: 200, time: 200, msg: 'Bob 击毁了 目标' }] };
    await watcher.poll();
    expect(watcher.tally.kills).toBe(0);
    routes.hud.damage.push({ id: 201, time: 201, msg: 'Ace 击毁了 FK-2000' });
    await watcher.poll();
    expect(watcher.tally.kills).toBe(1);
  });

  it('战场播报重复拉取不重复开口', async () => {
    const routes: Routes = { state: inBattle, indicators: { valid: true, speed: 400, altitude: 1000, type: 'P-51' }, hud: { events: [], damage: [] }, map: [] };
    const watcher = new BattleWatcher({ client: makeClient(() => routes), playerName: 'Ace', now: () => 100_000 });
    await watcher.poll();
    routes.hud = { events: [{ id: 300, time: 300, msg: '我方占领了战区 A' }], damage: [] };
    const first = await watcher.poll();
    expect(first.filter((event) => event.kind === 'hud').length).toBe(1);
    const second = await watcher.poll();
    expect(second.filter((event) => event.kind === 'hud').length).toBe(0);
  });
});
