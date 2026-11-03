import type { ConfigProperty, ConfigGroup, WorldPanelDecl } from 'cortico/core/types.ts';
import type { TelemetryScope } from './battle.ts';

/** `worlds.wt` 配置段。enabled 是框架总闸,World 定义里恒为 false,不写进面板。 */
export interface WtConfigSection {
  enabled: boolean;
  /** 自动播报总开关:关掉后只在被显式调用时才说话。 */
  autoBrief: boolean;
  speechStyle: '人格' | '模板';
  /** 播报长度档位。 */
  broadcastLength: 'full' | 'key' | 'brief' | 'custom';
  /** 自定义档的字符上限。 */
  broadcastMaxChars: number;
  readTelemetry: boolean;
  readVehicle: boolean;
  readMap: boolean;
  readMission: boolean;
  readHud: boolean;
  /** 是否用指示灯失效边沿补记阵亡。默认开：feed 没有对应阵亡行时补一次,无人机/炮手/观战不计。 */
  inferDeathFromIndicators: boolean;
  /** 打完一把后保留几把复盘(0~5)。0 表示不存明细，只推进编号。 */
  battleHistoryKeep: number;
  /** 在局判定是否要求地图证据。默认开：机库里 8111 的 mission 仍报 running，只看任务会把机库算成战局。 */
  strictInBattle: boolean;
  readChat: boolean;
  /** 附近敌我的统计半径（m）。 */
  nearbyRadiusM: number;
  broadcastEntryExit: boolean;
  broadcastKills: boolean;
  broadcastDeaths: boolean;
  broadcastWarnings: boolean;
  broadcastHud: boolean;
  broadcastCommentary: boolean;
  /**
   * 播报档位。
   *
   * quiet 只报进局与结算;important 再报击毁、阵亡、逆风(默认);commentary 才按间隔定时讲态势。
   * 开箱默认不持续解说——桌宠一直在旁边讲话,比少说几句更烦人。
   */
  chatterLevel: 'quiet' | 'important' | 'commentary';
  /** 本地遥测服务地址,战争雷霆客户端运行时监听。 */
  gameHost: string;
  gamePort: number;
  /**
   * 8111 响应的文本编码。
   *
   * 中文客户端的 /gamechat 与 /hudmsg 是 GBK 字节,按 UTF-8 解会整套变问号、玩家名一起烂。
   * auto 先试 UTF-8、见到替换字符再按 GBK 重解;钉死某一档只用于排障。
   */
  textEncoding: 'auto' | 'utf-8' | 'gbk';
  /**
   * 玩家自己的游戏内昵称。
   *
   * 8111 的 damage 列表是全场 kill feed（sender 恒为空），只有播报里的发起者名字能
   * 认出「这条是我打的」。留空则不认领任何击杀，只统计阵亡。
   */
  playerName: string;
  /** 轮询间隔(毫秒),实际下限 800。 */
  pollMs: number;
  /** 定时讲解间隔(毫秒),0 表示只报事件不报态势。 */
  commentaryEveryMs: number;
  /** 知识库更新源:一个返回 {version, entries} 的 JSON 地址,留空则不更新。 */
  kbUrl: string;
  kbAutoUpdateHours: number;
  /** 允许知识库源指向内网/本机。默认关:这条 fetch 模型能触发,不能让它扫内网。 */
  kbAllowPrivate: boolean;
  kbMaxDownloadMiB: number;
  kbMaxEntries: number;
  kbUpdateMemoryMiB: number;
  kbIngestMaxChars: number;
  kbIngestMaxEntries: number;
  /** 视觉降级方案:off 关闭,probe 允许截图 + OCR 自检。 */
  /** 截图 OCR 只在按需调用时执行，不自动采集。 */
  visionMode: 'off' | 'probe';
  /** 截图区域 "x,y,w,h",留空表示整屏。 */
  visionRegion: string;
  /** 截图是否留在本地。默认不留:整屏截图里可能有别的窗口内容。 */
  visionKeepShot: boolean;
  /** 一次最多翻译多少条对局对话。 */
  chatLines: number;
  /** 翻译目标语言:zh / en / ja / ru。 */
  chatTarget: string;
  /** 翻译聊天时单独给模型的字符预算,比播报大;仍受每日 token 上限约束。 */
  chatMaxInputChars: number;
  /** 发言的落地方式:clipboard 复制到剪贴板(最稳),off 只出文本,confirm 预演后直写发言栏,auto 直接直写。 */
  chatSendMode: 'off' | 'clipboard' | 'confirm' | 'auto';
  /** Enter 打开输入框后等多久再打字(毫秒)。 */
  chatSendDelayMs: number;
  /** 文案生成:host 用宿主模型,openai 用自填的兼容接口,off 只用模板。 */
  llmMode: 'host' | 'openai' | 'off';
  llmBaseUrl: string;
  llmModel: string;
  /** 自填接口的密钥;留空则只有 host 与模板两档可用。 */
  llmApiKey: string;
  /** 单次请求的输入上限(字符),超出截断,用来压住花费。 */
  maxInputChars: number;
  /** 单次请求的输出上限(token)。 */
  maxOutputTokens: number;
  /** 每日预算(元),到顶后只发模板文案。0 表示不按金额限,只按下面的次数与 token 限。 */
  dailyBudgetYuan: number;
  /** 每分钟最多调用几次模型;事件风暴与工具连打都靠它削平。 */
  maxCallsPerMinute: number;
  /** 每日模型调用次数上限;计价填 0 时这是唯一还算得准的闸。 */
  maxCallsPerDay: number;
  /** 每日输入+输出 token 总量上限。 */
  maxTokensPerDay: number;
  /** 计价:每百万输入 token 的元数。 */
  priceInPerM: number;
  /** 计价:每百万输出 token 的元数。 */
  priceOutPerM: number;
  language: 'zh' | 'en';
}

