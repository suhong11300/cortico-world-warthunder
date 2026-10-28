/** 额外更新工作集的估算准入预算，不是进程RSS硬限制，也不改变Node堆。 */
const MiB = 1024 * 1024;
export const KB_MAX_BYTES = 64 * MiB;
export const KB_MAX_ENTRIES = 100000;
export interface KbLimits { maxBytes: number; maxEntries: number; memoryBudgetBytes: number }
export type KbLimitInput = Partial<KbLimits>;
function bound(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.min(max, Math.max(1, Math.trunc(value!))) : fallback;
}
export function resolveKbLimits(input: KbLimitInput = {}): KbLimits {
  const memoryBudgetBytes = bound(input.memoryBudgetBytes, 512 * MiB, 2048 * MiB);
  return {
    maxBytes: Math.min(bound(input.maxBytes, KB_MAX_BYTES, 256 * MiB), Math.max(1, Math.floor(memoryBudgetBytes / 8))),
    maxEntries: bound(input.maxEntries, KB_MAX_ENTRIES, 500000), memoryBudgetBytes,
  };
}
export function checkKbBudget(bytes: number, entries: number, limits: KbLimits, structureBytes = 0): void {
  if (bytes > limits.maxBytes) throw new Error('知识库超过字节上限 ' + limits.maxBytes);
  if (entries > limits.maxEntries) throw new Error('知识库条目超过上限 ' + limits.maxEntries);
  // 包含响应/解码/解析/清洗/合并的保守估算；旧库与宿主原有内存另计。
  if (bytes * 6 + entries * 2048 + structureBytes > limits.memoryBudgetBytes) throw new Error('知识库超过额外更新内存估算预算 ' + limits.memoryBudgetBytes);
}

/** 分配对象树之前扫描结构；仍在有界文本上调用JSON.parse，不宣称流式JSON解析。 */
export function preflightKbJson(text: string, bytes: number, limits: KbLimits): void {
  checkKbBudget(bytes, 0, limits);
  let i = 0, values = 0, propertiesTotal = 0, entryCount = 0;
  const fail = (reason: string): never => { throw new Error('知识库JSON结构上限/格式错误：' + reason); };
  const space = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function string(key = false): string {
    const start = i++;
    while (i < text.length) {
      const c = text[i++]; if (c === '\\') i++;
      else if (c === '"') {
        if (i - start > (key ? 258 : 65538)) fail('字符串过长');
        return key ? JSON.parse(text.slice(start, i)) as string : '';
      }
      if (i - start > (key ? 258 : 65538)) fail('字符串过长');
    }
    return fail('字符串未结束');
  }
  function value(depth: number, entries = false): void {
    if (depth > 32 || ++values > limits.maxEntries * 64 + 4096) fail('嵌套或复杂度过高');
    if (values % 1024 === 0) checkKbBudget(bytes, entryCount, limits, (values + propertiesTotal) * 64);
    space(); const c = text[i];
    if (c === '"') { string(); return; }
    if (c === '{') {
      i++; space(); let properties = 0;
      if (text[i] === '}') { i++; return; }
      for (;;) {
        if (++properties > 64 || text[i] !== '"') fail('对象字段');
        propertiesTotal++;
        const key = string(true); space(); if (text[i++] !== ':') fail('缺少冒号');
        value(depth + 1, depth === 0 && key === 'entries'); space();
        const end = text[i++]; if (end === '}') break; if (end !== ',') fail('对象未结束'); space();
      }
      return;
    }
    if (c === '[') {
      i++; space(); let count = 0;
      if (text[i] === ']') { i++; return; }
      for (;;) {
        if (++count > (entries ? limits.maxEntries : 128)) fail('数组条目过多');
        value(depth + 1); space(); const end = text[i++]; if (end === ']') break; if (end !== ',') fail('数组未结束');
      }
      if (entries) entryCount += count;
      return;
    }
    const start = i;
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    if (i === start) fail('缺少值');
  }
  value(0); space(); if (i !== text.length) fail('多余内容');
  // 未知字段/数组/对象同样占内存，不能只数合法entries而放过小文件对象膨胀。
  checkKbBudget(bytes, entryCount, limits, (values + propertiesTotal) * 64);
}
