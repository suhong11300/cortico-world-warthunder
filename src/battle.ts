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
  /**
   * 响应里到底有没有 valid 字段。
   *
   * 真机 /indicators 偶尔只回一半字段，或者返回一个残缺对象；那种情况下 bool(undefined)
   * 会得到 false，若直接当成"阵亡"就是凭缺失字段编战绩。所以把"有没有这个字段"单独记下来，
   * 只有明确说出 false 才算指标失效。
   */
  known: boolean;
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

/** 一条对局聊天。/gamechat 的契约是 { id, msg, sender, enemy, mode }，缺字段一律给默认值。 */
export interface ChatLine {
  id: number;
  sender: string;
  msg: string;
  enemy: boolean;
  mode: string;
}
/** /mission.json：战局主目标。坦克/空战里 status 为 running 就说明人在局内，这是最稳的判据。 */
export interface MissionState {
  running: boolean;
  objectives: string[];
}

/** /map_info.json：地图元信息，valid 为真说明地图已加载（机库里通常为假）。 */
export interface MapInfo {
  valid: boolean;
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
  /** 真机给的是 color[] = [r,g,b]（友方 23,77,255 / 敌方 250,12,0 / 自己 250,200,30），这里拍平成 "r,g,b"。 */
  color: string;
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
/**
 * 击毁类关键字。
 *
 * 中文客户端的措辞和英文完全不是一回事：实测同一局里同时出现
 *   「X (ZTZ99A) 击毁了 Y (HSTV-L)」
 *   「X 的攻击引燃了 Y」  ← 引燃即击毁，之前漏了它，中文局几乎全漏
 *   「⋇ X 先拔头筹！」    ← 首杀播报
 * 所以这里中英并列，且只用包含匹配（版本间措辞还会变）。
 */
const KILL_WORDS = [
  'destroyed', 'killed', 'shot down', 'burned', 'shattered',
  '击毁', '击落', '引燃', '摧毁', '击杀', '先拔头筹',
];
/**
 * 一次轮询里最多为几条击毁各推一个事件。
 *
 * 客户端暂停恢复或长局积压时,hudmsg 可能一口气吐出几十条,每条都要走一次模型:
 * 一次风暴就能把一天的额度烧完。所以超出的只累加战绩,不再逐条开口。
 */
const MAX_KILL_EVENTS = 3;
/** 全战场播报里最多取几条当素材。 */
const MAX_HUD_EVENTS = 12;
/**
 * 同一毫秒级的重复判定防抖。
 *
 * 早期版本用 8 秒冷却挡重复计死，但冷却既挡不住"持续失效反复计死"，又会吞掉重生后
 * 短时间内的二次阵亡。现在由"存活边沿"负责去重，这里只留一个极小的防抖窗。
 */
const DEATH_DEBOUNCE_MS = 200;
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
      known: 'valid' in item,
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
      const rgb = Array.isArray(item['color[]'])
        ? (item['color[]'] as unknown[]).map((part) => Math.trunc(num(part))).join(',')
        : '';
      out.push({ icon: str(item.icon), type: str(item.type), x: num(item.x), y: num(item.y), color: rgb || str(item.color) });
    }
    return out;
  }

  /**
   * 读对局聊天。lastId 传上次见到的最大 id 做增量，传 0 从头拿。
   *
   * 聊天内容是别人写的，是可污染的输入：这里只做结构解析与长度/控制字符清洗，
   * 不做任何「看起来像指令就执行」的判断——那属于上层提示词的事。
   */
  async gamechat(lastId: number): Promise<ChatLine[]> {
    const cursor = Number.isFinite(lastId) ? Math.max(0, Math.trunc(lastId)) : 0;
    const raw = await this.json('/gamechat?lastId=' + cursor);
    if (!Array.isArray(raw)) return [];
    const out: ChatLine[] = [];
    for (const entry of raw) {
      const line = toChatLine(entry);
      if (!line) continue;
      if (line.id > cursor) out.push(line);
    }
    return out;
  }

  /** 战局主目标。读不到就返回 null（机库/游戏没开）。 */
  async mission(): Promise<MissionState | null> {
    const raw = await this.json('/mission.json');
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const objectives: string[] = [];
    if (Array.isArray(item.objectives)) {
      for (const entry of item.objectives.slice(0, 4)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const text = str((entry as Record<string, unknown>).text).trim();
        if (text) objectives.push(text.replace(/\s+/g, ' '));
      }
    }
    const status = str(item.status).toLowerCase();
    return { running: status === 'running', objectives };
  }

  /** 地图元信息。valid 为真说明地图已加载。 */
  async mapInfo(): Promise<MapInfo | null> {
    const raw = await this.json('/map_info.json');
    if (typeof raw !== 'object' || raw === null) return null;
    return { valid: bool((raw as Record<string, unknown>).valid) };
  }
}

