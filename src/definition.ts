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
        zh: '主动读一次当前战局的载具、读数与战绩。',
        en: 'Read the current battle: vehicle, readings and tally.',
      },
      wt_commentary: {
        zh: '生成一条战况播报推到对话:态势、喝彩或打气。',
        en: 'Compose one battle commentary line: sitrep, cheer or urge.',
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
        zh: '把一句话打进游戏发言栏并回车发出；默认先预演再确认。',
        en: 'Type a line into the in-game chat box and press Enter; dry run first unless confirmed.',
      },
      wt_budget: {
        zh: '看今天的文案模型用量与花费,可清零。',
        en: 'Show or reset today usage and spend of the commentary model.',
      },
    }),
    events: [
      { type: 'wt.ready', description: { zh: 'World 挂载完成,附遥测与知识库状态。', en: 'The World was mounted, with telemetry and knowledge base status.' } },
      { type: 'wt.battle_started', description: { zh: '进入战局。', en: 'A battle started.' } },
      { type: 'wt.kill', description: { zh: '本局击毁目标,带当前连击数。', en: 'A kill happened, with the current streak.' } },
      { type: 'wt.death', description: { zh: '本局载具被击毁。', en: 'The vehicle was destroyed.' } },
      { type: 'wt.behind', description: { zh: '局势逆风,需要打气。', en: 'The battle is going badly; encouragement is due.' } },
      { type: 'wt.commentary', description: { zh: '定时或手动的战况解说。', en: 'A periodic or manual battle commentary.' } },
      { type: 'wt.result', description: { zh: '离开战局,带本局战绩与时长。', en: 'The battle ended, with tally and duration.' } },
    ],
  },
};