export const WT_DEFAULTS: WtConfigSection = {
  enabled: false,
  autoBrief: true,
  speechStyle: '人格',
  broadcastLength: 'full',
  broadcastMaxChars: 0,
  readTelemetry: true,
  readVehicle: true,
  readMap: true,
  readMission: true,
  readHud: true,
  inferDeathFromIndicators: true,
  battleHistoryKeep: 3,
  strictInBattle: true,
  readChat: true,
  nearbyRadiusM: 500,
  broadcastEntryExit: true,
  broadcastKills: true,
  broadcastDeaths: true,
  broadcastWarnings: true,
  broadcastHud: true,
  broadcastCommentary: true,
  chatterLevel: 'important',
  gameHost: '127.0.0.1',
  gamePort: 8111,
  textEncoding: 'auto',
  playerName: '',
  pollMs: 1500,
  commentaryEveryMs: 45000,
  kbUrl: 'https://gh-proxy.com/https://raw.githubusercontent.com/suhong11300/cortico-world-warthunder/main/kb.json,https://raw.githubusercontent.com/suhong11300/cortico-world-warthunder/main/kb.json',
  kbAutoUpdateHours: 24,
  kbAllowPrivate: false,
  kbMaxDownloadMiB: 64,
  kbMaxEntries: 100000,
  kbUpdateMemoryMiB: 512,
  kbIngestMaxChars: 12000,
  kbIngestMaxEntries: 30,
  visionMode: 'off',
  visionRegion: '',
  visionKeepShot: false,
  chatLines: 12,
  chatTarget: 'zh',
  chatSendMode: 'clipboard',
  chatMaxInputChars: 4000,
  chatSendDelayMs: 180,
  llmMode: 'host',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  maxInputChars: 1200,
  maxOutputTokens: 160,
  dailyBudgetYuan: 1,
  maxCallsPerMinute: 6,
  maxCallsPerDay: 200,
  maxTokensPerDay: 60000,
  priceInPerM: 1,
  priceOutPerM: 2,
  language: 'zh',
};

/** 未出现的新开关按旧版允许读取处理；显式false才关闭。 */
export function telemetryScopeAllowed(cfg: WtConfigSection, scope: TelemetryScope): boolean {
  const key = { vehicle: 'readVehicle', map: 'readMap', mission: 'readMission', hud: 'readHud', chat: 'readChat' } as const;
  return cfg.readTelemetry !== false && cfg[key[scope]] !== false;
}

