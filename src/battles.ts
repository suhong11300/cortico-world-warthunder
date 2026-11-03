import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 一把打完的战局（赛后复盘用）。8111 没有「第几局」字段，编号只能自己发。 */
export interface BattleRecord {
  /** 第几把，跨会话自增。 */
  seq: number;
  /** 载具标识（/indicators.type 原值，读不到就空串）。 */
  vehicle: string;
  kills: number;
  deaths: number;
  /** 时长（秒）。 */
  seconds: number;
  startedAt: number;
  endedAt: number;
}

export interface BattleLogFile {
  version: 1;
  /** 下一把要用的编号。 */
  seq: number;
  items: BattleRecord[];
}

/** 复盘保留上限：用户要求最多五把。 */
export const MAX_BATTLE_KEEP = 5;

export function battleLogPath(dataDir: string): string {
  return join(dataDir, 'wt', 'battles.json');
}

export function emptyBattleLog(): BattleLogFile {
  return { version: 1, seq: 1, items: [] };
}

function isRecord(value: unknown): value is BattleRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.seq === 'number' && Number.isFinite(row.seq)
    && typeof row.kills === 'number' && Number.isFinite(row.kills)
    && typeof row.deaths === 'number' && Number.isFinite(row.deaths);
}

/** 读复盘存档。坏文件当作空档，别让一段过期 JSON 把整局观测带崩。 */
export function readBattleLog(dataDir: string): BattleLogFile {
  const file = battleLogPath(dataDir);
  let raw: string | null = null;
  try { raw = readFileSync(file, 'utf8'); } catch { raw = null; }
  if (raw === null) return emptyBattleLog();
  try {
    const parsed = JSON.parse(raw) as Partial<BattleLogFile>;
    const items = Array.isArray(parsed.items) ? parsed.items.filter(isRecord) : [];
    const seq = typeof parsed.seq === 'number' && Number.isFinite(parsed.seq) ? parsed.seq : items.length + 1;
    return { version: 1, seq: Math.max(1, Math.trunc(seq)), items: items.slice(-MAX_BATTLE_KEEP) };
  } catch {
    return emptyBattleLog();
  }
}

function writeBattleLog(dataDir: string, file: BattleLogFile): void {
  const target = battleLogPath(dataDir);
  mkdirSync(join(dataDir, 'wt'), { recursive: true });
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
}

/**
 * 追加一把复盘。keep 是保留数量（0 表示只推进编号、不留明细，上限五把）。
 * 写盘失败只丢复盘，不影响局内计数——调用方可以忽略返回值。
 */
export function appendBattleRecord(
  dataDir: string,
  record: Omit<BattleRecord, 'seq'>,
  keep: number,
): BattleLogFile {
  const current = readBattleLog(dataDir);
  const limit = Math.max(0, Math.min(MAX_BATTLE_KEEP, Math.trunc(keep)));
  const saved: BattleRecord = { seq: current.seq, ...record };
  const kept = [...current.items, saved];
  const items = limit === 0 ? [] : kept.slice(-limit);
  const next: BattleLogFile = { version: 1, seq: current.seq + 1, items };
  try {
    writeBattleLog(dataDir, next);
  } catch {
    return current;
  }
  return next;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时间的 HH:MM，只用于复盘列表。 */
export function clockLabel(ms: number): string {
  const at = new Date(ms);
  return pad(at.getHours()) + ':' + pad(at.getMinutes());
}

/** 一行复盘：#3 · su_30mk2v · 3 杀 1 死 · 14 分钟 · 15:20 */
export function formatBattleLine(record: BattleRecord): string {
  const minutes = record.seconds > 0 ? Math.max(1, Math.round(record.seconds / 60)) : 0;
  const bits = ['#' + record.seq];
  if (record.vehicle) bits.push(record.vehicle);
  bits.push(record.kills + ' 杀 ' + record.deaths + ' 死');
  if (minutes > 0) bits.push(minutes + ' 分钟');
  if (record.endedAt > 0) bits.push(clockLabel(record.endedAt));
  return bits.join(' · ');
}
