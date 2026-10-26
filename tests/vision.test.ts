import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn as spawnChild } from 'node:child_process';
import { ensureVisionScript, extractVisionHints, probeVision, visionScriptPath } from '../src/vision.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wt-vision-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 假 spawn:按需写 OCR 文本文件,然后按给定退出码收尾。 */
function fakeSpawn(options: { text?: string | null; code?: number | null; stderr?: string; hang?: boolean }) {
  return (() => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    if (options.hang) return child;
    setTimeout(() => {
      if (typeof options.text === 'string') {
        const args = (child as unknown as { spawnargs?: string[] }).spawnargs;
        void args;
      }
      if (options.stderr) child.stderr.emit('data', options.stderr);
      child.emit('close', options.code ?? 0);
    }, 5);
    return child;
  }) as unknown as typeof spawnChild;
}

/** 会写文本文件的假 spawn:从参数里取 -TextOut 的路径。 */
function writingSpawn(text: string, code = 0, stderr = '') {
  return ((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      const at = args.indexOf('-TextOut');
      if (at >= 0 && args[at + 1]) writeFileSync(args[at + 1], text, 'utf8');
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', code);
    }, 5);
    return child;
  }) as unknown as typeof spawnChild;
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
    expect(script).toContain('Windows.Media.Ocr');
    expect(script).toContain('CopyFromScreen');
    for (const ch of script) expect(ch.charCodeAt(0)).toBeLessThan(128);
  });
});

describe('探测', () => {
  it('成功时返回识别行数与文本', async () => {
    const result = await probeVision({ dataDir: dir, spawnImpl: writingSpawn('击毁 T-34\n胜利', 0) });
    expect(result.ok).toBe(true);
    expect(result.lines).toBe(2);
    expect(result.text).toContain('击毁 T-34');
    expect(result.pngPath.endsWith('vision-last.png')).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('非零退出码时给出失败原因,不抛异常', async () => {
    const result = await probeVision({ dataDir: dir, spawnImpl: writingSpawn('', 1, 'Access denied') });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('截图或 OCR 失败');
    expect(result.error).toContain('Access denied');
  });

  it('进程不退出时按超时收尾', async () => {
    const result = await probeVision({ dataDir: dir, timeoutMs: 40, spawnImpl: fakeSpawn({ hang: true }) });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('识别文本为空时 ok 仍为真但行数为 0', async () => {
    const result = await probeVision({ dataDir: dir, spawnImpl: writingSpawn('   \n  ', 0) });
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
