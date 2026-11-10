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
  /** Only explicitly unit-labelled state fields are converted to display units. */
  speedKmh?: number;
  speedKind?: 'IAS' | 'TAS';
  altitudeM?: number;
  /** 空战的过载（/state 的 Ny，单位 G）；陆战不提供。 */
  loadFactor?: number;
  mapValidKnown?: boolean;
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
  speedKnown: boolean;
  altitudeKnown: boolean;
  army: string;
  /**
   * 载具状态字段。真机（2026-11-02 陆战）给出 crew_current / crew_total / gear /
   * first_stage_ammo / stabilizer / rpm；空战不给这些，所以全部可选、缺了就不报。
   */
  crewCurrent?: number;
  crewTotal?: number;
  gear?: number;
  ammo?: number;
  stabilizer?: number;
  rpm?: number;
  /** 游戏入场阶段的已知占位模型，不是玩家载具。 */
  placeholder?: boolean;
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
  status: string;
}

/** /map_info.json：地图元信息，valid 为真说明地图已加载（机库里通常为假）。 */
export interface MapInfo {
  valid: boolean;
  known: boolean;
  /** 一个格子的世界边长（m）。真机 2026-11-02：grid_size [1600,1600]、grid_steps [225,225]。 */
  gridSize?: [number, number];
  gridSteps?: [number, number];
  /** 网格原点在世界坐标里的位置（m）。 */
  gridZero?: [number, number];
  /** 地图的世界范围（m），用来把地图端点里 0..1 的 x/y 换成米。 */
  mapMin?: [number, number];
  mapMax?: [number, number];
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
  /**
   * 朝向单位向量，只有自己的 Player 图标带；其它单位真机不给。
   * 与 x/y 同一坐标系，所以拿它算「目标相对车头的夹角」不需要任何额外定标。
   */
  dx?: number;
  dy?: number;
  /**
   * 占领点专用：/map_obj.json 的 capture_zone 对象带 zone_id 与 zone_label（A/B/C）。
   * 这是端口唯一直接给出的占领点标识；占领进度与占领方它不给。
   */
  zoneId?: number;
  zoneLabel?: string;
}

/** 地图端点里的一个单位或点位，已换算成世界米数并算出与自己的直线距离。 */
export interface MapContact {
  /** enemy / ally / self / point（point = 防守点、轰炸点、机场等目标点）。 */
  side: 'enemy' | 'ally' | 'self' | 'point';
  x: number;
  y: number;
  /** 与自己当前位置的直线距离（m）。 */
  distM: number;
  /** 客户端给的图标名（如 Player、MediumTank、Airfield）。 */
  icon: string;
  /** 客户端给的对象类型（如 ground_model、aircraft、defending_point）。 */
  type: string;
  /** 格网列号（0 起），与自身格号同一套 grid_zero / grid_steps 换算。 */
  col?: number;
  /** 格网行号（0 起）。 */
  row?: number;
  /**
   * 相对车头的夹角（度，-180..180）。0 = 正前，绝对值 180 = 正后。
   * 只用自己的 dx/dy 与目标相对位移算，同一坐标系相减，不依赖地图定标。
   * 正负对应哪一侧取决于客户端 y 轴朝向，尚未定标，所以文案里不写左右。
   */
  bearingDeg?: number;
}

/**
 * 地图端点里的一个占领点（capture_zone）。
 *
 * 端口直接给出编号、字母标签与坐标，这是占领点位置的唯一权威来源；
 * 占领进度、占领方与「谁在占」它一律不给，那部分只能按需截图 OCR 兜底。
 */
export interface MapZone {
  /** 客户端给的 zone_id。 */
  id: number;
  /** 字母标签（A/B/C）；客户端没给时退回编号。 */
  label: string;
  /** 客户端给的图标名与对象类型，原样保留。 */
  icon: string;
  type: string;
  /** 客户端配色 "r,g,b"（真实样本：A 敌红 250,12,0 / B 友蓝 23,77,255 / C 敌红）。 */
  color: string;
  /**
   * 按配色判定的控制方：敌方红、我方蓝。判不出来时留空，不猜。
   * 这是端口给的「点归谁」，与「占领进度/谁正在占」不是一回事，后者端口不给。
   */
  side: 'enemy' | 'ally' | 'self' | '';
  /** 归一化坐标，与其它地图对象同一坐标系。 */
  x: number;
  y: number;
  /** 由 map_min/map_max 换出的世界米数与格号；地图端点没给参数时不出现。 */
  worldX?: number;
  worldY?: number;
  col?: number;
  row?: number;
}

export interface BattleSnapshot {
  vehicle: string;
  /** 载具的中文名（知识库命中时由 world.ts 填），播报优先用它。 */
  vehicleLabel?: string;
  mode: string;
  army: string;
  speed: number;
  altitude: number;
  enemies: number;
  allies: number;
  /** 地图端点里的目标点数量（防守点/轰炸点/机场）；8111 不给占领进度。 */
  points?: number;
  /** 自身图标在地图端点里的原始坐标；量纲随地图变，只当报点参考。 */
  selfX?: number;
  selfY?: number;
  /** 自身朝向单位向量（只有自己的 Player 图标带），给相对方位角用。 */
  selfDx?: number;
  selfDy?: number;
  /** 由 /map_info.json 的 map_min/map_max 把 selfX/selfY 换成世界米数，换算唯一确定。 */
  worldX?: number;
  worldY?: number;
  /** 按客户端格网参数（grid_zero / grid_steps）算的格子列/行，0 起；换算式见 refreshSnapshot。 */
  gridCol?: number;
  gridRow?: number;
  /** 陆战/海战的对地速度（km/h）：由相邻两次地图坐标位移除以时间算出，静止判 0。 */
  groundSpeedKmh?: number;
  /** 指定半径内的敌我数量（只统计地图端点能看到的单位）。 */
  nearby?: {
    radiusM: number;
    enemies: number;
    allies: number;
    /** 半径内的点位数量（不止是敌我单位）。 */
    points: number;
  };
  /** 半径内最近的目标，按距离升序，最多 8 条。 */
  contacts?: MapContact[];
  /** 地图端点给出的占领点（capture_zone）：编号、字母标签、坐标与格号。 */
  zones?: MapZone[];
  /** 画面 OCR 得到的占领线索：端口不给占领进度与占领方，这才是那部分的来源。 */
  zoneHints?: string[];
  /** /mission.json 的 objectives：本局目标文本。真机多数时候是 null，空了就不出现。 */
  objectives?: string[];
  /** 载具状态（/indicators）：车组、档位、待发弹、稳定器、转速；缺字段就不出现。 */
  vehicleState?: {
    crewCurrent?: number;
    crewTotal?: number;
    gear?: number;
    ammo?: number;
    stabilizer?: boolean;
    rpm?: number;
  };
  /** Current endpoint provenance; absent only on legacy/manual snapshots. */
  readings?: {
    speed: { value: number | null; unit: 'km/h' | 'unconfirmed'; source: string; kind: string };
    altitude: { value: number | null; unit: 'm' | 'unconfirmed'; source: string };
    /** 空战过载（/state 的 Ny，单位 G）；陆战或读数缺失时为 null。 */
    load?: { value: number | null; source: string };
    mapKnown: boolean;
    observedAt: number;
    vehiclePending?: boolean;
  };
}

export interface BattleSummary {
  vehicle: string;
  kills: number;
  deaths: number;
  seconds: number;
  killsKnown?: boolean;
  deathsKnown?: boolean;
}

export type BattleEvent =
  | { kind: 'enter'; snapshot: BattleSnapshot }
  | { kind: 'leave'; summary: BattleSummary }
  | { kind: 'kill'; total: number; streak: number; detail: string; victim: string; victimRaw: string; snapshot: BattleSnapshot }
  | { kind: 'death'; total: number; snapshot: BattleSnapshot; killer?: string; feedText?: string }
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

export type TelemetryScope = 'vehicle' | 'map' | 'mission' | 'hud' | 'chat';

export interface BattleClientOptions {
  host: string;
  port: number;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** 文本编码策略,默认 auto。 */
  textEncoding?: TextEncoding;
  /** 每次实际请求前检查活权限，旧在途轮询也不能继续请求已关闭类别。 */
  canRead?: (scope: TelemetryScope) => boolean;
}

