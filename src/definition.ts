import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { WT_DEFAULTS, type WtConfigSection } from './config.ts';
import { WT_TOOL_DECLS, WtWorld } from './world.ts';

export const WT: WorldDefinition<WtConfigSection> = {
  id: 'wt',
  label: 'war thunder安东星助手',
  defaults: () => ({ ...WT_DEFAULTS }),
  // `ctx.cfg` 是 `worlds.wt` 的活引用:热改的键现读即生效。
  create: (ctx) =>
    new WtWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
      botDir: ctx.botDir,
    }),
  describe: {
    tools: describeTools(WT_TOOL_DECLS, {
      wt_status: {
        zh: '自检遥测连接、战局状态、知识库版本与今日花费。',
        en: 'Self-check: telemetry link, battle state, knowledge base version and today spend.',
      },
      wt_search: {
        zh: '在本地知识库里检索战争雷霆的概念、载具与玩法。',
        en: 'Search the local knowledge base for concepts, vehicles and gameplay.',
      },
      wt_vehicle: {
        zh: '按名称或别名取一台载具的完整词条。',
        en: 'Fetch one vehicle entry by name or alias.',
      },
      wt_kb_status: {
        zh: '看知识库版本、条数分布与更新来源。',
        en: 'Show knowledge base version, counts and update source.',
      },
      wt_kb_update: {
        zh: '从配置的地址拉一次知识库更新。',
        en: 'Pull one knowledge base update from the configured URL.',
      },
      wt_battle_state: {
        zh: '读取当前观测、字段来源与可见地图；战绩为观测归因累计,非官方记分板。',
        en: 'Read current observations and visible-map objects; attributed tally is not the official scoreboard.',
      },
      wt_commentary: {
        zh: '确定性生成当前观测播报:态势、喝彩或打气;未知状态不复用旧读数。',
        en: 'Render current observed facts deterministically; never replay stale readings as current.',
      },
      wt_vision_probe: {
        zh: '视觉降级通道自检:截屏后做系统 OCR 并挑出战况线索。',
        en: 'Fallback vision probe: screenshot, system OCR, extract battle hints.',
      },
      wt_chat: {
        zh: '读对局聊天并翻译成指定语言;先给原文再给译文。',
        en: 'Read in-battle chat and translate it; original first, then the translation.',
      },
      wt_say: {
        zh: '默认把文本复制到剪贴板；明确配置confirm/auto时可键盘直写。',
        en: 'Copy text to the clipboard by default; optional confirm/auto mode types into game chat.',
      },
      wt_budget: {
        zh: '看今天的文案模型用量与花费,可清零。',
        en: 'Show or reset today usage and spend of the commentary model.',
      },
    }),
    events: [
      { type: 'wt.ready', description: { zh: 'World 挂载完成,附遥测与知识库状态。', en: 'The World was mounted, with telemetry and knowledge base status.' } },
      { type: 'wt.battle_started', description: { zh: '进入战局。', en: 'A battle started.' } },
      { type: 'wt.kill', description: { zh: 'feed中观测归属于昵称的击毁,非官方记分板。', en: 'An observed feed kill attributed to the configured nickname, not an official scoreboard update.' } },
      { type: 'wt.death', description: { zh: '观测阵亡或指标失效推断,不能一律当确认击毁。', en: 'An observed death or indicator-loss inference, not always a confirmed destruction.' } },
      { type: 'wt.behind', description: { zh: '观测累计含推断的死亡多于击毁,不代表全局胜负。', en: 'Observed/inferred losses exceed attributed kills; no match-result claim.' } },
      { type: 'wt.commentary', description: { zh: '确定性观测播报,或明确external的原始HUD信息。', en: 'Deterministic observations, or raw HUD text explicitly framed as external.' } },
      { type: 'wt.result', description: { zh: '离开观测战局,带观测累计与时长;官方胜负未知。', en: 'Left the observed battle, with local tally and duration; official result unknown.' } },
    ],
  },
};
