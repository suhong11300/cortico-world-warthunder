import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { personaWrap, type Lang } from './copy.ts';
import { redactSecret } from './guard.ts';

/** 文案生成的三档:宿主模型 / 自填的 OpenAI 兼容接口 / 只用模板。 */
export type LlmMode = 'host' | 'openai' | 'off';
export type LlmSource = 'host' | 'openai' | 'template';

export interface SpendBook {
  /** YYYY-MM-DD;跨日自动清零。 */
  date: string;
  inTokens: number;
  outTokens: number;
  /** 本地估算的花费,单位元。 */
  yuan: number;
  calls: number;
  /** 被预算或上限挡下来的次数,用来解释"为什么这条是模板"。 */
  blocked: number;
  /** 当天手动清零账本的次数;用来限制"清零绕过预算"这条路。 */
  resets: number;
}

export interface PriceTable {
  inPerM: number;
  outPerM: number;
}

export interface CognitionLike {
  request(req: { brief: string; tools?: string[] }): Promise<{ text: string } | { error: string }>;
}

export interface ComposeOptions {
  dataDir: string;
  lang: Lang;
  mode: LlmMode;
  material: string;
  instruction: string;
  /** 模板兜底:所有模型路径都不可用时用它。 */
  template: () => string;
  maxInputChars: number;
  maxOutputTokens: number;
  /**
   * 输出字符硬上限。宿主 cognition 通道不吃 max_tokens,模型可以吐回远多于预期的文本,
   * 所以这条在插件侧自己把关:超了就降级成模板,而不是把一大段话塞进对话。
   */
  maxOutputChars?: number;
  /** 素材里的事实行。模型输出出现素材里没有的数字时整段弃用。 */
  facts?: string[];
  dailyBudgetYuan: number;
  /** 每日模型调用次数上限;0 表示不限。 */
  maxCallsPerDay: number;
  /** 每日输入+输出 token 总量上限;0 表示不限。 */
  maxTokensPerDay: number;
  price: PriceTable;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 当天日期,由调用方按本地时区算好。 */
  today: string;
  cognition?: CognitionLike;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface ComposeResult {
  text: string;
  source: LlmSource;
  /** 为什么没走模型;source 为 template 时一定有。 */
  reason?: string;
  /** 模型回来了但被质量闸拦下时的原因。 */
  degraded?: 'too-long' | 'contradicts-facts';
  spent?: SpendBook;
}

export const SPEND_DIR = 'wt';
export const SPEND_FILE = 'spend.json';

/** 汉字与假名按 1 token 估,其余按 4 字符 1 token 估;只用于本地预算,不追求精确。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, Math.round(cjk + other / 4));
}

export function spendPath(dataDir: string): string {
  return join(dataDir, SPEND_DIR, SPEND_FILE);
}

function emptyBook(today: string): SpendBook {
  return { date: today, inTokens: 0, outTokens: 0, yuan: 0, calls: 0, blocked: 0, resets: 0 };
}

export function readSpend(dataDir: string, today: string): SpendBook {
  let raw: string;
  try {
    raw = readFileSync(spendPath(dataDir), 'utf8');
  } catch {
    return emptyBook(today);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyBook(today);
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyBook(today);
  const item = parsed as Record<string, unknown>;
  if (item.date !== today) return emptyBook(today);
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  return {
    date: today,
    inTokens: num(item.inTokens),
    outTokens: num(item.outTokens),
    yuan: num(item.yuan),
    calls: num(item.calls),
    blocked: num(item.blocked),
    resets: num(item.resets),
  };
}

export function writeSpend(dataDir: string, book: SpendBook): void {
  try {
    const target = spendPath(dataDir);
    mkdirSync(join(dataDir, SPEND_DIR), { recursive: true });
    const tmp = target + '.tmp';
    writeFileSync(tmp, JSON.stringify(book, null, 2), 'utf8');
    renameSync(tmp, target);
  } catch {
    // 记账失败不影响播报。
  }
}

export function chargeSpend(book: SpendBook, inTokens: number, outTokens: number, price: PriceTable): SpendBook {
  const cost = (inTokens / 1_000_000) * price.inPerM + (outTokens / 1_000_000) * price.outPerM;
  return {
    date: book.date,
    inTokens: book.inTokens + inTokens,
    outTokens: book.outTokens + outTokens,
    yuan: Math.round((book.yuan + cost) * 1e6) / 1e6,
    calls: book.calls + 1,
    blocked: book.blocked,
    resets: book.resets,
  };
}

/** 把 base 规范成 chat completions 端点:带 /v1 的不再重复加。 */
export function chatEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return '';
  if (base.endsWith('/chat/completions')) return base;
  if (/\/v1$/.test(base)) return base + '/chat/completions';
  return base + '/v1/chat/completions';
}

