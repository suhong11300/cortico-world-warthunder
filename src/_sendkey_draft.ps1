param(
  [Parameter(Mandatory=$true)][string]$TextB64,
  [int]$DelayMs = 180,
  [string]$ProcessName = "aces.exe",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WtKey {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [StructLayout(LayoutKind.Explicit, Size = 40)]
  public struct INPUT {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public ushort wVk;
    [FieldOffset(10)] public ushort wScan;
    [FieldOffset(12)] public uint dwFlags;
    [FieldOffset(16)] public uint time;
    [FieldOffset(24)] public IntPtr dwExtraInfo;
  }

  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const int INPUT_KEYBOARD = 1;

  public static void Key(ushort vk) {
    INPUT down = new INPUT();
    down.type = INPUT_KEYBOARD;
    down.wVk = vk;
    INPUT up = down;
    up.dwFlags = KEYEVENTF_KEYUP;
    INPUT[] both = new INPUT[] { down, up };
    SendInput(2, both, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Char(char c) {
    INPUT down = new INPUT();
    down.type = INPUT_KEYBOARD;
    down.wScan = c;
    down.dwFlags = KEYEVENTF_UNICODE;
    INPUT up = down;
    up.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    INPUT[] both = new INPUT[] { down, up };
    SendInput(2, both, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Text(string s) {
    foreach (char c in s) { Char(c); System.Threading.Thread.Sleep(8); }
  }
}
"@

function Get-ForegroundInfo {
  $h = [WtKey]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][WtKey]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][WtKey]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ""
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName + ".exe" } catch { $name = "?" }
  return [pscustomobject]@{ Hwnd = $h; Title = $sb.ToString(); Process = $name }
}

function Focus-Window([IntPtr]$hwnd) {
  if ([WtKey]::IsIconic($hwnd)) { [void][WtKey]::ShowWindow($hwnd, 9) }
  [void][WtKey]::ShowWindow($hwnd, 5)
  [void][WtKey]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 120
  if ([WtKey]::GetForegroundWindow() -eq $hwnd) { return $true }
  # foreground lock: attach our input queue to the current foreground thread and retry
  $fg = [WtKey]::GetForegroundWindow()
  $fgPid = 0
  [void][WtKey]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $mine = [WtKey]::GetCurrentThreadId()
  $attached = $false
  if ($fgPid -ne 0) { $attached = [WtKey]::AttachThreadInput($mine, $fgPid, $true) }
  [void][WtKey]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 150
  if ($attached) { [void][WtKey]::AttachThreadInput($mine, $fgPid, $false) }
  return ([WtKey]::GetForegroundWindow() -eq $hwnd)
}

try {
  $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextB64))
} catch {
  Write-Output "BAD_TEXT"
  exit 4
}

if ($text.Length -lt 1) { Write-Output "EMPTY_TEXT"; exit 4 }

$fg = Get-ForegroundInfo
$isTarget = ($fg.Process -ieq $ProcessName)
if ($isTarget) {
  $target = $fg.Hwnd
} else {
  $proc = Get-Process | Where-Object { $_.ProcessName -ieq [System.IO.Path]::GetFileNameWithoutExtension($ProcessName) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { Write-Output "NOWINDOW"; exit 3 }
  $target = $proc.MainWindowHandle
  if (-not (Focus-Window $target)) { Write-Output ("FOREGROUND_FAIL " + [int64]$target); exit 3 }
}

$tg = Get-ForegroundInfo
Write-Output ("WINDOW " + [int64]$tg.Hwnd + " " + $tg.Process)
if (-not ($tg.Process -ieq $ProcessName)) { Write-Output ("MISMATCH " + $tg.Process); exit 2 }
if ($DryRun) { Write-Output ("DRYRUN " + $text.Length); exit 0 }

[WtKey]::Key(0x0D)
Start-Sleep -Milliseconds $DelayMs
[WtKey]::Text($text)
Start-Sleep -Milliseconds $DelayMs
[WtKey]::Key(0x0D)
Write-Output ("SENT " + $text.Length)
exit 0
