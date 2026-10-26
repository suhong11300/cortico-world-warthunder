/**
 * 战争雷霆客户端自带的本地遥测(REST,默认 http://127.0.0.1:8111)。
 *
 * 这套接口随客户端一起发布,但 Gaijin 没有公开文档与兼容承诺:字段随版本增删、
 * 端口只在启动时决定、只监听本机。所以这里每一个字段都当成"可能不存在"来处理,
 * 任何一次读取失败都只返回 null,不抛错、不重试风暴。
 */

export interface GameState {
  valid: boolean;
  mapValid: boolean;
  vehicle: string;
  mode: string;
  army: string;
}

export interface Indicators {
  valid: boolean;
  speed: number;
  altitude: number;
  type: string;
}

export interface HudEvent {
  id: number;
  time: number;
  type: string;
  msg: string;
  sender: string;
}

export interface HudSnapshot {
  events: HudEvent[];
  damage: HudEvent[];
}

export interface MapObject {
  icon: string;
  type: string;
  x: number;
  y: number;
}

export interface BattleSnapshot {
  vehicle: string;
  mode: string;
  army: string;
  speed: number;
  altitude: number;
  enemies: number;
  allies: number;
}

export interface BattleSummary {
  vehicle: string;
  kills: number;
  deaths: number;
  seconds: number;
}

export type BattleEvent =
  | { kind: 'enter'; snapshot: BattleSnapshot }
  | { kind: 'leave'; summary: BattleSummary }
  | { kind: 'kill'; total: number; streak: number; detail: string; snapshot: BattleSnapshot }
  | { kind: 'death'; total: number; snapshot: BattleSnapshot }
  | { kind: 'behind'; kills: number; deaths: number; snapshot: BattleSnapshot }
  | { kind: 'hud'; detail: string };

export interface BattleClientOptions {
  host: string;
  port: number;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface BattleWatcherOptions {
  client: BattleClient;
  now?: () => number;
  /** 阵亡多少秒后可以再判一次,避免同一局反复触发。 */
  deathCooldownMs?: number;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function toHudEvent(raw: unknown): HudEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = num(item.id, -1);
  if (id < 0) return null;
  return {
    id,
    time: num(item.time),
    type: str(item.type),
    msg: str(item.msg),
    sender: str(item.sender),
  };
}

/** 击毁类关键字:不同版本的消息措辞不一样,统一用包含匹配兜一层。 */
const KILL_WORDS = ['destroyed', 'killed', 'shot down', 'burned', 'shattered', '击毁', '击落'];
/**
 * 一次轮询里最多为几条击毁各推一个事件。
 *
 * 客户端暂停恢复或长局积压时,hudmsg 可能一口气吐出几十条,每条都要走一次模型:
 * 一次风暴就能把一天的额度烧完。所以超出的只累加战绩,不再逐条开口。
 */
const MAX_KILL_EVENTS = 3;
/** 全战场播报里最多取几条当素材。 */
const MAX_HUD_EVENTS = 12;
const EVENT_WORDS = ['captured', 'lost', 'destroyed', 'killed', 'shot down'];

function looksLikeKill(text: string): boolean {
  const lower = text.toLowerCase();
  return KILL_WORDS.some((word) => lower.includes(word));
}

export class BattleClient {
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(opts: BattleClientOptions) {
    const host = opts.host.trim() || '127.0.0.1';
    const port = Number.isFinite(opts.port) && opts.port > 0 ? Math.trunc(opts.port) : 8111;
    this.base = 'http://' + host + ':' + port;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 2500;
  }

  get origin(): string {
    return this.base;
  }

