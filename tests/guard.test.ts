import { describe, it, expect } from 'vitest';
import {
  assertFetchableUrl,
  assertLocalHost,
  fetchGuarded,
  isLoopbackHost,
  isPrivateHost,
  normalizeHost,
  parseRegion,
  redactSecret,
  scrubUrl,
} from '../src/guard.ts';

describe('主机名的判定', () => {
  it('规范化去掉空白与方括号', () => {
    expect(normalizeHost('  127.0.0.1 ')).toBe('127.0.0.1');
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('LOCALHOST')).toBe('localhost');
  });

  it('只把 127.0.0.1 / localhost / ::1 当本机', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('遥测地址只放本机,别的一律抛错并说明回落', () => {
    expect(assertLocalHost('127.0.0.1')).toBe('127.0.0.1');
    expect(assertLocalHost('  ')).toBe('127.0.0.1');
    expect(assertLocalHost('localhost')).toBe('localhost');
    expect(() => assertLocalHost('192.168.1.5')).toThrow('已回落到 127.0.0.1');
    expect(() => assertLocalHost('10.0.0.1')).toThrow();
  });

  it('私网、链路本地与元数据都算私网', () => {
    for (const host of ['10.1.2.3', '172.20.0.1', '192.168.0.1', '127.0.0.1', '169.254.169.254', '0.0.0.0', '100.64.1.1', '::1', 'fd00::1', 'fe80::1', 'printer.local', 'db.internal', 'localhost']) {
      expect(isPrivateHost(host)).toBe(true);
    }
    for (const host of ['8.8.8.8', 'api.deepseek.com', 'raw.githubusercontent.com', '203.0.113.9']) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });
});

describe('知识库源地址的闸', () => {
  it('公网 https 直接放行', () => {
    expect(assertFetchableUrl('https://raw.githubusercontent.com/x/kb.json')).toBe('https://raw.githubusercontent.com/x/kb.json');
  });

  it('内网地址默认拒绝,显式打开 allowPrivate 才放行', () => {
    expect(() => assertFetchableUrl('http://127.0.0.1:8080/kb.json')).toThrow('内网');
    expect(assertFetchableUrl('http://127.0.0.1:8080/kb.json', { allowPrivate: true })).toBe('http://127.0.0.1:8080/kb.json');
  });

  it('云元数据地址任何时候都拒绝', () => {
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data/', { allowPrivate: true })).toThrow('云元数据');
    expect(() => assertFetchableUrl('http://metadata.google.internal/x')).toThrow('云元数据');
  });

  it('非 http(s)、带凭据、空地址都拒绝', () => {
    expect(() => assertFetchableUrl('file:///C:/secret.json')).toThrow('只支持 http');
    expect(() => assertFetchableUrl('https://user:pass@example.com/kb.json')).toThrow('用户名密码');
    expect(() => assertFetchableUrl('   ')).toThrow('空的');
    expect(() => assertFetchableUrl('not a url')).toThrow('不是合法地址');
  });

  it('scrubUrl 去掉凭据与查询串的值', () => {
    expect(scrubUrl('https://u:p@api.x.com/v1/chat?key=abc')).toBe('https://api.x.com/v1/chat?…');
    expect(scrubUrl('https://api.x.com/v1')).toBe('https://api.x.com/v1');
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl('乱写的')).toBe('乱写的');
  });
});

describe('脱敏', () => {
  it('sk- 前缀、Bearer、token=、超长串都会被抹掉', () => {
    const text = 'Bearer sk-abc123456789 token=deadbeefdeadbeef password: hunter2 ' + 'A'.repeat(40);
    const out = redactSecret(text);
    expect(out).not.toContain('abc123456789');
    expect(out).not.toContain('deadbeefdeadbeef');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('A'.repeat(40));
    expect(out).toContain('Bearer ***');
  });

  it('普通文本原样保留', () => {
    expect(redactSecret('接口返回 HTTP 502：upstream timeout')).toBe('接口返回 HTTP 502：upstream timeout');
  });
});

describe('OCR 区域参数', () => {
  it('合法值原样返回', () => {
    expect(parseRegion('10,20,300,400')).toEqual({ region: '10,20,300,400' });
    expect(parseRegion('  1,2,3,4 ')).toEqual({ region: '1,2,3,4' });
    expect(parseRegion('')).toEqual({ region: '' });
  });

  it('非法值给错误说明,不进进程', () => {
    expect(parseRegion('abc')).toHaveProperty('error');
    expect(parseRegion('1,2,3')).toHaveProperty('error');
    expect(parseRegion('-1,2,3,4')).toHaveProperty('error');
    expect(parseRegion('1,2,0,4')).toHaveProperty('error');
    expect(parseRegion('1,2,3,4; rm -rf /')).toHaveProperty('error');
  });
});

describe('私网与元数据的等价写法', () => {
  it('IPv4-mapped IPv6 的十六进制形式也认成私网', () => {
    // URL 会把 [::ffff:127.0.0.1] 规范成 [::ffff:7f00:1]，只认点分写法就有一条现成的绕过路线。
    expect(isPrivateHost('::ffff:7f00:1')).toBe(true);
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:a9fe:a9fe')).toBe(true);
    expect(() => assertFetchableUrl('http://[::ffff:127.0.0.1]/kb.json')).toThrow();
  });

  it('公网地址照旧放行', () => {
    expect(assertFetchableUrl('https://example.com/kb.json')).toBe('https://example.com/kb.json');
    expect(isPrivateHost('example.com')).toBe(false);
  });

  it('重定向到私网的那一跳会被拦住', async () => {
    const hops: string[] = [];
    const fake = (async (input: unknown) => {
      hops.push(String(input));
      return { ok: false, status: 302, headers: { get: () => 'http://127.0.0.1/kb.json' }, text: async () => '' };
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchGuarded('https://example.com/kb.json', { fetchImpl: fake })).rejects.toThrow('内网');
    expect(hops).toHaveLength(1);
  });
});
