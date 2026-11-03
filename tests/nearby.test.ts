import { describe, expect, it } from 'vitest';
import { BattleClient, BattleWatcher } from '../src/battle.ts';
import { bearingLabel, contactsLine, gridLabel, gridRowLetters, nearbyLine, positionLine } from '../src/copy.ts';

const MAP_INFO = {
  valid: true,
  grid_size: [1600, 1600],
  grid_steps: [225, 225],
  grid_zero: [0, 4000],
  map_max: [4096, 4096],
  map_min: [0, 0],
  hud_type: 1,
  map_generation: 11,
};

function unit(x: number, y: number, color: string, icon = 'MediumTank', type = 'ground_model') {
  // 真机的键名是 color[]，值是 [r,g,b] 数组；写成字符串会走 color 回退分支。
  return { icon, type, x, y, 'color[]': color.split(',').map((part) => Number(part)) };
}

function makeClient(objects: unknown[]) {
  const routes: Record<string, unknown> = {
    '/state': { valid: false },
    '/indicators': { valid: true, known: true, type: 'tankModels/us_hstv_l', army: 'tank' },
    '/map_info.json': MAP_INFO,
    '/map_obj.json': objects,
    '/mission.json': { status: 'running', objectives: null },
    '/hudmsg': { events: [], damage: [] },
    '/gamechat': [],
  };
  const fakeFetch = (async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(routes[path] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl: fakeFetch });
}

describe('附近敌我：按世界坐标算直线距离', () => {
  it('500 m 内只统计半径内的单位', async () => {
    const self = unit(0.5, 0.5, '250,200,30', 'Player');
    const nearEnemy = unit(0.52, 0.5, '250,12,0');
    const farEnemy = unit(0.9, 0.9, '250,12,0');
    const nearAlly = unit(0.5, 0.48, '23,77,255');
    const point = unit(0.51, 0.51, '255,255,255', 'Airfield', 'defending_point');
    const watcher = new BattleWatcher({ client: makeClient([self, nearEnemy, farEnemy, nearAlly, point]), playerName: 'Ace', nearbyRadiusM: 500 });
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    expect(snap.nearby?.radiusM).toBe(500);
    expect(snap.nearby?.enemies).toBe(1);
    expect(snap.nearby?.allies).toBe(1);
    expect(snap.nearby?.points).toBe(1);
    expect(snap.enemies).toBe(2);
    expect(snap.contacts?.length).toBe(3);
    const distances = (snap.contacts ?? []).map((item) => item.distM);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeLessThanOrEqual(100);
  });

  it('半径调小后同一个单位不再计入', async () => {
    const self = unit(0.5, 0.5, '250,200,30', 'Player');
    const enemy = unit(0.6, 0.5, '250,12,0');
    const watcher = new BattleWatcher({ client: makeClient([self, enemy]), playerName: 'Ace', nearbyRadiusM: 200 });
    await watcher.poll();
    expect(watcher.currentSnapshot.nearby?.enemies).toBe(0);
  });

  it('没有自身标记时给出未读到，而不是零敌零友', async () => {
    const watcher = new BattleWatcher({ client: makeClient([unit(0.6, 0.5, '250,12,0')]), playerName: 'Ace' });
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    expect(snap.nearby).toBeUndefined();
    expect(nearbyLine(snap, 'zh')).toContain('未读到');
    expect(contactsLine(snap, 'zh')).toBe('');
  });

  it('文案按距离排序并带图标中文名', async () => {
    const self = unit(0.5, 0.5, '250,200,30', 'Player');
    const enemy = unit(0.503, 0.5, '250,12,0', 'HeavyTank');
    const watcher = new BattleWatcher({ client: makeClient([self, enemy]), playerName: 'Ace', nearbyRadiusM: 500 });
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    expect(nearbyLine(snap, 'zh')).toContain('500 m 内：1 敌');
    expect(nearbyLine(snap, 'zh')).toContain('最近 敌 重坦');
    expect(contactsLine(snap, 'zh')).toContain('敌 重坦');
  });

  it('格号按小地图轴标：横向列用数字、纵向行用小写字母', async () => {
    // 游戏内小地图顶部是 1..7 数字、左侧是 a..g 小写字母；0.4.8 及以前输出「列字母 + 行数字」，方向正好反过来。
    expect(gridRowLetters(0)).toBe('a');
    expect(gridRowLetters(8)).toBe('i');
    expect(gridRowLetters(26)).toBe('aa');
    expect(gridLabel(9, 8, true)).toBe('格 10i');
    expect(gridLabel(0, 0, false)).toBe('grid 1a');

    const self = unit(0.5, 0.5, '250,200,30', 'Player');
    const enemy = unit(0.503, 0.5, '250,12,0', 'HeavyTank');
    const watcher = new BattleWatcher({ client: makeClient([self, enemy]), playerName: 'Ace', nearbyRadiusM: 500 });
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    // grid_zero [0,4000]、step 225：自身 wx 2048 / wy 2048 → 列 9（第 10 列）、行 8（第 9 行 i）。
    expect(positionLine(snap, 'zh')).toContain('格 10i');
    expect(snap.contacts?.[0]?.col).toBeTypeOf('number');
    expect(nearbyLine(snap, 'zh')).toMatch(/格 \d+[a-z]/);
  });
});