export interface BattleWatcherOptions {
  client: BattleClient;
  now?: () => number;
  /** 玩家自己的游戏内昵称，用来从全场 kill feed 里认出自己的击杀。 */
  playerName?: string;
  /**
   * 在局判定是否让地图端点否决 mission（默认开）。
   *
   * 机库实测：/state 与 /indicators 都 valid:true、/mission.json 还报 running，只有
   * /map_info.json 是 valid:false、/map_obj.json 是空数组。开着时 map_info 说没有地图
   * 就算离场（刚进局地图未就绪会有几秒延迟）；关掉后退回旧语义，只在任务结束时离场。
   */
  strictInBattle?: boolean;
  /**
   * 是否允许用 /indicators 的失效边沿补记一次阵亡（默认关闭）。
   *
   * 这条兜底把"指示灯由有效变失效"当成死亡，但玩家切侦察无人机、开炮手视角、
   * 载具切换的瞬间都会产生同样的边沿——于是无人机与辅助车辆 AI 的损毁会被
   * 算成本人阵亡。默认只认 kill feed 里"victim 是我"的归因；确实要兜底的人
   * 打开这个开关，并要求连续两轮失效才计。
   */
  inferDeathFromIndicators?: boolean;
  /**
   * 附近敌我的统计半径（m，默认 500）。
   *
   * 地图端点给的是整张地图的全部单位；陆战历史模式的交战距离通常在 500 m 内，
   * 所以默认按 500 m 聚合。超出这个半径的单位只进全场敌我计数，不进 nearby。
   */
  nearbyRadiusM?: number;
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

function knownBool(value: unknown): boolean {
  return typeof value === 'boolean' || value === 0 || value === 1;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function eventFingerprint(event: HudEvent): string {
  return JSON.stringify([event.id, event.time, event.msg, event.type]);
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
 * 指示灯要连续失效多少轮才当阵亡。
 *
 * 切视角、换载具、进出菜单与加载画面都会让 /indicators 抖一两拍 valid:false。
 * 只看单拍就记阵亡时，这些操作会各记一次（真机反馈：切视角与换车都误报）。
 * 连续两轮仍然失效，才算这一命真的结束。
 */
const DEATH_CONFIRM_POLLS = 2;
/**
 * 入局后最多等几拍再发 enter 播报。
 *
 * 加载画面里 /indicators.type 还是 dummy_plane，这一拍推 enter 会得到「载具待生成 ·
 * 速度未读到 · 高度未读到 · 过载未读到」；而一局只有一次 enter，之后再没有更正的机会。
 * 加载画面长短不定（2026-11-10 真机见过超过 30 秒仍在 dummy_plane），所以：
 * ① 占位期（/indicators.type = dummy_plane）压根不计拍、不设上限，等到出真载具再发；
 * ② 这个上限只兜「载具名已可读、但陆战对地速度还没算出来」的长尾，按 1.5 秒一拍算 60 拍约 90 秒；
 * ③ 过了上限照发完整一行（载具名 + 速度未读到），不再有「⚔️ 进战局」那种半句兜底。
 */
const ENTER_WAIT_POLLS = 60;
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
  // 真机 feed 里动词被零宽字符拆开(实测 155 条里 139 条含 U+200B，「击​毁​了」不是
  // 「击毁了」)，所以必须先过 cleanBattleText 再比对，否则整份 feed 会被判成没有击杀。
  const lower = cleanBattleText(text).toLowerCase();
  return KILL_WORDS.some((word) => lower.includes(word));
}

/** 击杀播报的动词：词前是发起者，词后是被击毁的目标。 */
const KILL_VERBS = ['击毁了', '击落了', '摧毁了', '击杀了', 'destroyed', 'killed', 'shot down', 'shattered'];

export interface KillLine {
  killer: string;
  victim: string;
  /** 发起者名字是否带「(载具)」标注。玩家名字带标注，AI 与武器不带。手写对象可省略。 */
  killerTagged?: boolean;
  /** 受害者名字是否带「(载具)」标注。手写对象可省略，省略时按带标注处理。 */
  victimTagged?: boolean;
  /** 去掉载具名之前的发起者原文，用来识别「玩家名 (微型侦察无人机)」这类辅助载具。 */
  killerRaw?: string;
  /** 去掉载具名之前的受害者原文。 */
  victimRaw?: string;
}

/**
 * kill feed 里一个名字代表的是什么。
 *
 * 真机 47 条带动词的播报里，27 条受害者是「玩家名 (载具)」，20 条不是：
 *   13 条是「X (载具) 击毁了 weapons/us_aim_120c_5/short」——导弹拦截，不是击杀；
 *   7 条是「X (载具) 击毁了 IPM1 / AIA-4B / AI米格-15bis」——AI 单位，只有载具名。
 * 玩家目标始终带「(载具)」后缀，这是唯一稳定的区分依据。
 */
export type TargetKind = 'player' | 'ammo' | 'drone' | 'ai';

/** 侦察无人机：能击落直升机与飞机，但它自己被打掉不记玩家阵亡。 */
const DRONE_WORDS = ['无人机', '侦察机', 'uav', 'drone', 'recon'];

/**
 * 给 kill feed 里的一个名字归类。
 *
 * tagged 表示去掉载具名之后原名是否还带「(载具)」后缀；raw 是未去载具名的原文，用来识别
 * 「玩家名 (微型侦察无人机)」这种「玩家开的是辅助载具」的情况。
 *
 * 判断顺序：武器 -> 无人机 -> 玩家 -> 其余当 AI。武器优先，因为 `weapons/xxx/short`
 * 这种名字里也可能出现辅助单位关键字。
 *
 * 侦察无人机能击落直升机或飞机，所以它当发起者时照常入账；它当受害者时不记任何人阵亡。
 * 防空车（播报里常写作「S-75 发射车」）不按名字剔除：它带「(载具)」标注就是玩家开的车，
 * 照常计入；不带标注的裸名称由「是否带标注」这一条自然落到 AI。
 */
export function classifyTarget(token: string, tagged: boolean, raw?: string): TargetKind {
  const text = token.trim();
  if (!text) return 'ai';
  if (/^weapons?[\\/]/i.test(text) || /\/short$/i.test(text)) return 'ammo';
  const probe = (raw && raw.trim() ? raw : text).toLowerCase();
  if (DRONE_WORDS.some((word) => probe.includes(word))) return 'drone';
  return tagged ? 'player' : 'ai';
}

/**
 * 去掉名字尾部的「(载具)」括号段，全角半角都认。
 *
 * 真机载具名自带括号：「Kapitan Haddock (▄F-14A (伊朗) “雄猫”)」，旧的非贪婪正则
 * 只能啃掉最里层，会把名字留成「Kapitan Haddock (▄F-14A (伊朗)」。这里改成配对扫描，
 * 从右往左配平后再整段切掉。
 */
function stripVehicleTag(value: string): string {
  let text = value.trim();
  while (/[)）]\s*$/.test(text)) {
    let depth = 0;
    let open = -1;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === ')' || ch === '）') depth += 1;
      else if (ch === '(' || ch === '（') {
        depth -= 1;
        if (depth === 0) { open = i; break; }
      }
    }
    if (open <= 0) break;
    text = text.slice(0, open).trim();
  }
  return text;
}

/** 这段名字是否带「(载具)」标注：只要有右括号收尾就算，不要求能被成对解析。 */
function hasVehicleTag(value: string): boolean {
  return /[)）]\s*$/.test(value.trim());
}

/** 比对用名字归一化：去零宽、压平空白、小写，保留昵称中有意义的空格。 */
export function normalizePlayerName(value: string): string {
  return cleanBattleText(value).toLowerCase();
}

function samePlayer(actual: string, configured: string): boolean {
  const me = normalizePlayerName(stripVehicleTag(configured));
  if (!me) return false;
  const name = normalizePlayerName(stripVehicleTag(actual));
  // A displayed squadron prefix is not an arbitrary nickname substring.
  const withoutSquadron = name.replace(/^(?:\[[^\]]+\]|=[^=]+=|\^[^^]+\^)\s*/, '');
  return name === me || withoutSquadron === me;
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
    // English verbs must be separated from names; e.g. NotDestroyedAce is a name.
    const match = /^[a-z]/.test(verb) ? new RegExp('\\s' + verb + '\\s', 'i').exec(text) : null;
    const at = /^[a-z]/.test(verb) ? (match ? match.index + 1 : -1) : lower.indexOf(verb);
    if (at <= 0) continue;
    const killerRaw = text.slice(0, at).trim();
    const victimRaw = text.slice(at + verb.length).trim();
    const killer = stripVehicleTag(killerRaw);
    const victim = stripVehicleTag(victimRaw);
    if (!killer || !victim) continue;
    return {
      killer,
      victim,
      killerTagged: hasVehicleTag(killerRaw),
      victimTagged: hasVehicleTag(victimRaw),
      killerRaw,
      victimRaw,
    };
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
  return samePlayer(line.killer, playerName) && !samePlayer(line.victim, playerName);
}

export class BattleClient {
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly encoding: TextEncoding;
  private readonly canRead?: (scope: TelemetryScope) => boolean;

  constructor(opts: BattleClientOptions) {
    const host = opts.host.trim() || '127.0.0.1';
    const port = Number.isFinite(opts.port) && opts.port > 0 ? Math.trunc(opts.port) : 8111;
    this.base = 'http://' + (host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host) + ':' + port;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.encoding = opts.textEncoding ?? 'auto';
    this.canRead = opts.canRead;
  }

  get origin(): string {
    return this.base;
  }