interface Entry {
  key: string;
  title: string;
  description: string;
  prop: Omit<ConfigProperty, 'title' | 'description'>;
}

const ENTRIES: Entry[] = [
  { key: 'worlds.wt.autoBrief', title: '自动播报', description: '开启后按下方逐项开关自动推送；关闭后仅在手动查询时输出。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.speechStyle', title: '口吻', description: '人格：由桌宠按自身人格改写；模板：按固定句式输出。两种表达使用同一份事实与数字。', prop: { type: 'string', enum: ['人格', '模板'] } },
  { key: 'worlds.wt.broadcastLength', title: '播报详略', description: '详细：全量事实；重点：约 160 字，读数完整；简略：约 60 字，只报载具与敌我；自定义：按下一项。人格档把字数写成对桌宠的要求，由它自己压；模板档按档位选用详略定稿，不做半句截断。', prop: { type: 'string', enum: ['full', 'key', 'brief', 'custom'] } },
  { key: 'worlds.wt.broadcastMaxChars', title: '字数上限', description: '0 表示按档位（详细不限 / 重点 160 / 简略 60 / 自定义 160）；填 20 至 500 则覆盖档位，各档都能改。', prop: { type: 'number', minimum: 0, maximum: 500, multipleOf: 10, 'x-suffix': '字' } },
  { key: 'worlds.wt.chatterLevel', title: '播报档位', description: '安静：仅进出战局与结算；重要：增加击毁与阵亡；详解：另加定时态势。', prop: { type: 'string', enum: ['quiet', 'important', 'commentary'] } },
  { key: 'worlds.wt.broadcastEntryExit', title: '进出战局', description: '进入与离开战局各一条。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastKills', title: '个人击毁', description: '战果日志中归因到本昵称的击毁。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastDeaths', title: '个人阵亡', description: '战果日志中的阵亡，以及按「阵亡补记」推断的阵亡。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastWarnings', title: '逆风提示', description: '观测阵亡数比击毁数多 2 次时提示一次。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastHud', title: '全场事件', description: '转发战果日志中的全场事件原文，来源标记为外部。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastCommentary', title: '定时态势', description: '按「讲解间隔」播报当前读数。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.commentaryEveryMs', title: '讲解间隔', description: '0 表示关闭定时态势；其余取值最小 5 秒。', prop: { type: 'number', minimum: 0, multipleOf: 1, 'x-scale': 1000, 'x-suffix': '秒' } },
  { key: 'worlds.wt.battleHistoryKeep', title: '复盘保留', description: '离场时存档保留的局数，上限 5；0 表示不保留明细，仅推进编号。', prop: { type: 'number', minimum: 0, maximum: 5, multipleOf: 1, 'x-suffix': '局' } },
  { key: 'worlds.wt.language', title: '语言', description: '播报与提示词使用的语言。', prop: { type: 'string', enum: ['zh', 'en'] } },
  { key: 'worlds.wt.playerName', title: '游戏昵称', description: '仅归因此昵称的击毁，须与游戏内一致（含中队标签）；留空只统计阵亡。', prop: { type: 'string' } },
  { key: 'worlds.wt.gameHost', title: '遥测地址', description: '8111 服务地址，本机为 127.0.0.1。', prop: { type: 'string' } },
  { key: 'worlds.wt.gamePort', title: '遥测端口', description: '默认 8111。', prop: { type: 'number' } },
  { key: 'worlds.wt.textEncoding', title: '文本编码', description: '中文客户端为 GBK；auto 先按 UTF-8 解码，出现替换字符改用 GBK。', prop: { type: 'string', enum: ['auto', 'utf-8', 'gbk'] } },
  { key: 'worlds.wt.pollMs', title: '轮询间隔', description: '范围 0.8 至 30。', prop: { type: 'number', minimum: 800, maximum: 30000, multipleOf: 1, 'x-scale': 1000, 'x-suffix': '秒' } },
  { key: 'worlds.wt.readTelemetry', title: '8111 总闸', description: '关闭后所有端点均不访问，也不使用缓存读数。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readVehicle', title: '载具与仪表', description: '读 /state 与 /indicators：载具型号、速度、高度、车组、弹药与存活状态。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readMap', title: '地图与标记', description: '读 /map_info.json 与 /map_obj.json：格网参数、自身坐标与图上敌我图标。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readMission', title: '任务状态', description: '读 /mission.json：判定在局与离局。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readHud', title: '战果日志', description: '读 /hudmsg：归因击毁与阵亡。关闭后战绩为未知。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readChat', title: '对局聊天', description: '读 /gamechat：聊天原文与翻译。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.inferDeathFromIndicators', title: '阵亡补记', description: '战果日志无对应阵亡行时，按仪表由有效转失效的边沿补记一次；侦察无人机、炮手与观战视角不计。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.visionMode', title: '截图 OCR', description: '关闭：不截图。按需：只有调用 wt_vision_probe（例如被问占领情况）才截一次，平时不采集、不占性能。8111 没有占领端点，占点与计分板文字只能来自画面。', prop: { type: 'string', enum: ['off', 'probe'] } },
  { key: 'worlds.wt.visionRegion', title: '截图区域', description: 'x,y,w,h；留空为整屏。', prop: { type: 'string' } },
  { key: 'worlds.wt.chatLines', title: '翻译条数', description: '单次读取并翻译的聊天条数上限。', prop: { type: 'number', minimum: 1, maximum: 40 } },
  { key: 'worlds.wt.chatTarget', title: '翻译语言', description: '翻译目标语言，玩家名保持原文。', prop: { type: 'string', enum: ['zh', 'en', 'ja', 'ru'] } },
  { key: 'worlds.wt.chatSendMode', title: '发言落地', description: 'off 仅输出文本；clipboard 复制到剪贴板；confirm 预演后写入发言栏；auto 直接写入。', prop: { type: 'string', enum: ['off', 'clipboard', 'confirm', 'auto'] } },
  { key: 'worlds.wt.nearbyRadiusM', title: '附近半径', description: '统计附近敌我与点位的半径（米）；超出该半径的只计入全场敌我。', prop: { type: 'number', minimum: 100, maximum: 5000, multipleOf: 50, 'x-suffix': 'm' } },
  { key: 'worlds.wt.kbUrl', title: '知识库源', description: 'JSON 或网页地址，可填多个，按序尝试，首个可用即入库；网页按段落提取，sitemap 按页面展开。', prop: { type: 'string' } },
  { key: 'worlds.wt.kbAllowPrivate', title: '允许内网源', description: '默认仅公网 http(s)；连接本机服务时开启。云元数据地址恒拒。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.kbAutoUpdateHours', title: '自动更新', description: '小时；0 表示仅手动更新。', prop: { type: 'number' } },
  { key: 'worlds.wt.kbMaxDownloadMiB', title: '单源大小上限', description: '单个源响应体的大小上限。', prop: { type: 'number', minimum: 1, maximum: 256, multipleOf: 1, 'x-suffix': 'MiB' } },
  { key: 'worlds.wt.kbMaxEntries', title: '远程条目上限', description: '远程词条数上限，内置词条另计。', prop: { type: 'number', minimum: 1, maximum: 500000, multipleOf: 1, 'x-suffix': '条' } },
  { key: 'worlds.wt.kbUpdateMemoryMiB', title: '更新内存预算', description: '更新时的估算上限，非硬限制。', prop: { type: 'number', minimum: 64, maximum: 2048, multipleOf: 1, 'x-suffix': 'MiB' } },
  { key: 'worlds.wt.kbIngestMaxChars', title: '单次素材上限', description: '给一个网址抓正文时，最多交给模型多少字；越大越完整，也越费上下文。', prop: { type: 'number', minimum: 2000, maximum: 40000, multipleOf: 500, 'x-suffix': '字' } },
  { key: 'worlds.wt.kbIngestMaxEntries', title: '单次入库上限', description: '一次整理最多写进多少条，避免模型一口气吐出整站。', prop: { type: 'number', minimum: 1, maximum: 100, multipleOf: 1, 'x-suffix': '条' } },
  { key: 'worlds.wt.llmMode', title: '文案模型', description: 'host 使用宿主模型；openai 使用下方兼容接口；off 仅用模板。', prop: { type: 'string', enum: ['host', 'openai', 'off'] } },
  { key: 'worlds.wt.llmBaseUrl', title: '接口地址', description: 'OpenAI 兼容接口的基地址。', prop: { type: 'string' } },
  { key: 'worlds.wt.llmModel', title: '模型名', description: '请求体中的 model 字段。', prop: { type: 'string' } },
  { key: 'worlds.wt.llmApiKey', title: '接口密钥', description: '仅 openai 档使用，明文存于 config.json。', prop: { type: 'string' } },
  { key: 'worlds.wt.maxInputChars', title: '单次输入上限', description: '字符数，超出截断。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxOutputTokens', title: '单次输出上限', description: 'token 数。', prop: { type: 'number' } },
  { key: 'worlds.wt.dailyBudgetYuan', title: '每日预算', description: '元；超出后回退模板。0 表示不按金额限制。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxCallsPerMinute', title: '每分钟调用', description: '超出后回退模板。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxCallsPerDay', title: '每日调用次数', description: '次数上限。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxTokensPerDay', title: '每日 token 上限', description: '输入与输出合计。', prop: { type: 'number' } },
  { key: 'worlds.wt.priceInPerM', title: '输入单价', description: '元 / 百万 token。', prop: { type: 'number' } },
  { key: 'worlds.wt.priceOutPerM', title: '输出单价', description: '元 / 百万 token。', prop: { type: 'number' } },
];

