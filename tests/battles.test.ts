import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_BATTLE_KEEP,
  appendBattleRecord,
  battleLogPath,
  clockLabel,
  formatBattleLine,
  readBattleLog,
} from '../src/battles.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'wt-battles-'));
}

const sample = { vehicle: 'su_30mk2v', kills: 3, deaths: 1, seconds: 840, startedAt: 1_000, endedAt: 1_840_000 };

describe('赛后复盘存档', () => {
  it('第一次追加就发 #1，编号一把一把往上走', () => {
    const dir = scratch();
    expect(readBattleLog(dir).items).toEqual([]);
    const first = appendBattleRecord(dir, sample, 3);
    expect(first.seq).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].seq).toBe(1);
    const second = appendBattleRecord(dir, { ...sample, kills: 0, deaths: 2 }, 3);
    expect(second.items.map((row) => row.seq)).toEqual([1, 2]);
    expect(readBattleLog(dir).items.map((row) => row.kills)).toEqual([3, 0]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('保留数量是硬上限五把，超出的最早那把被挤掉', () => {
    const dir = scratch();
    for (let i = 1; i <= 7; i += 1) appendBattleRecord(dir, { ...sample, kills: i }, 99);
    const log = readBattleLog(dir);
    expect(log.items).toHaveLength(MAX_BATTLE_KEEP);
    expect(log.items.map((row) => row.kills)).toEqual([3, 4, 5, 6, 7]);
    expect(log.items.at(-1)?.seq).toBe(7);
    expect(log.seq).toBe(8);
    rmSync(dir, { recursive: true, force: true });
  });

  it('保留数设成 0 时只推进编号、不留明细', () => {
    const dir = scratch();
    appendBattleRecord(dir, sample, 3);
    const off = appendBattleRecord(dir, { ...sample, kills: 9 }, 0);
    expect(off.items).toEqual([]);
    expect(off.seq).toBe(3);
    const back = appendBattleRecord(dir, { ...sample, kills: 1 }, 2);
    expect(back.items.map((row) => row.seq)).toEqual([3]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('坏 JSON 与缺字段的行都当作没有，不抛错', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'wt'), { recursive: true });
    writeFileSync(battleLogPath(dir), '{划掉的口子', 'utf8');
    expect(readBattleLog(dir)).toEqual({ version: 1, seq: 1, items: [] });

    writeFileSync(battleLogPath(dir), JSON.stringify({ version: 1, seq: 4, items: [{ seq: 1 }, { seq: 2, kills: 5, deaths: 0, vehicle: 'x', seconds: 60, startedAt: 0, endedAt: 0 }] }), 'utf8');
    const log = readBattleLog(dir);
    expect(log.seq).toBe(4);
    expect(log.items.map((row) => row.seq)).toEqual([2]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('一行复盘写清编号、载具、杀/死、时长与结束时刻', () => {
    const line = formatBattleLine({ seq: 3, vehicle: 'su_30mk2v', kills: 3, deaths: 1, seconds: 840, startedAt: 0, endedAt: 0 });
    expect(line).toBe('#3 · su_30mk2v · 3 杀 1 死 · 14 分钟');
    const stamped = formatBattleLine({ seq: 1, vehicle: '', kills: 0, deaths: 0, seconds: 0, startedAt: 0, endedAt: 1_840_000 });
    expect(stamped.startsWith('#1 · 0 杀 0 死')).toBe(true);
    expect(stamped).toContain(clockLabel(1_840_000));
    rmSync(scratch(), { recursive: true, force: true });
  });
});
