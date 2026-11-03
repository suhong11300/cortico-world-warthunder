/**
 * 世界页的配置分页:快速开始 / 播报 / 查询与读取 / 知识库 / 模型与花费。
 *
 * 宿主的「配置」页只保留世界总闸;字段按用途分在这里的五页 tab,
 * 写回走 invoke('save', [页名, 字段表]),由世界侧做键与类型白名单后落盘。
 *
 * 呈现密度按用途分三档:
 * - switch:两个播报总闸与 8111 总闸,一眼看到开没开;
 * - check:逐项播报与逐项读取压成一张勾选卡片,一栏内可多选也可少选;
 * - row:其余仍是一行一值,输入框即时回写。
 *
 * 样式自成一块(.wtpage 前缀)并挂在 document.head:挂在 ctx.root 里只有当前这页
 * 看得到,切页后新容器没有样式,实测会退回单列堆叠。
 *
 * 浏览器侧只允许 import type 框架:运行时零依赖,可被 esbuild 直接打成 dist/webui.js。
 */
import type { ConfigValue } from 'cortico/core/config-schema.ts';
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

/** 与 src/core/config-schema.ts 的 ConfigProperty 同形的子集。 */
interface Prop {
  type?: string;
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  enum?: string[];
  items?: { type?: string; minimum?: number; maximum?: number };
  nullable?: boolean;
  'x-scale'?: number;
  'x-suffix'?: string;
  'x-hot'?: boolean;
}

/** 一条字段:完整配置路径、声明、当前存储值与控件形态。 */
interface FieldView {
  path: string;
  prop: Prop;
  value: unknown;
  ui?: 'switch' | 'check' | 'row';
}

/** 服务端 invoke('fields', [panelId]) 的回执。 */
interface FieldsReply {
  group: { id: string; title: string; description?: string };
  fields: FieldView[];
}

interface PageDecl {
  id: string;
  title: string;
  /** 快速开始页没有表单,只显示现况与一个检查按钮。 */
  intro?: boolean;
}

const PAGES: readonly PageDecl[] = [
  { id: 'start', title: '快速开始', intro: true },
  { id: 'broadcast', title: '播报' },
  { id: 'query', title: '查询与读取' },
  { id: 'kb', title: '知识库' },
  { id: 'model', title: '模型与花费' },
];

/** 连续输入的提交去抖间隔,与宿主配置页一致。 */
const SAVE_MS = 400;