/**
 * 配置页按用途拆成四组。
 *
 * 0.3.1 及以前把四十多项塞在一个 group 里，配置页就是一长条滚动列表，找不到东西。
 * 宿主按 group 逐个渲染成独立分区（web/client/features/config/view.ts），所以这里
 * 只要按用途切开：owner 一律 world:wt，path 一律落在 worlds.wt.* 前缀内，
 * 每条都能在 WT_DEFAULTS 里找到同名键。
 */
const GROUP_KEYS = {
  // 播报:开口时机、颗粒度、口吻,以及离场存档。
  broadcast: ['autoBrief', 'speechStyle', 'broadcastLength', 'broadcastMaxChars', 'chatterLevel', 'broadcastEntryExit', 'broadcastKills', 'broadcastDeaths', 'broadcastWarnings', 'broadcastHud', 'broadcastCommentary', 'commentaryEveryMs', 'battleHistoryKeep', 'language'],
  // 查询与读取:连接参数 + 六个端点开关 + 两档兜底(指标补记、截图 OCR) + 聊天翻译。
  query: ['playerName', 'gameHost', 'gamePort', 'textEncoding', 'pollMs', 'readTelemetry', 'readVehicle', 'readMap', 'readMission', 'readHud', 'readChat', 'inferDeathFromIndicators', 'visionMode', 'visionRegion', 'chatLines', 'chatTarget', 'chatSendMode', 'nearbyRadiusM'],
  kb: ['kbUrl', 'kbAllowPrivate', 'kbAutoUpdateHours', 'kbMaxDownloadMiB', 'kbMaxEntries', 'kbUpdateMemoryMiB', 'kbIngestMaxChars', 'kbIngestMaxEntries'],
  model: ['llmMode', 'llmBaseUrl', 'llmModel', 'llmApiKey', 'maxInputChars', 'maxOutputTokens', 'dailyBudgetYuan', 'maxCallsPerMinute', 'maxCallsPerDay', 'maxTokensPerDay', 'priceInPerM', 'priceOutPerM'],
} as const;

