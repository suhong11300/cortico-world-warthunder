import { fileURLToPath } from 'node:url';
import type { ToolDef, TriggerMode, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { WT_CONFIG_GROUP, type WtConfigSection } from './config.ts';
import { BattleClient, BattleWatcher, type BattleEvent, type BattleSnapshot } from './battle.ts';
import {
  battleLine,
  behindText,
  clip,
  commentaryText,
  deathText,
  enterText,
  formatEntry,
  formatHit,
  killText,
  readyText,
  resultText,
  type Lang,
} from './copy.ts';
import { fetchRemoteKb, findVehicle, kbCounts, kbPath, loadKb, readKbFile, searchKb, writeKbFile, type KbView } from './kb.ts';
import { compose, describeError, readSpend, writeSpend } from './llm.ts';
import { extractVisionHints, probeVision } from './vision.ts';

/** 提示词模板文件;describe 与 WebUI 都指向它。 */
const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const MIN_POLL_MS = 800;
const MAX_POLL_MS = 30000;
const MAX_SEARCH = 8;
const MAX_NAME = 60;
const MAX_VISION_HINTS = 6;

/** 构造参数:配置段、时区、数据目录,其余由装配层给。 */
export interface WtWorldOptions {
  cfg: WtConfigSection;
  timezone: string;
  dataDir: string;
  botDir?: string;
  /** 测试注入用;缺省 Date.now。 */
  now?: () => number;
  /** 测试注入用;缺省走全局 fetch,这样 8111 可以被假数据替换。 */
  fetchImpl?: typeof globalThis.fetch;
}

/** 九个工具的声明;definition.ts 用它生成 describe.json,handler 在这里按需挂。 */
export const WT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'wt_status',
    description:
      '战争雷霆百科自检:遥测是否连上、是否在战局、知识库版本与条数、文案模型来源、今日花费、视觉通道状态。不确定为什么没播报时先调它。',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'wt_search',
    description:
      '在本地战争雷霆知识库里检索概念、载具与玩法。回答"什么是 BR""P-51 怎么打""历史模式规则"这类问题前先用它取证,别凭记忆编。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 80, description: '关键词,中文或英文都行。' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH, default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'wt_vehicle',
    description: '按名称或别名查一台载具的完整词条:国家线、类别、战斗评级与打法要点。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: MAX_NAME, description: '载具名或别名,如 野马 / T-34-85 / Tiger II。' },
      },
      required: ['name'],
    },
  },
  {
    name: 'wt_kb_status',
    description: '看知识库当前版本、条数分布、远程更新来源与上次更新时间。',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'wt_kb_update',
    description: '从 worlds.wt.kbUrl 拉一次知识库更新;没配来源时会直说。更新成功后立即生效,不用重启。',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        force: { type: 'boolean', default: false, description: '忽略小时级的节流,强制拉一次。' },
      },
    },
  },
  {
    name: 'wt_battle_state',
    description: '主动读一次当前战局:是否在战局、载具、速度高度、附近敌我数量与本局战绩。',
    tags: ['read', 'snapshot'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'wt_commentary',
    description: '手生成一条战况播报并推到对话里。mode=sitrep 讲态势,cheer 是高光喝彩,urge 是逆风打气。',
    tags: ['speak'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['sitrep', 'cheer', 'urge'], default: 'sitrep' },
      },
    },
  },
  {
    name: 'wt_vision_probe',
    description:
      '视觉降级通道自检:截一张当前屏幕、用系统 OCR 读文字并挑出战况线索。官方遥测连不上时才用它。',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        region: { type: 'string', maxLength: 40, description: '可选,形如 "x,y,w,h";留空按配置或整屏。' },
      },
    },
  },
  {
    name: 'wt_budget',
    description: '看今天的文案模型用量与花费;reset=true 时把当天账本清零。',
    tags: ['read', 'write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reset: { type: 'boolean', default: false },
      },
    },
  },
];