/**
 * /indicators 的 type 形如 tankModels/ussr_t_80ue1_sm、aircraftModels/...，
 * 直接把前缀去掉当载具名，比空字符串有用。
 */
function vehicleFromType(type: string): string {
  const name = type.trim();
  if (!name) return '';
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/** 重生点、机场、据点这些不是单位，统计敌我数量时要排掉。 */
const NON_UNIT_TYPES = ['respawn_base', 'airfield', 'capture_zone', 'point_of_interest'];

function isUnitObject(object: MapObject): boolean {
  const type = object.type.toLowerCase();
  if (!type || type === 'none') return false;
  return !NON_UNIT_TYPES.some((word) => type.includes(word));
}

/**
 * 敌我判定。真机的小地图单位不带 enemy/friend 字样，靠颜色区分：
 * 友方 [23,77,255] / 敌方 [250,12,0] / 自己 [250,200,30]。
 * 老客户端的 icon 里可能带 enemy/friend，所以颜色判不出来时回退看 icon。
 */
function sideOf(object: MapObject): 'enemy' | 'ally' | 'self' | '' {
  const parts = object.color.split(',').map((part) => Number(part.trim()));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [r, g, b] = parts;
    if (r > 180 && g < 90 && b < 90) return 'enemy';
    if (r > 200 && g > 150 && b < 110) return 'self';
    if (b > 180 && r < 110) return 'ally';
    if (g > 150 && r < 120 && b < 120) return 'ally';
  }
  const icon = object.icon.toLowerCase();
  if (icon.includes('enemy')) return 'enemy';
  if (icon.includes('friend') || icon.includes('ally')) return 'ally';
  return '';
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
/**
 * 一次探测的全部信号。
 *
 * 为什么不能只看 /state：真机对局里 /state 恒返回 { "valid": false }（只有这一个键），
 * 而 /mission.json 的 status 是 running、/map_info.json 的 valid 是 true、/map_obj.json 有 229 条单位。
 * 只认 state.valid 会让「人在局里」被判成不在战局——这就是当初 wt_battle_state 一直报「不在战局」的原因。
 */
interface BattleProbe {
  online: boolean;
  inBattle: boolean;
  state: GameState | null;
  objects: MapObject[];
}

export class BattleWatcher {
  private readonly client: BattleClient;
  private readonly now: () => number;
  private online = false;
  /** 事件状态机里的"在战局"，只由 poll 推进。 */
  private inBattle = false;
  /** 最近一次采样看到的"在战局"，只反映观测，不消费入局/结算的转移。 */
  private observedInBattle = false;
  /**
   * 阵亡边沿的武装位。
   *
   * 只有在 /indicators 上明确看到过一次 valid:true 才算"这一命是活的"，随后那次
   * valid:false 才是这一次阵亡；否则持续的失效读数会被每一轮轮询重复计成死亡。
   */
  private aliveArmed = false;
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
  }

  get online_now(): boolean {
    return this.online;
  }

  get inBattleNow(): boolean {
    return this.inBattle;
  }

  /**
   * 采样视角的"在战局"。
   *
   * 展示与工具回执要用它：用户问"现在在不在局里"是问观测结果，不该顺手把状态机推进一格。
   */
  get observedInBattleNow(): boolean {
    return this.observedInBattle;
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
    this.aliveArmed = false;
    this.snapshot = { vehicle, mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };
  }

  private async refreshSnapshot(state: GameState | null, objects: MapObject[]): Promise<void> {
    const ind = await this.client.indicators();
    let enemies = 0;
    let allies = 0;
    for (const object of objects) {
      if (!isUnitObject(object)) continue;
      const side = sideOf(object);
      if (side === 'enemy') enemies += 1;
      else if (side === 'ally') allies += 1;
    }
    const vehicle = (state && state.vehicle) || (ind ? vehicleFromType(ind.type) : '');
    this.snapshot = {
      vehicle,
      mode: state ? state.mode : this.snapshot.mode,
      army: state ? state.army : this.snapshot.army,
      speed: ind ? ind.speed : 0,
      altitude: ind ? ind.altitude : 0,
      enemies,
      allies,
    };
  }

  /** 四路并发探一次：谁通都算在线，任一强信号为真就算在战局。 */
  private async probe(): Promise<BattleProbe> {
    const [state, mission, mapInfo, objects] = await Promise.all([
      this.client.state(),
      this.client.mission(),
      this.client.mapInfo(),
      this.client.mapObjects(),
    ]);
    const online = state !== null || mission !== null || mapInfo !== null || objects.length > 0;
    const missionRunning = mission !== null && mission.running;
    const mapReady = mapInfo !== null && mapInfo.valid;
    const stateOk = state !== null && state.valid && state.mapValid;
    // 单独的 objects.length 不能当判据：机库里 map_obj.json 可能还残留上一局的单位。
    const inBattle = missionRunning || stateOk || (mapReady && objects.length > 0);
    return { online, inBattle, state, objects };
  }
  /**
   * 主动刷新一次读数,不产生事件、也不改变事件状态机。
   *
   * 早先这里会顺手写 inBattle，于是 wt_battle_state 先查一次之后，下一次 poll 就以为
   * "已经在局里"，跳过了 reset/warmup，把上一局积压的伤害算成本局战绩。观测与转移必须分开。
   */
  async refresh(): Promise<BattleSnapshot> {
    const probe = await this.probe();
    this.online = probe.online;
    this.observedInBattle = probe.inBattle;
    if (probe.inBattle) await this.refreshSnapshot(probe.state, probe.objects);
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
    const probe = await this.probe();
    if (!probe.online) {
      if (this.inBattle) {
        out.push({ kind: 'leave', summary: this.summaryOf() });
        this.inBattle = false;
      }
      this.online = false;
      this.observedInBattle = false;
      return out;
    }
    this.online = true;
    this.observedInBattle = probe.inBattle;
    const state = probe.state;
    const inBattle = probe.inBattle;

    if (inBattle && !this.inBattle) {
      this.inBattle = true;
      this.resetBattle((state && state.vehicle) || '');
      await this.refreshSnapshot(state, probe.objects);
      await this.warmup();
      // 入局这一拍就把存活边沿武装好。不武装的话,下一次读到的失效会因为"没见过活的"
      // 而被当成缺数据直接丢掉,玩家看到的现象就是"第一次阵亡从来不播"。
      const firstInd = await this.client.indicators();
      if (firstInd && firstInd.known && firstInd.valid) this.aliveArmed = true;
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
    /**
     * 服务端游标回退。
     *
     * 客户端重启/重连后 hudmsg 的 id 会从 1 重新计数；这时若继续用旧游标查询，
     * 新播报的 id 永远小于旧游标，会被本地过滤掉——表现就是"接下来一局什么都读不到"。
     * 只有真的看到"有数据但最大 id 比记录的小"才重建游标，读不到数据不算回退。
     */
    const dmgMax = maxId(hud.damage, -1);
    const evtMax = maxId(hud.events, -1);
    if ((hud.damage.length > 0 && dmgMax < this.lastDmg) || (hud.events.length > 0 && evtMax < this.lastEvt)) {
      this.lastEvt = -1;
      this.lastDmg = -1;
      await this.warmup();
      return out;
    }
    this.lastEvt = maxId(hud.events, this.lastEvt);
    this.lastDmg = maxId(hud.damage, this.lastDmg);

    await this.refreshSnapshot(state, probe.objects);

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
    if (ind && ind.known) {
      if (ind.valid) {
        // 看到一次有效存活：武装边沿，下一次失效才算阵亡。
        this.aliveArmed = true;
      } else if (this.aliveArmed && this.now() - this.lastDeathAt >= DEATH_DEBOUNCE_MS) {
        this.aliveArmed = false;
        this.deaths += 1;
        this.streak = 0;
        this.lastDeathAt = this.now();
        out.push({ kind: 'death', total: this.deaths, snapshot: this.snapshot });
        if (!this.behindRaised && this.deaths >= this.kills + 2) {
          this.behindRaised = true;
          out.push({ kind: 'behind', kills: this.kills, deaths: this.deaths, snapshot: this.snapshot });
        }
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

/** 聊天正文与昵称都可能被人塞控制字符或超长文本，先洗再收。 */
const MAX_CHAT_MSG = 400;
const MAX_CHAT_SENDER = 40;

function toChatLine(raw: unknown): ChatLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const id = num(item.id);
  const msg = cleanChatText(str(item.msg)).slice(0, MAX_CHAT_MSG);
  if (!msg) return null;
  return {
    id: Number.isFinite(id) ? id : 0,
    sender: cleanChatText(str(item.sender)).slice(0, MAX_CHAT_SENDER),
    msg,
    enemy: bool(item.enemy),
    mode: cleanChatText(str(item.mode)).slice(0, 16) || 'All',
  };
}

function cleanChatText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
