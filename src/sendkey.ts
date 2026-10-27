/**
 * 把文本送进《战争雷霆》的对局发言栏。
 *
 * 为什么是键盘事件:8111 只有只读端点(/state /indicators /hudmsg /map_obj.json /gamechat),
 * 没有任何"发送聊天"的接口。要真的发出去,只能让系统输入队列把按键交给游戏窗口。
 * 所以这里做三件事,且只做这三件:找游戏窗口 → 抢回前台 → 发 Enter + Unicode 字符 + Enter。
 *
 * 不读游戏内存、不 attach 进程、不注入 DLL、不发鼠标事件;代价是输入期间游戏处于前台,
 * 打字那几百毫秒里玩家自己按的键会一起进聊天框,所以默认关闭、并且要显式确认才发。
 */
import { spawn as spawnChild } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 落盘用的 PowerShell 5.1 脚本;纯 ASCII,中文正文走临时文件 + UTF8 读入。 */
export const SEND_SCRIPT = [
  "param(",
  "  [Parameter(Mandatory=$true)][string]$TextFile,",
  "  [int]$DelayMs = 180,",
  "  [string]$ProcessName = \"aces.exe\",",
  "  [switch]$DryRun",
  ")",
  "",
  "$ErrorActionPreference = \"Stop\"",
  "",
  "Add-Type -TypeDefinition @\"",
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "",
  "public static class WtKey {",
  "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
  "  [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
  "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
  "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
  "  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd);",
  "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);",
  "  [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);",
  "  [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
  "  [DllImport(\"user32.dll\", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);",
  "",
  "  [StructLayout(LayoutKind.Explicit, Size = 40)]",
  "  public struct INPUT {",
  "    [FieldOffset(0)] public int type;",
  "    [FieldOffset(8)] public ushort wVk;",
  "    [FieldOffset(10)] public ushort wScan;",
  "    [FieldOffset(12)] public uint dwFlags;",
  "    [FieldOffset(16)] public uint time;",
  "    [FieldOffset(24)] public IntPtr dwExtraInfo;",
  "  }",
  "",
  "  const uint KEYEVENTF_KEYUP = 0x0002;",
  "  const uint KEYEVENTF_UNICODE = 0x0004;",
  "  const int INPUT_KEYBOARD = 1;",
  "",
  "  public static void Key(ushort vk) {",
  "    INPUT down = new INPUT();",
  "    down.type = INPUT_KEYBOARD;",
  "    down.wVk = vk;",
  "    INPUT up = down;",
  "    up.dwFlags = KEYEVENTF_KEYUP;",
  "    INPUT[] both = new INPUT[] { down, up };",
  "    SendInput(2, both, Marshal.SizeOf(typeof(INPUT)));",
  "  }",
  "",
  "  public static void Char(char c) {",
  "    INPUT down = new INPUT();",
  "    down.type = INPUT_KEYBOARD;",
  "    down.wScan = c;",
  "    down.dwFlags = KEYEVENTF_UNICODE;",
  "    INPUT up = down;",
  "    up.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;",
  "    INPUT[] both = new INPUT[] { down, up };",
  "    SendInput(2, both, Marshal.SizeOf(typeof(INPUT)));",
  "  }",
  "",
  "  public static void Text(string s) {",
  "    foreach (char c in s) { Char(c); System.Threading.Thread.Sleep(8); }",
  "  }",
  "}",
  "\"@",
  "",
  "function Get-ForegroundInfo {",
  "  $h = [WtKey]::GetForegroundWindow()",
  "  $sb = New-Object System.Text.StringBuilder 512",
  "  [void][WtKey]::GetWindowText($h, $sb, 512)",
  "  $procId = 0",
  "  [void][WtKey]::GetWindowThreadProcessId($h, [ref]$procId)",
  "  $name = \"\"",
  "  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName + \".exe\" } catch { $name = \"?\" }",
  "  return [pscustomobject]@{ Hwnd = $h; Title = $sb.ToString(); Process = $name }",
  "}",
  "",
  "function Focus-Window([IntPtr]$hwnd) {",
  "  if ([WtKey]::IsIconic($hwnd)) { [void][WtKey]::ShowWindow($hwnd, 9) }",
  "  [void][WtKey]::ShowWindow($hwnd, 5)",
  "  [void][WtKey]::SetForegroundWindow($hwnd)",
  "  Start-Sleep -Milliseconds 120",
  "  if ([WtKey]::GetForegroundWindow() -eq $hwnd) { return $true }",
  "  # foreground lock: attach our input queue to the current foreground thread and retry",
  "  $fg = [WtKey]::GetForegroundWindow()",
  "  $fgPid = 0",
  "  # AttachThreadInput wants a THREAD id. GetWindowThreadProcessId returns it and only fills the pid by ref.",
  "  $fgTid = [WtKey]::GetWindowThreadProcessId($fg, [ref]$fgPid)",
  "  $mine = [WtKey]::GetCurrentThreadId()",
  "  $attached = $false",
  "  if ($fgTid -ne 0) { $attached = [WtKey]::AttachThreadInput($mine, $fgTid, $true) }",
  "  [void][WtKey]::SetForegroundWindow($hwnd)",
  "  Start-Sleep -Milliseconds 150",
  "  if ($attached) { [void][WtKey]::AttachThreadInput($mine, $fgTid, $false) }",
  "  return ([WtKey]::GetForegroundWindow() -eq $hwnd)",
  "}",
  "",
  "try {",
  "  # Text comes from a file: command-line arguments are visible to other processes.",
  "  $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)",
  "} catch {",
  "  Write-Output \"BAD_TEXT\"",
  "  exit 4",
  "}",
  "",
  "if ($text.Length -lt 1) { Write-Output \"EMPTY_TEXT\"; exit 4 }",
  "",
  "$fg = Get-ForegroundInfo",
  "$isTarget = ($fg.Process -ieq $ProcessName)",
  "if ($isTarget) {",
  "  $target = $fg.Hwnd",
  "} else {",
  "  $proc = Get-Process | Where-Object { $_.ProcessName -ieq [System.IO.Path]::GetFileNameWithoutExtension($ProcessName) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
  "  if (-not $proc) { Write-Output \"NOWINDOW\"; exit 3 }",
  "  $target = $proc.MainWindowHandle",
  "  if (-not (Focus-Window $target)) { Write-Output (\"FOREGROUND_FAIL \" + [int64]$target); exit 3 }",
  "}",
  "",
  "$tg = Get-ForegroundInfo",
  "Write-Output (\"WINDOW \" + [int64]$tg.Hwnd + \" \" + $tg.Process)",
  "if (-not ($tg.Process -ieq $ProcessName)) { Write-Output (\"MISMATCH \" + $tg.Process); exit 2 }",
  "if ($DryRun) { Write-Output (\"DRYRUN \" + $text.Length); exit 0 }",
  "",
  "[WtKey]::Key(0x0D)",
  "Start-Sleep -Milliseconds $DelayMs",
  "[WtKey]::Text($text)",
  "Start-Sleep -Milliseconds $DelayMs",
  "[WtKey]::Key(0x0D)",
  "Write-Output (\"SENT \" + $text.Length)",
  "exit 0",
  "",
].join('\n');

