/**
 * 出网闸、脱敏与入参校验。
 *
 * 这个 World 有两条外部输入:面板里填的遥测地址与知识库源,以及模型能调用的工具参数。
 * 前者决定请求打到哪,后者决定屏幕 OCR 与日志文本长什么样。两条都从这里过一遍:
 * 遥测只允许本机(官方 8111 只监听 127.0.0.1),知识库源默认只允许公网 http(s),
 * 错误文本与地址在进回执前统一脱敏,避免密钥被写进对话。
 */

import { lookup } from 'node:dns/promises';

/** 本机遥测允许的主机名;别的值一律降级成 127.0.0.1。 */
const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1'];

/** 云元数据与链路本地地址一律拒绝,不管 allowPrivate 怎么设。 */
const METADATA_HOSTS: readonly string[] = ['169.254.169.254', 'metadata.google.internal', 'metadata', '100.100.100.200'];

const PRIVATE_SUFFIXES: readonly string[] = ['.local', '.internal', '.lan', '.home', '.localhost', '.localdomain', '.intranet'];

/** 规范化主机:去空白、去方括号、小写。 */
export function normalizeHost(raw: string): string {
  return raw.trim().replace(/^\[|\]$/g, '').toLowerCase();
}

/** 是不是回环主机。 */
export function isLoopbackHost(raw: string): boolean {
  const host = normalizeHost(raw);
  return LOCAL_HOSTS.includes(host);
}

/**
 * 遥测地址只允许本机。
 *
 * 不是本机就抛错,由调用方决定降级:遥测只在本机,配错了要让人看见,不能偷偷连别处。
 */
export function assertLocalHost(raw: string): string {
  const host = normalizeHost(raw);
  if (!host) return '127.0.0.1';
  if (isLoopbackHost(host)) return host === '[::1]' ? '::1' : host;
  throw new Error('遥测地址只能是本机(' + LOCAL_HOSTS.join('/') + '),现在填的是 ' + host + ';已回落到 127.0.0.1');
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const a = nums[0] as number;
  const b = nums[1] as number;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * 把 `::ffff:7f00:1` 这种十六进制写法的 IPv4-mapped 地址还原成点分四段。
 *
 * URL 规范化会把 `[::ffff:127.0.0.1]` 改写成 `[::ffff:7f00:1]`，只认点分那一种
 * 就等于给了一条现成的绕过路线。
 */
function ipv4FromMappedHex(value: string): string | null {
  const matched = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (!matched) return null;
  const hi = Number.parseInt(matched[1] as string, 16);
  const lo = Number.parseInt(matched[2] as string, 16);
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase();
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('::ffff:')) {
    const tail = value.slice(7);
    if (tail.includes('.')) return isPrivateIpv4(tail);
    const mapped = ipv4FromMappedHex(value);
    if (mapped) return isPrivateIpv4(mapped);
    return false;
  }
  return false;
}

/** 私网 / 回环 / 链路本地 / 元数据,都算不该被模型的工具请求打到的地方。 */
export function isPrivateHost(raw: string): boolean {
  const host = normalizeHost(raw);
  if (!host) return true;
  if (host === 'localhost') return true;
  if (METADATA_HOSTS.includes(host)) return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  if (isPrivateIpv4(host)) return true;
  return false;
}

/**
 * 校验一个可以被 fetch 的地址。
 *
 * 规则:必须 http(s);不许带用户名密码(会把凭据发出去);默认不许私网与云元数据,
 * 想连本机自建服务得显式打开 allowPrivate。
 */
export function assertFetchableUrl(raw: string, opts: { allowPrivate?: boolean } = {}): string {
  const text = raw.trim();
  if (!text) throw new Error('地址是空的');
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error('不是合法地址:' + text.slice(0, 80));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http 与 https,现在是 ' + parsed.protocol);
  }
  if (parsed.username || parsed.password) throw new Error('地址里不要带用户名密码');
  const host = normalizeHost(parsed.hostname);
  if (METADATA_HOSTS.includes(host)) throw new Error('拒绝访问云元数据地址:' + host);
  if (!opts.allowPrivate && isPrivateHost(host)) {
    throw new Error('拒绝访问内网地址 ' + host + ';确实要连本机服务,把 worlds.wt.kbAllowPrivate 打开');
  }
  return parsed.toString();
}