const GROUP_META = {
  broadcast: { id: 'world:wt', title: '播报', description: '开口时机、播报颗粒度与表述口吻。' },
  query: { id: 'world:wt.query', title: '查询与读取', description: '8111 连接参数与各端点读取开关。' },
  kb: { id: 'world:wt.kb', title: '知识库', description: '词条来源、更新频率与容量上限。' },
  model: { id: 'world:wt.model', title: '模型与花费', description: '文案生成方式与各项费用上限。' },
} as const;

function buildGroup(kind: keyof typeof GROUP_KEYS): ConfigGroup {
  const byKey = new Map(ENTRIES.map(e => [e.key, e]));
  const properties: Record<string, ConfigProperty> = {};
  for (const short of GROUP_KEYS[kind]) {
    const entry = byKey.get('worlds.wt.' + short);
    if (!entry) continue;
    properties[entry.key] = { ...entry.prop, title: entry.title, description: entry.description, 'x-hot': true };
  }
  return {
    id: GROUP_META[kind].id,
    owner: 'world:wt',
    schema: { type: 'object', title: GROUP_META[kind].title, description: GROUP_META[kind].description, properties },
  };
}

/**
 * 世界页面板里每个字段该用哪种控件。
 *
 * 面板自己画页面，宿主只管数据；这张表让「同一批配置」在两处呈现不同密度：
 * 播报的两个总闸与 8111 总闸用滑块，逐项播报与逐项读取压成一张勾选卡片，
 * 其余仍是一行一值。表里没有的键按普通行渲染。
 */
