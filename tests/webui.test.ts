/** 世界页的配置分页:快速开始 + 四页表单,声明、数据面与浏览器 bundle。 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WT_CONFIG_GROUPS, WT_DEFAULTS, WT_FIELD_UI, WT_PANELS, configGroupCoverage } from '../src/config.ts';
import { WtWorld } from '../src/world.ts';

const DIST = new URL('../dist/webui.js', import.meta.url);

function rig(patch: Partial<typeof WT_DEFAULTS> = {}): WtWorld {
  return new WtWorld({
    cfg: { ...WT_DEFAULTS, ...patch },
    timezone: 'Asia/Shanghai',
    dataDir: mkdtempSync(join(tmpdir(), 'wt-webui-')),
    now: () => Date.UTC(2026, 10, 2, 6, 0, 0),
  });
}

/** 页签顺序:快速开始在最左,后面四页与四个配置组一一对应。 */
const PANEL_IDS = ['start', 'broadcast', 'query', 'kb', 'model'];
const FORM_IDS = ['broadcast', 'query', 'kb', 'model'];

describe('世界页的五个分页', () => {
  it('每页一个 tab,快速开始排在最前', () => {
    expect(WT_PANELS.map((panel) => panel.id)).toEqual(PANEL_IDS);
    expect(WT_CONFIG_GROUPS.length).toBe(4);
    for (const panel of WT_PANELS) {
      expect(panel.id).toMatch(/^[a-z0-9-]+$/);
      expect(panel.title.length).toBeGreaterThan(0);
      expect(panel.description && panel.description.length).toBeGreaterThan(0);
    }
    expect(WT_PANELS.slice(1).map((panel) => panel.title)).toEqual(WT_CONFIG_GROUPS.map((group) => group.schema.title));
  });

  it('快速开始不带表单,只回四行现况', async () => {
    const world = rig({ playerName: 'Ace' });
    const reply = (await world.invoke('start', 'fields', ['start'])) as {
      group: { id: string; title: string; description: string };
      fields: Array<{ value: unknown }>;
    };
    expect(reply.group.id).toBe('world:wt.start');
    expect(reply.group.title).toBe('快速开始');
    expect(reply.fields).toHaveLength(4);
    for (const field of reply.fields) expect(typeof field.value).toBe('string');
    expect(reply.fields.map((field) => String(field.value)).join(' ')).toContain('Ace');
  });

  it('数据面按页返回该组的全部字段、当前值与控件形态', async () => {
    const world = rig({ pollMs: 2500, playerName: 'Ace', kbMaxEntries: 5000 });
    const seen: string[] = [];
    for (const [index, panel] of WT_PANELS.slice(1).entries()) {
      const reply = (await world.invoke(panel.id, 'fields', [panel.id])) as {
        group: { id: string; title: string; description: string };
        fields: Array<{ path: string; prop: Record<string, unknown>; value: unknown; ui: string }>;
      };
      const group = WT_CONFIG_GROUPS[index]!;
      expect(reply.group.id).toBe(group.id);
      expect(reply.group.title).toBe(group.schema.title);
      expect(reply.group.description).toBe(group.schema.description);
      expect(reply.fields.map((field) => field.path).sort()).toEqual(Object.keys(group.schema.properties).sort());
      for (const field of reply.fields) {
        expect(field.path.startsWith('worlds.wt.')).toBe(true);
        expect(field.prop).toBeTypeOf('object');
        expect(['string', 'number', 'boolean']).toContain(typeof field.value);
        expect(['switch', 'check', 'row']).toContain(field.ui);
        seen.push(field.path);
      }
    }
    expect(new Set(seen).size).toBe(seen.length);
    const query = (await world.invoke('query', 'fields', ['query'])) as {
      fields: Array<{ path: string; prop: Record<string, unknown>; value: unknown; ui: string }>;
    };
    const poll = query.fields.find((field) => field.path === 'worlds.wt.pollMs');
    expect(poll?.value).toBe(2500);
    expect(poll?.prop['x-scale']).toBe(1000);
    expect(poll?.prop['x-suffix']).toBe('秒');
    const player = query.fields.find((field) => field.path === 'worlds.wt.playerName');
    expect(player?.value).toBe('Ace');
    // 连接项排在 8111 总开关前面,总开关是滑块,逐项读取是勾选卡片。
    const order = query.fields.map((field) => field.path);
    expect(order.indexOf('worlds.wt.playerName')).toBeLessThan(order.indexOf('worlds.wt.readTelemetry'));
    expect(query.fields.find((field) => field.path === 'worlds.wt.readTelemetry')?.ui).toBe('switch');
    expect(query.fields.find((field) => field.path === 'worlds.wt.readMap')?.ui).toBe('check');
  });

  it('播报页把两个总闸放在最前,逐项播报压成勾选卡片', async () => {
    const world = rig();
    const reply = (await world.invoke('broadcast', 'fields', ['broadcast'])) as {
      fields: Array<{ path: string; ui: string }>;
    };
    expect(reply.fields.slice(0, 2).map((field) => field.path)).toEqual(['worlds.wt.autoBrief', 'worlds.wt.speechStyle']);
    expect(reply.fields[0]?.ui).toBe('switch');
    expect(reply.fields[1]?.ui).toBe('switch');
    const checks = reply.fields.filter((field) => field.ui === 'check').map((field) => field.path);
    expect(checks).toEqual([
      'worlds.wt.broadcastEntryExit',
      'worlds.wt.broadcastKills',
      'worlds.wt.broadcastDeaths',
      'worlds.wt.broadcastWarnings',
      'worlds.wt.broadcastHud',
      'worlds.wt.broadcastCommentary',
    ]);
  });

  it('控件形态表只提到真实存在的配置键', () => {
    const covered = new Set(configGroupCoverage().covered);
    for (const key of Object.keys(WT_FIELD_UI)) expect(covered.has('worlds.wt.' + key)).toBe(true);
  });

  it('四页合起来不重不漏地覆盖全部配置键', () => {
    const coverage = configGroupCoverage();
    expect(coverage.missing).toEqual([]);
    expect(new Set(coverage.covered).size).toBe(coverage.covered.length);
    expect(coverage.covered).not.toContain('worlds.wt.enabled');
  });

  it('交给「配置」tab 的只剩一个总闸,不重复四页的表单', () => {
    const decl = rig().webUi();
    expect(decl.config).toHaveLength(1);
    const only = decl.config![0]!;
    expect(only.id).toBe('world:wt');
    expect(Object.keys(only.schema.properties)).toEqual(['worlds.wt.enabled']);
    expect(decl.panels?.map((panel) => panel.id)).toEqual(PANEL_IDS);
  });

  it('数据面挂在页面声明上,宿主才认得出它', async () => {
    const world = rig();
    const decl = world.webUi();
    expect(typeof decl.invoke).toBe('function');
    const reply = (await decl.invoke!('kb', 'fields', ['kb'])) as { group: { id: string }; fields: unknown[] };
    expect(reply.group.id).toBe('world:wt.kb');
    expect(reply.fields.length).toBeGreaterThan(0);
    const probe = await decl.invoke!('start', 'probe', []);
    expect(typeof probe).toBe('string');
    expect(String(probe).length).toBeGreaterThan(0);
  });

  it('不认识的面板与方法直接报错,不返回半截数据', async () => {
    const world = rig();
    await expect(world.invoke('model', 'nope', [])).rejects.toThrow(/未知的面板方法/);
    await expect(world.invoke('ghost', 'fields', ['ghost'])).rejects.toThrow(/没有这一页配置/);
  });

  it('浏览器 bundle 已构建且导出五个面板', async () => {
    expect(existsSync(DIST)).toBe(true);
    expect(statSync(DIST).size).toBeGreaterThan(500);
    const mod = (await import(DIST.href)) as {
      default: { panels: Record<string, { mount: unknown }> };
    };
    expect(Object.keys(mod.default.panels).sort()).toEqual([...PANEL_IDS].sort());
    for (const id of PANEL_IDS) expect(typeof mod.default.panels[id]?.mount).toBe('function');
    expect(FORM_IDS.every((id) => id in mod.default.panels)).toBe(true);
  });
});