const STYLE = [
  '.wtpage .wthead { font-size: 18px; font-weight: 600; color: var(--ink); margin: 2px 0 6px; }',
  '.wtpage .wtsub { color: var(--ink-soft); font-size: 13px; line-height: 1.65; margin: 0 0 16px; }',
  '.wtpage .wtrow { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 6px 18px; align-items: start; padding: 13px 0; border-top: 1px solid var(--line); }',
  '.wtpage .wtrow.first { border-top: 0; }',
  '.wtpage .wtlabel { grid-column: 1; grid-row: 1 / span 2; font-size: 13.5px; color: var(--ink); padding-top: 6px; }',
  '.wtpage .wtctl { grid-column: 2; display: flex; align-items: center; gap: 8px; min-width: 0; }',
  '.wtpage .wtctl input.field, .wtpage .wtctl select.field { width: 100%; max-width: 360px; font-size: 13.5px; }',
  '.wtpage .wtunit { color: var(--ink-soft); font-size: 13px; white-space: nowrap; }',
  '.wtpage .wtdesc { grid-column: 2; color: var(--ink-soft); font-size: 12.5px; line-height: 1.65; }',
  '.wtpage .wtsw { position: relative; width: 46px; height: 26px; border-radius: 13px; border: 1px solid var(--line); background: color-mix(in srgb, var(--ink) 12%, transparent); cursor: pointer; padding: 0; flex: none; transition: background .16s ease; }',
  '.wtpage .wtsw.on { background: var(--accent, #12b886); border-color: transparent; }',
  '.wtpage .wtswknob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .16s ease; }',
  '.wtpage .wtsw.on .wtswknob { transform: translateX(20px); }',
  '.wtpage .wtswstate { font-size: 13px; color: var(--ink-soft); }',
  '.wtpage .wtsec { font-size: 13px; color: var(--ink-soft); margin: 16px 0 2px; }',
  '.wtpage .wtchecks { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }',
  '.wtpage .wtcheck { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 9px; background: transparent; cursor: pointer; font-size: 13.5px; color: var(--ink); text-align: left; }',
  '.wtpage .wtcheck.on { border-color: var(--accent, #12b886); background: color-mix(in srgb, var(--accent, #12b886) 10%, transparent); }',
  '.wtpage .wttick { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-size: 11px; color: transparent; flex: none; }',
  '.wtpage .wtcheck.on .wttick { background: var(--accent, #12b886); border-color: transparent; color: #fff; }',
  '.wtpage .wtstep { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 4px; color: var(--ink-soft); font-size: 13.5px; line-height: 1.95; }',
  '.wtpage .wtstepno { color: var(--ink); }',
  '.wtpage .wtstep:first-of-type { margin-top: 10px; }',
  '.wtpage .wtkv { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 6px 12px; font-size: 13.5px; margin: 6px 0 18px; }',
  '.wtpage .wtkvk { color: var(--ink-soft); }',
  '@media (max-width: 760px) { .wtpage .wtrow { grid-template-columns: 1fr; } .wtpage .wtlabel { grid-row: auto; padding-top: 0; } .wtpage .wtctl, .wtpage .wtdesc { grid-column: 1; } }',
].join('\n');

const styled = new WeakSet<Document>();

function ensureStyle(ctx: WebUiPanelContext): void {
  const doc = ctx.root.ownerDocument;
  if (styled.has(doc)) return;
  styled.add(doc);
  const node = doc.createElement('style');
  node.setAttribute('data-wt-panel-style', '');
  node.textContent = STYLE;
  (doc.head ?? doc.body ?? ctx.root).appendChild(node);
}

const errText = (error: unknown): string => String((error as Error)?.message ?? error);

interface Control {
  node: HTMLElement;
  /** 取存储单位的值(数字已乘回 x-scale)。 */
  read: () => ConfigValue;
}

/** 滑块:布尔直接开关;两值枚举(人格/模板)映射成开/关两档。 */
function makeSwitch(
  ctx: WebUiPanelContext,
  prop: Prop,
  value: unknown,
  onChange: () => void,
): Control {
  const doc = ctx.root.ownerDocument;
  const pairs = prop.type === 'string' && Array.isArray(prop.enum) && prop.enum.length === 2 ? prop.enum : null;
  const onText = pairs ? pairs[0]! : '开';
  const offText = pairs ? pairs[1]! : '关';
  let state = pairs ? String(value ?? onText) === onText : value === true;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'wtsw' + (state ? ' on' : '');
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', state ? 'true' : 'false');
  const knob = doc.createElement('span');
  knob.className = 'wtswknob';
  btn.appendChild(knob);
  const label = doc.createElement('span');
  label.className = 'wtswstate';
  const paint = (): void => {
    btn.className = 'wtsw' + (state ? ' on' : '');
    btn.setAttribute('aria-checked', state ? 'true' : 'false');
    label.textContent = state ? onText : offText;
  };
  btn.addEventListener('click', () => {
    state = !state;
    paint();
    onChange();
  });
  paint();
  const wrap = doc.createElement('span');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '10px';
  wrap.appendChild(btn);
  wrap.appendChild(label);
  return { node: wrap, read: () => (pairs ? (state ? onText : offText) : state) };
}

