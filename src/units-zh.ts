import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 载具中文名对照表（来自官方客户端拆包的语言表，gszabi99/War-Thunder-Datamine 的 units.csv）。
 *
 * 8111 的 /indicators.type 只给内部名（it_centauro_rgo_120），玩家在游戏里看到的是
 * 「半人马 RGO」。这张表把内部名对到中文名，播报与查询时附在内部名前面，好让玩家核对。
 *
 * 表里 240 条带客户端的 ▄(U+2584) 与零宽字符，读进来统一清掉。
 * 查不到就返回空串——调用方退回内部名，绝不编一个名字出来。
 */
const CTRL = /[\u2580-\u259F\u200B-\u200F\u00AD\uFEFF\u2060]/g;

let cache: Map<string, string> | null = null;
let cachedDir = '';

/** <dataDir>/wt/units-zh.json 的绝对路径（与 kb.json 同级）。 */
export function unitsZhPath(dataDir: string): string {
  return join(dataDir, 'wt', 'units-zh.json');
}

/** 读一次表并缓存；文件不在就返回空表（功能退化成「只报内部名」）。 */
export function loadUnitsZh(dataDir: string): Map<string, string> {
  if (cache && cachedDir === dataDir) return cache;
  const map = new Map<string, string>();
  try {
    const raw = readFileSync(unitsZhPath(dataDir), 'utf8');
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      const name = String(value ?? '').replace(CTRL, '').trim();
      if (!key || !name) continue;
      map.set(key.trim().toLowerCase(), name);
    }
  } catch {
    // 没有表、表坏了、路径不对：都退回内部名，不报错打断播报。
  }
  cache = map;
  cachedDir = dataDir;
  return map;
}

/** 内部名 → 中文名；查不到返回空串。 */
export function vehicleZh(dataDir: string, internal: string): string {
  const map = loadUnitsZh(dataDir);
  if (map.size === 0 || !internal) return '';
  // /indicators.type 可能带 tankModels/ 之类前缀，只看最后一段。
  const slash = internal.lastIndexOf('/');
  const base = (slash >= 0 ? internal.slice(slash + 1) : internal).trim().toLowerCase();
  if (!base) return '';
  const direct = map.get(base);
  if (direct) return direct;
  // 表里同一台载具有 _shop / _0 / _1 等变体行，主 id 是去掉后缀的那个。
  const stripped = base.replace(/_(shop|\d+)$/, '');
  const hit = map.get(stripped);
  if (hit) return hit;
  return '';
}