describe('面板保存走世界自己的 persist', () => {
  function rigSave(patch: Partial<typeof WT_DEFAULTS> = {}) {
    const applied: Array<Record<string, unknown>> = [];
    const world = new WtWorld({
      cfg: { ...WT_DEFAULTS, ...patch },
      timezone: 'Asia/Shanghai',
      dataDir: mkdtempSync(join(tmpdir(), 'wt-webui-save-')),
      now: () => Date.UTC(2026, 10, 2, 6, 0, 0),
      persist: (next) => { applied.push(next); },
    });
    return { world, applied };
  }

  it('按页面所属组做白名单,写回不带前缀的短键', async () => {
    const { world, applied } = rigSave();
    const message = await world.invoke('kb', 'save', ['kb', { 'worlds.wt.kbAutoUpdateHours': 30 }]);
    expect(applied).toEqual([{ kbAutoUpdateHours: 30 }]);
    expect(String(message)).toContain('已保存');
  });

  it('跨组键与未知键被拒,且不写盘', async () => {
    const { world, applied } = rigSave();
    await expect(world.invoke('kb', 'save', ['kb', { 'worlds.wt.llmModel': 'x' }])).rejects.toThrow(/这一页不接受/);
    await expect(world.invoke('kb', 'save', ['kb', { 'worlds.wt.nope': 1 }])).rejects.toThrow(/这一页不接受/);
    expect(applied).toEqual([]);
  });

  it('类型与范围不符被拒', async () => {
    const { world, applied } = rigSave();
    await expect(world.invoke('query', 'save', ['query', { 'worlds.wt.pollMs': 30 }])).rejects.toThrow(/不得小于/);
    await expect(world.invoke('query', 'save', ['query', { 'worlds.wt.readMap': 'yes' }])).rejects.toThrow(/要布尔值/);
    expect(applied).toEqual([]);
  });

  it('运行环境没有 persist 时明确拒绝,不假装成功', async () => {
    const world = rig();
    await expect(world.invoke('model', 'save', ['model', { 'worlds.wt.llmModel': 'deepseek-chat' }])).rejects.toThrow(/不允许写配置/);
  });
});