interface OpenAiReply {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

function readReply(raw: unknown): { text: string; inTokens: number; outTokens: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const reply = raw as OpenAiReply;
  const choices = reply.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  const content = first && first.message ? first.message.content : undefined;
  if (typeof content !== 'string' || content.trim().length === 0) return null;
  const usage = reply.usage;
  const inTokens = usage && typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outTokens = usage && typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  return { text: content.trim(), inTokens, outTokens };
}

async function callOpenAi(opts: ComposeOptions, brief: string): Promise<{ text: string; inTokens: number; outTokens: number }> {
  const endpoint = chatEndpoint(opts.baseUrl);
  if (!endpoint) throw new Error('接口地址没填');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + opts.apiKey,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.lang === 'en' ? 'You are a concise War Thunder commentator.' : '你是一个简短、口语化的战争雷霆战况解说。' },
          { role: 'user', content: brief },
        ],
        max_tokens: Math.max(32, Math.trunc(opts.maxOutputTokens)),
        temperature: 0.7,
        stream: false,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error('接口返回 HTTP ' + res.status + (detail ? '：' + redactSecret(detail.slice(0, 120)) : ''));
    }
    const raw: unknown = await res.json();
    const parsed = readReply(raw);
    if (!parsed) throw new Error('接口没有返回可用文本');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** 同一 dataDir 上的"读账 → 预留 → 结算"必须排队，否则并发请求各自看到同一份旧账本。 */
const spendQueues = new Map<string, Promise<unknown>>();

function lockKey(dataDir: string): string {
  return dataDir.replace(/\\/g, '/').toLowerCase();
}

/**
 * 把一次记账操作排到该 dataDir 的队尾。
 *
 * 一致性范围只到进程内：插件的模型调用都发生在同一个 bot 进程里；跨进程场景靠"预留立即落盘"
 * 把竞态窗口压到最小，所以这里的数字是"本地估算"，不是账务级精确账。
 */
export function withSpendLock<T>(dataDir: string, task: () => Promise<T>): Promise<T> {
  const key = lockKey(dataDir);
  const prev = spendQueues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  spendQueues.set(key, next.then(() => undefined, () => undefined));
  return next;
}

/** 结算实际用量：只加 token 与花费（调用次数已由预留记过，这里不再 +1）。 */
export function settleSpend(book: SpendBook, inTokens: number, outTokens: number, price: PriceTable): SpendBook {
  const cost = (inTokens / 1_000_000) * price.inPerM + (outTokens / 1_000_000) * price.outPerM;
  return {
    date: book.date,
    inTokens: book.inTokens + inTokens,
    outTokens: book.outTokens + outTokens,
    yuan: Math.round((book.yuan + cost) * 1e6) / 1e6,
    calls: book.calls,
    blocked: book.blocked,
    resets: book.resets,
  };
}

/**
 * 三道闸：金额、调用次数、token 总量。
 *
 * 只按金额判是不行的——计价填 0 时 yuan 恒为 0，预算永远不触发，次数与 token 闸兜住这条路。
 */
function limitReason(book: SpendBook, opts: ComposeOptions): string {
  const usedTokens = book.inTokens + book.outTokens;
  if (opts.dailyBudgetYuan > 0 && book.yuan >= opts.dailyBudgetYuan) return '今日预算 ' + opts.dailyBudgetYuan + ' 元已用完';
  if (opts.maxCallsPerDay > 0 && book.calls >= opts.maxCallsPerDay) return '今日模型调用已达上限 ' + opts.maxCallsPerDay + ' 次';
  if (opts.maxTokensPerDay > 0 && usedTokens >= opts.maxTokensPerDay) return '今日 token 用量已达上限 ' + opts.maxTokensPerDay;
  return '';
}

/**
 * 生成一条播报文案。
 *
 * 顺序：模板 → 预算检查 → host(宿主 cognition) → openai(自填接口) → 模板。
 * 任何一步失败都往下走，并在 reason 里留下原因，调用方可以把它拼进文本尾部。
 * 整个记账过程按 dataDir 串行，并发时后写的不会覆盖先写的。
 */
/** 抽出文本里的数字 token,用于和事实集合比对。 */
function numbersOf(text: string): string[] {
  const hits = text.match(/[0-9]+(?:\.[0-9]+)?/g) ?? [];
  return hits.map((v) => v.replace(/^0+(?=[0-9])/, ''));
}

/**
 * 模型输出是否编了素材里没有的数字。
 *
 * 兵棋类播报最怕的不是文风跑偏,而是把"本局 2 杀"讲成"击毁 99 个目标"——后者会直接被当真。
 * 所以素材里的数字构成白名单,输出里出现白名单外的数字(0 与 1 这种口语量词除外)就判定不可信。
 */
export function contradictsFacts(text: string, facts: string[]): boolean {
  if (facts.length === 0) return false;
  const known = new Set(numbersOf(facts.join(' ')));
  for (const token of numbersOf(text)) {
    if (!known.has(token)) return true;
  }
  return false;
}