/** 按属性声明造控件。 */
/** 枚举值的中文标签：只改下拉里显示的字，提交的仍是原值。 */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  chatterLevel: { quiet: '安静', important: '重要', commentary: '详解' },
  textEncoding: { auto: '自动（先 UTF-8，失败改 GBK）', 'utf-8': 'UTF-8', gbk: 'GBK' },
  visionMode: { off: '关闭', probe: '按需截图' },
  broadcastLength: { full: '详细', key: '重点', brief: '简略', custom: '自定义' },
  chatTarget: { zh: '简体中文', en: '英文', ja: '日文', ru: '俄文' },
  chatSendMode: { off: '不落地', clipboard: '复制到剪贴板', confirm: '确认后输入', auto: '直接输入' },
  llmMode: { host: '宿主模型', openai: '兼容接口', off: '关闭，只用模板' },
  language: { zh: '中文', en: '英文' },
  speechStyle: { '人格': '人格（按桌宠口吻）', '模板': '模板（原样转述）' },
};

function enumOptions(key: string, values: readonly string[]): Array<{ value: string; label: string }> {
  const labels = ENUM_LABELS[key];
  return values.map((v) => ({ value: v, label: labels?.[v] ?? v }));
}

/** 画一行控件：布尔与枚举各有形态，其余按类型给输入框。 */
function makeControl(
  ctx: WebUiPanelContext,
  key: string,
  prop: Prop,
  value: unknown,
  onChange: () => void,
  asSwitch = false,
): Control {
  const ui = ctx.ui;
  // 只有服务端在 WT_FIELD_UI 里标了 switch 的才画滑块:zh/en 这类两值枚举用滑块看不出口径。
  if (asSwitch) return makeSwitch(ctx, prop, value, onChange);
  if (prop.type === 'boolean') return makeSwitch(ctx, prop, value, onChange);
  if (prop.type === 'string' && Array.isArray(prop.enum)) {
    const options = prop.enum;
    const first = options[0] ?? '';
    // select 的 onInput 绑的就是 change 事件(宿主 fields.ts:84),选项一换就回调。
    const sel = ui.select({ options: enumOptions(key, options), value: value == null ? first : String(value), onInput: onChange });
    return { node: sel, read: () => sel.value };
  }
  if (prop.type === 'string') {
    // 输入框要 onInput:宿主的 onChange 绑的是 change 事件,不点别处永远不回调。
    const inp = ui.input({ type: 'text', value: value == null ? '' : String(value), onInput: onChange, onCommit: onChange });
    return { node: inp, read: () => inp.value.trim() };
  }
  if (prop.type === 'integer' || prop.type === 'number') {
    const scale = prop['x-scale'] || 1;
    const inp = ui.input({ type: 'number', onInput: onChange, onCommit: onChange });
    if (prop.minimum != null) inp.min = String(prop.minimum / scale);
    if (prop.maximum != null) inp.max = String(prop.maximum / scale);
    if (prop.multipleOf != null) inp.step = String(prop.multipleOf / scale);
    inp.value = value == null ? '' : String(Number(value) / scale);
    return { node: inp, read: () => Number(inp.value) * scale };
  }
  return { node: ui.h('span', 'wtdesc', JSON.stringify(value) ?? ''), read: () => (value ?? null) as ConfigValue };
}

/** 勾选卡片:一栏内可多选也可少选。 */
function makeCheck(ctx: WebUiPanelContext, prop: Prop, value: unknown, onChange: () => void): Control {
  const doc = ctx.root.ownerDocument;
  let state = value === true;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'wtcheck' + (state ? ' on' : '');
  btn.setAttribute('role', 'checkbox');
  btn.setAttribute('aria-checked', state ? 'true' : 'false');
  const tick = doc.createElement('span');
  tick.className = 'wttick';
  tick.textContent = '\u2713';
  const text = doc.createElement('span');
  text.className = 'wtctext';
  text.textContent = prop.title || '未命名';
  btn.appendChild(tick);
  btn.appendChild(text);
  btn.addEventListener('click', () => {
    state = !state;
    btn.className = 'wtcheck' + (state ? ' on' : '');
    btn.setAttribute('aria-checked', state ? 'true' : 'false');
    onChange();
  });
  return { node: btn, read: () => state };
}

