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

/** 8111 响应的文本编码策略:auto 先按 UTF-8 试,解出替换字符就换 GBK;也可以钉死一种。 */
export type TextEncoding = 'auto' | 'utf-8' | 'gbk';

/** 真正交给 TextDecoder 的两档。 */
type RealEncoding = 'utf-8' | 'gbk';

/**
 * 把 8111 的响应字节解成文本。
 *
 * 实测中文客户端的 /gamechat 与 /hudmsg 吐的是 GBK 字节:直接 res.text()(按 UTF-8 解)
 * 会得到「?й?」这类替换字符,玩家名一起烂掉,按名字匹配全失真。所以这里先看 Content-Type
 * 的 charset;没写清楚就先按 UTF-8 试解一次,出现 U+FFFD 再按 GBK 重解。
 *
 * 钉死档位(textEncoding=utf-8/gbk)只给排障用:猜错的那一次会把整段中文变成问号。
 */
export function decodeGameText(
  input: ArrayBuffer | Uint8Array,
  contentType = '',
  mode: TextEncoding = 'auto',
): string {
  const all = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (all.byteLength === 0) return '';
  // UTF-8 BOM 先剥掉,否则 JSON.parse 会因为开头的 \ufeff 直接失败。
  const bom = all.length >= 3 && all[0] === 0xef && all[1] === 0xbb && all[2] === 0xbf ? 3 : 0;
  const bytes = bom > 0 ? all.subarray(bom) : all;
  const declared = declaredEncoding(contentType);
  if (mode === 'gbk' || mode === 'utf-8') return decodeAs(mode, bytes);
  if (declared) return decodeAs(declared, bytes);
  // auto:GBK 字节按 UTF-8 解几乎必然产生 U+FFFD,拿它当「猜错了」的判据。
  const utf8 = decodeAs('utf-8', bytes);
  if (!utf8.includes('\ufffd')) return utf8;
  const gbk = decodeAs('gbk', bytes);
  return gbk.includes('\ufffd') ? utf8 : gbk;
}

function declaredEncoding(contentType: string): RealEncoding | '' {
  const hit = /charset\s*=\s*"?([\w-]+)/i.exec(contentType);
  if (!hit) return '';
  const label = (hit[1] ?? '').toLowerCase();
  if (label === 'gbk' || label === 'gb2312' || label === 'gb18030') return 'gbk';
  if (label === 'utf-8' || label === 'utf8') return 'utf-8';
  return '';
}

function decodeAs(label: RealEncoding, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // 运行时缺某张码表时退回另一档,至少别把整次读取变成异常。
    return new TextDecoder(label === 'gbk' ? 'utf-8' : 'gbk').decode(bytes);
  }
}

export interface BattleClientOptions {
  host: string;
  port: number;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 文本编码策略,默认 auto。 */
  textEncoding?: TextEncoding;
}

export interface BattleWatcherOptions {
  client: BattleClient;
  now?: () => number;
  /** 玩家自己的游戏内昵称，用来从全场 kill feed 里认出自己的击杀。 */
  playerName?: string;
}

/** 同一次击毁可能连着吐多条播报，这个窗口内同发起者+同目标只算一次。 */
const KILL_DEDUPE_MS = 8000;
/**
 * 同一次阵亡会同时出现在 indicators 的边沿与 damage feed 里，这个窗口内只认先到的一路。
 * 取与击毁去重同一个量级：两路都是 1500ms 一拉，两拍内必然都到齐。
 */
const DEATH_VIA_FEED_WINDOW_MS = KILL_DEDUPE_MS;

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
    msg: cleanBattleText(str(item.msg)),
    sender: cleanBattleText(str(item.sender)),
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
/**
 * 判定「这条 damage 播报是不是一次击杀」的动词。
 *
 * 曾经把 `引燃`/`burned`（起火，未必当场击毁）与 `先拔头筹`（首杀播报，同一次击毁会再来
 * 一条）也算进来，实测把 51 条「击毁了」数成 54 杀——多的几条就是这么重复的。只认终局动词。
 */
