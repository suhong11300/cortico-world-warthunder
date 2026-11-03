import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { parseRegion } from './guard.ts';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 视觉降级通道:官方遥测不可用(游戏在另一台机器、端口被封、主机版)时,
 * 退成"截图 + 系统 OCR"，只做一次性探测,不做常驻轮询——OCR 误识率高,
 * 常驻轮询会把噪声当成战况。
 *
 * 脚本用 PowerShell 5.1(Windows OCR 的 WinRT 类型字面量在 PS7 里加载不了),
 * 且全文保持 ASCII:5.1 按 GBK 解析含中文的 .ps1 会乱码。
 *
 * 进程模型:同一个数据目录共用一个常驻 PowerShell 进程。启动一次要付
 * Add-Type 与 OCR 引擎初始化的固定开销(实测约 2 秒),之后每次探测只付
 * 截图 + 识别(实测 150~270 毫秒)。像素从 GDI+ 位图直接交给 WinRT,
 * 不再走 PNG 编解码;需要留截图时按请求额外落盘。
 */

const CRLF = String.fromCharCode(13, 10);

const SCRIPT_LINES = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Drawing',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0]",
  'function Await($op, $type) {',
  '  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))',
  '  $task.Wait(-1) | Out-Null',
  '  $task.Result',
  '}',
  'function Flatten($e) {',
  '  $m = $e.Message',
  '  $i = $e.InnerException',
  '  $n = 0',
  '  while ($i -ne $null -and $n -lt 5) { $m = $m + " << " + $i.Message; $i = $i.InnerException; $n = $n + 1 }',
  '  return $m.Replace([string][char]13, " ").Replace([string][char]10, " ")',
  '}',
  '[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null',
  "$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage('zh-Hans-CN')",
  'if ($engine -eq $null) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }',
  "if ($engine -eq $null) { throw 'no OCR engine available' }",
  "[Console]::Out.WriteLine('VISION_READY')",
  '[Console]::Out.Flush()',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  $line = $line.Trim()',
  "  if ($line -eq '') { continue }",
  "  if ($line -eq 'quit') { break }",
  '  $parts = $line.Split([char]124)',
  '  if ($parts.Length -lt 4) {',
  "    [Console]::Out.WriteLine('VISION_ERR - bad request')",
  '    [Console]::Out.Flush()',
  '    continue',
  '  }',
  '  $id = $parts[0]',
  '  $savePath = $parts[1]',
  '  $textOut = $parts[2]',
  '  $region = $parts[3]',
  '  $full = $null',
  '  $target = $null',
  '  $bitmap = $null',
  '  $sw = [Diagnostics.Stopwatch]::StartNew()',
  '  try {',
  '    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
  '    $full = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
  '    $graphics = [System.Drawing.Graphics]::FromImage($full)',
  '    $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)',
  '    $graphics.Dispose()',
  '    $target = $full',
  "    if ($region -ne '') {",
  '      $rg = $region.Split([char]44)',
  "      if ($rg.Length -ne 4) { throw ('region must be x,y,w,h: ' + $region) }",
  '      $rx = [int]$rg[0]',
  '      $ry = [int]$rg[1]',
  '      $rw = [int]$rg[2]',
  '      $rh = [int]$rg[3]',
  '      if ($rw -le 0 -or $rh -le 0 -or ($rx + $rw) -gt $full.Width -or ($ry + $rh) -gt $full.Height) {',
  "        throw ('region out of screen bounds: ' + $region + ' / screen ' + $full.Width + 'x' + $full.Height)",
  '      }',
  '      $target = New-Object System.Drawing.Bitmap $rw, $rh',
  '      $g2 = [System.Drawing.Graphics]::FromImage($target)',
  '      $srcRect = New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rh',
  '      $dstRect = New-Object System.Drawing.Rectangle 0, 0, $rw, $rh',
  '      $g2.DrawImage($full, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)',
  '      $g2.Dispose()',
  '    }',
  '    $capture = $sw.ElapsedMilliseconds',
  "    if ($savePath -ne '') { $target.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png) }",
  '    $save = $sw.ElapsedMilliseconds',
  '    $w = $target.Width',
  '    $h = $target.Height',
  '    $w4 = $w * 4',
  '    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h',
  '    $data = $target.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
  '    $stride = $data.Stride',
  '    $bytes = New-Object byte[] ($w4 * $h)',
  '    if ($stride -eq $w4) {',
  '      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)',
  '    } else {',
  '      for ($y = 0; $y -lt $h; $y++) {',
  '        $src = [IntPtr]::Add($data.Scan0, $y * $stride)',
  '        [System.Runtime.InteropServices.Marshal]::Copy($src, $bytes, $y * $w4, $w4)',
  '      }',
  '    }',
  '    $target.UnlockBits($data)',
  '    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)',
  '    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, $w, $h, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)',
  '    $ready = $sw.ElapsedMilliseconds',
  '    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
  '    $ocr = $sw.ElapsedMilliseconds',
  "    $text = ''",
  '    $count = 0',
  '    foreach ($l in $result.Lines) {',
  '      $text = $text + $l.Text + [string][char]10',
  '      $count = $count + 1',
  '    }',
  '    [System.IO.File]::WriteAllText($textOut, $text, (New-Object System.Text.UTF8Encoding($false)))',
  '    $sw.Stop()',
  "    [Console]::Out.WriteLine('VISION_OK ' + $id + ' capture=' + $capture + ' save=' + ($save - $capture) + ' bitmap=' + ($ready - $save) + ' ocr=' + ($ocr - $ready) + ' total=' + $sw.ElapsedMilliseconds + ' lines=' + $count)",
  '  } catch {',
  "    [Console]::Out.WriteLine('VISION_ERR ' + $id + ' ' + (Flatten $_.Exception))",
  '  } finally {',
  '    if ($bitmap -ne $null) { $bitmap.Dispose() }',
  '    if ($target -ne $null -and [object]::ReferenceEquals($target, $full) -eq $false) { $target.Dispose() }',
  '    if ($full -ne $null) { $full.Dispose() }',
  '  }',
  '  [Console]::Out.Flush()',
  '}',
];