/** 把一页配置挂进 tab。 */
function mountPage(ctx: WebUiPanelContext, page: PageDecl): void {
  const { ui } = ctx;
  ensureStyle(ctx);
  const body = ui.h('div', 'wtpage');
  const note = ui.msgline('');
  ctx.root.appendChild(body);

  let fields: Array<{ path: string; read: () => ConfigValue }> = [];
  let snapshot = '';
  let pending: { dispose(): void } | null = null;

  const collect = (): Record<string, ConfigValue> => {
    const values: Record<string, ConfigValue> = {};
    for (const field of fields) values[field.path] = field.read();
    return values;
  };

  async function flush(): Promise<void> {
    const values = collect();
    const next = JSON.stringify(values);
    if (next === snapshot) return;
    try {
      // 走世界自己的数据面:服务端按页面所属组做键与类型白名单,再深合并进 worlds.wt。
      const message = await ctx.invoke<string>('save', [page.id, values]);
      snapshot = next;
      note.classList.remove('bad');
      note.textContent = typeof message === 'string' && message !== '' ? message : '已保存';
    } catch (error) {
      note.classList.add('bad');
      note.textContent = '保存失败：' + errText(error);
    }
  }

  function queue(): void {
    pending?.dispose();
    pending = ctx.timeout(() => {
      pending = null;
      void flush();
    }, SAVE_MS);
  }

  function render(reply: FieldsReply): void {
    body.replaceChildren();
    body.appendChild(ui.h('div', 'wthead', reply.group.title || page.title));
    if (reply.group.description) body.appendChild(ui.h('div', 'wtsub', reply.group.description));
    if (page.id === 'kb') {
      const bar = ui.h('div', 'wtctl');
      bar.style.margin = '0 0 10px';
      bar.appendChild(ui.button('立即更新知识库', {
        size: 'sm',
        variant: 'plain',
        onClick: () => {
          note.textContent = '正在更新知识库…';
          ctx
            .invoke<string>('kb-update', [])
            .then((text) => {
              note.classList.remove('bad');
              note.textContent = String(text);
            })
            .catch((error: unknown) => {
              note.classList.add('bad');
              note.textContent = '更新失败：' + errText(error);
            });
        },
      }));
      bar.appendChild(ui.h('span', 'wtswstate', '源可为 JSON、网页或 sitemap 地址。'));
      body.appendChild(bar);
    }
    fields = [];
    let first = true;
    let checks: FieldView[] = [];
    const byKey = new Map<string, Control>();

    const flushChecks = (): void => {
      if (checks.length === 0) return;
      const group = checks;
      checks = [];
      body.appendChild(ui.h('div', 'wtsec', '逐项开关'));
      const wrap = ui.h('div', 'wtchecks');
      for (const item of group) {
        const control = makeCheck(ctx, item.prop, item.value, queue);
        wrap.appendChild(control.node);
        fields.push({ path: item.path, read: control.read });
      }
      body.appendChild(wrap);
    };

    for (const item of reply.fields) {
      if (item.ui === 'check') {
        checks.push(item);
        continue;
      }
      flushChecks();
      const row = ui.h('div', first ? 'wtrow first' : 'wtrow');
      first = false;
      row.appendChild(ui.h('span', 'wtlabel', item.prop.title || item.path));
      const control = makeControl(ctx, item.path.replace('worlds.wt.', ''), item.prop, item.value, queue, item.ui === 'switch');
      byKey.set(item.path, control);
      const wrap = ui.h('div', 'wtctl');
      wrap.appendChild(control.node);
      if (item.prop['x-suffix'] && item.prop.type !== 'boolean') {
        wrap.appendChild(ui.h('span', 'wtunit', item.prop['x-suffix']));
      }
      row.appendChild(wrap);
      row.appendChild(ui.h('span', 'wtdesc', item.prop.description || ''));
      body.appendChild(row);
      fields.push({ path: item.path, read: control.read });
    }
    flushChecks();
    // 详略与字数两栏联动：换档时把字数栏写成该档的建议值，用户不用记 160/60 各属于哪档。
    const lengthCtl = byKey.get('worlds.wt.broadcastLength');
    const maxCtl = byKey.get('worlds.wt.broadcastMaxChars');
    if (lengthCtl && maxCtl) {
      lengthCtl.node.addEventListener('change', () => {
        const mode = String(lengthCtl.read());
        const suggest = mode === 'full' ? 0 : mode === 'brief' ? 60 : 160;
        (maxCtl.node as HTMLInputElement).value = String(suggest);
        queue();
      });
    }
    body.appendChild(note);
    if (fields.length === 0) body.appendChild(ui.placeholder('本页暂无可改配置。'));
    snapshot = JSON.stringify(collect());
  }

  function fail(error: unknown): void {
    body.replaceChildren(
      ui.h('div', 'wthead', page.title),
      ui.msgline('读取失败：' + errText(error), true),
      ui.placeholder('可重试，或查看世界运行日志。'),
    );
  }

  ctx.invoke<FieldsReply>('fields', [page.id]).then(render).catch(fail);
}