/** 脚本落在 <dataDir>/wt/sendkey.ps1；每次调用覆盖写，避免旧版本残留。 */
export function sendScriptPath(dataDir: string): string {
  return join(dataDir, 'wt', 'sendkey.ps1');
}

/** 待发文本的临时落点:发完即删,不进命令行也不长期留存。 */
export function outboxPath(dataDir: string): string {
  return join(dataDir, 'wt', 'outbox.txt');
}

export function ensureSendScript(dataDir: string): string {
  const path = sendScriptPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SEND_SCRIPT, "utf8");
  return path;
}

export interface SendToGameOptions {
  dataDir: string;
  text: string;
  delayMs?: number;
  processName?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  /** 测试注入用。 */
  spawnImpl?: typeof spawnChild;
}

export interface SendResult {
  ok: boolean;
  sent: number;
  window?: string;
  error?: string;
  raw: string;
}

/** 发出去之前先洗一遍：换行会把一句话拆成两条发出去，控制字符会被游戏吞掉。 */
export function cleanOutgoing(text: string, maxLength: number): string {
  return text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, maxLength));
}

/** 把脚本的几行输出解析成结果；脚本只输出 ASCII，所以不用担心代码页。 */
export function parseSendOutput(stdout: string): SendResult {
  const text = stdout.trim();
  const window = /WINDOW (\d+) (\S+)/.exec(text);
  const sent = /SENT (\d+)/.exec(text);
  const dry = /DRYRUN (\d+)/.exec(text);
  const mismatch = /MISMATCH (\S+)/.exec(text);
  const fail = /FOREGROUND_FAIL (\d+)/.exec(text);
  const base: SendResult = { ok: false, sent: 0, raw: text, ...(window ? { window: window[2] } : {}) };
  if (sent) return { ...base, ok: true, sent: Number(sent[1]) };
  if (dry) return { ...base, ok: true, sent: Number(dry[1]) };
  if (mismatch) return { ...base, error: '前台窗口是 ' + mismatch[1] + '，不是游戏，这次没发。' };
  if (fail) return { ...base, error: '抢不到游戏前台（被别的窗口占着），先手动切回游戏再试。' };
  if (text.includes('NOWINDOW')) return { ...base, error: '没找到游戏窗口，先把游戏开起来。' };
  if (text.includes('EMPTY_TEXT')) return { ...base, error: '要发的文本是空的。' };
  if (text.includes('BAD_TEXT')) return { ...base, error: '文本编码坏了，这次没发。' };
  return { ...base, error: text ? '发送脚本没给出结果：' + text.slice(0, 120) : '发送脚本没有任何输出。' };
}