export const VISION_SCRIPT = SCRIPT_LINES.join(CRLF) + CRLF;

export interface VisionProbeOptions {
  dataDir: string;
  /** "x,y,w,h";留空截整屏。 */
  region?: string;
  timeoutMs?: number;
  /** 是否把整屏截图留成 PNG;默认不落盘,像素直接交给 OCR。 */
  keepPng?: boolean;
  spawnImpl?: typeof spawnChild;
}

export interface VisionResult {
  ok: boolean;
  /** 截图应落的位置;未保留截图(keepPng 为假)时这个文件不存在。 */
  pngPath: string;
  /**
   * 这一次探测独占的临时目录（截图与 OCR 文本都在里面）。
   *
   * 以前所有探测共用 wt/vision-last.*，并发时后一次会把前一次的截图覆盖掉，
   * 清理时就可能删错、或者谁都删不干净。每次一个目录，删的时候整棵删，OCR 文本也一起消失。
   */
  runDir: string;
  /** OCR 出来的纯文本,按行用 \n 连接。 */
  text: string;
  lines: number;
  ms: number;
  error?: string;
}

export interface VisionHint {
  kind: 'kill' | 'death' | 'result' | 'score';
  text: string;
}

/**
 * 删掉一次探测留下的全部东西：截图、OCR 文本、临时目录。
 *
 * 成功、失败、超时三条路都要走这里——OCR 失败时截图同样已经落在盘上，而整屏截图里
 * 可能有别的窗口内容；删图也不等于删掉识别结果，所以 OCR 文本一起删。
 * 只删自己产生的 wt/vision-* 目录，路径不像就拒绝，避免传错参数把用户文件删了。
 */
export function discardVisionRun(result: VisionResult): { removed: boolean; detail: string } {
  const target = result.runDir || '';
  if (!/[\\/]wt[\\/]vision-[a-z0-9]+-[a-z0-9]+$/.test(target)) {
    return { removed: false, detail: '路径不像本次探测的临时目录，没有删:' + target };
  }
  try {
    rmSync(target, { recursive: true, force: true });
    return { removed: true, detail: '已删除截图与 OCR 文本' };
  } catch (error) {
    return { removed: false, detail: '删除失败:' + (error instanceof Error ? error.message : String(error)) };
  }
}

const KILL_WORDS = ['击毁', '击落', '命中', 'destroyed', 'shot down', 'killed', 'hit'];
const DEATH_WORDS = ['被击毁', '被击落', '载具损毁', 'your vehicle', 'lost'];
const RESULT_WORDS = ['胜利', '失败', '战斗结束', 'victory', 'defeat', 'battle over'];

export function visionScriptPath(dataDir: string): string {
  return join(dataDir, 'wt', 'vision.ps1');
}

/** 脚本按需落盘;写完返回路径。 */
export function ensureVisionScript(dataDir: string): string {
  const target = visionScriptPath(dataDir);
  try {
    mkdirSync(join(dataDir, 'wt'), { recursive: true });
    writeFileSync(target, VISION_SCRIPT, 'utf8');
  } catch {
    // 写不进去就让调用方拿到原路径,执行时会报错。
  }
  return target;
}