const MAX_REDIRECTS = 5;

/** 主机是不是 IP 字面量(v4 / v6)。 */
function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

/**
 * 域名解析出来的地址里有没有私网。
 *
 * 只看字面量不够：`kb.example.com` 完全可以解析到 127.0.0.1 或 169.254.169.254，
 * 那时"主机名不是私网"这条判断就是假的。解析失败不阻断（实际连接多半也失败），
 * 但只要有一个 A/AAAA 落在私网就拒绝。
 */
export async function resolvesToPrivate(host: string): Promise<boolean> {
  const name = normalizeHost(host);
  if (!name || isIpLiteral(name)) return false;
  try {
    const list = await lookup(name, { all: true });
    return list.some((item) => (item.family === 6 ? isPrivateIpv6(normalizeHost(item.address)) : isPrivateIpv4(item.address)));
  } catch {
    return false;
  }
}

export interface FetchGuardedOptions {
  allowPrivate?: boolean;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * 带闸门的 fetch：每一跳重定向都重新校验目标。
 *
 * 只校验入口地址是不够的——公网地址 302 到 127.0.0.1 就绕过了所有检查。
 */
export async function fetchGuarded(raw: string, opts: FetchGuardedOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = assertFetchableUrl(current, { allowPrivate: opts.allowPrivate });
    const host = normalizeHost(new URL(target).hostname);
    if (!opts.allowPrivate && (await resolvesToPrivate(host))) {
      throw new Error('拒绝访问 ' + host + ':这个域名解析到内网地址');
    }
    const res = await fetchImpl(target, {
      method: 'GET',
      redirect: 'manual',
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    } as RequestInit);
    const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, target).toString();
      continue;
    }
    return res;
  }
  throw new Error('重定向次数超过 ' + MAX_REDIRECTS + ' 次,已停止');
}

/** 去掉地址里的凭据与查询串值,只留主机与路径,用于回执。 */
export function scrubUrl(raw: string): string {
  const text = (raw || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const query = parsed.search ? '?…' : '';
    return parsed.protocol + '//' + parsed.host + parsed.pathname + query;
  } catch {
    return text.slice(0, 80);
  }
}

/**
 * 把文本里像密钥的东西抹掉。
 *
 * 上游接口出错时会把请求体回显回来,里面可能带 Authorization;这些文本会进 reason、
 * 进而进 wt_status 回执与对话,所以统一在出口处脱敏。
 */
export function redactSecret(input: string): string {
  let out = input;
  out = out.replace(/(bearer\s+)[A-Za-z0-9._\-]{6,}/gi, '$1***');
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***');
  out = out.replace(/((?:api[_-]?key|access[_-]?token|token|secret|password|authorization)\s*[:=]\s*)["']?[A-Za-z0-9._\-]{6,}["']?/gi, '$1***');
  out = out.replace(/[A-Za-z0-9_-]{32,}/g, '***');
  return out;
}

/**
 * 解析 OCR 区域 "x,y,w,h"。
 *
 * 这个值模型能传,直接进 PowerShell 参数;虽然 spawn 是数组形式没有 shell 注入,
 * 但让非法值进进程只会白开一次 powershell,所以先在门口挡掉。
 */
export function parseRegion(raw: string): { region: string } | { error: string } {
  const text = (raw || '').trim();
  if (!text) return { region: '' };
  if (!/^\d{1,5},\d{1,5},\d{1,5},\d{1,5}$/.test(text)) {
    return { error: '区域要写成 x,y,w,h 四个非负整数,现在是 ' + text.slice(0, 40) };
  }
  const parts = text.split(',').map((part) => Number(part));
  const width = parts[2] as number;
  const height = parts[3] as number;
  if (width <= 0 || height <= 0) return { error: '区域的宽和高必须大于 0' };
  return { region: text };
}