export async function compose(opts: ComposeOptions): Promise<ComposeResult> {
  return withSpendLock(opts.dataDir, () => composeLocked(opts));
}

async function composeLocked(opts: ComposeOptions): Promise<ComposeResult> {
  const book = readSpend(opts.dataDir, opts.today);
  const template = opts.template();

  if (opts.mode === 'off') {
    return { text: template, source: 'template', reason: '文案模型已关闭', spent: book };
  }
  const gate = limitReason(book, opts);
  if (gate) {
    const blocked: SpendBook = { ...book, blocked: book.blocked + 1 };
    writeSpend(opts.dataDir, blocked);
    return { text: template, source: 'template', reason: gate, spent: blocked };
  }

  /** 模型输出的统一闸:长度与事实两道,任一不过就退回模板并说明原因。 */
  const finish = (text: string, source: LlmSource, spent: SpendBook): ComposeResult => {
    const trimmed = text.trim();
    const limit = Math.max(160, Math.trunc(opts.maxOutputChars ?? opts.maxOutputTokens * 4));
    if (trimmed.length > limit) {
      return {
        text: template,
        source: 'template',
        reason: '模型输出 ' + trimmed.length + ' 字符,超过 ' + limit + ' 字符上限,已改用模板',
        degraded: 'too-long',
        spent,
      };
    }
    // 事实白名单默认取模板与素材里的数字:模板是确定性渲染,素材是遥测原样,两者之外的数字都算编造。
    if (contradictsFacts(trimmed, opts.facts ?? [template, opts.material])) {
      return {
        text: template,
        source: 'template',
        reason: '模型输出出现素材里没有的数字,已改用模板(事实以素材为准)',
        degraded: 'contradicts-facts',
        spent,
      };
    }
    return { text: trimmed, source, spent };
  };

  const material = opts.material.slice(0, Math.max(200, Math.trunc(opts.maxInputChars)));
  const brief = personaWrap(material, opts.instruction, opts.lang);
  let lastError = '';

  /**
   * 抢一个调用名额。
   *
   * 先落盘 calls+1 再发请求：并发时第二个请求读到的就是"已经被占掉"的账本，不至于两个都放行；
   * 请求失败也保留这一次记录，否则"花了钱却没记账"在出问题时完全看不出来。
   */
  const reserve = (): string => {
    const fresh = readSpend(opts.dataDir, opts.today);
    const denied = limitReason(fresh, opts);
    if (denied) {
      writeSpend(opts.dataDir, { ...fresh, blocked: fresh.blocked + 1 });
      return denied;
    }
    writeSpend(opts.dataDir, { ...fresh, calls: fresh.calls + 1 });
    return '';
  };

  /** 结算实际用量：永远基于盘上最新账本，不拿闭包里的旧 book，避免并发时后写覆盖前写。 */
  const settle = (inTokens: number, outTokens: number): SpendBook => {
    const fresh = readSpend(opts.dataDir, opts.today);
    const spent = settleSpend(fresh, inTokens, outTokens, opts.price);
    writeSpend(opts.dataDir, spent);
    return spent;
  };

  if (opts.mode === 'host') {
    if (!opts.cognition) {
      lastError = '宿主没有提供 cognition 通道';
    } else {
      const denied = reserve();
      if (denied) {
        lastError = denied;
      } else {
        try {
          const result = await opts.cognition.request({ brief });
          if ('text' in result && typeof result.text === 'string' && result.text.trim().length > 0) {
            const spent = settle(estimateTokens(brief), estimateTokens(result.text));
            return finish(result.text, 'host', spent);
          }
          lastError = 'error' in result ? result.error : '宿主模型没有返回文本';
        } catch (error) {
          lastError = '宿主模型调用失败：' + describeError(error);
        }
      }
    }
  }

  if ((opts.mode === 'openai' || opts.mode === 'host') && opts.apiKey.trim()) {
    const denied = reserve();
    if (denied) {
      lastError = lastError ? lastError + '；' + denied : denied;
    } else {
      try {
        const reply = await callOpenAi(opts, brief);
        const inTokens = reply.inTokens > 0 ? reply.inTokens : estimateTokens(brief);
        const outTokens = reply.outTokens > 0 ? reply.outTokens : estimateTokens(reply.text);
        const spent = settle(inTokens, outTokens);
        return finish(reply.text, 'openai', spent);
      } catch (error) {
        lastError = (lastError ? lastError + '；' : '') + describeError(error);
      }
    }
  }

  if (opts.mode === 'openai' && !opts.apiKey.trim()) lastError = lastError || '接口密钥没填';
  return {
    text: template,
    source: 'template',
    reason: redactSecret(lastError) || '没有可用的模型通道',
    spent: readSpend(opts.dataDir, opts.today),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
