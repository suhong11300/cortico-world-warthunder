import { describe, expect, it } from 'vitest';
import { BattleClient, BattleWatcher } from '../src/battle.ts';
import { gridLabel, situationLine, zonesLine } from '../src/copy.ts';

// 真机样本（2026-11-03 陆战）：map 跨度 1800 m、格 250 m，
// 三个占领点 A/B/C 由客户端直接给出，颜色区分控制方（A/C 敌红、B 友蓝）。
const MAP_INFO = {
  valid: true,
  grid_size: [1800, 1800],
  grid_steps: [250, 250],
  grid_zero: [1119.87, 3694.04],
  map_min: [1119.87, 1894.04],
  map_max: [2919.87, 3694.04],
  hud_type: 1,
  map_generation: 29,
};

const PLAYER = { icon: 'Player', type: 'ground_model', x: 0.589289, y: 0.066772, 'color[]': [250, 200, 30], dx: 0.11, dy: 0.99 };

function zone(id: number, label: string, x: number, y: number, color: number[]) {
  return { icon: 'capture_zone', type: 'capture_zone', x, y, 'color[]': color, zone_id: id, zone_label: label, zone_label_code: label.charCodeAt(0) };
}

const ZONES = [
  zone(0, 'A', 0.167672, 0.517139, [250, 12, 0]),
  zone(1, 'B', 0.473294, 0.511661, [23, 77, 255]),
  zone(2, 'C', 0.868222, 0.487211, [250, 12, 0]),
];

function makeWatcher(objects: unknown[]) {
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
  const client = new BattleClient({ host: '127.0.0.1', port: 8111, fetchImpl: fakeFetch });
  return new BattleWatcher({ client, playerName: 'Ace', nearbyRadiusM: 500 });
}

describe('占领点：/map_obj.json 的 capture_zone', () => {
  it('读出编号、字母标签、控制方与格号', async () => {
    const watcher = makeWatcher([PLAYER, ...ZONES]);
    await watcher.poll();
    const zones = watcher.currentSnapshot.zones ?? [];
    expect(zones.map((item) => item.label)).toEqual(['A', 'B', 'C']);
    expect(zones.map((item) => item.id)).toEqual([0, 1, 2]);
    // 控制方按客户端配色判定：A/C 敌红、B 友蓝。
    expect(zones.map((item) => item.side)).toEqual(['enemy', 'ally', 'enemy']);
    // 世界坐标用 map_min + x*(map_max-map_min)，与其它对象同一套换算。
    const a = zones[0];
    expect(a.worldX).toBe(Math.round(1119.87 + 0.167672 * 1800));
    expect(a.worldY).toBe(Math.round(1894.04 + 0.517139 * 1800));
    expect(typeof a.col).toBe('number');
    expect(typeof a.row).toBe('number');
  });

  it('占领点不算进敌我单位数', async () => {
    const watcher = makeWatcher([PLAYER, ...ZONES]);
    await watcher.poll();
    const snap = watcher.currentSnapshot;
    expect(snap.enemies).toBe(0);
    expect(snap.allies).toBe(0);
    expect(snap.points ?? 0).toBe(0);
  });

  it('zonesLine 给点位、格号与控制方，并说清进度端口不给', async () => {
    const watcher = makeWatcher([PLAYER, ...ZONES]);
    await watcher.poll();
    const line = zonesLine(watcher.currentSnapshot, 'zh');
    expect(line).toContain('占领点 3 个');
    expect(line).toContain('A ');
    expect(line).toContain('敌方控制');
    expect(line).toContain('我方控制');
    expect(line).toContain(gridLabel(watcher.currentSnapshot.zones![0].col!, watcher.currentSnapshot.zones![0].row!, true));
    expect(line).toContain('占领进度端口不给');
    expect(line).not.toContain('未采集');
  });

  it('端口没给占领点时明说未给，不编造', async () => {
    const watcher = makeWatcher([PLAYER]);
    await watcher.poll();
    expect(watcher.currentSnapshot.zones).toBeUndefined();
    expect(zonesLine(watcher.currentSnapshot, 'zh')).toContain('端口未给占领点');
  });

  it('端口没给但 OCR 有线索时，写明线索来自 OCR', async () => {
    const watcher = makeWatcher([PLAYER]);
    await watcher.poll();
    const line = zonesLine({ ...watcher.currentSnapshot, zoneHints: ['B 点 68% 我方'] }, 'zh');
    expect(line).toContain('端口未给占领点');
    expect(line).toContain('B 点 68% 我方');
  });

  it('situationLine 优先用端口占领点，不再落到「未采集」', async () => {
    const watcher = makeWatcher([PLAYER, ...ZONES]);
    await watcher.poll();
    const line = situationLine(watcher.currentSnapshot, 'zh');
    expect(line).toContain('占领点');
    expect(line).toContain('敌控');
    expect(line).not.toContain('未采集');
  });
});