  private async json(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.base + path, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const text = await res.text();
      const start = text.indexOf('{');
      const startArray = text.indexOf('[');
      if (start < 0 && startArray < 0) return null;
      const body = start >= 0 && (startArray < 0 || start < startArray) ? text.slice(start) : text.slice(startArray);
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 游戏没开或端口不对时返回 null。 */
  async state(): Promise<GameState | null> {
    const raw = await this.json('/state');
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    return {
      valid: bool(item.valid),
      mapValid: bool(item.map_valid),
      vehicle: str(item.vehicle_type),
      mode: str(item.game_mode),
      army: str(item.army),
    };
  }

  async indicators(): Promise<Indicators | null> {
    const raw = await this.json('/indicators');
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    return {
      valid: bool(item.valid),
      speed: num(item.speed),
      altitude: num(item.altitude),
      type: str(item.type),
    };
  }

  /** lastEvt / lastDmg 传 -1 表示"不要历史",第一次预热用它只记游标。 */
  async hud(lastEvt: number, lastDmg: number): Promise<HudSnapshot> {
    const raw = await this.json('/hudmsg?lastEvt=' + lastEvt + '&lastDmg=' + lastDmg);
    const empty: HudSnapshot = { events: [], damage: [] };
    if (typeof raw !== 'object' || raw === null) return empty;
    const item = raw as Record<string, unknown>;
    const events: HudEvent[] = [];
    const damage: HudEvent[] = [];
    if (Array.isArray(item.events)) {
      for (const raw of item.events) {
        const event = toHudEvent(raw);
        if (event) events.push(event);
      }
    }
    if (Array.isArray(item.damage)) {
      for (const raw of item.damage) {
        const event = toHudEvent(raw);
        if (event) damage.push(event);
      }
    }
    return { events, damage };
  }

  async mapObjects(): Promise<MapObject[]> {
    const raw = await this.json('/map_obj.json');
    if (!Array.isArray(raw)) return [];
    const out: MapObject[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      out.push({ icon: str(item.icon), type: str(item.type), x: num(item.x), y: num(item.y) });
    }
    return out;
  }
}

function maxId(events: HudEvent[], fallback: number): number {
  let max = fallback;
  for (const event of events) if (event.id > max) max = event.id;
  return max;
}

/**
 * 把 8111 的轮询结果翻译成"要不要开口"的事件。
 *
 * 归因说明:hudmsg 的 damage 列表记为"本机造成的命中/击毁",events 是全战场播报。
 * 这个语义没有官方文档背书,所以 damage 只用来判断"有击毁"并给出细节,
 * events 只当作战况素材放进讲解,不当成自己的战绩。
 */
export class BattleWatcher {
  private readonly client: BattleClient;
  private readonly now: () => number;
  private readonly deathCooldownMs: number;
  private online = false;
  private inBattle = false;
  private lastEvt = -1;
  private lastDmg = -1;
  private kills = 0;
  private deaths = 0;
  private streak = 0;
  private bestStreak = 0;
  private startedAt = 0;
  private lastDeathAt = 0;
  private behindRaised = false;
  private snapshot: BattleSnapshot = { vehicle: '', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };

  constructor(opts: BattleWatcherOptions) {
    this.client = opts.client;
    this.now = opts.now ?? (() => Date.now());
    this.deathCooldownMs = opts.deathCooldownMs ?? 8000;
  }

  get online_now(): boolean {
    return this.online;
  }

  get inBattleNow(): boolean {
    return this.inBattle;
  }

  get currentSnapshot(): BattleSnapshot {
    return this.snapshot;
  }

  get tally(): { kills: number; deaths: number; bestStreak: number } {
    return { kills: this.kills, deaths: this.deaths, bestStreak: this.bestStreak };
  }

  private resetBattle(vehicle: string): void {
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.behindRaised = false;
    this.startedAt = this.now();
    this.lastDeathAt = 0;
    this.snapshot = { vehicle, mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };
  }

  private async refreshSnapshot(state: GameState): Promise<void> {
    const ind = await this.client.indicators();
    const objects = await this.client.mapObjects();
    let enemies = 0;
    let allies = 0;
    for (const object of objects) {
      const icon = object.icon.toLowerCase();
      if (icon.includes('enemy') || icon.startsWith('aircraft_enemy') || icon.startsWith('tank_enemy')) enemies += 1;
      else if (icon.includes('friend') || icon.includes('ally')) allies += 1;
    }
    this.snapshot = {
      vehicle: state.vehicle || (ind ? ind.type : '') || '',
      mode: state.mode,
      army: state.army,
      speed: ind ? ind.speed : 0,
      altitude: ind ? ind.altitude : 0,
      enemies,
      allies,
    };
  }

