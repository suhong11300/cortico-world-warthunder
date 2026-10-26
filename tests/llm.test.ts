import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chargeSpend,
  chatEndpoint,
  compose,
  describeError,
  estimateTokens,
  readSpend,
  spendPath,
  writeSpend,
} from '../src/llm.ts';
import type { ComposeOptions } from '../src/llm.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-llm-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const today = '2026-10-27';
const price = { inPerM: 1, outPerM: 2 };

function baseOpts(patch: Partial<ComposeOptions> = {}): ComposeOptions {
  return {
    dataDir: dir,
    lang: 'zh',
    mode: 'off',
    material: '本局第 2 个击毁,连击 2',
    instruction: '用一两句话喝彩',
    template: () => '模板文案',
    maxInputChars: 1200,
    maxOutputTokens: 160,
    dailyBudgetYuan: 1,
    maxCallsPerDay: 200,
    maxTokensPerDay: 60000,
    price,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    today,
    ...patch,
  };
}

function jsonFetch(payload: unknown, calls: string[] = []) {
  return (async (url: unknown, init: unknown) => {
    calls.push(String(init && (init as { body?: string }).body ? (init as { body?: string }).body : ''));
    return { ok: true, status: 200, text: async () => '', json: async () => payload };
  }) as unknown as typeof globalThis.fetch;
}

describe('计费与端点', () => {
  it('中文按字、其余按 4 字符估算,最少 1', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(1);
  });

  it('chatEndpoint 三种写法都补成 chat/completions', () => {
    expect(chatEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatEndpoint('https://x.y/v1/chat/completions')).toBe('https://x.y/v1/chat/completions');
    expect(chatEndpoint('   ')).toBe('');
  });

  it('账本按天隔离:换日就归零', () => {
    expect(readSpend(dir, today).yuan).toBe(0);
    writeSpend(dir, { date: today, inTokens: 100, outTokens: 50, yuan: 0.5, calls: 2, blocked: 0, resets: 0 });
    expect(readSpend(dir, today).yuan).toBeCloseTo(0.5);
    expect(readSpend(dir, '2026-10-28').yuan).toBe(0);
    expect(readSpend(dir, '2026-10-28').calls).toBe(0);
  });

  it('chargeSpend 按百万 token 单价累加', () => {
    const book = chargeSpend({ date: today, inTokens: 0, outTokens: 0, yuan: 0, calls: 0, blocked: 0, resets: 0 }, 1_000_000, 500_000, price);
    expect(book.inTokens).toBe(1_000_000);
    expect(book.outTokens).toBe(500_000);
    expect(book.yuan).toBeCloseTo(2);
    expect(book.calls).toBe(1);
    expect(spendPath(dir).endsWith(join('wt', 'spend.json'))).toBe(true);
  });
});