const KILL_WORDS = [
  'destroyed', 'killed', 'shot down', 'shattered',
  '击毁了', '击落了', '摧毁了', '击杀了',
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
/**
 * 全战场播报里值得当素材的动词。
 *
 * 必须有中文：中文客户端的 events 是「占领了战区」这种，只留英文关键字时 includes 全部
 * 落空，一个 hud 事件都不会产生（KILL_WORDS 一直是中英并列的，这里当初漏了）。
 */
const EVENT_WORDS = [
  'captured', 'lost', 'destroyed', 'killed', 'shot down',
  '占领', '丢失', '失去', '击毁', '击落', '摧毁', '击杀', '被摧毁',
];

function looksLikeKill(text: string): boolean {
  const lower = text.toLowerCase();
  return KILL_WORDS.some((word) => lower.includes(word));
}

/** 击杀播报的动词：词前是发起者，词后是被击毁的目标。 */
const KILL_VERBS = ['击毁了', '击落了', '摧毁了', '击杀了', 'destroyed', 'killed', 'shot down', 'shattered'];

export interface KillLine {
  killer: string;
  victim: string;
}

/** 去掉名字尾部的「(载具)」括号段，全角半角都认。 */
function stripVehicleTag(value: string): string {
  return value.replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim();
}

/** 比对用的名字归一化：去零宽、去所有空白、小写。 */
export function normalizePlayerName(value: string): string {
  return cleanBattleText(value).replace(/\s+/g, '').toLowerCase();
}

/**
 * 从一条 damage 播报里切出发起者与受害者。
 *
 * 真机形如「迪特里希 (◄EMBT) 击毁了 勃兰特 (T-80BVM)」，英文客户端是「A destroyed B」。
 * 切不出动词（或动词在最前=没有发起者）就返回 null。
 */
export function parseKillLine(msg: string): KillLine | null {
  const text = cleanBattleText(msg);
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const verb of KILL_VERBS) {
    const at = lower.indexOf(verb);
    if (at <= 0) continue;
    const killer = stripVehicleTag(text.slice(0, at));
    const victim = stripVehicleTag(text.slice(at + verb.length));
    if (!killer) continue;
    return { killer, victim };
  }
  return null;
}

/**
 * 这条击杀是不是玩家自己造成的。
 *
 * 真机的 damage 列表是**全场 kill feed**：实测 144 条里 `sender` 字段全是空串，唯一的
 * 归属线索是播报里的发起者名字。名字没配就一个都不认领——宁可不报，也不能把全场的
 * 击杀当成自己的战绩，再拿去喊「本局第 N 个」。
 */
export function isSelfKill(line: KillLine, playerName: string): boolean {
  const me = normalizePlayerName(playerName);
  if (!me) return false;
  return normalizePlayerName(line.killer).includes(me);
}

export class BattleClient {
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly encoding: TextEncoding;

