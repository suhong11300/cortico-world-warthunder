import type { ConfigProperty, ConfigGroup } from 'cortico/core/types.ts';

/** `worlds.wt` 配置段。enabled 是框架总闸,World 定义里恒为 false,不写进面板。 */
export interface WtConfigSection {
  enabled: boolean;
  /** 自动播报总开关:关掉后只在被显式调用时才说话。 */
  autoBrief: boolean;
  /** 本地遥测服务地址,战争雷霆客户端运行时监听。 */
  gameHost: string;
  gamePort: number;
  /** 轮询间隔(毫秒),实际下限 800。 */
  pollMs: number;
  /** 定时讲解间隔(毫秒),0 表示只报事件不报态势。 */
  commentaryEveryMs: number;
  /** 知识库更新源:一个返回 {version, entries} 的 JSON 地址,留空则不更新。 */
  kbUrl: string;
  kbAutoUpdateHours: number;
  /** 允许知识库源指向内网/本机。默认关:这条 fetch 模型能触发,不能让它扫内网。 */
  kbAllowPrivate: boolean;
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
  gameHost: '127.0.0.1',
  gamePort: 8111,
  pollMs: 1500,
  commentaryEveryMs: 45000,
  kbUrl: '',
  kbAutoUpdateHours: 24,
  kbAllowPrivate: false,
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

interface Entry {
  key: string;
  title: string;
  description: string;
  prop: Omit<ConfigProperty, 'title' | 'description'>;
}

const ENTRIES: Entry[] = [
  { key: 'worlds.wt.autoBrief', title: '自动播报', description: '战局事件与定时讲解是否自动推送。关掉后只在被显式调用时出声。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.gameHost', title: '遥测地址', description: '战争雷霆客户端的本地遥测服务所在主机。本机运行留 127.0.0.1。', prop: { type: 'string' } },
  { key: 'worlds.wt.gamePort', title: '遥测端口', description: '默认 8111。改过启动参数或端口被占用时改这里。', prop: { type: 'number' } },
  { key: 'worlds.wt.pollMs', title: '轮询间隔(ms)', description: '读取战局状态的频率,越小越跟手也越耗 CPU。1000 到 3000 之间最合适。', prop: { type: 'number' } },
  { key: 'worlds.wt.commentaryEveryMs', title: '讲解间隔(ms)', description: '战局中定时讲一句态势的间隔;0 表示只在击毁、阵亡、结算时开口。', prop: { type: 'number' } },
  { key: 'worlds.wt.kbUrl', title: '知识库源', description: '一个返回 {version, entries} 的 JSON 地址;留空则只用内置词条。', prop: { type: 'string' } },
  { key: 'worlds.wt.kbAllowPrivate', title: '允许内网知识库源', description: '关着时知识库源只能是公网 http(s);要连本机自建服务才打开。云元数据地址永远拒绝。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.kbAutoUpdateHours', title: '自动更新(小时)', description: '开机后每隔多少小时检查一次知识库源;0 表示只在手动调用时更新。', prop: { type: 'number' } },
  { key: 'worlds.wt.visionKeepShot', title: '保留截图', description: '默认关:OCR 用完就把整屏截图删掉,只留识别文本。打开后会一直留在 data/wt/ 下,方便自己回看。', prop: { type: 'boolean' } },
  { key: 'worlds.wt.visionMode', title: '视觉降级', description: 'off 关闭;probe 允许截图与 OCR 自检,用于官方遥测不可用时。', prop: { type: 'string', enum: ['off', 'probe'] } },
  { key: 'worlds.wt.chatLines', title: '对话翻译条数', description: '一次最多取多少条对局聊天交给模型翻译;越多越贵,12 条左右够看清上下文。', prop: { type: 'number', minimum: 1, maximum: 40 } },
  { key: 'worlds.wt.chatSendMode', title: '发言方式', description: 'clipboard 复制到剪贴板,自己 Ctrl+V 再回车(最稳,不碰游戏);off 只出文本;confirm 先预演、再确认才用键盘直写发言栏;auto 直接直写。', prop: { type: 'string', enum: ['off', 'clipboard', 'confirm', 'auto'] } },
  { key: 'worlds.wt.chatSendDelayMs', title: '发送间隔(毫秒)', description: '按 Enter 打开聊天框后等多久再逐字输入;游戏卡顿时调大。', prop: { type: 'number', minimum: 60, maximum: 2000 } },
  { key: 'worlds.wt.chatTarget', title: '翻译成', description: '对局对话要翻成的语言;玩家名始终保持原文。', prop: { type: 'string', enum: ['zh', 'en', 'ja', 'ru'] } },
  { key: 'worlds.wt.chatMaxInputChars', title: '翻译输入上限(字符)', description: '翻译对局聊天时单独给模型的字符预算。播报仍用「输入上限」那一项;两边都受每日 token 上限约束。', prop: { type: 'number', minimum: 200, maximum: 8000 } },
  { key: 'worlds.wt.visionRegion', title: '截图区域', description: '形如 "x,y,w,h";留空表示整屏。缩到记分板或击杀提示能显著提速。', prop: { type: 'string' } },
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
