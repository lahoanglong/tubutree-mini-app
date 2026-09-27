<#
.SYNOPSIS
  Stop the audit environment started by start-audit-env.ps1 — kills EXACTLY the PIDs recorded in
  .audit/pids.json (with their child processes), nothing else.

.DESCRIPTION
  For every recorded PID the script first checks that the running process still has the same start
  time as when it was recorded (PIDs get recycled by Windows); a mismatch is reported and skipped.
  Afterwards it reports whether ports 3201/3212/3213 are free, but never kills anything it did not start.
  Data (DB tubutree_audit, .audit/*) is left untouched.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\stop-audit-env.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PidFile = Join-Path $Repo '.audit\pids.json'
function Say([string]$msg) { Write-Host ("[audit] " + $msg) }

if (-not (Test-Path $PidFile)) { Say "no .audit/pids.json — nothing to stop"; return }
$state = Get-Content $PidFile -Raw | ConvertFrom-Json

$targets = @()
foreach ($p in @($state.processes)) { if ($p) { $targets += [pscustomobject]@{ name = $p.name; pid = [int]$p.pid; startTime = $p.startTime; kind = 'root' } } }
foreach ($l in @($state.listeners)) {
  if ($l -and -not ($targets | Where-Object { $_.pid -eq [int]$l.pid })) {
    $targets += [pscustomobject]@{ name = $l.name; pid = [int]$l.pid; startTime = $l.startTime; kind = 'listener' }
  }
}

foreach ($t in $targets) {
  $proc = Get-Process -Id $t.pid -ErrorAction SilentlyContinue
  if (-not $proc) { Say ("{0} ({1}) PID {2}: already stopped" -f $t.name, $t.kind, $t.pid); continue }
  if ($t.startTime) {
    $actual = $proc.StartTime.ToUniversalTime().ToString('o')
    if ($actual -ne $t.startTime) {
      Say ("{0} PID {1}: start time differs ({2} vs recorded {3}) — PID was reused, NOT killing" -f $t.name, $t.pid, $actual, $t.startTime)
      continue
    }
  }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & taskkill.exe /PID $t.pid /T /F 2>&1 | Out-Null } finally { $ErrorActionPreference = $prev }
  if (Get-Process -Id $t.pid -ErrorAction SilentlyContinue) { Say ("{0} PID {1}: still alive after taskkill" -f $t.name, $t.pid) }
  else { Say ("{0} ({1}) PID {2}: stopped" -f $t.name, $t.kind, $t.pid) }
}

foreach ($port in @(3201, 3212, 3213)) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Say ("port {0} still listening (PID {1}) — not started by this env or not recorded; left alone" -f $port, $c.OwningProcess) }
  else { Say ("port {0} free" -f $port) }
}

$state | Add-Member -NotePropertyName stoppedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force
[IO.File]::WriteAllText($PidFile, ($state | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