  constructor(opts: BattleClientOptions) {
    const host = opts.host.trim() || '127.0.0.1';
    const port = Number.isFinite(opts.port) && opts.port > 0 ? Math.trunc(opts.port) : 8111;
    this.base = 'http://' + host + ':' + port;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.encoding = opts.textEncoding ?? 'auto';
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
      const contentType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') ?? '' : '';
      // 真 Response 有 arrayBuffer:按字节解才拿得到正确的中文;测试与精简实现只有 text() 时退回去。
      const text =
        typeof res.arrayBuffer === 'function'
          ? decodeGameText(new Uint8Array(await res.arrayBuffer()), contentType, this.encoding)
          : await res.text();
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

  /** lastEvt / lastDmg 传 -1 表示"要全量";本插件每轮都传 -1,按基线在本地过滤。 */
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
      out.push({
        icon: str(item.icon),
        type: str(item.type),
        // 真机给的是 sx/sy（起点）与 ex/ey（终点），x/y 只在老客户端出现。
        x: num(item.sx, num(item.x)),
        y: num(item.sy, num(item.y)),
        color: rgb || str(item.color),
      });
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

/** 同一次击毁的多条播报在 feed 里是相邻 id,间隔不会超过这个数。 */
const KILL_DEDUPE_ID = 3;

/** 一次"自己的击毁"命中,带去重用的幂等键。 */
export interface SelfKillHit {
  /** 幂等键:发起者>目标#第几次。全量重放多少轮都只会入账一次。 */
  key: string;
  /** 原始播报正文,拿去开口。 */
  detail: string;
  /** 目标昵称(已去掉尾部的载具括号)。 */
  victim: string;
  /** 这次击毁在 feed 里最大的那条 id。 */
  id: number;
  /** 在本轮 feed 范围内,同一对玩家之间的第几次击毁。 */
  occurrence: number;
}

/** 一次"自己被打掉"的命中,幂等键带 d: 前缀,与击杀分开计数。 */
export interface SelfDeathHit {
  /** 幂等键:d:发起者>目标#第几次。全量重放多少轮都只会入账一次。 */
  key: string;
  /** 原始播报正文。 */
  detail: string;
  /** 打掉我的那个人的昵称(已去掉尾部的载具括号)。 */
  killer: string;
  /** 这次阵亡在 feed 里最大的那条 id。 */
  id: number;
  /** 在本轮 feed 范围内,同一对玩家之间的第几次。 */
  occurrence: number;
}

/** 去重后的一条击毁播报:发起者>目标 已归组,occurrence 是这对玩家的第几次。 */
interface KillRow {
  detail: string;
  line: KillLine;
  pair: string;
  id: number;
  occurrence: number;
}

/**
 * 把全量 damage feed 收成去重后的击毁行。
 *
 * 同一次击毁会连着吐多条播报(击毁 / 起火 / 首杀),这里按 发起者>目标 归组:组内
 * time 相差不到 KILL_DEDUPE_MS 或 id 相差不超过 KILL_DEDUPE_ID 就算同一条。time
 * 缺失(部分服务端、以及全部测试夹具)时自动退化为纯 id 邻近判断。
 */
function collectKillRows(damage: HudEvent[], afterId: number): KillRow[] {
  const rows: KillRow[] = [];
  const anchor = new Map<string, { time: number; id: number }>();
  const occurrence = new Map<string, number>();
  const ordered = damage.filter((event) => event.id > afterId).sort((a, b) => a.id - b.id);
  for (const event of ordered) {
    const detail = (event.msg || event.type || '').trim();
    if (!looksLikeKill(detail)) continue;
    const line = parseKillLine(detail);
    if (!line) continue;
    const pair = normalizePlayerName(line.killer) + '>' + normalizePlayerName(line.victim);
    const prev = anchor.get(pair);
    if (prev) {
      const nearByTime = event.time > 0 && prev.time > 0 && Math.abs(event.time - prev.time) * 1000 < KILL_DEDUPE_MS;
      const nearById = event.id - prev.id <= KILL_DEDUPE_ID;
      if (nearByTime || nearById) {
        // 是上一条的后续播报:只把锚点挪到最新,不重复入账。
        anchor.set(pair, { time: event.time, id: event.id });
        continue;
      }
    }
    anchor.set(pair, { time: event.time, id: event.id });
    const seq = (occurrence.get(pair) ?? 0) + 1;
    occurrence.set(pair, seq);
    rows.push({ detail, line, pair, id: event.id, occurrence: seq });
  }
  return rows;
}

/**
 * 从全量 damage feed 里挑出"自己的击杀"。
 *
 * 纯函数:不读时钟、不改状态,只按基线 id 过滤后按 id 升序判定。调用方拿 key 做幂等
 * 去重即可 —— 这正是把增量游标换成"每轮全量重算"之后仍然不会重复计数的关键。
 */
export function computeSelfKills(
  damage: HudEvent[],
  opts: { afterId: number; playerName: string },
): SelfKillHit[] {
  return collectKillRows(damage, opts.afterId)
    .filter((row) => isSelfKill(row.line, opts.playerName))
    .map((row) => ({
      key: row.pair + '#' + row.occurrence,
      detail: row.detail,
      victim: row.line.victim,
      id: row.id,
      occurrence: row.occurrence,
    }));
}

/** 受害者是不是我(按归一化后的昵称做包含匹配)。 */
export function isSelfDeath(line: KillLine, playerName: string): boolean {
  const me = normalizePlayerName(playerName);
  if (!me) return false;
  return normalizePlayerName(line.victim).includes(me);
}

/**
 * 从全量 damage feed 里挑出"自己被打掉"。
 *
 * 与 computeSelfKills 同一套路:每轮全量重算 + 幂等键去重,所以重连、换局、游戏重启
 * 都不会把阵亡数算丢或算重。键带 d: 前缀,与击杀键互不干扰。
 *
 * 自己把自己打掉(极罕见)只算击杀,这里跳过,免得一条播报两边各加一。
 */
export function computeSelfDeaths(
  damage: HudEvent[],
  opts: { afterId: number; playerName: string },
): SelfDeathHit[] {
  const hits: SelfDeathHit[] = [];
  for (const row of collectKillRows(damage, opts.afterId)) {
    if (!isSelfDeath(row.line, opts.playerName)) continue;
    if (isSelfKill(row.line, opts.playerName)) continue;
    hits.push({
      key: 'd:' + row.pair + '#' + row.occurrence,
      detail: row.detail,
      killer: row.line.killer,
      id: row.id,
      occurrence: row.occurrence,
    });
  }
  return hits;
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
  /**
   * 本局基线：只认 id 大于它的播报，等于"入局那一刻之后发生的事"。
   *
   * 这里刻意不用增量游标查询（hudmsg?lastDmg=N）。游标一旦大于服务端现存的最大 id，
   * 服务端就永远回空；而"回空"又不足以判定游标已经失效——两个判断互为前提，
   * 于是整条战绩通道永久卡死（游戏重启后 id 从 1 重新计数必踩，且不重启宿主恢复不了）。
   * 现在每轮拉全量、按名字幂等重算，回退只影响基线，不会再让计数停摆。
   */
  private baselineDmgId = -1;
  private baselineEvtId = -1;
  /** 自己的游戏内昵称，空串表示没配（此时不认领任何击杀）。 */
  private readonly playerName: string;
  /** 已经入账的击杀幂等键（发起者>目标#第几次），全量重放多少次都只算一次。 */
  private readonly countedKills = new Set<string>();
  /** 已经开口过的全战场播报 id，全量重放时不重复播。 */
  private readonly seenHud = new Set<number>();
  /** 已经入账的阵亡幂等键（d:发起者>目标#第几次）。 */
  private readonly countedDeaths = new Set<string>();
  private kills = 0;
  private deaths = 0;
  private streak = 0;
  private bestStreak = 0;
  private startedAt = 0;
  private lastDeathAt = 0;
  /** indicators 那一路最近一次计到阵亡的时刻，用来让 feed 认领时不重复累加。 */
  private lastIndicatorDeathAt = 0;
  private behindRaised = false;
  private snapshot: BattleSnapshot = { vehicle: '', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };

  constructor(opts: BattleWatcherOptions) {
    this.client = opts.client;
    this.now = opts.now ?? (() => Date.now());
    this.playerName = opts.playerName ?? '';
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

  /** 记一次阵亡：累加、断连胜、落后两杀以上喊一句逆风。两路共用，口径只有一处。 */
  private applyDeath(out: BattleEvent[]): void {
    this.deaths += 1;
    this.streak = 0;
    out.push({ kind: 'death', total: this.deaths, snapshot: this.snapshot });
    if (!this.behindRaised && this.deaths >= this.kills + 2) {
      this.behindRaised = true;
      out.push({ kind: 'behind', kills: this.kills, deaths: this.deaths, snapshot: this.snapshot });
    }
  }

  private resetBattle(vehicle: string): void {
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.behindRaised = false;
    this.startedAt = this.now();
    this.lastDeathAt = 0;
    this.lastIndicatorDeathAt = 0;
    this.aliveArmed = false;
    this.countedKills.clear();
    this.countedDeaths.clear();
    this.seenHud.clear();
    this.baselineDmgId = -1;
    this.baselineEvtId = -1;
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
  /** 预热:只把基线锚到当前最新,不产生事件。 */
  async warmup(): Promise<void> {
    const hud = await this.client.hud(-1, -1);
    this.baselineEvtId = maxId(hud.events, -1);
    this.baselineDmgId = maxId(hud.damage, -1);
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

    // 每轮拉全量。增量游标一旦超过服务端现存的最大 id 就永久回空，而"回空"与
    // "这段确实没播报"无法区分，两个判断互为前提 → 战绩永久卡死（游戏重启后 id 从 1
    // 重新计数必踩，不重启宿主就恢复不了）。真机全量 159 条，1500ms 一轮完全扛得住。
    const hud = await this.client.hud(-1, -1);
    const dmgMax = maxId(hud.damage, -1);
    const evtMax = maxId(hud.events, -1);
    /**
     * 服务端 id 回退：游戏重启/重连后从 1 重新计数。
     *
     * 全量查询下这个信号每一轮都看得到，所以判定不再要求"这一轮必须先拿到非空数据"
     * ——那条前置条件正是原来卡死的原因。基线作废后按当前 feed 重新锚定：宁可把
     * 重启前的残留当历史，也不要整条通道停摆。
     */
    if (dmgMax >= 0 && this.baselineDmgId > dmgMax) this.baselineDmgId = -1;
    if (evtMax >= 0 && this.baselineEvtId > evtMax) this.baselineEvtId = -1;

    await this.refreshSnapshot(state, probe.objects);

    let killPushed = 0;
    for (const hit of computeSelfKills(hud.damage, { afterId: this.baselineDmgId, playerName: this.playerName })) {
      // 幂等键 = 发起者>目标#第几次。全量重放多少轮都只入账一次，服务端 id 回退
      // 或 feed 窗口滑动也不会重复计。
      if (this.countedKills.has(hit.key)) continue;
      this.countedKills.add(hit.key);
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
        detail: hit.detail,
        snapshot: this.snapshot,
      });
    }

    // 阵亡同样从全量 feed 重算：重启/重生那一下 indicators 的边沿还没武装好，只靠它必漏，
    // 而且漏一次这一局就永远对不上。这里按 victim=我 数，幂等键去重，重连换局都自愈。
    for (const hit of computeSelfDeaths(hud.damage, { afterId: this.baselineDmgId, playerName: this.playerName })) {
      if (this.countedDeaths.has(hit.key)) continue;
      this.countedDeaths.add(hit.key);
      // 这一拍 indicators 可能已经把同一次阵亡数过，那就不再重复累加。
      if (this.now() - this.lastIndicatorDeathAt < DEATH_VIA_FEED_WINDOW_MS) continue;
      // feed 已经认领这一条，indicators 这边接下来失效的那一拍直接吞掉。
      this.aliveArmed = false;
      this.lastDeathAt = this.now();
      this.applyDeath(out);
    }

    const ind = await this.client.indicators();
    if (ind && ind.known) {
      if (ind.valid) {
        // 看到一次有效存活：武装边沿，下一次失效才算阵亡。
        this.aliveArmed = true;
      } else if (this.aliveArmed && this.now() - this.lastDeathAt >= DEATH_DEBOUNCE_MS) {
        // feed 里那一条还没到或压根没有（坠机、撞地），由 indicators 兜底计一次。
        this.aliveArmed = false;
        this.lastIndicatorDeathAt = this.now();
        this.lastDeathAt = this.now();
        this.applyDeath(out);
      }
    }

    let hudPushed = 0;
    for (const event of hud.events) {
      // 全量重放:入局前的旧播报跳过,已经开过口的 id 不再重复,否则每一轮都会刷屏。
      if (event.id <= this.baselineEvtId) continue;
      if (this.seenHud.has(event.id)) continue;
      if (hudPushed >= MAX_HUD_EVENTS) break;
      const text = (event.msg || event.type || '').trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (!EVENT_WORDS.some((word) => lower.includes(word))) continue;
      hudPushed += 1;
      this.seenHud.add(event.id);
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
  const msg = cleanBattleText(str(item.msg)).slice(0, MAX_CHAT_MSG);
  if (!msg) return null;
  return {
    id: Number.isFinite(id) ? id : 0,
    sender: cleanBattleText(str(item.sender)).slice(0, MAX_CHAT_SENDER),
    msg,
    enemy: bool(item.enemy),
    mode: cleanBattleText(str(item.mode)).slice(0, 16) || 'All',
  };
}

/**
 * 清掉 8111 文本里的隐形垃圾。
 *
 * 玩家名里混进零宽空格(U+200B)与 BOM(U+FEFF)是实测过的:它们不可见,但会让「按名字
 * 匹配」永远对不上,所以这里直接删掉而不是换成空格;真正的控制字符才当空白处理。
 */
function cleanBattleText(value: string): string {
  return value
    // 富文本标签：中文客户端会给聊天正文塞 <color=#FF00FF50>…</color>，方括号里的
    // [e6] 是网格坐标，要保留。
    .replace(/<\/?color(?:=[^>]*)?>/gi, '')
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, " ")
    .trim();
}