function clamp(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 战争雷霆百科 World:知识库 + 战局遥测 + 可降级的文案模型。 */
export class WtWorld implements World {
  readonly id = 'wt';

  private readonly opts: WtWorldOptions;
  private host: WorldHost | null = null;
  private view: KbView;
  private client: BattleClient | null = null;
  private watcher: BattleWatcher | null = null;
  private clientKey = '';
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private commentaryTimer: ReturnType<typeof setTimeout> | undefined;
  private greetTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private polling = false;
  private online = false;
  private lastError = '';
  private lastLlmNote = '';
  private lastText = '';
  private lastTextAt = 0;
  private lastKbAt = '';

  constructor(opts: WtWorldOptions) {
    this.opts = opts;
    this.view = loadKb(opts.dataDir);
  }

  // ---- 基础读数 ----

  private lang(): Lang {
    return this.opts.cfg.language === 'en' ? 'en' : 'zh';
  }

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private timezone(): string {
    const zone = (this.opts.timezone || '').trim();
    if (!zone) return 'Asia/Shanghai';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(this.nowMs()));
      return zone;
    } catch {
      return 'Asia/Shanghai';
    }
  }

  /** 本地时区的 YYYY-MM-DD,用于预算与自动更新节流。 */
  private todayKey(): string {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: this.timezone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(this.nowMs()));
    } catch {
      return new Date(this.nowMs()).toISOString().slice(0, 10);
    }
  }

  private stamp(): string {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: this.timezone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(this.nowMs()));
    } catch {
      return new Date(this.nowMs()).toISOString();
    }
  }

  /** 遥测地址或端口改了要换客户端,否则会一直打旧端口。 */
  private ensureBattle(): { client: BattleClient; watcher: BattleWatcher } | null {
    const cfg = this.opts.cfg;
    const key = cfg.gameHost.trim() + ':' + cfg.gamePort;
    if (this.client && this.watcher && this.clientKey === key) return { client: this.client, watcher: this.watcher };
    try {
      const client = new BattleClient({
        host: cfg.gameHost,
        port: cfg.gamePort,
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      });
      const watcher = new BattleWatcher({ client, now: () => this.nowMs() });
      this.client = client;
      this.watcher = watcher;
      this.clientKey = key;
      return { client, watcher };
    } catch (error) {
      this.lastError = describeError(error);
      return null;
    }
  }

  // ---- 生命周期 ----

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.stopped = false;
    this.view = loadKb(this.opts.dataDir);
    // 先建定时器再投事件:宿主 core 未就绪时 pushEvent 会抛,不能让它中断 start。
    this.schedulePoll(clamp(this.opts.cfg.pollMs, MIN_POLL_MS, MAX_POLL_MS));
    this.scheduleCommentary(this.commentaryEvery());
    try {
      await this.greet();
      host.log.info('就绪:遥测 ' + this.originText() + ' · 知识库 ' + this.view.entries.length + ' 条 · 文案 ' + this.opts.cfg.llmMode);
    } catch (error) {
      host.log.info('就绪事件没投出去,2 秒后补投: ' + describeError(error));
      this.greetTimer = setTimeout(() => {
        void this.greet().catch(() => undefined);
      }, 2000);
      this.greetTimer.unref?.();
    }
    if (this.opts.cfg.kbUrl.trim() && this.opts.cfg.kbAutoUpdateHours > 0) {
      void this.maybeAutoUpdateKb().catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.commentaryTimer) clearTimeout(this.commentaryTimer);
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.pollTimer = undefined;
    this.commentaryTimer = undefined;
    this.greetTimer = undefined;
    this.host = null;
  }

  private originText(): string {
    return 'http://' + (this.opts.cfg.gameHost || '127.0.0.1') + ':' + this.opts.cfg.gamePort;
  }

  private commentaryEvery(): number {
    const every = Math.trunc(this.opts.cfg.commentaryEveryMs);
    return Number.isFinite(every) && every >= 5000 ? every : 0;
  }

  private schedulePoll(delay: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce()
        .catch((error: unknown) => { this.lastError = describeError(error); })
        .finally(() => { this.schedulePoll(clamp(this.opts.cfg.pollMs, MIN_POLL_MS, MAX_POLL_MS)); });
    }, Math.max(MIN_POLL_MS, delay));
    this.pollTimer.unref?.();
  }

  private scheduleCommentary(delay: number): void {
    if (this.stopped || delay <= 0) return;
    this.commentaryTimer = setTimeout(() => {
      void this.commentaryOnce()
        .catch((error: unknown) => { this.lastError = describeError(error); })
        .finally(() => { this.scheduleCommentary(this.commentaryEvery()); });
    }, Math.max(5000, delay));
    this.commentaryTimer.unref?.();
  }

  private async greet(): Promise<void> {
    const text = readyText(this.online, this.view.entries.length, this.lang());
    await this.push('wt.ready', text, 'flush', { kb: this.view.entries.length, online: this.online });
  }

  // ---- 战局轮询 ----

  private async pollOnce(): Promise<void> {
    if (this.polling || this.stopped) return;
    const battle = this.ensureBattle();
    if (!battle) return;
    this.polling = true;
    try {
      const events = await battle.watcher.poll();
      this.online = battle.watcher.online_now;
      for (const event of events) {
        try {
          await this.handleBattleEvent(event);
        } catch (error) {
          this.lastError = describeError(error);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async handleBattleEvent(event: BattleEvent): Promise<void> {
    const cfg = this.opts.cfg;
    const lang = this.lang();
    switch (event.kind) {
      case 'enter': {
        if (!cfg.autoBrief) return;
        const material = '刚进入战局。' + battleLine(event.snapshot, 'zh');
        const text = await this.composeText(material, '用一句话宣告进战局,并说明你会盯着哪些事', () => enterText(event.snapshot, lang));
        await this.push('wt.battle_started', text, 'flush', { vehicle: event.snapshot.vehicle });
        return;
      }
      case 'kill': {
        if (!cfg.autoBrief) return;
        const material = '本局第 ' + event.total + ' 个击毁,当前连击 ' + event.streak + '。' + (event.detail ? '原始播报:' + event.detail : '') + ' 读数:' + battleLine(event.snapshot, 'zh');
        const text = await this.composeText(material, '用一两句话为这次击毁喝彩,可以带一个表情', () => killText(event.total, event.streak, event.detail, lang));
        await this.push('wt.kill', text, 'flush', { total: event.total, streak: event.streak });
        return;
      }
      case 'death': {
        if (!cfg.autoBrief) return;
        const material = '本局第 ' + event.total + ' 次被击毁。' + battleLine(event.snapshot, 'zh');
        const text = await this.composeText(material, '用一两句话安慰并给出一条具体的下一步建议', () => deathText(event.total, lang));
        await this.push('wt.death', text, 'flush', { total: event.total });
        return;
      }
      case 'behind': {
        if (!cfg.autoBrief) return;
        const material = '本局 ' + event.kills + ' 杀 ' + event.deaths + ' 死,局势逆风。';
        const text = await this.composeText(material, '用一两句话打气,给一条能立刻执行的战术建议', () => behindText(event.kills, event.deaths, lang));
        await this.push('wt.behind', text, 'flush', { kills: event.kills, deaths: event.deaths });
        return;
      }
      case 'leave': {
        if (!cfg.autoBrief) return;
        const summary = event.summary;
        const material = '本局结束。击杀 ' + summary.kills + ',被击毁 ' + summary.deaths + ',时长约 ' + Math.round(summary.seconds / 60) + ' 分钟。';
        const text = await this.composeText(material, '用一两句话复盘这一局的结果与一个改进点', () => resultText(summary, lang));
        await this.push('wt.result', text, 'flush', { kills: summary.kills, deaths: summary.deaths });
        return;
      }
      default:
        return;
    }
  }

  private async commentaryOnce(): Promise<void> {
    if (this.stopped || !this.opts.cfg.autoBrief) return;
    const battle = this.ensureBattle();
    if (!battle || !battle.watcher.inBattleNow) return;
    const snapshot = await battle.watcher.refresh();
    const material = battleLine(snapshot, 'zh');
    const text = await this.composeText(material, '用一句话接力解说当前战况,不要重复开场白', () => commentaryText(snapshot, this.lang()));
    await this.push('wt.commentary', text, 'debounce', { vehicle: snapshot.vehicle });
  }

  // ---- 文案与推送 ----

  private async composeText(material: string, instruction: string, template: () => string): Promise<string> {
    const cfg = this.opts.cfg;
    const result = await compose({
      dataDir: this.opts.dataDir,
      lang: this.lang(),
      mode: cfg.llmMode,
      material,
      instruction,
      template,
      maxInputChars: clamp(cfg.maxInputChars, 200, 8000),
      maxOutputTokens: clamp(cfg.maxOutputTokens, 32, 1024),
      dailyBudgetYuan: Math.max(0, cfg.dailyBudgetYuan),
      price: { inPerM: Math.max(0, cfg.priceInPerM), outPerM: Math.max(0, cfg.priceOutPerM) },
      apiKey: cfg.llmApiKey,
      baseUrl: cfg.llmBaseUrl,
      model: cfg.llmModel,
      today: this.todayKey(),
      cognition: this.host?.cognition,
    });
    this.lastLlmNote = result.reason ?? '';
    return result.text;
  }

  private async push(type: string, text: string, trigger: TriggerMode, meta?: Record<string, unknown>): Promise<void> {
    const host = this.host;
    if (!host) return;
    const envelope = {
      type,
      ts: nowIso(this.timezone()),
      source: this.id,
      origin: 'internal' as const,
      senderKey: this.id,
      text,
      ...(meta ? { meta } : {}),
    };
    await host.pushEvent(envelope as Parameters<WorldHost['pushEvent']>[0], { trigger });
    this.lastText = text;
    this.lastTextAt = this.nowMs();
  }

  // ---- 知识库更新 ----

  private async maybeAutoUpdateKb(): Promise<void> {
    const cfg = this.opts.cfg;
    const hours = Math.max(0, Math.trunc(cfg.kbAutoUpdateHours));
    if (hours <= 0 || !cfg.kbUrl.trim()) return;
    const last = this.view.remoteVersion ? this.readKbFetchedAt() : '';
    if (last) {
      const lastMs = Date.parse(last);
      if (Number.isFinite(lastMs) && this.nowMs() - lastMs < hours * 3600_000) return;
    }
    await this.updateKb(false);
  }

  private readKbFetchedAt(): string {
    return readKbFile(this.opts.dataDir)?.fetchedAt ?? this.lastKbAt;
  }

  private async updateKb(force: boolean): Promise<string> {
    const cfg = this.opts.cfg;
    const url = cfg.kbUrl.trim();
    if (!url) return '知识库源没配(worlds.wt.kbUrl 留空),现在只用内置 ' + this.view.entries.length + ' 条。';
    if (!force && this.lastKbAt) {
      const lastMs = Date.parse(this.lastKbAt);
      if (Number.isFinite(lastMs) && this.nowMs() - lastMs < 60_000) {
        return '刚更新过(60 秒内),这次跳过;要强制就加 force=true。';
      }
    }
    try {
      const remote = await fetchRemoteKb(url);
      writeKbFile(this.opts.dataDir, { version: remote.version, fetchedAt: new Date(this.nowMs()).toISOString(), entries: remote.entries });
      this.view = loadKb(this.opts.dataDir);
      this.lastKbAt = new Date(this.nowMs()).toISOString();
      const counts = kbCounts(this.view.entries);
      const skipped = remote.skipped > 0 ? ',跳过 ' + remote.skipped + ' 条不合法词条' : '';
      return '知识库更新到 v' + this.view.version + ':共 ' + counts.total + ' 条(载具 ' + counts.vehicle + ' / 概念 ' + counts.concept + ' / 玩法 ' + counts.play + ')' + skipped + '。';
    } catch (error) {
      return '知识库更新失败:' + describeError(error) + '。内置 ' + this.view.entries.length + ' 条照旧可用。';
    }
  }

  // ---- 工具 ----

  tools(): ToolDef[] {
    return [
      this.statusTool(),
      this.searchTool(),
      this.vehicleTool(),
      this.kbStatusTool(),
      this.kbUpdateTool(),
      this.battleStateTool(),
      this.commentaryTool(),
      this.visionTool(),
      this.budgetTool(),
    ];
  }

  private statusTool(): ToolDef {
    return { ...decl('wt_status'), handler: async () => this.reportStatus() };
  }

  private searchTool(): ToolDef {
    return {
      ...decl('wt_search'),
      handler: async (args) => {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) return '没给出关键词,用法:wt_search query=BR';
        const limit = clamp(Number(args.limit ?? 5), 1, MAX_SEARCH);
        const hits = searchKb(this.view.entries, query, limit);
        if (hits.length === 0) {
          return '知识库里没找到「' + query + '」(库内 ' + this.view.entries.length + ' 条)。换个说法试试,或先 wt_kb_update 拉一次更新。';
        }
        const lines = ['🔎 「' + query + '」命中 ' + hits.length + ' 条:'];
        for (const hit of hits) lines.push(formatHit(hit.entry, this.lang()));
        lines.push('要完整词条就用 wt_vehicle name=<载具名>。');
        return lines.join('\n');
      },
    };
  }

  private vehicleTool(): ToolDef {
    return {
      ...decl('wt_vehicle'),
      handler: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return '没给出载具名,用法:wt_vehicle name=野马';
        const entry = findVehicle(this.view.entries, name);
        if (!entry) return '知识库里没有「' + name + '」。用 wt_search 先搜一下,或 wt_kb_update 拉更新。';
        const lines = [formatEntry(entry, this.lang())];
        const tag = entry.tags && entry.tags.length > 0 ? entry.tags[0] : entry.name;
        const related = searchKb(this.view.entries, tag, 4)
          .filter((hit) => hit.entry.id !== entry.id)
          .slice(0, 3);
        if (related.length > 0) lines.push('', '相关:' + related.map((hit) => hit.entry.name).join('、'));
        return lines.join('\n');
      },
    };
  }

  private kbStatusTool(): ToolDef {
    return { ...decl('wt_kb_status'), handler: async () => this.reportKb() };
  }

  private kbUpdateTool(): ToolDef {
    return { ...decl('wt_kb_update'), handler: async (args) => this.updateKb(args.force === true) };
  }

  private battleStateTool(): ToolDef {
    return { ...decl('wt_battle_state'), handler: async () => this.reportBattle() };
  }

  private commentaryTool(): ToolDef {
    return {
      ...decl('wt_commentary'),
      handler: async (args) => {
        const mode = args.mode === 'cheer' || args.mode === 'urge' ? args.mode : 'sitrep';
        const battle = this.ensureBattle();
        if (!battle) return '遥测客户端没建起来:' + (this.lastError || '未知原因');
        const snapshot = await battle.watcher.refresh();
        const tally = battle.watcher.tally;
        const lang = this.lang();
        let material = battleLine(snapshot, 'zh');
        let instruction = '用一句话接力解说当前战况,不要重复开场白';
        let template = (): string => commentaryText(snapshot, lang);
        if (mode === 'cheer') {
          material = '本局已击毁 ' + tally.kills + ' 个,被击毁 ' + tally.deaths + ' 次,最长连击 ' + tally.bestStreak + '。读数:' + material;
          instruction = '用一两句话为本局的高光喝彩,可以带一个表情';
          template = (): string => killText(Math.max(1, tally.kills), Math.max(1, tally.bestStreak), '', lang);
        } else if (mode === 'urge') {
          material = '本局 ' + tally.kills + ' 杀 ' + tally.deaths + ' 死,局势需要打气。读数:' + material;
          instruction = '用一两句话打气,给一条能立刻执行的战术建议';
          template = (): string => behindText(tally.kills, tally.deaths, lang);
        }
        const text = await this.composeText(material, instruction, template);
        await this.push('wt.commentary', text, 'flush', { manual: true, mode });
        return text + '\n(已推送到对话)';
      },
    };
  }

  private visionTool(): ToolDef {
    return {
      ...decl('wt_vision_probe'),
      handler: async (args) => {
        const cfg = this.opts.cfg;
        if (cfg.visionMode !== 'probe') {
          return '视觉通道是关的(把 worlds.wt.visionMode 改成 probe 才启用)。遥测能连上时不需要它。';
        }
        const argRegion = typeof args.region === 'string' ? args.region.trim() : '';
        const region = argRegion || cfg.visionRegion.trim();
        const result = await probeVision({ dataDir: this.opts.dataDir, region });
        if (!result.ok) return '视觉探测失败:' + (result.error ?? '未知原因');
        const hints = extractVisionHints(result.text).slice(0, MAX_VISION_HINTS);
        const lines = ['🖼 视觉探测完成', '耗时 ' + result.ms + ' ms · 识别 ' + result.lines + ' 行', '截图:' + result.pngPath];
        if (result.text.trim()) lines.push('识别文本(前 400 字):' + clip(result.text, 400));
        else lines.push('画面里没识别出文字(窗口被遮挡或分辨率太低)。');
        if (hints.length > 0) lines.push('线索:' + hints.map((hint) => '[' + hint.kind + '] ' + clip(hint.text, 30)).join(' · '));
        lines.push('OCR 会误识,只当参考,不要据此宣布战绩。');
        return lines.join('\n');
      },
    };
  }

  private budgetTool(): ToolDef {
    return {
      ...decl('wt_budget'),
      handler: async (args) => {
        const today = this.todayKey();
        if (args.reset === true) {
          writeSpend(this.opts.dataDir, { date: today, inTokens: 0, outTokens: 0, yuan: 0, calls: 0, blocked: 0 });
          return '💰 已把 ' + today + ' 的用量账本清零。';
        }
        const book = readSpend(this.opts.dataDir, today);
        const budget = Math.max(0, this.opts.cfg.dailyBudgetYuan);
        const pct = budget > 0 ? Math.round((book.yuan / budget) * 100) : 0;
        return [
          '💰 今日文案用量(' + today + ')',
          '调用 ' + book.calls + ' 次 · 输入 ' + book.inTokens + ' tokens · 输出 ' + book.outTokens + ' tokens',
          '估算花费 ' + book.yuan.toFixed(4) + ' 元 / 预算 ' + budget + ' 元(' + pct + '%)',
          '因预算被拦 ' + book.blocked + ' 次',
          '计价:输入 ' + this.opts.cfg.priceInPerM + ' 元/M · 输出 ' + this.opts.cfg.priceOutPerM + ' 元/M',
          '单次上限:输入 ' + this.opts.cfg.maxInputChars + ' 字符 · 输出 ' + this.opts.cfg.maxOutputTokens + ' tokens',
        ].join('\n');
      },
    };
  }

  // ---- 回执 ----

  private sourceText(): string {
    const cfg = this.opts.cfg;
    if (cfg.llmMode === 'off') return 'off(只用模板文案)';
    if (cfg.llmMode === 'openai') return 'openai(' + (cfg.llmBaseUrl || '未填地址') + ' · ' + (cfg.llmModel || '未填模型') + ')';
    return this.host?.cognition ? 'host(宿主模型)' : 'host(宿主没提供 cognition,会退模板)';
  }

  private reportStatus(): string {
    const cfg = this.opts.cfg;
    const counts = kbCounts(this.view.entries);
    const book = readSpend(this.opts.dataDir, this.todayKey());
    const battle = this.watcher;
    const inBattle = battle ? battle.inBattleNow : false;
    const snapshot = battle ? battle.currentSnapshot : null;
    const lines = [
      '🐯 战争雷霆百科 · 自检',
      '📡 遥测:' + this.originText() + ' · ' + (this.online ? '在线' : '没连上'),
      '🎮 战局:' + (inBattle && snapshot ? '战局中(' + battleLine(snapshot, 'zh') + ')' : '不在战局'),
      '📚 知识库:v' + this.view.version + ' · ' + counts.total + ' 条(载具 ' + counts.vehicle + ' / 概念 ' + counts.concept + ' / 玩法 ' + counts.play + ')' +
        (this.view.remoteVersion ? ' · 远程 ' + this.view.remoteCount + ' 条' : ' · 仅内置'),
      '🧠 文案:' + this.sourceText(),
      '💰 今日 ' + book.yuan.toFixed(4) + ' 元 / 预算 ' + Math.max(0, cfg.dailyBudgetYuan) + ' 元',
      '🖼 视觉:' + (cfg.visionMode === 'probe' ? 'probe(可截图 OCR)' : 'off'),
      '🕘 现在:' + this.stamp(),
    ];
    if (this.lastText) lines.push('📣 上次播报(' + Math.round((this.nowMs() - this.lastTextAt) / 1000) + ' 秒前):' + clip(this.lastText, 80));
    else lines.push('📣 上次播报:还没有');
    if (this.lastLlmNote) lines.push('ℹ️ 文案通道备注:' + this.lastLlmNote);
    if (this.lastError) lines.push('⚠️ 上次错误:' + clip(this.lastError, 160));
    return lines.join('\n');
  }

  private reportKb(): string {
    const counts = kbCounts(this.view.entries);
    const cfg = this.opts.cfg;
    const lines = [
      '📚 知识库',
      '生效版本:v' + this.view.version,
      '条数:' + counts.total + '(载具 ' + counts.vehicle + ' / 概念 ' + counts.concept + ' / 玩法 ' + counts.play + ')',
      '来源:' + (this.view.remoteVersion ? '内置 + 远程(v' + this.view.remoteVersion + ',' + this.view.remoteCount + ' 条)' : '仅内置'),
      '更新源:' + (cfg.kbUrl.trim() || '未配置(worlds.wt.kbUrl 留空)'),
      '自动更新:' + (cfg.kbAutoUpdateHours > 0 ? '每 ' + cfg.kbAutoUpdateHours + ' 小时' : '已关'),
      '本地文件:' + kbPath(this.opts.dataDir),
    ];
    const fetchedAt = this.readKbFetchedAt();
    if (fetchedAt) lines.push('上次拉取:' + fetchedAt);
    return lines.join('\n');
  }

  private async reportBattle(): Promise<string> {
    const battle = this.ensureBattle();
    if (!battle) return '遥测客户端没建起来:' + (this.lastError || '未知原因');
    const state = await battle.client.state();
    if (!state) return '遥测没连上(' + this.originText() + ')。确认游戏在运行、端口和配置一致。';
    if (!state.valid || !state.mapValid) return '遥测在线,但当前不在战局(菜单或战局加载中)。';
    const snapshot = await battle.watcher.refresh();
    const tally = battle.watcher.tally;
    return [
      '🎮 当前战局',
      '读数:' + battleLine(snapshot, 'zh'),
      '本局:' + tally.kills + ' 杀 · ' + tally.deaths + ' 死' + (tally.bestStreak > 1 ? ' · 最长连击 ' + tally.bestStreak : ''),
      '读于:' + this.stamp(),
    ].join('\n');
  }

  // ---- 提示词与 WebUI ----

  envPromptVars(): Record<string, string> {
    const cfg = this.opts.cfg;
    const counts = kbCounts(this.view.entries);
    const book = readSpend(this.opts.dataDir, this.todayKey());
    const battle = this.watcher;
    const inBattle = battle ? battle.inBattleNow : false;
    const snapshot = battle ? battle.currentSnapshot : null;
    return {
      'wt.now': this.stamp(),
      'wt.zone': this.timezone(),
      'wt.status': this.online ? '遥测在线' : '遥测离线',
      'wt.battle': inBattle && snapshot ? '战局中:' + battleLine(snapshot, 'zh') : '不在战局',
      'wt.kb': 'v' + this.view.version + ' · ' + counts.total + ' 条(载具 ' + counts.vehicle + ' / 概念 ' + counts.concept + ' / 玩法 ' + counts.play + ')',
      'wt.source': this.sourceText(),
      'wt.budget': '今日 ' + book.yuan.toFixed(4) + ' 元 / 预算 ' + Math.max(0, cfg.dailyBudgetYuan) + ' 元',
      'wt.vehicle': snapshot && snapshot.vehicle ? snapshot.vehicle : '未知',
    };
  }

  webUi(): WorldWebUiDecl {
    const cfg = this.opts.cfg;
    const book = readSpend(this.opts.dataDir, this.todayKey());
    return {
      label: '战争雷霆百科',
      lamps: [
        { label: '遥测', state: this.online ? 'online' : 'offline', hint: this.originText() },
        { label: '知识库', state: this.view.entries.length > 0 ? 'online' : 'offline', hint: 'v' + this.view.version + ' · ' + this.view.entries.length + ' 条' },
        { label: '文案', state: cfg.llmMode === 'off' ? 'offline' : 'online', hint: this.sourceText() },
      ],
      badges: [
        { label: '知识库', value: this.view.entries.length + ' 条', tone: 'plain' as const },
        { label: '今日花费', value: book.yuan.toFixed(3) + ' 元', tone: 'plain' as const },
      ],
      config: [WT_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.wt.envPrompt',
          title: '战争雷霆百科环境段',
          description: '把当前遥测状态、知识库版本与花费上限写给模型。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt' as const,
        },
      ],
    };
  }
}

function decl(name: string): Omit<ToolDef, 'handler'> {
  const found = WT_TOOL_DECLS.find((item) => item.name === name);
  if (!found) throw new Error('缺少工具声明:' + name);
  return found;
}
