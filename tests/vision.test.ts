import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn as spawnChild } from 'node:child_process';
import { ensureVisionScript, extractVisionHints, extractZoneHints, probeVision, stopVisionHost, visionScriptPath } from '../src/vision.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-vision-'));
});
afterEach(() => {
  stopVisionHost(dir);
  rmSync(dir, { recursive: true, force: true });
});

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  stdin: { write: (chunk: string) => boolean };
  kill: () => void;
}

/**
 * 假常驻进程:起来就报就绪,收到一条请求后写 OCR 文本并回一行结果。
 * 请求行格式 <id>|<savePath>|<textPath>|<region>。
 */
function hostSpawn(options: { text?: string; fail?: string; hang?: boolean } = {}) {
  const children: FakeChild[] = [];
  const spawnFn = (() => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    child.kill = () => {};
    child.stdin = {
      write: (chunk: string) => {
        const line = chunk.trim();
        if (options.hang || line === 'quit') return true;
        const parts = line.split('|');
        const id = parts[0];
        const textPath = parts[2] ?? '';
        setTimeout(() => {
          if (options.fail) {
            child.stdout.emit('data', 'VISION_ERR ' + id + ' ' + options.fail + '\n');
            return;
          }
          if (typeof options.text === 'string') writeFileSync(textPath, options.text, 'utf8');
          child.stdout.emit('data', 'VISION_OK ' + id + ' total=1 lines=0\n');
        }, 5);
        return true;
      },
    };
    setTimeout(() => child.stdout.emit('data', 'VISION_READY\n'), 1);
    children.push(child);
    return child;
  }) as unknown as typeof spawnChild;
  return { spawnFn, children };
}

describe('视觉脚本', () => {
  it('脚本路径落在数据目录的 wt 下', () => {
    expect(visionScriptPath(dir)).toBe(join(dir, 'wt', 'vision.ps1'));
  });

  it('脚本按需落盘,内容是 ASCII 且能跑 Windows OCR', () => {
    const target = ensureVisionScript(dir);
    expect(existsSync(target)).toBe(true);
    const script = readFileSync(target, 'utf8');
    expect(script).toContain('VISION_OK');
    expect(script).toContain('VISION_READY');
    expect(script).toContain('Windows.Media.Ocr');
    expect(script).toContain('CopyFromScreen');
    for (const ch of script) expect(ch.charCodeAt(0)).toBeLessThan(128);
  });
});

describe('探测', () => {
  it('成功时返回识别行数与文本', async () => {
    const fake = hostSpawn({ text: '击毁 T-34\n胜利' });
    const result = await probeVision({ dataDir: dir, spawnImpl: fake.spawnFn });
    expect(result.ok).toBe(true);
    expect(result.lines).toBe(2);
    expect(result.text).toContain('击毁 T-34');
    // 每次探测一个独占目录，避免并发时后一次把前一次的截图覆盖掉。
    expect(result.pngPath.endsWith('shot.png')).toBe(true);
    expect(result.runDir).toContain('vision-');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('默认不留截图,要留时才落盘', async () => {
    const plain = hostSpawn({ text: '击毁 T-34' });
    const without = await probeVision({ dataDir: dir, spawnImpl: plain.spawnFn });
    expect(without.ok).toBe(true);
    expect(existsSync(without.pngPath)).toBe(false);

    stopVisionHost(dir);
    const keep = hostSpawn({ text: '击毁 T-34' });
    const saved = await probeVision({ dataDir: dir, spawnImpl: keep.spawnFn, keepPng: true });
    expect(saved.ok).toBe(true);
  });

  it('同一数据目录复用常驻进程', async () => {
    const fake = hostSpawn({ text: '击毁 T-34' });
    await probeVision({ dataDir: dir, spawnImpl: fake.spawnFn });
    await probeVision({ dataDir: dir, spawnImpl: fake.spawnFn });
    expect(fake.children.length).toBe(1);
  });

  it('失败时给出原因,不抛异常', async () => {
    const fake = hostSpawn({ fail: 'Access denied' });
    const result = await probeVision({ dataDir: dir, spawnImpl: fake.spawnFn });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('截图或 OCR 失败');
    expect(result.error).toContain('Access denied');
  });

  it('进程不回应时按超时收尾', async () => {
    const fake = hostSpawn({ hang: true });
    const result = await probeVision({ dataDir: dir, timeoutMs: 40, spawnImpl: fake.spawnFn });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('识别文本为空时 ok 仍为真但行数为 0', async () => {
    const fake = hostSpawn({ text: '   \n  ' });
    const result = await probeVision({ dataDir: dir, spawnImpl: fake.spawnFn });
    expect(result.ok).toBe(true);
    expect(result.lines).toBe(0);
  });
});

describe('从 OCR 文本里挑线索', () => {
  it('击毁、被击毁、胜负、比分各归各类', () => {
    const hints = extractVisionHints(['你击毁了 T-34', '你的载具被击毁', '战斗结束 胜利', '比分 3 : 1'].join('\n'));
    expect(hints.map((hint) => hint.kind)).toEqual(['kill', 'death', 'result', 'score']);
  });

  it('被击毁优先判成 death,不会同时算 kill', () => {
    const hints = extractVisionHints('你的载具被击毁 by enemy');
    expect(hints.length).toBe(1);
    expect(hints[0].kind).toBe('death');
  });

  it('最多 12 条,无关行被丢掉', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) lines.push('击毁目标 ' + i);
    lines.push('这是一段无关的菜单文字');
    const hints = extractVisionHints(lines.join('\n'));
    expect(hints.length).toBe(12);
    expect(hints.every((hint) => hint.kind === 'kill')).toBe(true);
  });

  it('空文本返回空数组', () => {
    expect(extractVisionHints('')).toEqual([]);
  });
});

describe('占领线索只取画面里的占领行', () => {
  it('挑出占领与防守行，滤掉普通播报', () => {
    const text = ['占领 A 点 60%', '你击毁了 T-62', '敌方正在占领 C 点', '得分 1200', '据点已夺回'].join('\n');
    expect(extractZoneHints(text)).toEqual(['占领 A 点 60%', '敌方正在占领 C 点', '据点已夺回']);
  });

  it('去重、限流并丢弃过长行', () => {
    const long = '占领'.repeat(40);
    const text = ['占领 A 点', '占领 A 点', long, '防守 B 点'].join('\n');
    expect(extractZoneHints(text, 2)).toEqual(['占领 A 点', '防守 B 点']);
  });

  it('没有占领词就返回空数组', () => {
    expect(extractZoneHints('你击毁了 T-62\n得分 1200')).toEqual([]);
  });
});