  /** 主动刷新一次读数,不产生事件;游戏没开就保持原样。 */
  async refresh(): Promise<BattleSnapshot> {
    const state = await this.client.state();
    if (state && state.valid && state.mapValid) await this.refreshSnapshot(state);
    return this.snapshot;
  }
  /** 预热:只把游标推到当前最新,不产生事件。 */
  async warmup(): Promise<void> {
    const hud = await this.client.hud(-1, -1);
    this.lastEvt = maxId(hud.events, this.lastEvt);
    this.lastDmg = maxId(hud.damage, this.lastDmg);
  }

  /** 拉一次并给出这一轮要推的事件;游戏没开就返回空数组。 */
  async poll(): Promise<BattleEvent[]> {
    const out: BattleEvent[] = [];
    const state = await this.client.state();
    if (!state) {
      if (this.inBattle) {
        out.push({ kind: 'leave', summary: this.summaryOf() });
        this.inBattle = false;
      }
      this.online = false;
      return out;
    }
    this.online = true;
    const inBattle = state.valid && state.mapValid;

    if (inBattle && !this.inBattle) {
      this.inBattle = true;
      this.resetBattle(state.vehicle);
      await this.refreshSnapshot(state);
      await this.warmup();
      out.push({ kind: 'enter', snapshot: this.snapshot });
      return out;
    }

    if (!inBattle) {
      if (this.inBattle) {
        this.inBattle = false;
        out.push({ kind: 'leave', summary: this.summaryOf() });
      }
      return out;
    }

    const hud = await this.client.hud(this.lastEvt, this.lastDmg);
    this.lastEvt = maxId(hud.events, this.lastEvt);
    this.lastDmg = maxId(hud.damage, this.lastDmg);

    await this.refreshSnapshot(state);

    let killPushed = 0;
    for (const hit of hud.damage) {
      if (!looksLikeKill(hit.msg + ' ' + hit.type)) continue;
      // 战绩永远照实累加,限的只是"逐条开口"这件事。
      this.kills += 1;
      this.streak += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      if (this.behindRaised && this.kills >= this.deaths) this.behindRaised = false;
      if (killPushed >= MAX_KILL_EVENTS) continue;
      killPushed += 1;
      out.push({
        kind: 'kill',
        total: this.kills,
        streak: this.streak,
        detail: (hit.msg || hit.type || '').trim(),
        snapshot: this.snapshot,
      });
    }

    const ind = await this.client.indicators();
    if (ind && !ind.valid && this.now() - this.lastDeathAt > this.deathCooldownMs) {
      this.deaths += 1;
      this.streak = 0;
      this.lastDeathAt = this.now();
      out.push({ kind: 'death', total: this.deaths, snapshot: this.snapshot });
      if (!this.behindRaised && this.deaths >= this.kills + 2) {
        this.behindRaised = true;
        out.push({ kind: 'behind', kills: this.kills, deaths: this.deaths, snapshot: this.snapshot });
      }
    }

    let hudPushed = 0;
    for (const event of hud.events) {
      if (hudPushed >= MAX_HUD_EVENTS) break;
      const text = (event.msg || event.type || '').trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (!EVENT_WORDS.some((word) => lower.includes(word))) continue;
      hudPushed += 1;
      out.push({ kind: 'hud', detail: text });
    }

    return out;
  }

  private summaryOf(): BattleSummary {
    const seconds = this.startedAt > 0 ? Math.max(0, Math.round((this.now() - this.startedAt) / 1000)) : 0;
    return { vehicle: this.snapshot.vehicle, kills: this.kills, deaths: this.deaths, seconds };
  }
}