/** 快速开始:四条上手说明 + 现况 + 一个当场检查按钮,没有表单。 */
function mountIntro(ctx: WebUiPanelContext, page: PageDecl): void {
  const { ui } = ctx;
  ensureStyle(ctx);
  const body = ui.h('div', 'wtpage');
  ctx.root.appendChild(body);
  const probeLine = ui.msgline('');
  const btn = ui.button('检查连接', {
    size: 'sm',
    variant: 'plain',
    onClick: () => {
      probeLine.textContent = '正在连接 8111…';
      ctx
        .invoke<string>('probe', [])
        .then((text) => {
          probeLine.textContent = String(text);
        })
        .catch((error: unknown) => {
          probeLine.textContent = '检查失败：' + errText(error);
        });
    },
  });

  const STEPS = [
    '确认游戏内本地遥测已开启：浏览器打开 http://127.0.0.1:8111 能返回 JSON 即为开启。',
    '在「查询与读取」填写游戏昵称，须与游戏内完全一致（含中队标签）。',
    '询问「我现在在战局里吗」「上一局战绩如何」，插件按昵称从战果日志归因击毁与阵亡。',
    '需要自动播报时在「播报」开启；仅手动查询则保持关闭。',
  ];

  const paint = (description: string, rows: Array<[string, string]>): void => {
    body.replaceChildren();
    body.appendChild(ui.h('div', 'wthead', page.title));
    if (description) body.appendChild(ui.h('div', 'wtsub', description));
    STEPS.forEach((text, index) => {
      const line = ui.h('div', 'wtstep');
      line.appendChild(ui.h('span', 'wtstepno', String(index + 1) + '.'));
      line.appendChild(ui.h('span', '', text));
      body.appendChild(line);
    });
    if (rows.length > 0) {
      body.appendChild(ui.h('div', 'wtsec', '现况'));
      const kv = ui.h('div', 'wtkv');
      for (const [label, value] of rows) {
        kv.appendChild(ui.h('span', 'wtkvk', label));
        kv.appendChild(ui.h('span', '', value));
      }
      body.appendChild(kv);
    }
    body.appendChild(btn);
    body.appendChild(probeLine);
  };

  paint('', []);
  ctx
    .invoke<FieldsReply>('fields', ['start'])
    .then((reply) => {
      const rows = reply.fields.map((item): [string, string] => [String(item.prop.title ?? ''), String(item.value ?? '')]);
      paint(reply.group.description ?? '', rows);
    })
    .catch((error: unknown) => {
      paint('读不到现况:' + errText(error), []);
    });
}

const bundle = {
  panels: Object.fromEntries(
    PAGES.map((page) => [
      page.id,
      { mount: (ctx: WebUiPanelContext) => (page.intro ? mountIntro(ctx, page) : mountPage(ctx, page)) },
    ]),
  ),
};

export default bundle;