/** 拉起常驻进程后等它报就绪的上限；冷启动实测约 2 秒。 */
const BOOT_TIMEOUT_MS = 30000;
/** 空闲这么久就收掉进程,避免长期占着一个 PowerShell。 */
const IDLE_TIMEOUT_MS = 120000;

interface HostWaiter {
  id: string;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
}

interface HostHandle {
  child: ChildProcess;
  tail: string;
  stderr: string;
  ready: boolean;
  booted: Promise<void>;
  settleBoot: (error?: Error) => void;
  waiter: HostWaiter | null;
  dead: boolean;
  seq: number;
  idleTimer: NodeJS.Timeout | null;
}

const hosts = new Map<string, HostHandle>();
let exitHooked = false;

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once('exit', () => stopVisionHost());
}

function failHost(handle: HostHandle, message: string): void {
  if (handle.dead) return;
  handle.dead = true;
  handle.settleBoot(new Error(message));
  const waiter = handle.waiter;
  handle.waiter = null;
  if (waiter) waiter.reject(new Error(message));
  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
    handle.idleTimer = null;
  }
  try {
    handle.child.kill();
  } catch {
    // 已经退出了。
  }
}

function onHostLine(handle: HostHandle, line: string): void {
  if (line === 'VISION_READY') {
    handle.ready = true;
    handle.settleBoot();
    return;
  }
  const waiter = handle.waiter;
  if (!waiter) return;
  if (line.startsWith('VISION_OK ' + waiter.id + ' ') || line === 'VISION_OK ' + waiter.id) {
    handle.waiter = null;
    waiter.resolve(line);
    return;
  }
  if (line.startsWith('VISION_ERR ' + waiter.id + ' ') || line === 'VISION_ERR ' + waiter.id) {
    handle.waiter = null;
    waiter.resolve(line);
  }
}

function spawnHost(key: string, runner: typeof spawnChild, script: string): HostHandle {
  const child = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let settle: (error?: Error) => void = () => {};
  const booted = new Promise<void>((resolve, reject) => {
    settle = (error?: Error) => {
      if (error) reject(error);
      else resolve();
    };
  });
  // 就绪前就失败时没人 await,先挂一个 handler 免得变成未处理拒绝。
  booted.catch(() => {});
  const handle: HostHandle = {
    child,
    tail: '',
    stderr: '',
    ready: false,
    booted,
    settleBoot: settle,
    waiter: null,
    dead: false,
    seq: 0,
    idleTimer: null,
  };
  if (!child.stdout || !child.stdin) {
    failHost(handle, '常驻进程没有可用的管道');
    hosts.set(key, handle);
    return handle;
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string | Buffer) => {
    handle.tail += String(chunk);
    let at = handle.tail.indexOf('\n');
    while (at >= 0) {
      const line = handle.tail.slice(0, at).trim();
      handle.tail = handle.tail.slice(at + 1);
      if (line) onHostLine(handle, line);
      at = handle.tail.indexOf('\n');
    }
  });
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string | Buffer) => {
      handle.stderr += String(chunk);
      if (handle.stderr.length > 4000) handle.stderr = handle.stderr.slice(-4000);
    });
  }
  child.on('error', (error: Error) => failHost(handle, error.message));
  child.on('close', (code: number | null) => failHost(handle, '进程退出 code=' + String(code)));
  hosts.set(key, handle);
  hookExit();
  return handle;
}