/**
 * 把一段话发到对局发言栏。
 *
 * 时序是「Enter 打开输入框 → 逐字打 → Enter 发送」；游戏必须在前台，
 * 所以脚本会先抢前台。这段几百毫秒里游戏仍在跑，玩家自己按的键会一并进输入框。
 */
export async function sendToGame(opts: SendToGameOptions): Promise<SendResult> {
  const text = opts.text;
  if (!text.trim()) return { ok: false, sent: 0, error: '要发的文本是空的。', raw: '' };
  if (process.platform !== 'win32') return { ok: false, sent: 0, error: '写发言栏只支持 Windows。', raw: '' };
  let script: string;
  try {
    script = ensureSendScript(opts.dataDir);
  } catch (error) {
    return { ok: false, sent: 0, error: '发送脚本落盘失败：' + describeSendError(error), raw: '' };
  }
  const runner = opts.spawnImpl ?? spawnChild;
  // 文本先落成临时文件再让脚本读:放进命令行的话,同机任何进程都能从
  // Win32_Process.CommandLine 里读到这段聊天草稿。
  const outbox = outboxPath(opts.dataDir);
  try {
    mkdirSync(dirname(outbox), { recursive: true });
    writeFileSync(outbox, text, 'utf8');
  } catch (error) {
    return { ok: false, sent: 0, error: '写临时文本失败：' + describeSendError(error), raw: '' };
  }
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-TextFile',
    outbox,
    '-DelayMs',
    String(Math.max(60, Math.trunc(opts.delayMs ?? 180))),
    '-ProcessName',
    opts.processName ?? 'aces.exe',
    ...(opts.dryRun ? ['-DryRun'] : []),
  ];
  return await new Promise<SendResult>((resolve) => {
    const child = runner('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rmSync(outbox, { force: true }); } catch { /* 删不掉也不影响结果 */ }
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退出 */ }
      finish({ ok: false, sent: 0, error: '发送超时：游戏没响应或前台被占。', raw: out });
    }, Math.max(3000, opts.timeoutMs ?? 20000));
    timer.unref?.();
    child.stdout?.on("data", (chunk: unknown) => { out += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { err += String(chunk); });
    child.on("error", (error: unknown) => {
      finish({ ok: false, sent: 0, error: '起不了 PowerShell：' + describeSendError(error), raw: out });
    });
    child.on("close", (code: number | null) => {
      const parsed = parseSendOutput(out);
      if (parsed.ok) { finish(parsed); return; }
      const tail = err.trim().split("\n").slice(-2).join(" ");
      if (code !== 0 && tail) finish({ ...parsed, error: (parsed.error ?? '') + '（' + tail.slice(0, 160) + '）' });
      else finish(parsed);
    });
  });
}

function describeSendError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

/**
 * 把文本放进 Windows 剪贴板。
 *
 * 比键盘直写稳:不抢前台、不碰游戏输入、出错也只是没复制上。中文必须走
 * 文本走临时文件 + UTF8 读入再 Set-Clipboard,不要用 clip.exe(它按 OEM 代码页读,中文会变乱码),
 * 也不要把正文塞进 -Command 命令行(同机进程能看到)。
 */
export async function copyToClipboard(opts: {
  text: string;
  timeoutMs?: number;
  spawnImpl?: typeof spawnChild;
}): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: '剪贴板方案只支持 Windows。' };
  if (!opts.text.trim()) return { ok: false, error: '要复制的文本是空的。' };
  const dataFile = join(process.env.TEMP ?? '.', 'wt-clipboard-' + Date.now().toString(36) + '.txt');
  try {
    writeFileSync(dataFile, opts.text, 'utf8');
  } catch (error) {
    return { ok: false, error: '写临时文件失败：' + describeSendError(error) };
  }
  const quoted = dataFile.replace(/'/g, "''");
  const script = "$t=[System.IO.File]::ReadAllText('" + quoted + "', [System.Text.Encoding]::UTF8); Set-Clipboard -Value $t; Write-Output CLIP_OK";
  const runner = opts.spawnImpl ?? spawnChild;
  return await new Promise((resolve) => {
    const child = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rmSync(dataFile, { force: true }); } catch { /* 删不掉也不影响结果 */ }
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退出 */ }
      finish({ ok: false, error: '复制剪贴板超时。' });
    }, Math.max(2000, opts.timeoutMs ?? 8000));
    timer.unref?.();
    child.stdout?.on("data", (chunk: unknown) => { out += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { err += String(chunk); });
    child.on("error", (error: unknown) => {
      finish({ ok: false, error: '起不了 PowerShell：' + describeSendError(error) });
    });
    child.on("close", () => {
      if (out.includes("CLIP_OK")) { finish({ ok: true }); return; }
      const tail = err.trim().split("\n").slice(-2).join(" ");
      finish({ ok: false, error: tail ? 'Set-Clipboard 失败：' + tail.slice(0, 160) : '剪贴板没有回应。' });
    });
  });
}
