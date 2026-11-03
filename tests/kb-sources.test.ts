import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitKbSources, updateKbTransaction } from '../src/kb-update.ts';
import { fetchRemoteKb, isSitemapPayload, kbPath, loadKb, parseHtmlKb, parseSitemapLocs } from '../src/kb.ts';
import { ingestKbEntries } from '../src/kb-ingest.ts';
import { normalizeKbSource } from '../src/guard.ts';

// 本机 DNS 会把 *.example 劫持到 198.18.0.0/15（benchmark 保留段），闸门据此判成内网并拒绝。
// 这组用例测的是多源合并与本地整理共存，与 DNS 无关，所以把解析结果固定成公网地址。
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

const dirs: string[] = [];
const sandbox = (): string => { const dir = mkdtempSync(join(tmpdir(), 'wt-kb-src-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const good = { version: '9.9.9', entries: [{ id: 'x1', kind: 'vehicle', name: '测试车', summary: '夹具词条' }] };
const json = (status = 200): Response => new Response(JSON.stringify(good), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(routes: Record<string, () => Response>, seen: string[]): typeof globalThis.fetch {
  return (async (input: unknown) => {
    const url = String(input);
    seen.push(url);
    const make = routes[url];
    if (!make) throw new TypeError('fetch failed');
    return make();
  }) as unknown as typeof globalThis.fetch;
}

const options = (url: string, fetchImpl: typeof globalThis.fetch) => ({
  url, fetchedAt: new Date().toISOString(), isCurrent: () => true, fetchImpl, allowPrivate: false, timeoutMs: 2000,
});

describe('远程更新与本地整理共存', () => {
  it('远程更新保留 AI 整理入库的条目，同名以本地为准', async () => {
    const dataDir = sandbox();
    ingestKbEntries(dataDir, JSON.stringify([{ kind: 'vehicle', name: '测试车', summary: '本地整理的详细摘要，长度足够，用来确认远程更新后仍然保留。' }]), 'https://wiki.example/x');
    const fetchImpl = fakeFetch({ 'https://a.example/kb.json': json }, []);
    await updateKbTransaction(dataDir, options('https://a.example/kb.json', fetchImpl));
    const view = loadKb(dataDir);
    const same = view.entries.filter((entry) => entry.name === '测试车');
    expect(same.length).toBe(1);
    expect(same[0]!.summary).toContain('本地整理');
    expect(view.remoteVersion).toBe('9.9.9');
  });
});

describe('知识库多源解析', () => {
  it('逗号、中文逗号、分号与换行都能分隔，并去掉重复', () => {
    const raw = 'https://a.example/kb.json, https://b.example/kb.json\nhttps://a.example/kb.json；https://c.example/kb.json';
    expect(splitKbSources(raw)).toEqual(['https://a.example/kb.json', 'https://b.example/kb.json', 'https://c.example/kb.json']);
  });

  it('空白与空串给出空数组，不制造假源', () => {
    expect(splitKbSources('')).toEqual([]);
    expect(splitKbSources('  \n\t ， , ')).toEqual([]);
  });
});

describe('知识库多源更新', () => {
  it('第一个源 503 时落到第二个源，回执报出实际来源', async () => {
    const dataDir = sandbox();
    const seen: string[] = [];
    const fetchImpl = fakeFetch({ 'https://a.example/kb.json': () => json(503), 'https://b.example/kb.json': () => json() }, seen);
    const result = await updateKbTransaction(dataDir, options('https://a.example/kb.json,https://b.example/kb.json', fetchImpl));
    expect(seen).toEqual(['https://a.example/kb.json', 'https://b.example/kb.json']);
    expect(result.via).toBe('https://b.example/kb.json');
    const saved = JSON.parse(readFileSync(kbPath(dataDir), 'utf8')) as { version: string };
    expect(saved.version).toBe('9.9.9');
  });

  it('第一个源成功就不再请求后面的源', async () => {
    const dataDir = sandbox();
    const seen: string[] = [];
    const fetchImpl = fakeFetch({ 'https://a.example/kb.json': () => json() }, seen);
    const result = await updateKbTransaction(dataDir, options('https://a.example/kb.json,https://b.example/kb.json', fetchImpl));
    expect(seen).toEqual(['https://a.example/kb.json']);
    expect(result.via).toBe('https://a.example/kb.json');
  });

  it('所有源都不可用时把每个源的失败原因带出来，且不覆盖旧库', async () => {
    const dataDir = sandbox();
    const seen: string[] = [];
    const fetchImpl = fakeFetch({}, seen);
    await expect(updateKbTransaction(dataDir, options('https://a.example/kb.json,https://b.example/kb.json', fetchImpl)))
      .rejects.toThrow(/所有知识库源都不可用/);
    const message = await updateKbTransaction(dataDir, options('https://a.example/kb.json', fetchImpl)).catch((error: Error) => error.message);
    expect(String(message)).toContain('https://a.example/kb.json 失败');
    expect(String(message)).toContain('fetch failed');
  });
});

describe('网页也能当知识库源', () => {
  const page = [
    '<html><head><title>WT 战术笔记 &amp; 说明</title>',
    '<style>.x{color:red}</style><script>var a = 1;</script></head>',
    '<body><nav>菜单 首页 登录</nav>',
    '<h1>攻顶弹怎么打</h1>',
    '<p>攻顶弹从上方命中，适合对付顶装甲薄的车，遇到带格栅装甲的目标要先打掉附件。</p>',
    '<ul><li>街机模式里落点提示更明显，但对手也更会躲。</li>',
    '<li>历史模式需要自己算提前量，云层低时命中率会掉。</li></ul>',
    '<p>短</p>',
    '<footer>版权所有</footer></body></html>',
  ].join('');

  it('按段落切词条，剥掉脚本样式，解实体', () => {
    const kb = parseHtmlKb(page, 'https://example.org/notes/tactics');
    // 段落门槛 12 字:h1「攻顶弹怎么打」与 p「短」都被过滤,留下 1 个正文段 + 2 个列表项。
    expect(kb.entries.length).toBe(3);
    expect(kb.version.startsWith('web:example.org@')).toBe(true);
    const text = kb.entries.map((entry) => entry.summary).join('\n');
    expect(text).toContain('攻顶弹从上方命中');
    expect(text).toContain('街机模式里落点提示更明显');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var a = 1');
    expect(text).not.toContain('版权所有');
    const first = kb.entries[0]!;
    expect(first.name).toContain('WT 战术笔记 & 说明');
    expect(first.kind).toBe('concept');
    expect(first.tags).toContain('example.org');
  });

  it('同样的页面重复抓取得到同样的 id，合并时不会翻倍', () => {
    const a = parseHtmlKb(page, 'https://example.org/notes/tactics');
    const b = parseHtmlKb(page, 'https://example.org/notes/tactics');
    expect(a.entries.map((entry) => entry.id)).toEqual(b.entries.map((entry) => entry.id));
  });

  it('抓取时按 content-type 走网页分支', async () => {
    const seen: string[] = [];
    const fetchImpl = fakeFetch({
      'https://example.org/page': () => new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    }, seen);
    const kb = await fetchRemoteKb('https://example.org/page', { fetchImpl, allowPrivate: false, timeoutMs: 2000 });
    expect(seen).toEqual(['https://example.org/page']);
    expect(kb.entries.length).toBe(3);
    expect(kb.version.startsWith('web:')).toBe(true);
  });

  it('网页里没有可读段落时直接报错，不写空库', () => {
    expect(() => parseHtmlKb('<html><body><script>1</script></body></html>', 'https://e.org/x')).toThrow(/没有可读的段落/);
  });
});

describe('网页源:补协议、导航页与 sitemap', () => {
  it('裸域名补成 https,已带协议与空串保持原样', () => {
    expect(normalizeKbSource('wiki.warthunder.com')).toBe('https://wiki.warthunder.com');
    expect(normalizeKbSource('wiki.warthunder.com/ground')).toBe('https://wiki.warthunder.com/ground');
    expect(normalizeKbSource(' http://a.example/x ')).toBe('http://a.example/x');
    expect(normalizeKbSource('   ')).toBe('');
  });

  it('sitemap 的 loc 去重、只留 http(s)', () => {
    const xml = '<?xml version="1.0"?><urlset>'
      + '<url><loc>https://e.example/a</loc></url>'
      + '<url><loc> https://e.example/a </loc></url>'
      + '<url><loc>https://e.example/b</loc></url>'
      + '<url><loc>mailto:x@e.example</loc></url></urlset>';
    expect(parseSitemapLocs(xml)).toEqual(['https://e.example/a', 'https://e.example/b']);
  });

  it('按内容类型或首行识别 sitemap', () => {
    expect(isSitemapPayload('application/xml', '')).toBe(true);
    expect(isSitemapPayload('text/html', '<?xml version="1.0"?>')).toBe(true);
    expect(isSitemapPayload('text/html; charset=utf-8', '<html><body>')).toBe(false);
  });

  it('抓 sitemap 源时先补协议,再展开一层子图并逐页抽取', async () => {
    const seen: string[] = [];
    const html = (title: string, text: string) => '<html><head><title>' + title + '</title></head><body><p>' + text + '</p></body></html>';
    const fetchImpl = fakeFetch({
      'https://docs.example/sitemap-index.xml': () => new Response(
        '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://docs.example/sitemap-a.xml</loc></sitemap></sitemapindex>',
        { status: 200, headers: { 'content-type': 'application/xml' } }),
      'https://docs.example/sitemap-a.xml': () => new Response(
        '<?xml version="1.0"?><urlset><url><loc>https://docs.example/guide/intro</loc></url><url><loc>https://docs.example/guide/setup</loc></url></urlset>',
        { status: 200, headers: { 'content-type': 'application/xml' } }),
      'https://docs.example/guide/intro': () => new Response(html('Intro', '这是介绍页的正文段落,长度足够被抽成一条词条。'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      'https://docs.example/guide/setup': () => new Response(html('Setup', '这是安装页的正文段落,同样足够长用于抽取。'), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    }, seen);
    const kb = await fetchRemoteKb('docs.example/sitemap-index.xml', { fetchImpl, allowPrivate: false, timeoutMs: 5000, maxPages: 5 });
    expect(seen[0]).toBe('https://docs.example/sitemap-index.xml');
    expect(kb.version).toMatch(/^sitemap:docs\.example@2页\//);
    expect(kb.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('导航页只抽到菜单时明确报错,不把菜单写进词库', () => {
    const anchors = Array.from({ length: 120 }, (_, i) => '<a href="/m' + i + '">menu</a>').join('');
    const html = '<html><head><title>W</title></head><body>' + anchors + '<p>这一行是页脚说明文字。</p></body></html>';
    expect(() => parseHtmlKb(html, 'https://wiki.example/')).toThrow(/导航页/);
  });
});