describe('compose 的降级顺序', () => {
  it('mode=off 直接用模板并说明原因', async () => {
    const result = await compose(baseOpts());
    expect(result.source).toBe('template');
    expect(result.text).toBe('模板文案');
    expect(result.reason).toContain('关闭');
  });

  it('预算用完就不再调模型,blocked 计数增加', async () => {
    writeSpend(dir, { date: today, inTokens: 0, outTokens: 0, yuan: 1, calls: 1, blocked: 0, resets: 0 });
    const result = await compose(baseOpts({ mode: 'host', dailyBudgetYuan: 1 }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('预算');
    expect(readSpend(dir, today).blocked).toBe(1);
  });

  it('宿主有 cognition 时用它,并记账', async () => {
    const result = await compose(baseOpts({
      mode: 'host',
      cognition: { request: async () => ({ text: '漂亮！第二个也拿下了' }) },
    }));
    expect(result.source).toBe('host');
    expect(result.text).toBe('漂亮！第二个也拿下了');
    expect(readSpend(dir, today).calls).toBe(1);
    expect(readSpend(dir, today).yuan).toBeGreaterThan(0);
  });

  it('宿主 cognition 报错时退模板,原因写清楚', async () => {
    const result = await compose(baseOpts({
      mode: 'host',
      cognition: { request: async () => ({ error: 'persona 未启用' }) },
    }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('persona 未启用');
  });

  it('宿主没给通道且没填 key 时直接退模板', async () => {
    const result = await compose(baseOpts({ mode: 'host' }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('cognition');
  });

  it('mode=openai 走自填接口,请求体带模型与上限', async () => {
    const bodies: string[] = [];
    const result = await compose(baseOpts({
      mode: 'openai',
      apiKey: 'sk-test',
      fetchImpl: jsonFetch({ choices: [{ message: { content: '接得好，继续压！' } }], usage: { prompt_tokens: 120, completion_tokens: 20 } }, bodies),
    }));
    expect(result.source).toBe('openai');
    expect(result.text).toBe('接得好，继续压！');
    expect(bodies.length).toBe(1);
    const body = JSON.parse(bodies[0]) as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('deepseek-chat');
    expect(body.max_tokens).toBe(160);
    expect(body.messages[1].content).toContain('数字一个都不要改');
    expect(readSpend(dir, today).inTokens).toBe(120);
  });

  it('输入超长时按 maxInputChars 截断后再发', async () => {
    const bodies: string[] = [];
    await compose(baseOpts({
      mode: 'openai',
      apiKey: 'sk-test',
      material: 'A'.repeat(500) + '尾巴标记',
      maxInputChars: 300,
      fetchImpl: jsonFetch({ choices: [{ message: { content: '好' } }] }, bodies),
    }));
    expect(bodies[0]).not.toContain('尾巴标记');
  });

  it('openai 没填 key 时退模板并提示', async () => {
    const result = await compose(baseOpts({ mode: 'openai' }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('密钥');
  });

  it('接口报 HTTP 错时退模板并带上状态码', async () => {
    const failing = (async () => ({ ok: false, status: 502, text: async () => 'bad gateway', json: async () => ({}) })) as unknown as typeof globalThis.fetch;
    const result = await compose(baseOpts({ mode: 'openai', apiKey: 'sk-test', fetchImpl: failing }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('502');
  });

  it('describeError 对非 Error 也给出字符串', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('raw')).toBe('raw');
  });
});

describe('配额闸与脱敏', () => {
  it('调用次数到上限就退模板:计价填 0 时这条是唯一还准的闸', async () => {
    // 计价全 0 时 yuan 永远是 0,金额闸不会触发;次数闸必须兜住这条路。
    writeSpend(dir, { date: today, inTokens: 0, outTokens: 0, yuan: 0, calls: 3, blocked: 0, resets: 0 });
    let called = false;
    const result = await compose(baseOpts({
      mode: 'host',
      price: { inPerM: 0, outPerM: 0 },
      maxCallsPerDay: 3,
      cognition: { request: async () => { called = true; return { text: '不该被调用' }; } },
    }));
    expect(called).toBe(false);
    expect(result.source).toBe('template');
    expect(result.reason).toContain('调用已达上限');
  });

  it('token 总量到上限也退模板', async () => {
    writeSpend(dir, { date: today, inTokens: 60_000, outTokens: 0, yuan: 0.06, calls: 1, blocked: 0, resets: 0 });
    const result = await compose(baseOpts({ mode: 'host', maxTokensPerDay: 60_000 }));
    expect(result.source).toBe('template');
    expect(result.reason).toContain('token');
  });

  it('dailyBudgetYuan=0 表示不按金额限,只看次数与 token', async () => {
    const result = await compose(baseOpts({
      mode: 'host',
      dailyBudgetYuan: 0,
      cognition: { request: async () => ({ text: '照样能说' }) },
    }));
    expect(result.source).toBe('host');
    expect(result.text).toBe('照样能说');
  });

  it('账本里的清零次数会被读回来,用于限制绕过', () => {
    writeSpend(dir, { date: today, inTokens: 0, outTokens: 0, yuan: 0, calls: 0, blocked: 0, resets: 2 });
    expect(readSpend(dir, today).resets).toBe(2);
  });

  it('接口回显里带密钥时 reason 会被脱敏', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      text: async () => 'bad key: Bearer sk-abcdefgh12345678 与 token=deadbeefdeadbeef',
      json: async () => ({}),
    })) as unknown as typeof globalThis.fetch;
    const result = await compose(baseOpts({
      mode: 'openai',
      apiKey: 'sk-abcdefgh12345678',
      fetchImpl,
    }));
    expect(result.source).toBe('template');
    expect(result.reason).not.toContain('abcdefgh12345678');
    expect(result.reason).toContain('***');
    expect(result.reason).toContain('401');
  });
});