function hostFor(dataDir: string, runner: typeof spawnChild, script: string): HostHandle {
  const existing = hosts.get(dataDir);
  if (existing && !existing.dead) return existing;
  if (existing) hosts.delete(dataDir);
  return spawnHost(dataDir, runner, script);
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** 收掉常驻进程;不传 dataDir 就全收。 */
export function stopVisionHost(dataDir?: string): void {
  const keys = dataDir ? [dataDir] : Array.from(hosts.keys());
  for (const key of keys) {
    const handle = hosts.get(key);
    if (!handle) continue;
    hosts.delete(key);
    const wasDead = handle.dead;
    handle.dead = true;
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
    if (!wasDead) {
      try {
        handle.child.stdin?.write('quit\n');
      } catch {
        // 管道已断。
      }
      try {
        handle.child.kill();
      } catch {
        // 已经退出。
      }
    }
    handle.waiter = null;
  }
}

function armIdle(handle: HostHandle, key: string): void {
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  handle.idleTimer = setTimeout(() => {
    if (handle.waiter) {
      armIdle(handle, key);
      return;
    }
    stopVisionHost(key);
  }, IDLE_TIMEOUT_MS);
  handle.idleTimer.unref?.();
}

/** 起一个常驻进程备用;失败时静默,下次探测会重新拉起。 */
export function warmVisionHost(dataDir: string): void {
  if (process.platform !== 'win32') return;
  const existing = hosts.get(dataDir);
  if (existing && !existing.dead) return;
  if (existing) hosts.delete(dataDir);
  try {
    const script = ensureVisionScript(dataDir);
    const handle = spawnHost(dataDir, spawnChild, script);
    armIdle(handle, dataDir);
  } catch {
    // 起不来就算了,探测时还会再试一次。
  }
}

/** 跑一次截图 + OCR。失败一律不抛,包成 {ok:false, error}。 */
export async function probeVision(opts: VisionProbeOptions): Promise<VisionResult> {
  const started = Date.now();
  const runDir = join(opts.dataDir, 'wt', 'vision-' + started.toString(36) + '-' + Math.random().toString(36).slice(2, 8));
  const pngPath = join(runDir, 'shot.png');
  const textPath = join(runDir, 'ocr.txt');
  const base: VisionResult = { ok: false, pngPath, runDir, text: '', lines: 0, ms: 0 };

  if (process.platform !== 'win32') {
    return { ...base, error: '视觉通道用的是 Windows OCR,当前系统不支持', ms: Date.now() - started };
  }

  // 第二道校验:即使调用方漏了,脏区域也不会进 PowerShell 参数。
  const parsedRegion = parseRegion(opts.region ?? '');
  if ('error' in parsedRegion) return { ...base, ms: 0, error: parsedRegion.error };
  const region = parsedRegion.region;

  const script = ensureVisionScript(opts.dataDir);
  mkdirSync(runDir, { recursive: true });
  try {
    rmSync(textPath, { force: true });
  } catch {
    // 忽略。
  }

  const runner = opts.spawnImpl ?? spawnChild;
  const handle = hostFor(opts.dataDir, runner, script);
  const timeoutMs = opts.timeoutMs ?? 20000;
  const id = String((handle.seq += 1));
  const savePath = opts.keepPng === true ? pngPath : '';

  let line = '';
  try {
    await withTimeout(handle.booted, Math.min(BOOT_TIMEOUT_MS, timeoutMs), '常驻进程没有就绪');
    line = await withTimeout(
      new Promise<string>((resolve, reject) => {
        handle.waiter = { id, resolve, reject };
        try {
          handle.child.stdin?.write([id, savePath, textPath, region].join('|') + '\n');
        } catch (error) {
          handle.waiter = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
      timeoutMs,
      '等待 OCR 结果超时',
    );
  } catch (error) {
    const detail = handle.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 200);
    const reason = error instanceof Error ? error.message : String(error);
    // 进程状态已不可信:收掉,下次重建。
    stopVisionHost(opts.dataDir);
    return { ...base, ms: Date.now() - started, error: '截图或 OCR 失败：' + reason + (detail ? ' ' + detail : '') };
  }
  armIdle(handle, opts.dataDir);

  if (line.startsWith('VISION_ERR')) {
    const detail = line.slice('VISION_ERR'.length).trim().replace(/^\S+\s*/, '').slice(0, 300);
    const extra = handle.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 200);
    return {
      ...base,
      ms: Date.now() - started,
      error: '截图或 OCR 失败' + (detail ? '：' + detail : extra ? '：' + extra : ''),
    };
  }

  let text = '';
  try {
    if (existsSync(textPath)) text = readFileSync(textPath, 'utf8');
  } catch {
    text = '';
  }
  let lines = 0;
  for (const item of text.split(/\r?\n/)) if (item.trim()) lines += 1;
  return { ok: true, pngPath, runDir, text, lines, ms: Date.now() - started };
}

/** 占领相关词;8111 没有占领端点,只能从画面文字里找。 */
const ZONE_WORDS = ['占领', '据点', '防守', '夺回', '控制点', 'capture', 'captured', 'contested'];

/** 从 OCR 文本里挑出占领线索;只选含占领词的行,不推断进度。 */
export function extractZoneHints(text: string, limit = 4): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > 60) continue;
    const lower = line.toLowerCase();
    if (!ZONE_WORDS.some((word) => lower.includes(word))) continue;
    if (out.includes(line)) continue;
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

/** 从 OCR 文本里挑出战况线索;只做提示,不据此算战绩。 */
export function extractVisionHints(text: string): VisionHint[] {
  const hints: VisionHint[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (DEATH_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
      hints.push({ kind: 'death', text: line });
      continue;
    }
    if (RESULT_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
      hints.push({ kind: 'result', text: line });
      continue;
    }
    if (KILL_WORDS.some((word) => lower.includes(word.toLowerCase()))) {
      hints.push({ kind: 'kill', text: line });
      continue;
    }
    if (/\d+\s*[:：]\s*\d+/.test(line)) hints.push({ kind: 'score', text: line });
  }
  return hints.slice(0, 12);
}