  private async json(path: string): Promise<unknown> {
    if (this.canRead) {
      const scopes: Record<string, TelemetryScope> = { '/state': 'vehicle', '/indicators': 'vehicle', '/mission.json': 'mission', '/map_info.json': 'map', '/map_obj.json': 'map', '/hudmsg': 'hud', '/gamechat': 'chat' };
      const scope = scopes[path.split('?')[0]];
      try { if (!scope || !this.canRead(scope)) return null; } catch { return null; }
    }
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
      // 2026-11-10 真机复核：/state 的 32 个字段里没有 vehicle_type / game_mode / army /
      // map_valid，只有飞行仪表。这三行照旧保留（客户端升级可能加回来），但不要指望它有值：
      // 载具身份与 army 实际来自 /indicators，game_mode 两端都不给。
      vehicle: str(item.vehicle_type),
      mode: str(item.game_mode),
      army: str(item.army),
      ...(knownBool(item.map_valid) ? { mapValidKnown: true } : {}),
      ...(finite(item['IAS, km/h']) ? { speedKmh: item['IAS, km/h'], speedKind: 'IAS' as const }
        : finite(item['TAS, km/h']) ? { speedKmh: item['TAS, km/h'], speedKind: 'TAS' as const } : {}),
      ...(finite(item['H, m']) ? { altitudeM: item['H, m'] } : {}),
      ...(finite(item.Ny) ? { loadFactor: num(item.Ny) } : {}),
    };
  }

  async indicators(): Promise<Indicators | null> {
    const raw = await this.json('/indicators');
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    return {
      valid: bool(item.valid),
      known: knownBool(item.valid),
      speed: num(item.speed),
      altitude: num(item.altitude),
      type: str(item.type),
      ...(vehicleFromType(str(item.type)) === 'dummy_plane' ? { placeholder: true } : {}),
      speedKnown: finite(item.speed),
      altitudeKnown: finite(item.altitude),
      army: str(item.army),
      ...(finite(item.crew_current) ? { crewCurrent: num(item.crew_current) } : {}),
      ...(finite(item.crew_total) ? { crewTotal: num(item.crew_total) } : {}),
      ...(finite(item.gear) ? { gear: num(item.gear) } : {}),
      ...(finite(item.first_stage_ammo) ? { ammo: num(item.first_stage_ammo) } : {}),
      ...(finite(item.stabilizer) ? { stabilizer: num(item.stabilizer) } : {}),
      ...(finite(item.rpm) ? { rpm: num(item.rpm) } : {}),
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
    return (await this.mapObjectsResult()).objects;
  }

  async mapObjectsResult(): Promise<{ objects: MapObject[]; known: boolean }> {
    const raw = await this.json('/map_obj.json');
    if (!Array.isArray(raw)) return { objects: [], known: false };
    const out: MapObject[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      // 真机颜色有几种写法：color[] 数组、color 逗号串、color 井号十六进制（形如 faC81E）。
      // 统一成 "r,g,b"，因为 sideOf() 只认这一种，而陆战自机正是靠颜色认出来的
      // （icon 是 "Player"，不带 enemy/friend 字样）。
      const colorRaw = item['color[]'] ?? item.color;
      const rgb = Array.isArray(colorRaw)
        ? colorRaw.map((part) => Math.trunc(num(part))).join(',')
        : typeof colorRaw === 'string'
          ? normalizeColor(colorRaw)
          : '';
      const dx = typeof item.dx === 'number' && Number.isFinite(item.dx) ? item.dx : undefined;
      const dy = typeof item.dy === 'number' && Number.isFinite(item.dy) ? item.dy : undefined;
      const zoneId = typeof item.zone_id === 'number' && Number.isFinite(item.zone_id) ? item.zone_id : undefined;
      const zoneLabel = typeof item.zone_label === 'string' && item.zone_label.trim() ? item.zone_label.trim() : undefined;
      out.push({
        icon: str(item.icon),
        type: str(item.type),
        // 官方 openapi：x/y 是点的归一化坐标（地图外目标会超出 0..1）；
        // sx/sy/ex/ey 是区域的起始/结束角点，只有机场这类区域对象才给。
        x: num(item.x, num(item.sx)),
        y: num(item.y, num(item.sy)),
        color: rgb || str(item.color),
        ...(dx !== undefined && dy !== undefined ? { dx, dy } : {}),
        ...(zoneId !== undefined ? { zoneId } : {}),
        ...(zoneLabel !== undefined ? { zoneLabel } : {}),
      });
    }
    return { objects: out, known: true };
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
      for (const entry of item.objectives.slice(0, 12)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const text = str((entry as Record<string, unknown>).text).trim();
        if (text) objectives.push(text.replace(/\s+/g, ' '));
      }
    }
    const status = str(item.status).toLowerCase();
    return { running: status === 'running', objectives, status };
  }

  /** 地图元信息。valid 为真说明地图已加载。 */
  async mapInfo(): Promise<MapInfo | null> {
    const raw = await this.json('/map_info.json');
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const value = item.valid;
    const pair = (key: string): [number, number] | undefined => {
      const src = item[key];
      if (!Array.isArray(src) || src.length < 2) return undefined;
      const a = Number(src[0]);
      const b = Number(src[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
      return [a, b];
    };
    const gridSize = pair('grid_size');
    const gridSteps = pair('grid_steps');
    const gridZero = pair('grid_zero');
    const mapMin = pair('map_min');
    const mapMax = pair('map_max');
    return {
      valid: bool(value),
      known: knownBool(value),
      ...(gridSize ? { gridSize } : {}),
      ...(gridSteps ? { gridSteps } : {}),
      ...(gridZero ? { gridZero } : {}),
      ...(mapMin ? { mapMin } : {}),
      ...(mapMax ? { mapMax } : {}),
    };
  }
}

/**
 * /indicators 的 type 形如 tankModels/ussr_t_80ue1_sm、aircraftModels/...，
 * 直接把前缀去掉当载具名，比空字符串有用。
 */
/**
 * 当前读数是不是来自观察者/无人机视角。
 *
 * /state 的 vehicle_type 在切到侦察无人机、炮手镜或观战视角时会换成 dummy_plane /
 * uav_* 这类形态；这些位面下指示灯失效与本人阵亡没有关系，不能拿来记死亡。
 */
function isObserverVehicle(vehicle: string): boolean {
  const name = vehicleFromType(vehicle).toLowerCase();
  if (!name) return false;
  if (name === 'dummy_plane') return true;
  // 内部名常是 dummy_plane / uav_* 这类形态，但中文客户端与部分观察者位面会直接给
  // 「微型侦察无人机」，所以中文词也要认。
  if (DRONE_WORDS.some((word) => name.includes(word))) return true;
  return name.includes('observer') || name.includes('spectator');
}

/** 侦察机坠毁后到切回主载具之间的这段时间，指示灯失效说明不了本人死活。 */
const OBSERVER_CRASH_WINDOW_MS = 20_000;

/** 坠毁类动词：没有"击毁"发起者，parseKillLine 认不出来，只能单独判。 */
const CRASH_WORDS = ['坠毁', '坠机', 'crashed', 'crash'];

/**
 * 「自己的侦察机坠毁」。
 *
 * 真机样本是：玩家名 (微型侦察无人机) 已坠毁。这一行没有发起者，parseKillLine 返回 null，
 * 所以它既不进击杀也不进阵亡；但紧接着视角切回主载具，指示灯会抖一次失效，兜底逻辑就会
 * 把它记成一局阵亡。这里把它识别出来，交给调用方开一个吸收窗口。
 */
export function isSelfObserverCrash(msg: string, playerName: string): boolean {
  const text = cleanBattleText(msg);
  const me = normalizePlayerName(playerName);
  if (!me) return false;
  const lower = text.toLowerCase();
  const meAt = lower.indexOf(me);
  if (meAt < 0) return false;
  // 无人机词必须出现在我名字之后：真机形态是「玩家名 (微型侦察无人机)」。
  const droneAt = DRONE_WORDS
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (droneAt === undefined || droneAt < meAt) return false;
  // 形态一：带坠毁类动词（"… 已坠毁"）。
  if (CRASH_WORDS.some((word) => lower.includes(word))) return true;
  // 形态二（真机实测）：整行只有「玩家名 (微型侦察无人机)」，既没有发起者也没有动词。
  // 这种行 parseKillLine 认不出来，也不会进击杀/阵亡统计；但随后视角切回主载具时
  // 指示灯会抖一次失效，兜底逻辑就会把它记成一局阵亡，所以这里必须识别出来。
  const line = parseKillLine(text);
  if (line) return samePlayer(line.victim, playerName);
  return !KILL_VERBS.some((word) => lower.includes(word));
}

function vehicleFromType(type: string): string {
  const name = type.trim();
  if (!name) return '';
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/** 重生点、机场、据点这些不是单位，统计敌我数量时要排掉。 */
const NON_UNIT_TYPES = ['respawn_base', 'airfield', 'capture_zone', 'point_of_interest', 'defending_point', 'bombing_point'];

// 官方 openapi 的 MapObject.type 枚举里，只有这几种是"点"：防守点、轰炸点、机场。
// 它们不是单位，不能算进敌我数；8111 也不给占领进度与占领方。
const OBJECTIVE_TYPES = ['defending_point', 'bombing_point', 'airfield'];

function isObjectiveObject(object: MapObject): boolean {
  const type = object.type.toLowerCase();
  return OBJECTIVE_TYPES.some((word) => type.includes(word));
}

function isUnitObject(object: MapObject): boolean {
  const type = object.type.toLowerCase();
  if (!type || type === 'none') return false;
  return !NON_UNIT_TYPES.some((word) => type.includes(word));
}

/**
 * 把 8111 的颜色写法归一成 "r,g,b"。
 *
 * 同一台客户端两种都见过：#faC81E 这种十六进制串与 [250,200,30] 数组。数组在
 * mapObjectsResult 里直接 join，字符串走这里。认不出来就原样返回，交给 sideOf 回退。
 */
function normalizeColor(value: string): string {
  const text = value.trim();
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(text);
  if (hex) {
    const packed = parseInt(hex[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255].join(',');
  }
  return text;
}

/**
 * 敌我判定。真机的小地图单位不带 enemy/friend 字样，靠颜色区分：
 * 友方 [23,77,255] / 敌方 [250,12,0] / 自己 [250,200,30]。
 * 老客户端的 icon 里可能带 enemy/friend，所以颜色判不出来时回退看 icon；
 * icon 直接是 "Player" 的也一定是自己（陆战真机就长这样）。
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
  if (icon === 'player') return 'self';
  if (icon.includes('enemy')) return 'enemy';
  if (icon.includes('friend') || icon.includes('ally')) return 'ally';
  return '';
}

/** 把角度归一到 -180..180 并取整，用于相对车头的方位角。 */
function normalizeDeg(deg: number): number {
  const wrapped = (((deg + 180) % 360) + 360) % 360 - 180;
  return Math.round(wrapped);
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
  /** 当前响应内的稳定组键:发起者>目标@首条事件id。 */
  key: string;
  /** 原始播报正文,拿去开口。 */
  detail: string;
  /** 目标昵称(已去掉尾部的载具括号)。 */
  victim: string;
  /** 目标段的原始文本，含「(载具)」标注；播报要用全就给这一份。 */
  victimRaw: string;
  /** 这次击毁在 feed 里最大的那条 id。 */
  id: number;
  /** 在本轮 feed 范围内,同一对玩家之间的第几次击毁。 */
  occurrence: number;
}

/** 一次"自己被打掉"的命中,幂等键带 d: 前缀,与击杀分开计数。 */
export interface SelfDeathHit {
  /** 当前响应内的稳定组键:d:发起者>目标@首条事件id。 */
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
 * 判「同一次击毁的多条播报」的同一性窗口。
 *
 * 只用 time 会漏计：客户端的 time 是战局内秒数，跨局会回绕（实测同一份全量 feed
 * 里 id 337 是 t333、id 343 却是 t153），两个不同战局里同一对玩家在相近秒数发生的
 * 击毁就会被误判成重复。改用 id 距离为主、time 作辅：服务端 id 单调递增，同一次
 * 击毁的多条播报既挨着 id 也共用 time。time 缺失时只按 id 判断。
 */
/**
 * 当前战局在 feed 里的起点下标。
 *
 * /hudmsg 的 damage 是整个游戏会话累积的，跨战局不清零；唯一的分局信号是 time——
 * 它是战局内秒数，新局从 0 重新计（真机同一份 feed 里 id 337 是 t333、id 343 却是 t153）。
 * 所以最后一个 time 回退点之后的行属于当前战局。留 1 秒容差，避免同 tick 的乱序被误判。
 */
export function battleStartIndex(damage: HudEvent[]): number {
  const ordered = [...damage].sort((a, b) => a.id - b.id);
  let start = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.time > 0 && cur.time > 0 && cur.time + 1 < prev.time) start = i;
  }
  return start;
}

function sameKillWindow(time: number, previousTime: number, id: number, previousId: number): boolean {
  const nearById = id > previousId && id - previousId <= KILL_DEDUPE_ID;
  if (!nearById) return false;
  // 同一次击毁的多条播报 id 相邻、time 只差 1 秒左右；两次真击毁至少隔几十秒
  // （真机 155 条里同 pair 相邻的 IPM1 t46/t76、T-62 t26/t61 都隔 30 秒以上）。
  // 所以 8 秒窗是安全的分界，不必收紧到严格相等。
  if (!(time > 0 && previousTime > 0)) return true;
  return Math.abs(time - previousTime) * 1000 < KILL_DEDUPE_MS;
}
/**
 * 把全量 damage feed 收成去重后的击毁行。
 *
 * 先按 classifyTarget 剔除 AI 单位、弹药拦截与辅助单位，再按对归组去重。
 *
 * 同一次击毁会连着吐多条播报(击毁 / 起火 / 首杀),这里按 发起者>目标 归组:组内
 * 用 sameKillWindow 判重(id 邻近为主、time 相同为辅)。
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
    // 受害者只认玩家：AI 单位、弹药拦截、无人机、发射车都不进战绩（真机 20/47 条属于这几类）。
    // 发起者不做过滤：他是不是玩家由 isSelfKill 用昵称比对决定，那里 AI 与武器名天然不匹配；
    // 而「玩家开着侦察无人机」这种发起者，去后缀后正是玩家本人，理应算作他的战功。
    if (classifyTarget(line.victim, line.victimTagged !== false, line.victimRaw) !== 'player') continue;
    const pair = normalizePlayerName(line.killer) + '>' + normalizePlayerName(line.victim);
    const prev = anchor.get(pair);
    if (prev) {
      const sameWindow = sameKillWindow(event.time, prev.time, event.id, prev.id);
      if (sameWindow) {
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
      key: row.pair + '@' + row.id,
      detail: row.detail,
      victim: row.line.victim,
      // 老客户端不带 victimRaw 时退回目标昵称，别让播报少一段。
      victimRaw: row.line.victimRaw ?? row.line.victim,
      id: row.id,
      occurrence: row.occurrence,
    }));
}

/** 受害者是不是我(按归一化后的昵称做包含匹配)。 */
export function isSelfDeath(line: KillLine, playerName: string): boolean {
  return samePlayer(line.victim, playerName);
}

/**
 * 从全量 damage feed 里挑出"自己被打掉"。
 *
 * 与 computeSelfKills 同一套路:每轮全量重算 + 幂等键去重,所以重连、换局、游戏重启
 * 都不会把阵亡数算丢或算重。键带 d: 前缀,与击杀键互不干扰。
 *
 * 自伤只记阵亡，不奖励击毁。
 */
export function computeSelfDeaths(
  damage: HudEvent[],
  opts: { afterId: number; playerName: string },
): SelfDeathHit[] {
  const hits: SelfDeathHit[] = [];
  for (const row of collectKillRows(damage, opts.afterId)) {
    if (!isSelfDeath(row.line, opts.playerName)) continue;
    if (isSelfKill(row.line, opts.playerName)) continue;
    // 侦察机是消耗品：它被打掉或自己坠毁都不算玩家阵亡，只算损失一架无人机。
    if (classifyTarget(row.line.victim, row.line.victimTagged !== false, row.line.victimRaw) === 'drone') continue;
    hits.push({
      key: 'd:' + row.pair + '@' + row.id,
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
 * damage 不能整体当成本机战绩，逐条核对昵称归属；events只作外部战况原文，
 * 不累加自己的战绩。两路均为客户端观察，不是服务器记分板。
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
  mapKnown: boolean;
  /** 地图端点的完整读数：坐标换算与格网都要用，只留 valid 会丢掉 grid_zero / map_max。 */
  mapInfo: MapInfo | null;
  indicators: Indicators | null;
  /** 任务端点的原始读数：用来判断战局是不是已经结束（null = 该端点读不到）。 */
  mission: MissionState | null;
  battleKnown: boolean;
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
  /** 入局播报已挂起的拍数；0 表示没有挂起的 enter。 */
  private pendingEnterPolls = 0;
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
  /** 是否允许用指示灯失效边沿补记阵亡，见 BattleWatcherOptions。 */
  private readonly inferDeathFromIndicators: boolean;
  /** 附近敌我的统计半径（m）。 */
  private readonly nearbyRadiusM: number;
  /** 上一次拿到自身世界坐标的时刻与位置，用来算对地速度。 */
  private lastFix: { x: number; y: number; at: number } | undefined;
  /** 在局判定是否必须看到地图证据，见 BattleWatcherOptions。 */
  private readonly strictInBattle: boolean;
  /** 连续多少轮看到指示灯有效但 invalid；兜底阵亡要求 >=DEATH_CONFIRM_POLLS。 */
  private invalidStreak = 0;
  /** 本拍地图里有没有自己的图标：true/false 为确定值，null = 地图端点这一拍读不到。 */
  private selfOnMap: boolean | null = null;
  /** feed 已确认这一命结束；置位后指示灯失效不再重复计，直到自己的图标回到地图。 */
  private selfDead = false;
  /** 最近一次「自己的侦察机损毁」的时刻；兜底推断在这个窗口内不计阵亡。 */
  private observerCrashAt = 0;
  /** 已经入账的击杀幂等键（发起者>目标#第几次），全量重放多少次都只算一次。 */
  private readonly countedKills = new Set<string>();
  /** 已经开口过的全战场播报 id，全量重放时不重复播。 */
  private readonly seenHud = new Set<string>();
  /** 已经入账的阵亡幂等键（d:发起者>目标#第几次）。 */
  private readonly countedDeaths = new Set<string>();
  private readonly processedDamage = new Set<string>();
  private readonly recentDamage = new Map<string, { id: number; time: number }>();
  private lastDmgMax = -1;
  private lastEvtMax = -1;
  private awaitingInvalidAfterFeed = false;
  private pendingIndicatorDeath = false;
  private observedKnown = false;
  private observationMade = false;
  private combatTimeline: Array<{ identity: string; kind: 'kill' | 'death'; id: number; epoch: number }> = [];
  private combatEpoch = 0;
  private pendingIndicatorEntry: string | null = null;
  private inferredSequence = 0;
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
    this.inferDeathFromIndicators = opts.inferDeathFromIndicators === true;
    this.nearbyRadiusM = Math.min(5000, Math.max(50, opts.nearbyRadiusM ?? 500));
    this.strictInBattle = opts.strictInBattle !== false;
  }

  get online_now(): boolean {
    return this.online;
  }

  /** 区分构造默认值与该观测身份已经完成的一次探测（包含离线）。 */
  get hasObservation(): boolean { return this.observationMade; }

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

  get observedBattleKnown(): boolean { return this.observedKnown; }

  get currentSnapshot(): BattleSnapshot {
    return this.snapshot;
  }

  get tally(): { kills: number; deaths: number; bestStreak: number } {
    return { kills: this.kills, deaths: this.deaths, bestStreak: this.bestStreak };
  }

  /** 记一次阵亡：累加、断连胜、落后两杀以上喊一句逆风。两路共用，口径只有一处。 */
  private recomputeStreaks(): void {
    let streak = 0;
    let best = 0;
    for (const event of [...this.combatTimeline].sort((a, b) => a.epoch - b.epoch || a.id - b.id)) {
      if (event.kind === 'death') streak = 0;
      else { streak += 1; best = Math.max(best, streak); }
    }
    this.streak = streak;
    this.bestStreak = best;
  }

  private applyDeath(out: BattleEvent[], feed?: { identity: string; id: number; killer?: string; detail?: string }): void {
    this.deaths += 1;
    const identity = feed?.identity ?? 'inferred:' + (++this.inferredSequence);
    this.combatTimeline.push({ identity, kind: 'death', id: feed?.id ?? this.lastDmgMax + 0.5, epoch: this.combatEpoch });
    if (!feed) this.pendingIndicatorEntry = identity;
    this.recomputeStreaks();
    // 0.5.1：谁把我打掉的、原文怎么说，都随事件一起给出去；推断路径没有 feed，这两个字段就缺省。
    out.push({
      kind: 'death',
      total: this.deaths,
      snapshot: this.snapshot,
      ...(feed?.killer ? { killer: feed.killer } : {}),
      ...(feed?.detail ? { feedText: feed.detail } : {}),
    });
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
    this.processedDamage.clear();
    this.recentDamage.clear();
    this.lastDmgMax = -1;
    this.lastEvtMax = -1;
    this.awaitingInvalidAfterFeed = false;
    this.pendingIndicatorDeath = false;
    this.observerCrashAt = 0;
    this.selfOnMap = null;
    this.selfDead = false;
    this.combatTimeline = [];
    this.combatEpoch = 0;
    this.pendingIndicatorEntry = null;
    this.inferredSequence = 0;
    this.baselineDmgId = -1;
    this.baselineEvtId = -1;
    this.lastFix = undefined;
    // 开新局即作废上一局挂起的入局播报：留着会被带进新局，再补出一条「进战局」。
    this.pendingEnterPolls = 0;
    this.snapshot = { vehicle, mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };
  }

  private refreshSnapshot(probe: BattleProbe): void {
    const { objects } = probe;
    const vehiclePending = probe.indicators?.placeholder === true;
    // 实战入场会给 dummy_plane 及一整套有效飞机仪表；不能冒充玩家读数。
    const state = vehiclePending ? null : probe.state;
    const ind = vehiclePending ? null : probe.indicators;
    let enemies = 0;
    let allies = 0;
    let selfX: number | undefined;
    let selfY: number | undefined;
    let selfDx: number | undefined;
    let selfDy: number | undefined;
    let points = 0;
    const classified: Array<{ object: MapObject; side: 'enemy' | 'ally' | 'self' | 'point' }> = [];
    for (const object of objects) {
      if (isObjectiveObject(object)) { points += 1; classified.push({ object, side: 'point' }); continue; }
      if (!isUnitObject(object)) continue;
      const side = sideOf(object);
      if (side === 'enemy') { enemies += 1; classified.push({ object, side: 'enemy' }); }
      else if (side === 'ally') { allies += 1; classified.push({ object, side: 'ally' }); }
      else if (side === 'self') {
        selfX = object.x;
        selfY = object.y;
        // 只有自己的图标带朝向；老客户端不给时保持 undefined，方位角就不出。
        if (object.dx !== undefined && object.dy !== undefined) { selfDx = object.dx; selfDy = object.dy; }
        classified.push({ object, side: 'self' });
      }
    }
    const speed: NonNullable<BattleSnapshot['readings']>['speed'] = state?.valid && state.speedKmh !== undefined
      ? { value: state.speedKmh, unit: 'km/h', source: '/state', kind: state.speedKind ?? 'speed' }
      : { value: ind?.known && ind.valid && ind.speedKnown ? ind.speed : null, unit: 'unconfirmed', source: '/indicators.speed', kind: 'raw' };
    const altitude: NonNullable<BattleSnapshot['readings']>['altitude'] = state?.valid && state.altitudeM !== undefined
      ? { value: state.altitudeM, unit: 'm', source: '/state.H, m' }
      : { value: ind?.known && ind.valid && ind.altitudeKnown ? ind.altitude : null, unit: 'unconfirmed', source: '/indicators.altitude' };
    // 过载只有 /state 的 Ny 一个来源（/indicators 是陆战仪表，没有这个字段）。
    const load: NonNullable<BattleSnapshot['readings']>['load'] = { value: state?.valid && state.loadFactor !== undefined ? state.loadFactor : null, source: '/state.Ny' };
    // 地图端点里的 x/y 是 0..1 归一化坐标：乘以 map_min/map_max 的跨度就是世界米数（换算唯一确定）。
    // 格子号用客户端自己的 grid_zero / grid_steps 换算，y 轴向下，所以行号取零点的减。
    // 真机参数（2026-11-02 陆战）：map 0..4096、grid_size 1600、grid_steps 225、grid_zero [1519.45, 2497.25]。
    let worldX: number | undefined;
    let worldY: number | undefined;
    let gridCol: number | undefined;
    let gridRow: number | undefined;
    const mapInfo = probe.mapInfo;
    if (selfX !== undefined && selfY !== undefined && mapInfo?.valid && mapInfo.mapMin && mapInfo.mapMax) {
      const wx = mapInfo.mapMin[0] + selfX * (mapInfo.mapMax[0] - mapInfo.mapMin[0]);
      const wy = mapInfo.mapMin[1] + selfY * (mapInfo.mapMax[1] - mapInfo.mapMin[1]);
      worldX = Math.round(wx);
      worldY = Math.round(wy);
      const zero = mapInfo.gridZero;
      const step = mapInfo.gridSteps;
      if (zero && step && step[0] > 0 && step[1] > 0) {
        gridCol = Math.floor((wx - zero[0]) / step[0]);
        gridRow = Math.floor((zero[1] - wy) / step[1]);
      }
    }
    // 对地速度：陆战/海战优先用 /indicators.speed —— 真机实测它在坦克上就是 km/h
    // （2026-11-10 Centauro RGO 那局 84 拍对拍：加速段 86/88、巡航 87~90/87~89、减速 70→26/65→22、
    // 末段 21.4/21，差几公里是 0.23 秒采样与地图点抖动的量级），而且自机点还没进 /map_obj 时
    // 它就有值（真机 20:00:19 起 speed=0.000000），不必等自机点出现。
    // 位移法留作兜底：/indicators.speed 缺字段或那一拍无效时，仍按两次采样的世界坐标差算。
    // 海战沿用同一口径（没单独核对过；若舰艇给的不是 km/h，再按兵种分开取）。
    // 位移小于 3 km/h 当作静止，避免坐标抖动被读成在跑。
    let groundSpeedKmh: number | undefined;
    const observedAt = this.now();
    const armyNow = state?.army || ind?.army || '';
    const onGroundNow = armyNow === 'tank' || armyNow === 'ship';
    if (onGroundNow && ind?.known && ind.valid && ind.speedKnown && Number.isFinite(ind.speed)) {
      groundSpeedKmh = Math.round(ind.speed);
    }
    if (worldX !== undefined && worldY !== undefined) {
      const prev = this.lastFix;
      if (groundSpeedKmh === undefined && prev) {
        const dtSec = (observedAt - prev.at) / 1000;
        if (dtSec >= 0.3) {
          const kmh = Math.round((Math.hypot(worldX - prev.x, worldY - prev.y) / dtSec) * 3.6);
          groundSpeedKmh = kmh < 3 ? 0 : kmh;
        }
      }
      this.lastFix = { x: worldX, y: worldY, at: observedAt };
    }

    // 附近敌我：同一套 map_min/map_max 换算后算直线距离。整张地图的单位数不封顶（真机见过两百多条），
    // 只有半径内的前 8 条进 contacts；点位（防守点/轰炸点/机场）单独计数，用于回答"附近有没有点"。
    let nearby: BattleSnapshot['nearby'] | undefined;
    let contacts: MapContact[] | undefined;
    if (worldX !== undefined && worldY !== undefined && mapInfo?.mapMin && mapInfo.mapMax) {
      const spanX = mapInfo.mapMax[0] - mapInfo.mapMin[0];
      const spanY = mapInfo.mapMax[1] - mapInfo.mapMin[1];
      const near: MapContact[] = [];
      // 车头朝向：与自己同一坐标系的单位向量，方位角 = 目标方位 − 车头朝向，不需要地图定标。
      const heading = selfDx !== undefined && selfDy !== undefined && (selfDx !== 0 || selfDy !== 0)
        ? Math.atan2(selfDy, selfDx)
        : undefined;
      let nearEnemies = 0;
      let nearAllies = 0;
      let nearPoints = 0;
      for (const item of classified) {
        if (item.side === 'self') continue;
        const ox = Math.round(mapInfo.mapMin[0] + item.object.x * spanX);
        const oy = Math.round(mapInfo.mapMin[1] + item.object.y * spanY);
        const dist = Math.round(Math.hypot(ox - worldX, oy - worldY));
        if (dist > this.nearbyRadiusM) continue;
        if (item.side === 'enemy') nearEnemies += 1;
        else if (item.side === 'ally') nearAllies += 1;
        else nearPoints += 1;
        const cell = mapInfo.gridZero && mapInfo.gridSteps && mapInfo.gridSteps[0] > 0 && mapInfo.gridSteps[1] > 0
          ? {
            col: Math.floor((ox - mapInfo.gridZero[0]) / mapInfo.gridSteps[0]),
            row: Math.floor((mapInfo.gridZero[1] - oy) / mapInfo.gridSteps[1]),
          }
          : {};
        const bearingDeg = heading === undefined
          ? undefined
          : normalizeDeg(((Math.atan2(oy - worldY, ox - worldX) - heading) * 180) / Math.PI);
        near.push({
          side: item.side,
          x: ox,
          y: oy,
          distM: dist,
          icon: item.object.icon,
          type: item.object.type,
          ...(bearingDeg !== undefined ? { bearingDeg } : {}),
          ...cell,
        });
      }
      near.sort((a, b) => a.distM - b.distM);
      nearby = { radiusM: this.nearbyRadiusM, enemies: nearEnemies, allies: nearAllies, points: nearPoints };
      // 0.5.1：半径内的目标不再掐到 8 条。地图端点在真机能给到两百多条，
      // 「附近有什么」是素材，取舍留给播报层，不再由这里替桌宠筛掉。
      contacts = near.slice(0, 40);
    }
    // 占领点：capture_zone 对象带 zone_id / zone_label（A/B/C），这是端口唯一直接给出占领点的通道。
    // 世界坐标与格号跟其它对象同一套换算；地图参数缺失时仍保留归一化坐标，不把点丢掉。
    // 占领进度、占领方、谁在占，端口一概不给，那部分才由按需截图 OCR 兜底。
    const zones: MapZone[] = [];
    if (probe.mapKnown) {
      const zMin = mapInfo?.valid ? mapInfo.mapMin : undefined;
      const zMax = mapInfo?.valid ? mapInfo.mapMax : undefined;
      const zero = mapInfo?.gridZero;
      const step = mapInfo?.gridSteps;
      for (const object of objects) {
        if (!object.type.toLowerCase().includes('capture_zone')) continue;
        const fallback = zones.length + 1;
        const zone: MapZone = {
          id: object.zoneId ?? fallback,
          label: object.zoneLabel || String(object.zoneId ?? fallback),
          icon: object.icon,
          type: object.type,
          color: object.color,
          side: sideOf(object),
          x: object.x,
          y: object.y,
        };
        if (zMin && zMax) {
          const ox = Math.round(zMin[0] + object.x * (zMax[0] - zMin[0]));
          const oy = Math.round(zMin[1] + object.y * (zMax[1] - zMin[1]));
          zone.worldX = ox;
          zone.worldY = oy;
          if (zero && step && step[0] > 0 && step[1] > 0) {
            zone.col = Math.floor((ox - zero[0]) / step[0]);
            zone.row = Math.floor((zero[1] - oy) / step[1]);
          }
        }
        zones.push(zone);
      }
      zones.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    // 真机 /state 从不带 vehicle_type，载具身份只挂在 /indicators.type 上；那一拍请求失败、
    // 返回残缺对象或 valid 抖成 false 时不能把已知载具清空，沿用上一拍的值（换载具走
    // vehiclePending 分支，那里会明确清空）。
    const vehicle = vehiclePending
      ? ''
      : (state?.valid && state.vehicle)
        || (ind && ind.known && ind.valid ? vehicleFromType(ind.type) : '')
        || (this.snapshot?.vehicle ?? '');
    const vehicleState = ind && ind.known && ind.valid
      ? {
        ...(ind.crewCurrent !== undefined ? { crewCurrent: ind.crewCurrent } : {}),
        ...(ind.crewTotal !== undefined ? { crewTotal: ind.crewTotal } : {}),
        ...(ind.gear !== undefined ? { gear: ind.gear } : {}),
        ...(ind.ammo !== undefined ? { ammo: ind.ammo } : {}),
        ...(ind.stabilizer !== undefined ? { stabilizer: ind.stabilizer > 0 } : {}),
        ...(ind.rpm !== undefined ? { rpm: ind.rpm } : {}),
      }
      : undefined;
    this.snapshot = {
      vehicle,
      mode: state ? state.mode : this.snapshot.mode,
      army: state?.army || ind?.army || '',
      speed: speed.value ?? 0,
      altitude: altitude.value ?? 0,
      enemies,
      allies,
      // points 从 0.5.4 起就一直在算（防守点/轰炸点/机场），但漏了写进快照，situationLine 的「目标点 N」因此永远不出现。
      ...(points > 0 ? { points } : {}),
      ...(selfX !== undefined && selfY !== undefined ? { selfX, selfY } : {}),
      ...(selfDx !== undefined && selfDy !== undefined ? { selfDx, selfDy } : {}),
      ...(worldX !== undefined && worldY !== undefined ? { worldX, worldY } : {}),
      ...(gridCol !== undefined && gridRow !== undefined ? { gridCol, gridRow } : {}),
      ...(vehicleState && Object.keys(vehicleState).length > 0 ? { vehicleState } : {}),
      ...(groundSpeedKmh !== undefined ? { groundSpeedKmh } : {}),
      ...(nearby ? { nearby } : {}),
      ...(contacts && contacts.length > 0 ? { contacts } : {}),
      ...(zones.length > 0 ? { zones } : {}),
      ...(probe.mission && probe.mission.objectives.length > 0 ? { objectives: probe.mission.objectives.slice(0, 12) } : {}),
      readings: {
        speed,
        altitude,
        load,
        mapKnown: probe.mapKnown,
        observedAt: this.now(),
        ...(vehiclePending ? { vehiclePending: true } : {}),
      },
    };
    // 地图端点这一拍读不到时记 null：没有图标不能当死亡证据，只能算"不知道"。
    this.selfOnMap = probe.mapKnown ? selfX !== undefined && selfY !== undefined : null;
    if (this.selfOnMap === true) this.selfDead = false;
  }

  /** 五路并发观察：在线与战局状态分别判断；缺少强信号时保留“未知”。 */
  private async probe(): Promise<BattleProbe> {
    const [state, mission, mapInfo, map, indicators] = await Promise.all([
      this.client.state(),
      this.client.mission(),
      this.client.mapInfo(),
      this.client.mapObjectsResult(),
      this.client.indicators(),
    ]);
    const objects = map.objects;
    const online = state !== null || mission !== null || mapInfo !== null || objects.length > 0 || indicators !== null;
    const missionRunning = mission !== null && mission.running;
    const mapReady = mapInfo !== null && mapInfo.valid;
    // 真机 /state 不带 map_valid（2026-11-10 复核 32 个字段全是飞行仪表），
    // bool(undefined) 恒 false 会让这条信号源永远失效；只有客户端确实给了这个字段才采信它。
    const stateOk = state !== null && state.valid && (state.mapValidKnown ? state.mapValid : true);
    // 单独的 objects.length 不能当判据：机库里 map_obj.json 可能还残留上一局的单位。
    const missionEnded = mission !== null && ['ended', 'completed', 'success', 'failed', 'fail', 'over'].includes(mission.status);
    // 机库实测（2026-11-02）：/state 与 /indicators 都是 valid:true，/mission.json 仍报
    // status=running，只有 /map_info.json 是 valid:false、/map_obj.json 是空数组。
    // 所以让地图端点直接否决 mission 才判得对；但端点完全不可读（mapInfo=null，
    // 例如 readMap 关了）时不能据此否决。刚进局地图未就绪会有几秒延迟，可接受。
    const mapGone = mapInfo !== null && mapInfo.known && !mapInfo.valid;
    const mapGoneOutside = mapGone && !missionRunning;
    const mapLive = mapReady || objects.length > 0;
    const inBattle = this.strictInBattle
      ? !missionEnded && !mapGone && (mapLive || missionRunning || stateOk)
      : !missionEnded && !mapGoneOutside && (missionRunning || stateOk || (mapReady && objects.some(isUnitObject)));
    const confirmedOutside = this.strictInBattle
      ? missionEnded || mapGone
      : missionEnded || mapGoneOutside || (state?.valid && state.mapValidKnown && !state.mapValid);
    return { online, inBattle, state, objects, mapKnown: map.known, mapInfo, indicators, mission, battleKnown: inBattle || !!confirmedOutside };
  }
  /**
   * 主动刷新一次读数,不产生事件、也不改变事件状态机。
   *
   * 早先这里会顺手写 inBattle，于是 wt_battle_state 先查一次之后，下一次 poll 就以为
   * "已经在局里"，跳过了 reset/warmup，把上一局积压的伤害算成本局战绩。观测与转移必须分开。
   */
  async refresh(): Promise<BattleSnapshot> {
    const probe = await this.probe();
    this.observationMade = true;
    this.online = probe.online;
    this.observedKnown = probe.battleKnown;
    this.observedInBattle = probe.inBattle;
    if (probe.inBattle) this.refreshSnapshot(probe);
    return this.snapshot;
  }
  /** 预热:只把基线锚到当前最新,不产生事件。 */
  async warmup(): Promise<void> {
    const hud = await this.client.hud(-1, -1);
    this.baselineEvtId = maxId(hud.events, -1);
    this.baselineDmgId = maxId(hud.damage, -1);
    this.lastDmgMax = this.baselineDmgId;
    this.lastEvtMax = this.baselineEvtId;
    for (const event of hud.damage) this.processedDamage.add(eventFingerprint(event));
    for (const event of hud.events) this.seenHud.add(eventFingerprint(event));
  }

  /** 拉一次并给出这一轮要推的事件;游戏没开就返回空数组。 */
  async poll(): Promise<BattleEvent[]> {
    const out: BattleEvent[] = [];
    const probe = await this.probe();
    this.observationMade = true;
    if (!probe.online) {
      // Missing transport data is unknown, not a confirmed match result.
      this.online = false;
      this.observedInBattle = false;
      this.observedKnown = false;
      return out;
    }
    this.online = true;
    this.observedKnown = probe.battleKnown;
    this.observedInBattle = probe.inBattle;
    if (!probe.battleKnown) return out;
    const state = probe.state;
    const inBattle = probe.inBattle;

    if (inBattle && !this.inBattle) {
      this.inBattle = true;
      this.resetBattle((state && state.vehicle) || '');
      this.refreshSnapshot(probe);
      await this.warmup();
      // 入局这一拍就把存活边沿武装好。不武装的话,下一次读到的失效会因为"没见过活的"
      // 而被当成缺数据直接丢掉,玩家看到的现象就是"第一次阵亡从来不播"。
      const firstInd = probe.indicators;
      if (firstInd && firstInd.known && firstInd.valid && !firstInd.placeholder) this.aliveArmed = true;
      // enter 不在这里发：加载画面里 type 还是 dummy_plane，这一拍推出去就是
      // 「载具待生成 · 速度未读到…」，而一局只有一次 enter，之后再没有更正的机会。
      // 先挂起交给每拍末尾的 flushPendingEnter；warmup 已经把 HUD 基线锚好，
      // 击杀/阵亡归因不依赖 enter，所以推迟不会丢战绩。
      this.pendingEnterPolls = 1;
      // 不 return：这一拍继续走常规流程，让 refreshSnapshot 用最新读数把快照补齐。
    }

    if (!inBattle) {
      if (this.inBattle) {
        this.inBattle = false;
        // enter 还没发出去就离场：没有「进战局」可对应的「离场」，这条不发。
        const neverEntered = this.pendingEnterPolls > 0;
        this.pendingEnterPolls = 0;
        if (!neverEntered) out.push({ kind: 'leave', summary: this.summaryOf() });
        // 离场即把本局战绩清干净：结算界面里再查状态不该还挂着上一局的杀与死。
        this.kills = 0;
        this.deaths = 0;
        this.streak = 0;
        this.bestStreak = 0;
        this.behindRaised = false;
        this.invalidStreak = 0;
        this.countedKills.clear();
        this.countedDeaths.clear();
        this.combatTimeline.length = 0;
        // 载具与开局时刻也清掉：否则结算界面再查状态会挂着上一局的载具名。
        this.snapshot = { vehicle: '', mode: '', army: '', speed: 0, altitude: 0, enemies: 0, allies: 0 };
        this.startedAt = 0;
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
    if (dmgMax >= 0 && this.lastDmgMax > dmgMax) {
      this.baselineDmgId = -1;
      // A lower-ID subset may be stale, not a new server. Never erase known identities here.
      // Keep cross-response anchors too: the next row may be a continuation of this old view.
      const continuesKnownGroup = (event: HudEvent): boolean => {
        const line = parseKillLine(event.msg);
        if (!line) return false;
        const previous = this.recentDamage.get(normalizePlayerName(line.killer) + '>' + normalizePlayerName(line.victim));
        return !!previous && event.id > previous.id && sameKillWindow(event.time, previous.time, event.id, previous.id);
      };
      if (hud.damage.length > 0 && hud.damage.every(event => !this.processedDamage.has(eventFingerprint(event)) && !continuesKnownGroup(event))) {
        this.combatEpoch += 1;
        this.recentDamage.clear();
        this.pendingIndicatorDeath = false;
        this.pendingIndicatorEntry = null;
        this.lastDmgMax = dmgMax;
      }
    }
    if (evtMax >= 0 && this.lastEvtMax > evtMax) this.baselineEvtId = -1;
    if (dmgMax >= 0) this.lastDmgMax = Math.max(this.lastDmgMax, dmgMax);
    if (evtMax >= 0) this.lastEvtMax = evtMax;

    // 一局结束到下一局开始之间，1500ms 一轮很可能抓不到地图卸载的那一瞬，
    // inBattle 就一直 true，新局的击杀会累加到上一局头上（结算界面看到两局之和）。
    // 新局的 time 从 0 重新计（真机 id337=t333 紧跟 id343=t153），所以只看本窗口
    // 新增行里的 time 回退：命中就把旧局封存、基线推到回退点之前，接着从新局累计。
    const fresh = hud.damage
      .filter(row => row.id > this.baselineDmgId)
      .sort((left, right) => left.id - right.id);
    const cut = fresh.length > 1 ? battleStartIndex(fresh) : 0;
    if (cut > 0) {
      // 上一局还没发出 enter 就又切局：没有「进」就没有「出」，这条 leave 不发。
      const neverEntered = this.pendingEnterPolls > 0;
      if (!neverEntered) out.push({ kind: 'leave', summary: this.summaryOf() });
      const carriedEvt = this.baselineEvtId;
      this.resetBattle(state?.vehicle ?? '');
      this.baselineDmgId = fresh[cut - 1].id;
      this.baselineEvtId = carriedEvt;
      // 新一局的 enter 也交给 flushPendingEnter，与入局边沿那条统一：这里 refreshSnapshot
      // 还没跑，直接 push 拿到的是上一局封存时的空载具（真机 /state 不带 vehicle_type）。
      this.pendingEnterPolls = 1;
    }

    this.refreshSnapshot(probe);

    let killPushed = 0;
    let feedDeathThisPoll = false;
    // One ordered stream, not all kills followed by all deaths: streaks cannot cross a death.
    // feed 只在战局确实还活着时才归因；否则结算界面滚动的收尾播报会被算进本局。
    const feedLive = this.feedLive(probe);
    // 自己的侦察机损毁：不进击杀、不进阵亡，但要开一个吸收窗口，免得随后指示灯抖动记成一局阵亡。
    if (feedLive) {
      for (const row of hud.damage) {
        if (row.id <= this.baselineDmgId) continue;
        const identity = eventFingerprint(row);
        if (this.processedDamage.has(identity)) continue;
        if (!isSelfObserverCrash(row.msg, this.playerName)) continue;
        this.processedDamage.add(identity);
        this.observerCrashAt = this.now();
        this.aliveArmed = false;
      }
    }
    const hits = !feedLive ? [] : [
      ...computeSelfKills(hud.damage, { afterId: this.baselineDmgId, playerName: this.playerName }).map(hit => ({ ...hit, kind: 'kill' as const })),
      ...computeSelfDeaths(hud.damage, { afterId: this.baselineDmgId, playerName: this.playerName }).map(hit => ({ ...hit, kind: 'death' as const })),
    ].sort((a, b) => a.id - b.id);
    for (const hit of hits) {
      const raw = hud.damage.find(row => row.id === hit.id)!;
      const identity = eventFingerprint(raw);
      if (this.processedDamage.has(identity)) continue;
      const line = parseKillLine(hit.detail)!;
      const pair = normalizePlayerName(line.killer) + '>' + normalizePlayerName(line.victim);
      const previous = this.recentDamage.get(pair);
      const duplicate = previous && sameKillWindow(raw.time, previous.time, hit.id, previous.id);
      this.recentDamage.set(pair, { id: hit.id, time: raw.time });
      if (duplicate) continue;
      if (hit.kind === 'death') {
        if (this.countedDeaths.has(identity)) continue;
        this.countedDeaths.add(identity);
        if (this.pendingIndicatorDeath && this.now() - this.lastIndicatorDeathAt < DEATH_VIA_FEED_WINDOW_MS) {
          this.pendingIndicatorDeath = false;
          const inferred = this.combatTimeline.find(event => event.identity === this.pendingIndicatorEntry);
          if (inferred) inferred.id = hit.id;
          this.pendingIndicatorEntry = null;
          this.recomputeStreaks();
          continue;
        }
        feedDeathThisPoll = true;
        this.awaitingInvalidAfterFeed = !!(probe.indicators?.known && probe.indicators.valid && !probe.indicators.placeholder);
        this.aliveArmed = false; this.lastDeathAt = this.now(); this.invalidStreak = 0;
        // 这一命已由 feed 确认：观战视角下指示灯会一直失效，不能每切一次视角就再记一次。
        this.selfDead = true;
        this.applyDeath(out, { identity, id: hit.id, killer: line.killer, detail: hit.detail });
        continue;
      }
      // 幂等键 = 发起者>目标#第几次。全量重放多少轮都只入账一次，服务端 id 回退
      // 或 feed 窗口滑动也不会重复计。
      if (this.countedKills.has(identity)) continue;
      this.countedKills.add(identity);
      // 战绩永远照实累加,限的只是"逐条开口"这件事。
      this.kills += 1;
    this.combatTimeline.push({ identity, kind: 'kill', id: hit.id, epoch: this.combatEpoch });
      this.recomputeStreaks();
      if (this.behindRaised && this.kills >= this.deaths) this.behindRaised = false;
      if (killPushed >= MAX_KILL_EVENTS) continue;
      killPushed += 1;
      out.push({
        kind: 'kill',
        total: this.kills,
        streak: this.streak,
        detail: hit.detail,
        victim: hit.victim,
        victimRaw: hit.victimRaw,
        snapshot: this.snapshot,
      });
    }

    // 已经离场：这一轮的 feed 不当真，但也不能记成"已处理"——否则回到局里再想统计
    // 就永远错过了（0.3.2 真机 bug：进局瞬间 mission 还没 running，整局 feed 被吃掉）。
    if (!feedLive) {
      this.invalidStreak = 0;
      this.flushPendingEnter(out);
      return out;
    }
    for (const row of hud.damage) this.processedDamage.add(eventFingerprint(row));
    const ind = probe.indicators;
    if (ind?.placeholder) {
      this.aliveArmed = false;
      this.awaitingInvalidAfterFeed = false;
      this.invalidStreak = 0;
    }
    if (ind && ind.known && !ind.placeholder) {
      if (ind.valid) {
        if (this.awaitingInvalidAfterFeed && this.now() - this.lastDeathAt >= DEATH_VIA_FEED_WINDOW_MS) this.awaitingInvalidAfterFeed = false;
        // 看到一次有效存活：武装边沿，下一次失效才算阵亡。
        // /indicators 只报"自己载具"的仪表：有效即说明这一命还在（观战/无人机走 placeholder）。
        this.invalidStreak = 0;
        this.selfDead = false;
        if (!feedDeathThisPoll && !this.awaitingInvalidAfterFeed) this.aliveArmed = true;
      } else if (this.awaitingInvalidAfterFeed) {
        this.awaitingInvalidAfterFeed = false;
        this.aliveArmed = false;
      } else {
        // 无人机 / 炮手 / 观察者视角下指示灯失效说明不了本人的死活，直接重新武装；
        // 刚损失过侦察机的那段时间同理：视角切回主载具的瞬间会抖一次。
        const crashRecent = this.observerCrashAt > 0 && this.now() - this.observerCrashAt < OBSERVER_CRASH_WINDOW_MS;
        // 对局中 /state 常只回 {"valid":false}，载具名只在 /indicators.type 里，
        // 所以三个来源都要看，否则切到侦察无人机时会被判成主载具失效而记阵亡。
        const observerNow = isObserverVehicle(probe.state?.vehicle ?? '')
          || isObserverVehicle(probe.indicators?.type ?? '')
          || isObserverVehicle(this.snapshot.vehicle);
        if (crashRecent || observerNow) {
          this.aliveArmed = false;
          this.invalidStreak = 0;
        } else if (this.selfOnMap === true) {
          // 地图上还画着自己的图标 = 这一命还在。切视角、换载具、开菜单都会让指示灯
          // 抖一拍失效；地图端点这一拍是明确的"活着"，直接否掉，不计阵亡。
          this.invalidStreak = 0;
          this.selfDead = false;
          if (!feedDeathThisPoll) this.aliveArmed = true;
        } else if (this.selfDead) {
          // feed 已经确认过这一命结束：观战视角下指示灯会一直失效，
          // 不能每切一次视角就再记一次阵亡。重生由"自己的图标回到地图"解除。
          this.invalidStreak = 0;
        } else {
          this.invalidStreak += 1;
          // 兜底推断可以用配置关掉（关掉后只认 feed 里"victim 是我"）；开着时要求
          // "有效→失效"边沿 + 连续 DEATH_CONFIRM_POLLS 轮失效 + 去抖，单拍抖动不算。
          if (this.inferDeathFromIndicators && this.aliveArmed
            && this.invalidStreak >= DEATH_CONFIRM_POLLS
            && this.now() - this.lastDeathAt >= DEATH_DEBOUNCE_MS) {
            this.aliveArmed = false;
            this.lastIndicatorDeathAt = this.now();
            this.pendingIndicatorDeath = true;
            this.lastDeathAt = this.now();
            this.selfDead = true;
            this.applyDeath(out);
          }
        }
      }
    }

    let hudPushed = 0;
    for (const event of hud.events) {
      // 全量重放:入局前的旧播报跳过,已经开过口的 id 不再重复,否则每一轮都会刷屏。
      if (event.id <= this.baselineEvtId) continue;
      if (this.seenHud.has(eventFingerprint(event))) continue;
      if (hudPushed >= MAX_HUD_EVENTS) break;
      const text = (event.msg || event.type || '').trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (!EVENT_WORDS.some((word) => lower.includes(word))) continue;
      hudPushed += 1;
      this.seenHud.add(eventFingerprint(event));
      out.push({ kind: 'hud', detail: text });
    }

    this.flushPendingEnter(out);
    return out;
  }

  /**
   * 挂起的入局播报：载具名读得出来就发。
   *
   * 判据盯的是「这一拍还是不是占位模型」，不拿 state.valid 放行——加载画面里
   * /state 往往已经 valid:true，而 dummy_plane 还带着一整套「有效」飞机仪表（见
   * refreshSnapshot 开头），单看 valid 或看读数都会把假读数播出去。
   *
   * 占位期不计数也不设上限：加载 40 秒就等 40 秒，等到 /indicators.type 变成真载具再说。
   * 一局只有一次 enter，发空了没有更正机会，宁可不发也不发半句——所以这里没有
   * 「只报进场一句」的兜底分支。ENTER_WAIT_POLLS 只兜「名字有了、陆战速度还没算出来」
   * 的长尾，过了上限照发完整一行（名字在，速度写未读到）。
   */
  private flushPendingEnter(out: BattleEvent[]): void {
    if (this.pendingEnterPolls === 0) return;
    // 占位期：这一拍什么都不算，直接把挂起留着。
    if (this.snapshot.readings?.vehiclePending === true) return;
    this.pendingEnterPolls += 1;
    // 占位期过了却仍解析不出载具名：不发。等这一局结束，挂起跟着作废（离场不补 leave）。
    if (this.snapshot.vehicle === '') return;
    // 陆战/海战报的是对地速度；/indicators.speed 一般进局就有，缺字段时才等地图位移。
    const onGround = this.snapshot.army === 'tank' || this.snapshot.army === 'ship';
    const speedGap = onGround && this.snapshot.groundSpeedKmh === undefined;
    if (speedGap && this.pendingEnterPolls <= ENTER_WAIT_POLLS) return;
    this.pendingEnterPolls = 0;
    const event: BattleEvent = { kind: 'enter', snapshot: this.snapshot };
    // 有 leave 的拍（切局）必须把 enter 插在 leave 之后，否则播报顺序成了「离场 → 进战局」倒置。
    const leaveAt = out.findIndex((one) => one.kind === 'leave');
    if (leaveAt >= 0) out.splice(leaveAt + 1, 0, event);
    else out.unshift(event);
  }

  /**
   * 这一轮还能不能把 feed 当成"正在进行的战局"。
   *
   * 任务端点明确 running 就是活的，明确 ended/completed 就是死了；两头都不确定时
   * 跟 inBattle（它已经把"地图端点说没地图"算作离场）。任务端点读不到时保守放行，
   * 免得把正常对局判成结束、整局都不再报战绩。
   */
  private feedLive(probe: BattleProbe): boolean {
    const mission = probe.mission;
    if (mission) {
      if (mission.running) return true;
      if (['ended', 'completed', 'success', 'failed', 'fail', 'over'].includes(mission.status)) return false;
    }
    return probe.inBattle;
  }

  private summaryOf(): BattleSummary {
    const seconds = this.startedAt > 0 ? Math.max(0, Math.round((this.now() - this.startedAt) / 1000)) : 0;
    return { vehicle: this.snapshot.vehicle, kills: this.kills, deaths: this.deaths, seconds };
  }
}

/** 聊天正文与昵称都可能被人塞控制字符或超长文本，先洗再收。 */
// 0.5.1：对局聊天是素材原话，原来切到 400 字，长句与引用会被截半。
const MAX_CHAT_MSG = 2000;
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
    mode: cleanBattleText(str(item.mode)).slice(0, 16),
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
