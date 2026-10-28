import type { ConfigProperty, ConfigGroup } from 'cortico/core/types.ts';
import type { TelemetryScope } from './battle.ts';

/** `worlds.wt` 配置段。enabled 是框架总闸,World 定义里恒为 false,不写进面板。 */
export interface WtConfigSection {
  enabled: boolean;
  /** 自动播报总开关:关掉后只在被显式调用时才说话。 */
  autoBrief: boolean;
  speechStyle: '人格' | '模板';
  readTelemetry: boolean;
  readVehicle: boolean;
  readMap: boolean;
  readMission: boolean;
  readHud: boolean;
  readChat: boolean;
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
  /** 视觉降级方案:off 关闭,probe 允许截图 + OCR 自检。 */
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
  readTelemetry: true,
  readVehicle: true,
  readMap: true,
  readMission: true,
  readHud: true,
  readChat: true,
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
  kbUrl: '',
  kbAutoUpdateHours: 24,
  kbAllowPrivate: false,
  kbMaxDownloadMiB: 64,
  kbMaxEntries: 100000,
  kbUpdateMemoryMiB: 512,
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
  { key: 'worlds.wt.autoBrief', title: '触发方式：自动播报', description: '开=自动，关=仅手动呼唤；与表达风格独立组成自动人格/自动模板/手动人格/手动模板四种模式。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.speechStyle', title: '表达风格', description: '人格：请求现有桌宠Persona自然表达；模板：请求原样转述。事实块固定，手动呼唤同样遵守此选择；不要求插件后台cognition或新增密钥。', prop: { type: 'string', enum: ['人格', '模板'] } },
  { key: 'worlds.wt.readTelemetry', title: '读取：8111总开关', description: '修改观测范围会重新开始本地统计。关闭后后台和手动工具均不访问8111；不影响独立的百科、知识库更新或显式OCR。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readVehicle', title: '读取：载具仪表', description: '允许读取/state与/indicators中已接入的载具、速度高度和存活指标。关闭后也不作指标失效阵亡推断。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readMap', title: '读取：地图对象', description: '允许读取/map_info.json与/map_obj.json；可见对象不是完整敌我名单，也不能区分AI与玩家。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readMission', title: '读取：任务状态', description: '允许读取/mission.json辅助判断在局/离局；不是个人贡献或官方胜负记分板。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readHud', title: '读取：战果与HUD日志', description: '允许读取/hudmsg并按昵称归因击毁/阵亡；关闭后击毁数量为未知，不显示为已测0。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.readChat', title: '读取：对局聊天', description: '关闭后wt_chat手动查询或翻译也不会访问/gamechat。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastEntryExit', title: '播报：进入与离开战局', description: '需自动播报总开关开启；只控制主动提示，不禁止手动查询。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastKills', title: '播报：个人击毁', description: '需自动播报开启且档位非quiet；不包含未接入的助攻或分项得分。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastDeaths', title: '播报：阵亡与指标失效推断', description: '需自动播报开启且档位非quiet；推断始终标明，不冒充确认击毁。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastWarnings', title: '播报：观测逆风提醒', description: '需自动播报开启且档位非quiet；不代表全队胜负。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastHud', title: '播报：全场HUD原文', description: '需自动播报开启且档位非quiet；外部原文不等于个人战绩。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.broadcastCommentary', title: '播报：定时战况', description: '需自动播报开启、档位commentary且讲解间隔大于0；关闭后仍允许手动讲解。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.gameHost', title: '遥测地址', description: '战争雷霆客户端的本地遥测服务所在主机。本机运行留 127.0.0.1。', prop: { type: 'string' } },
  { key: 'worlds.wt.gamePort', title: '遥测端口', description: '默认 8111。改过启动参数或端口被占用时改这里。', prop: { type: 'number' } },
  { key: 'worlds.wt.textEncoding', title: '遥测文本编码', description: 'auto 先按 UTF-8 解、见到替换字符再按 GBK 重解;中文客户端的对局聊天是 GBK,钉死 utf-8 会整段变问号。', prop: { type: 'string', enum: ['auto', 'utf-8', 'gbk'] } },
  { key: 'worlds.wt.playerName', title: '我的游戏昵称', description: '填游戏里显示的名字（含符号）。8111 的击杀列表是全场公开播报，只有靠这个名字才认得出哪些是你打的；留空则不统计击杀。', prop: { type: 'string' } },
  { key: 'worlds.wt.pollMs', title: '轮询间隔', description: '界面按秒显示，例如1.5秒；建议1–3秒。存储仍为毫秒，旧配置无需迁移。', prop: { type: 'number', minimum: 800, maximum: 30000, multipleOf: 1, 'x-scale': 1000, 'x-suffix': '秒' } },
  { key: 'worlds.wt.commentaryEveryMs', title: '讲解间隔', description: '界面按秒显示，例如45秒；0关闭定时讲解，其余有效值至少5秒。', prop: { type: 'number', minimum: 0, multipleOf: 1, 'x-scale': 1000, 'x-suffix': '秒' } },
  { key: 'worlds.wt.kbUrl', title: '知识库源', description: '一个返回 {version, entries} 的 JSON 地址;留空则只用内置词条。', prop: { type: 'string' } },
  { key: 'worlds.wt.kbAllowPrivate', title: '允许内网知识库源', description: '关着时知识库源只能是公网 http(s);要连本机自建服务才打开。云元数据地址永远拒绝。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.kbAutoUpdateHours', title: '自动更新(小时)', description: '开机后每隔多少小时检查一次知识库源;0 表示只在手动调用时更新。', prop: { type: 'number' } },
  { key: 'worlds.wt.kbMaxDownloadMiB', title: '知识库下载/本地文件上限', description: '默认64 MiB，最大256 MiB；同时受额外更新预算限制。超限拒绝新库、保留旧文件。', prop: { type: 'number', minimum: 1, maximum: 256, multipleOf: 1, 'x-suffix': 'MiB' } },
  { key: 'worlds.wt.kbMaxEntries', title: '知识库远程条目上限', description: '默认10万，最大50万；内置词条另计。降额不会删除旧文件，重启加载与下次更新按新限额准入。', prop: { type: 'number', minimum: 1, maximum: 500000, multipleOf: 1, 'x-suffix': '条' } },
  { key: 'worlds.wt.kbUpdateMemoryMiB', title: '知识库额外更新估算预算', description: '默认512 MiB，可调64–2048 MiB；旧库、桌宠和模型原有占用另计。不是RSS硬限制，不修改Node全局堆；内存不足请调低条目和下载上限。', prop: { type: 'number', minimum: 64, maximum: 2048, multipleOf: 1, 'x-suffix': 'MiB' } },
  { key: 'worlds.wt.visionKeepShot', title: '保留截图', description: '默认关:OCR 用完就把整屏截图删掉,只留识别文本。打开后会一直留在 data/wt/ 下,方便自己回看。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.visionMode', title: '视觉降级', description: 'off 关闭;probe 允许截图与 OCR 自检,用于官方遥测不可用时。', prop: { type: 'string', enum: ['off', 'probe'] } },
  { key: 'worlds.wt.chatLines', title: '对话翻译条数', description: '一次最多取多少条对局聊天交给模型翻译;越多越贵,12 条左右够看清上下文。', prop: { type: 'number', minimum: 1, maximum: 40 } },
  { key: 'worlds.wt.chatSendMode', title: '发言方式', description: 'clipboard 复制到剪贴板,自己 Ctrl+V 再回车(最稳,不碰游戏);off 只出文本;confirm 先预演、再确认才用键盘直写发言栏;auto 直接直写。', prop: { type: 'string', enum: ['off', 'clipboard', 'confirm', 'auto'] } },
  { key: 'worlds.wt.chatSendDelayMs', title: '发送等待间隔', description: '按秒显示，例如0.18秒；打开聊天框后等多久再逐字输入，游戏卡顿时调大。', prop: { type: 'number', minimum: 60, maximum: 2000, multipleOf: 1, 'x-scale': 1000, 'x-suffix': '秒' } },
  { key: 'worlds.wt.chatTarget', title: '翻译成', description: '对局对话要翻成的语言;玩家名始终保持原文。', prop: { type: 'string', enum: ['zh', 'en', 'ja', 'ru'] } },
  { key: 'worlds.wt.chatMaxInputChars', title: '翻译输入上限(字符)', description: '翻译对局聊天时单独给模型的字符预算。播报仍用「输入上限」那一项;两边都受每日 token 上限约束。', prop: { type: 'number', minimum: 200, maximum: 8000 } },
  { key: 'worlds.wt.visionRegion', title: '截图区域', description: '形如 "x,y,w,h";留空表示整屏。缩到记分板或击杀提示能显著提速。', prop: { type: 'string' } },
  { key: 'worlds.wt.chatterLevel', title: '播报档位', description: 'quiet 只报进局与结算;important 再报击毁、阵亡、逆风;commentary 才按间隔定时讲态势。', prop: { type: 'string', enum: ['quiet', 'important', 'commentary'] } },
  { key: 'worlds.wt.llmMode', title: '文案模型', description: 'host 用宿主当前模型;openai 用下面的兼容接口;off 只用模板文案。', prop: { type: 'string', enum: ['host', 'openai', 'off'] } },
  { key: 'worlds.wt.llmBaseUrl', title: '接口地址', description: 'OpenAI 兼容的 /v1 前缀地址,例如 https://api.deepseek.com。', prop: { type: 'string' } },
  { key: 'worlds.wt.llmModel', title: '模型名', description: '接口里填的 model 字段。', prop: { type: 'string' } },
  { key: 'worlds.wt.llmApiKey', title: '接口密钥', description: '仅 llmMode=openai 时使用;会明文存在 config.json,别填主账号密钥。', prop: { type: 'string' } },
  { key: 'worlds.wt.maxInputChars', title: '输入上限(字符)', description: '拼给模型的素材超过这个长度就截断,用来压输入花费。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxOutputTokens', title: '输出上限(token)', description: '单次生成的最大 token 数,直接决定单条播报的上限花费。', prop: { type: 'number' } },
  { key: 'worlds.wt.dailyBudgetYuan', title: '每日预算(元)', description: '到顶后自动退回模板文案,不再调用模型。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxCallsPerMinute', title: '每分钟调用上限', description: '一分钟内最多调几次模型;超出的那条直接用模板文案。防事件风暴把额度烧光。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxCallsPerDay', title: '每日调用上限(次)', description: '当天调用次数到顶后不再调模型。计价填 0 时靠这条兜底。', prop: { type: 'number' } },
  { key: 'worlds.wt.maxTokensPerDay', title: '每日 token 上限', description: '当天输入加输出 token 的总量上限,到顶后退回模板文案。', prop: { type: 'number' } },
  { key: 'worlds.wt.priceInPerM', title: '输入价(元/M)', description: '按每百万输入 token 计价,用于本地记账。', prop: { type: 'number' } },
  { key: 'worlds.wt.priceOutPerM', title: '输出价(元/M)', description: '按每百万输出 token 计价,用于本地记账。', prop: { type: 'number' } },
  { key: 'worlds.wt.language', title: '播报语言', description: '播报文案与模型提示使用的语言。', prop: { type: 'string', enum: ['zh', 'en'] } },
];

/** World 配置的 JSON Schema 声明;每个键都要在 defaults 里存在。 */
export const WT_CONFIG_GROUP: ConfigGroup = {
  id: 'world:wt',
  owner: 'world:wt',
  schema: {
    type: 'object',
    title: '战争雷霆百科',
    properties: Object.fromEntries(
      ENTRIES.map((e) => [e.key, { ...e.prop, title: e.title, description: e.description, 'x-hot': true }]),
    ),
  },
};