describe('对地速度：由地图坐标位移算出', () => {
  it('两次采样之间有位移时报 km/h', async () => {
    let clock = 0;
    const selfA = unit(0.5, 0.5, '250,200,30', 'Player');
    const selfB = unit(0.502, 0.5, '250,200,30', 'Player');
    const routes: Record<string, unknown> = {
      '/state': { valid: false },
      '/indicators': { valid: true, known: true, type: 'tankModels/us_hstv_l', army: 'tank' },
      '/map_info.json': MAP_INFO,
      '/map_obj.json': [selfA],
      '/mission.json': { status: 'running', objectives: null },
      '/hudmsg': { events: [], damage: [] },
      '/gamechat': [],
    };
    const fakeFetch = (async (input: unknown) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(routes[path] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl: fakeFetch });
    const watcher = new BattleWatcher({ client, playerName: 'Ace', now: () => clock });
    await watcher.poll();
    expect(watcher.currentSnapshot.groundSpeedKmh).toBeUndefined();
    clock = 2000;
    routes['/map_obj.json'] = [selfB];
    await watcher.poll();
    // 0.002 × 4096 = 8.192 m，2 秒 → 4.096 m/s ≈ 15 km/h。
    const speed = watcher.currentSnapshot.groundSpeedKmh ?? -1;
    expect(speed).toBeGreaterThanOrEqual(13);
    expect(speed).toBeLessThanOrEqual(16);
  });

  it('原地不动判 0', async () => {
    let clock = 0;
    const self = unit(0.5, 0.5, '250,200,30', 'Player');
    const routes: Record<string, unknown> = {
      '/state': { valid: false },
      '/indicators': { valid: true, known: true, type: 'tankModels/us_hstv_l', army: 'tank' },
      '/map_info.json': MAP_INFO,
      '/map_obj.json': [self],
      '/mission.json': { status: 'running', objectives: null },
      '/hudmsg': { events: [], damage: [] },
      '/gamechat': [],
    };
    const fakeFetch = (async (input: unknown) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(routes[path] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl: fakeFetch });
    const watcher = new BattleWatcher({ client, playerName: 'Ace', now: () => clock });
    await watcher.poll();
    clock = 1500;
    await watcher.poll();
    expect(watcher.currentSnapshot.groundSpeedKmh).toBe(0);
  });
});

describe('目标方位：相对车头自洽计算，不依赖地图定标', () => {
  it('方位词按偏角分段，正负两侧都不写左右', () => {
    expect(bearingLabel(0, true)).toBe('正前');
    expect(bearingLabel(15, true)).toBe('正前');
    expect(bearingLabel(45, true)).toBe('前偏 45°');
    expect(bearingLabel(-45, true)).toBe('前偏 45°');
    expect(bearingLabel(90, true)).toBe('侧方 90°');
    expect(bearingLabel(-140, true)).toBe('后偏 140°');
    expect(bearingLabel(175, true)).toBe('正后');
    expect(bearingLabel(0, false)).toBe('ahead');
  });

  it('正东的敌人落在正前、正北落在侧方、正西落在正后', async () => {
    // 朝向 dx=1 dy=0（朝 +x）。目标与自己同用 /map_obj.json 的坐标系，所以相减即可，不需要知道 y 轴朝哪。
    const self = { ...unit(0.5, 0.5, '250,200,30', 'Player'), dx: 1, dy: 0 };
    const east = unit(0.55, 0.5, '250,12,0', 'HeavyTank');
    const north = unit(0.5, 0.55, '250,12,0', 'MediumTank');
    const west = unit(0.45, 0.5, '250,12,0', 'SPAA');
    const watcher = new BattleWatcher({ client: makeClient([self, east, north, west]), playerName: 'Ace', nearbyRadiusM: 600 });
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    const byIcon = new Map((snap.contacts ?? []).map((entry) => [entry.icon, entry]));
    expect(byIcon.get('HeavyTank')?.bearingDeg).toBe(0);
    expect(byIcon.get('MediumTank')?.bearingDeg).toBe(90);
    expect(Math.abs(byIcon.get('SPAA')?.bearingDeg ?? 0)).toBe(180);
    expect(nearbyLine(snap, 'zh')).toContain('正前');
    expect(nearbyLine(snap, 'zh')).toContain('正后');
  });
});