export const WT_FIELD_UI: Record<string, 'switch' | 'check'> = {
  autoBrief: 'switch',
  speechStyle: 'switch',
  readTelemetry: 'switch',
  broadcastEntryExit: 'check',
  broadcastKills: 'check',
  broadcastDeaths: 'check',
  broadcastWarnings: 'check',
  broadcastHud: 'check',
  broadcastCommentary: 'check',
  readVehicle: 'check',
  readMap: 'check',
  readMission: 'check',
  readHud: 'check',
  readChat: 'check',
  inferDeathFromIndicators: 'check',
};

/** 配置页面板依次渲染的四组。 */
export const WT_CONFIG_GROUPS: ConfigGroup[] = [buildGroup('broadcast'), buildGroup('query'), buildGroup('kb'), buildGroup('model')];

/**
 * 世界页面板:快速开始 + 每组一页 tab。
 *
 * 顺序即 tab 顺序,快速开始放最左,第一次装进来的人先看到「要填什么、怎么问」。
 */
export const WT_PANELS: WorldPanelDecl[] = [
  { id: 'start', title: '快速开始', description: '首次使用：填游戏昵称、确认 8111 可用、了解提问方式。' },
  ...(Object.keys(GROUP_KEYS) as Array<keyof typeof GROUP_KEYS>).map((kind) => ({
    id: kind,
    title: GROUP_META[kind].title,
    description: GROUP_META[kind].description,
  })),
];

/**
 * 交给宿主「配置」tab 的精简组。
 *
 * 四页 tab 已经把同样的字段排好了,`配置` 页再平铺一遍只是重复;
 * 但 ctx.setConfig 要求目标组已在配置面声明(服务端按组名找 schema),
 * 所以这里保留一个只含总闸的组:面板写回仍落在 world:wt,配置页只剩一行。
 */
export const WT_CONFIG_SLIM: ConfigGroup[] = [{
  id: 'world:wt',
  owner: 'world:wt',
  schema: {
    type: 'object',
    title: '启用',
    description: '其余设置在世界页的各 tab 内，此处仅保留世界总闸。',
    properties: {
      'worlds.wt.enabled': { type: 'boolean', title: '启用这个世界', description: '关掉后整个世界停止工作。', 'x-hot': true },
    },
  },
}];

/** 第一组(播报)的别名,保留给只认单组的调用方。 */
export const WT_CONFIG_GROUP: ConfigGroup = WT_CONFIG_GROUPS[0];

/** 每组声明的键与全量键,供测试核对重构时没有键被漏掉。 */
export function configGroupCoverage(): { groups: string[]; covered: string[]; missing: string[] } {
  const covered: string[] = [];
  for (const group of WT_CONFIG_GROUPS) for (const key of Object.keys(group.schema.properties)) covered.push(key);
  const all = ENTRIES.map(e => e.key);
  const missing = all.filter(key => !covered.includes(key));
  return { groups: WT_CONFIG_GROUPS.map(g => g.id), covered, missing };
}
