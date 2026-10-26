import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanOutgoing, copyToClipboard, ensureSendScript, parseSendOutput, sendScriptPath, sendToGame } from '../src/sendkey.ts';

type SpawnFn = typeof import('node:child_process').spawn;

function fakeSpawn(plan: { out?: string; err?: string; code?: number }) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const impl = ((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => undefined;
    calls.push({ cmd, args });
    setImmediate(() => {
      if (plan.out) stdout.emit('data', plan.out);
      if (plan.err) stderr.emit('data', plan.err);
      child.emit('close', plan.code ?? 0);
    });
    return child;
  }) as unknown as SpawnFn;
  return { impl, calls };
}

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-send-'));
  dirs.push(dir);
  return dir;
}

describe('发送文本的清洗', () => {
  it('去掉控制字符、压平换行、按上限截断', () => {
    expect(cleanOutgoing('  nice\u0000 shot\n\ngg  ', 80)).toBe('nice shot gg');
    expect(cleanOutgoing('a'.repeat(50), 10).length).toBe(10);
    expect(cleanOutgoing('   ', 10)).toBe('');
  });
});

describe('脚本输出解析', () => {
  it('SENT 与 DRYRUN 都算成功', () => {
    const sent = parseSendOutput('WINDOW 1234 aces.exe\nSENT 9');
    expect(sent.ok).toBe(true);
    expect(sent.sent).toBe(9);
    expect(sent.window).toBe('aces.exe');
    expect(parseSendOutput('DRYRUN 12').ok).toBe(true);
  });

  it('前台不是游戏时给出可读原因', () => {
    const bad = parseSendOutput('MISMATCH explorer.exe');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('不是游戏');
  });

  it('抢不到前台、没窗口、空文本、空输出各有说法', () => {
    expect(parseSendOutput('FOREGROUND_FAIL 88').error).toContain('抢不到');
    expect(parseSendOutput('NOWINDOW').error).toContain('没找到游戏窗口');
    expect(parseSendOutput('EMPTY_TEXT').error).toContain('空的');
    expect(parseSendOutput('').error).toContain('没有任何输出');
  });
});

describe('PowerShell 脚本', () => {
  it('落盘到 data/wt/sendkey.ps1 且是纯 ASCII', () => {
    const dir = scratch();
    const path = ensureSendScript(dir);
    expect(path).toBe(sendScriptPath(dir));
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('SendInput');
    expect(text).toContain('KEYEVENTF_UNICODE');
    expect(/^[\x00-\x7F]*$/.test(text)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('剪贴板落地', () => {
  it('Set-Clipboard 成功时返回 ok,并把 base64 传进命令行', async () => {
    const dir = scratch();
    const fake = fakeSpawn({ out: 'CLIP_OK' });
    const result = await copyToClipboard({ text: '打得好', spawnImpl: fake.impl });
    expect(result.ok).toBe(true);
    expect(fake.calls[0].cmd).toBe('powershell.exe');
    expect(fake.calls[0].args.join(' ')).toContain(Buffer.from('打得好', 'utf8').toString('base64'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('没有 CLIP_OK 就把 stderr 带回来', async () => {
    const fake = fakeSpawn({ err: 'boom', code: 1 });
    const result = await copyToClipboard({ text: 'gg', spawnImpl: fake.impl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('空文本不发命令', async () => {
    const fake = fakeSpawn({ out: 'CLIP_OK' });
    const result = await copyToClipboard({ text: '   ', spawnImpl: fake.impl });
    expect(result.ok).toBe(false);
    expect(fake.calls.length).toBe(0);
  });
});

describe('发言栏直写', () => {
  it('SENT 时返回 ok 与字符数', async () => {
    const dir = scratch();
    const fake = fakeSpawn({ out: 'WINDOW 42 aces.exe\nSENT 5' });
    const result = await sendToGame({ dataDir: dir, text: 'gg wp', spawnImpl: fake.impl });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(5);
    expect(fake.calls[0].args).toContain('-TextB64');
    rmSync(dir, { recursive: true, force: true });
  });

  it('前台不是游戏时不假装成功', async () => {
    const dir = scratch();
    const fake = fakeSpawn({ out: 'MISMATCH Code.exe', code: 2 });
    const result = await sendToGame({ dataDir: dir, text: 'gg', spawnImpl: fake.impl });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不是游戏');
    rmSync(dir, { recursive: true, force: true });
  });
});
