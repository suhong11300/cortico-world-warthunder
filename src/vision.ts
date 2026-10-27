import { spawn as spawnChild } from 'node:child_process';
import { parseRegion } from './guard.ts';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 视觉降级通道:官方遥测不可用(游戏在另一台机器、端口被封、主机版)时,
 * 退成"截图 + 系统 OCR"，只做一次性探测,不做常驻轮询——OCR 误识率高,
 * 常驻会把噪声当成战况。
 *
 * 脚本用 PowerShell 5.1(Windows OCR 的 WinRT 类型字面量在 PS7 里加载不了),
 * 且全文保持 ASCII:5.1 按 GBK 解析含中文的 .ps1 会乱码。
 */

export const VISION_SCRIPT = "param(\r\n  [Parameter(Mandatory=$true)][string]$Out,\r\n  [Parameter(Mandatory=$true)][string]$TextOut,\r\n  [string]$Region = ''\r\n)\r\n$ErrorActionPreference = 'Stop'\r\nAdd-Type -AssemblyName System.Drawing\r\nAdd-Type -AssemblyName System.Windows.Forms\r\n\r\n$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds\r\n$full = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height\r\n$graphics = [System.Drawing.Graphics]::FromImage($full)\r\n$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)\r\n$graphics.Dispose()\r\n\r\n$target = $full\r\nif ($Region -ne '') {\r\n  $parts = $Region.Split(',')\r\n  if ($parts.Length -eq 4) {\r\n    $rx = [int]$parts[0]\r\n    $ry = [int]$parts[1]\r\n    $rw = [int]$parts[2]\r\n    $rh = [int]$parts[3]\r\n    if ($rw -gt 0 -and $rh -gt 0 -and ($rx + $rw) -le $full.Width -and ($ry + $rh) -le $full.Height) {\r\n      $target = New-Object System.Drawing.Bitmap $rw, $rh\r\n      $g2 = [System.Drawing.Graphics]::FromImage($target)\r\n      $srcRect = New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rh\r\n      $dstRect = New-Object System.Drawing.Rectangle 0, 0, $rw, $rh\r\n      $g2.DrawImage($full, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)\r\n      $g2.Dispose()\r\n    } else {\r\n      throw ('region out of screen bounds: ' + $Region + ' / screen ' + $full.Width + 'x' + $full.Height)\r\n    }\r\n  } else {\r\n    throw ('region must be x,y,w,h: ' + $Region)\r\n  }\r\n}\r\n$target.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)\r\n\r\nAdd-Type -AssemblyName System.Runtime.WindowsRuntime\r\n$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]\r\nfunction Await($op, $type) {\r\n  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))\r\n  $task.Wait(-1) | Out-Null\r\n  $task.Result\r\n}\r\n[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null\r\n[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null\r\n[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null\r\n\r\n$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Out)) ([Windows.Storage.StorageFile])\r\n$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])\r\n$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])\r\n$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])\r\n\r\n$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage('zh-Hans-CN')\r\nif ($engine -eq $null) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage('en-US') }\r\nif ($engine -eq $null) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }\r\nif ($engine -eq $null) { throw 'no OCR engine available' }\r\n\r\n$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])\r\n$lines = @()\r\nforeach ($line in $result.Lines) { $lines += $line.Text }\r\n$joined = [string]::Join(\"`n\", $lines)\r\n[System.IO.File]::WriteAllText($TextOut, $joined, (New-Object System.Text.UTF8Encoding($false)))\r\nWrite-Output ('VISION_OK ' + $lines.Count)\r\n";

export interface VisionProbeOptions {
  dataDir: string;
  /** "x,y,w,h";留空截整屏。 */
  region?: string;
  timeoutMs?: number;
  spawnImpl?: typeof spawnChild;
}

export interface VisionResult {
  ok: boolean;
  /** 截下来的 PNG 绝对路径。 */
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

  const script = ensureVisionScript(opts.dataDir);
  mkdirSync(runDir, { recursive: true });
  try {
    rmSync(textPath, { force: true });
  } catch {
    // 忽略。
  }

  const runner = opts.spawnImpl ?? spawnChild;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Out', pngPath, '-TextOut', textPath];
  // 第二道校验:即使调用方漏了,脏区域也不会进 PowerShell 参数。
  const parsedRegion = parseRegion(opts.region ?? '');
  if ('error' in parsedRegion) return { ...base, ms: 0, error: parsedRegion.error };
  const region = parsedRegion.region;
  if (region) args.push('-Region', region);

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = '';
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    };
    let child;
    try {
      child = runner('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 忽略。
      }
      finish(null);
    }, opts.timeoutMs ?? 20000);
    if (child.stderr) child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      stderr += error.message;
      finish(null);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      finish(code);
    });
  });

  const ms = Date.now() - started;
  if (outcome.code !== 0) {
    const detail = outcome.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 200);
    return { ...base, ms, error: '截图或 OCR 失败' + (detail ? '：' + detail : '') };
  }
  let text = '';
  try {
    if (existsSync(textPath)) text = readFileSync(textPath, 'utf8');
  } catch {
    text = '';
  }
  let lines = 0;
  for (const line of text.split(/\r?\n/)) if (line.trim()) lines += 1;
  return { ok: true, pngPath, runDir, text, lines, ms };
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
