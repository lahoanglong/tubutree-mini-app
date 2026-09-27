<#
.SYNOPSIS
  Start the ISOLATED audit environment: API :3201 (db tubutree_audit, redis db 5), miniapp :3213, web :3212.

.DESCRIPTION
  Everything is started DETACHED with Start-Process (hidden window, stdout/stderr -> .audit/logs/*.log),
  PIDs are written to .audit/pids.json, then the script waits until
    http://127.0.0.1:3201/api/health, http://127.0.0.1:3213/ and http://127.0.0.1:3212/ answer.
  Nothing of the owner's dev setup is touched:
    - API is compiled into .audit/api-dist (not apps/api/dist) and runs with CWD .audit/api-run;
      scripts/audit/api-preload.cjs forces every env key from .audit/api.env (integration keys blank)
      BEFORE @prisma/client can auto-load apps/api/.env, and refuses to start on a wrong DB/port/redis.
    - miniapp runs from apps/miniapp with scripts/audit/vite.audit.config.mts (own cache dir, port 3213).
    - web runs from a snapshot copy in .audit/web (own .next dir), node_modules is a junction to
      apps/web/node_modules. NEVER delete .audit/web with a recursive delete before removing that
      junction (cmd /c rmdir .audit\web\node_modules) — see README.
  Ports 3001/3113/3112 (owner) are never used.

.PARAMETER SkipBuild     Reuse .audit/api-dist instead of recompiling apps/api (tsc, ~2 min).
.PARAMETER KeepThrottle  Keep the API rate limits (default: disabled for screenshot runs, see api-preload.cjs).
.PARAMETER TimeoutSec    Max seconds to wait for all three health checks (default 900).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\start-audit-env.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$KeepThrottle,
  [int]$TimeoutSec = 900
)
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Audit = Join-Path $Repo '.audit'
$Logs = Join-Path $Audit 'logs'
$PidFile = Join-Path $Audit 'pids.json'
$Ports = @{ api = 3201; miniapp = 3213; web = 3212 }
$OwnerPorts = @(3001, 3113, 3112)

function Say([string]$msg) { Write-Host ("[audit] " + $msg) }
# Windows PowerShell 5.1 turns native stderr into terminating errors under 'Stop' — run natives with 'Continue'.
function Invoke-Native([scriptblock]$Block) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $prev }
}
function Write-JsonNoBom([object]$Obj, [string]$Path) {
  [IO.File]::WriteAllText($Path, ($Obj | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# ── 0) refuse to double-start / collide ─────────────────────────────────────────────
if (Test-Path $PidFile) {
  $old = Get-Content $PidFile -Raw | ConvertFrom-Json
  $alive = @($old.processes | Where-Object {
      $gp = Get-Process -Id $_.pid -ErrorAction SilentlyContinue
      $gp -and (-not $_.startTime -or $gp.StartTime.ToUniversalTime().ToString('o') -eq $_.startTime)
    })
  if ($alive.Count -gt 0) {
    throw ("Audit env already running (PIDs " + (($alive | ForEach-Object { $_.pid }) -join ', ') + "). Run scripts\audit\stop-audit-env.ps1 first.")
  }
}
foreach ($k in $Ports.Keys) {
  $busy = Get-NetTCPConnection -State Listen -LocalPort $Ports[$k] -ErrorAction SilentlyContinue
  if ($busy) { throw ("Port " + $Ports[$k] + " ($k) is already in use by PID " + ($busy[0].OwningProcess) + ".") }
}

$node = (Get-Command node -ErrorAction Stop).Source

# ── 1) audit env file (.audit/api.env + .audit/api-run/.env) ─────────────────────────
Say "building .audit/api.env from apps/api/.env (integrations blanked)"
Invoke-Native { & $node (Join-Path $Repo 'scripts\audit\build-audit-env.mjs') *> (Join-Path $Logs 'build-env.log') }
if ($LASTEXITCODE -ne 0) { throw "build-audit-env.mjs failed (see .audit/logs/build-env.log)" }

# ── 2) compile the API into .audit/api-dist ─────────────────────────────────────────
$ApiDist = Join-Path $Audit 'api-dist'
if (-not $SkipBuild -or -not (Test-Path (Join-Path $ApiDist 'main.js'))) {
  Say "compiling apps/api -> .audit/api-dist (tsc, takes ~2 min)"
  $tsc = Join-Path $Repo 'apps\api\node_modules\typescript\bin\tsc'
  Invoke-Native { & $node $tsc -p (Join-Path $Repo 'scripts\audit\tsconfig.audit-api.json') *> (Join-Path $Logs 'api-build.log') }
  if (-not (Test-Path (Join-Path $ApiDist 'main.js'))) { throw "API build produced no main.js (see .audit/logs/api-build.log)" }
  if ($LASTEXITCODE -ne 0) { Say "tsc reported type errors (JS still emitted) — see .audit/logs/api-build.log" }
}

# ── 3) web snapshot copy in .audit/web (own .next, node_modules junction) ────────────
$WebSrc = Join-Path $Repo 'apps\web'
$WebDst = Join-Path $Audit 'web'
New-Item -ItemType Directory -Force -Path $WebDst | Out-Null
Say "syncing apps/web -> .audit/web (snapshot; .next stays isolated)"
Invoke-Native { & robocopy (Join-Path $WebSrc 'src') (Join-Path $WebDst 'src') /MIR /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null }
if ($LASTEXITCODE -ge 8) { throw "robocopy of apps/web/src failed (exit $LASTEXITCODE)" }
foreach ($f in @('next.config.mjs', 'package.json', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs', 'next-env.d.ts')) {
  $srcFile = Join-Path $WebSrc $f
  if (Test-Path $srcFile) { Copy-Item -LiteralPath $srcFile -Destination (Join-Path $WebDst $f) -Force }
}
if (Test-Path (Join-Path $WebSrc 'public')) {
  Invoke-Native { & robocopy (Join-Path $WebSrc 'public') (Join-Path $WebDst 'public') /MIR /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null }
}
$WebNm = Join-Path $WebDst 'node_modules'
if (-not (Test-Path $WebNm)) {
  New-Item -ItemType Junction -Path $WebNm -Target (Join-Path $WebSrc 'node_modules') | Out-Null
}

# ── helpers: env scoping + detached start ───────────────────────────────────────────
function Start-Detached {
  param([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$Cwd, [hashtable]$Env)
  $saved = @{}
  foreach ($k in $Env.Keys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
    [Environment]::SetEnvironmentVariable($k, $Env[$k], 'Process')
  }
  try {
    $quoted = $Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
    $p = Start-Process -FilePath $Exe -ArgumentList $quoted -WorkingDirectory $Cwd -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $Logs "$Name.out.log") -RedirectStandardError (Join-Path $Logs "$Name.err.log")
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
  }
  Start-Sleep -Milliseconds 300
  $p.Refresh()
  return [pscustomobject]@{
    name      = $Name
    pid       = $p.Id
    startTime = $p.StartTime.ToUniversalTime().ToString('o')
    port      = $Ports[$Name]
    cwd       = $Cwd
    stdout    = (Join-Path '.audit\logs' "$Name.out.log")
    stderr    = (Join-Path '.audit\logs' "$Name.err.log")
  }
}

$procs = @()
# ── 4a) API ─────────────────────────────────────────────────────────────────────────
$apiEnv = @{
  NODE_PATH             = (Join-Path $Repo 'apps\api\node_modules')
  AUDIT_ENV_FILE        = (Join-Path $Audit 'api.env')
  AUDIT_DISABLE_THROTTLE = $(if ($KeepThrottle) { '0' } else { '1' })
  # non-empty guards (the preload overrides EVERY key of .audit/api.env anyway, blanks included)
  PORT                  = [string]$Ports.api
  NODE_ENV              = 'development'
}
Say "starting API on :3201"
$procs += Start-Detached -Name 'api' -Exe $node -Cwd (Join-Path $Audit 'api-run') -Env $apiEnv -Arguments @(
  '-r', (Join-Path $Repo 'scripts\audit\api-preload.cjs'), (Join-Path $ApiDist 'main.js'))

# ── 4b) miniapp (Vite) ──────────────────────────────────────────────────────────────
$miniEnv = @{
  VITE_API_BASE_URL = 'http://localhost:3201/api'
  VITE_API_TARGET   = 'http://localhost:3201'
  BROWSER           = 'none'
}
Say "starting miniapp (vite) on :3213"
$procs += Start-Detached -Name 'miniapp' -Exe $node -Cwd (Join-Path $Repo 'apps\miniapp') -Env $miniEnv -Arguments @(
  (Join-Path $Repo 'apps\miniapp\node_modules\vite\bin\vite.js'), '--config', (Join-Path $Repo 'scripts\audit\vite.audit.config.mts'),
  '--port', [string]$Ports.miniapp, '--strictPort', '--host', '127.0.0.1')

# ── 4c) web (Next.js dev from the snapshot copy) ────────────────────────────────────
$webEnv = @{
  NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3201/api'
  API_BASE_URL             = 'http://localhost:3201/api'
  NEXT_TELEMETRY_DISABLED  = '1'
}
Say "starting web (next dev) on :3212"
$procs += Start-Detached -Name 'web' -Exe $node -Cwd $WebDst -Env $webEnv -Arguments @(
  (Join-Path $Repo 'apps\web\node_modules\next\dist\bin\next'), 'dev', '-p', [string]$Ports.web, '-H', '127.0.0.1')

$state = [ordered]@{
  startedAt  = (Get-Date).ToUniversalTime().ToString('o')
  repo       = $Repo
  db         = 'tubutree_audit'
  redis      = 'redis://localhost:6381/5'
  ports      = $Ports
  throttle   = $(if ($KeepThrottle) { 'on' } else { 'off' })
  processes  = $procs
  listeners  = @()
}
Write-JsonNoBom $state $PidFile
Say ("PIDs: " + (($procs | ForEach-Object { $_.name + '=' + $_.pid }) -join ', ') + "  -> .audit/pids.json")

# ── 5) wait for health ──────────────────────────────────────────────────────────────
# web: probe /robots.txt — apps/web/src/middleware.ts treats a dotted IPv4 host as a tenant subdomain
# ("127.0.0.1" -> "127") and rewrites "/" to /s/127 (404); paths containing "." skip the middleware.
$checks = [ordered]@{
  api     = 'http://127.0.0.1:3201/api/health'
  miniapp = 'http://127.0.0.1:3213/'
  web     = 'http://127.0.0.1:3212/robots.txt'
}
$ok = @{}
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ($ok.Count -lt $checks.Count -and (Get-Date) -lt $deadline) {
  foreach ($k in $checks.Keys) {
    if ($ok.ContainsKey($k)) { continue }
    $pr = $procs | Where-Object { $_.name -eq $k }
    if (-not (Get-Process -Id $pr.pid -ErrorAction SilentlyContinue)) {
      $tail = ''
      if (Test-Path (Join-Path $Repo $pr.stderr)) { $tail = (Get-Content (Join-Path $Repo $pr.stderr) -Tail 20) -join "`n" }
      throw "$k (PID $($pr.pid)) exited during startup. stderr tail:`n$tail"
    }
    try {
      $r = Invoke-WebRequest -Uri $checks[$k] -UseBasicParsing -TimeoutSec 120
      if ($r.StatusCode -eq 200) { $ok[$k] = $true; Say "$k healthy ($($checks[$k]))" }
    } catch { }
  }
  if ($ok.Count -lt $checks.Count) { Start-Sleep -Seconds 3 }
}
if ($ok.Count -lt $checks.Count) {
  $missing = @($checks.Keys | Where-Object { -not $ok.ContainsKey($_) })
  throw ("Timed out waiting for: " + ($missing -join ', ') + " (processes left running; see .audit/logs, stop with stop-audit-env.ps1)")
}

# record the actual listening PIDs (next dev serves from a child process)
$listeners = @()
foreach ($k in $Ports.Keys) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Ports[$k] -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $lp = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    $listeners += [pscustomobject]@{ name = $k; port = $Ports[$k]; pid = $c.OwningProcess; startTime = $(if ($lp) { $lp.StartTime.ToUniversalTime().ToString('o') } else { $null }) }
  }
}
$state.listeners = $listeners
$state.healthyAt = (Get-Date).ToUniversalTime().ToString('o')
Write-JsonNoBom $state $PidFile

foreach ($p in $OwnerPorts) {
  if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Where-Object { (@($listeners | ForEach-Object { $_.pid }) + @($procs | ForEach-Object { $_.pid })) -contains $_.OwningProcess }) {
    throw "SAFETY: an audit process is listening on owner port $p — stop the env immediately."
  }
}
# warm the first compile of the home pages (best effort, via the real hostname "localhost")
foreach ($u in @('http://localhost:3212/', 'http://localhost:3213/profile')) {
  try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 240 | Out-Null } catch { }
}
Say "ready: API http://localhost:3201/api | miniapp http://localhost:3213 | web http://localhost:3212"
