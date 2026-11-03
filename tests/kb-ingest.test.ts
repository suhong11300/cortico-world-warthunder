import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchKbMaterial, htmlSections, ingestKbEntries, normalizeIngestedEntry, parseEntriesPayload } from '../src/kb-ingest.ts';
import { loadKb } from '../src/kb.ts';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wt-ingest-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const PAGE = `<html><head><title>P-51D-30 - 百科</title></head><body>
<nav><a href="/">首页</a><a href="/a">载具</a><a href="/b">科技树</a></nav>
<h2>概述</h2>
<p>P-51D-30 是美系单发螺旋桨战斗机，低空加速好，适合能量战与掠袭打法。</p>
<ul><li>是的</li><li>这是列表项里的一条正经说明，长度超过二十四个字符以便保留下来。</li></ul>
<h2>空白的节</h2>
</body></html>`;

describe('网页素材按小标题分节', () => {
  it('保留正文、丢掉导航短句与空节', () => {
    const parsed = htmlSections(PAGE, 'fallback');
    expect(parsed.title).toContain('P-51D-30');
    expect(parsed.sections.length).toBe(1);
    expect(parsed.sections[0]!.heading).toBe('概述');
    expect(parsed.sections[0]!.text).toContain('低空加速好');
    expect(parsed.sections[0]!.text).toContain('列表项');
    expect(parsed.sections[0]!.text).not.toContain('是的');
  });

  it('没有标题时用页面标题兜底', () => {
    const parsed = htmlSections('<html><head><title>词条页</title></head><body><p>这里是一段足够长的正文，用来确认没有小标题也能成节。</p></body></html>');
    expect(parsed.sections[0]!.heading).toBe('词条页');
  });
});

describe('素材抓取端到端（假 fetch）', () => {
  it('返回可直接阅读的正文', async () => {
    const material = await fetchKbMaterial('https://example.com/tank', {
      fetchImpl: (async () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof globalThis.fetch,
    });
    expect(material.host).toBe('example.com');
    expect(material.text).toContain('## 概述');
    expect(material.text).toContain('P-51D-30');
    expect(material.truncated).toBe(false);
  });
});

describe('模型输出解析', () => {
  it('容忍 json 围栏与前后解释', () => {
    const raw = "整理好了：\n```json\n[{\"name\":\"虎式\",\"summary\":\"德系重型坦克，正面装甲厚。\",\"kind\":\"tank\"}]\n```\n以上。";
    const list = parseEntriesPayload(raw);
    expect(list.length).toBe(1);
  });

  it('接受单个对象与包了一层 entries 的对象', () => {
    expect(parseEntriesPayload('{"name":"a","summary":"bbbbbbbbbbbbbbbbbbbbbb","kind":"concept"}').length).toBe(1);
    expect(parseEntriesPayload({ entries: [{ name: 'a' }, { name: 'b' }] }).length).toBe(2);
  });
});

describe('词条规范化', () => {
  it('认别名类型、去 markdown 星号、生成稳定 id', () => {
    const entry = normalizeIngestedEntry({ kind: 'tank', name: '**虎式 H1**', summary: '德系重型坦克，正面装甲厚重，机动性一般。' });
    expect(entry?.kind).toBe('vehicle');
    expect(entry?.name).toBe('虎式 H1');
    expect(entry?.id.startsWith('ing-')).toBe(true);
    const again = normalizeIngestedEntry({ kind: 'vehicle', name: '虎式 H1', summary: '另一段不同的描述，用来确认 id 只跟名字与类型有关。' });
    expect(again?.id).toBe(entry?.id);
  });

  it('摘要过短或缺名字的丢弃', () => {
    expect(normalizeIngestedEntry({ kind: 'vehicle', name: '虎式', summary: '太短' })).toBeNull();
    expect(normalizeIngestedEntry({ kind: 'vehicle', summary: '没有名字但摘要足够长的一段描述。' })).toBeNull();
  });
});

describe('入库合并', () => {
  const payload = JSON.stringify([
    { kind: 'vehicle', name: '虎式 H1', summary: '德系重型坦克，正面装甲厚重，机动性一般，适合卡点。', br: '5.7', nation: '德系' },
    { kind: 'play', name: '能量战', summary: '用高度换速度反复掠袭的空中打法，强调保持能量优势。', tags: ['空战'] },
  ]);

  it('首次新增两条，重复整理只覆盖不重复', () => {
    const first = ingestKbEntries(dir, payload, 'https://example.com/a');
    expect(first.added).toBe(2);
    expect(first.replaced).toBe(0);
    expect(first.total).toBe(2);
    const second = ingestKbEntries(dir, payload, 'https://example.com/a');
    expect(second.added).toBe(0);
    expect(second.replaced).toBe(2);
    expect(second.total).toBe(2);
    const view = loadKb(dir);
    expect(view.remoteCount).toBe(2);
    expect(view.entries.some((entry) => entry.name === '虎式 H1')).toBe(true);
  });

  it('改名后的旧条目按类型与名字清掉', () => {
    ingestKbEntries(dir, JSON.stringify([{ kind: 'vehicle', name: '虎式 H1', summary: '德系重型坦克，正面装甲厚重，机动性一般。' }]), 'https://example.com/a');
    // 伪造一条历史 id 的旧条目，模拟旧版本生成的名字。
    const legacy = JSON.stringify([{ id: 'legacy-1', kind: 'vehicle', name: '虎式H1', summary: '旧版留下的同名条目，用来确认会被清理掉。' }]);
    ingestKbEntries(dir, legacy, 'https://example.com/a');
    const view = loadKb(dir);
    expect(view.entries.filter((entry) => entry.name.replace(/\s/g, '') === '虎式H1').length).toBe(1);
  });

  it('超过单次上限直接拒绝', () => {
    const many = JSON.stringify(Array.from({ length: 4 }, (_unused, index) => ({ kind: 'concept', name: '词条' + String(index), summary: '这是一段足够长的词条摘要，用来确认上限拦截生效。' })));
    expect(() => ingestKbEntries(dir, many, 'https://example.com/a', { maxEntries: 2 })).toThrow();
  });

  it('全部不合法时报出原因', () => {
    expect(() => ingestKbEntries(dir, '[{"kind":"vehicle","name":"A","summary":"短"}]', 'https://example.com/a')).toThrow();
  });
});
