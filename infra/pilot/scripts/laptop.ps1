# Phase 3.5 pilot on this laptop / PC. Run from anywhere in PowerShell:
#   powershell -ExecutionPolicy Bypass -File infra\pilot\scripts\laptop.ps1 <command>
#
# Commands:
#   start    build the API image from the code checked out now, start everything, wait for health
#   status   containers + /health/ready
#   logs     follow API logs (Ctrl+C to stop following)
#   seed     create machines WRM-001 / WRM-900 (no test users outside APP_ENV=local)
#   backup   database dump to %USERPROFILE%\wrm-backups, keeps 14 days
#   restore  <file.dump>  REPLACES the database with a backup
#   tunnel   start a public https tunnel (Cloudflare quick tunnel) and print its URL
#   stop     stop everything (data stays)
param(
  [Parameter(Position = 0)] [string] $Command = 'status',
  [Parameter(Position = 1)] [string] $File
)
$ErrorActionPreference = 'Stop'
$pilot = Split-Path -Parent $PSScriptRoot          # infra\pilot
Set-Location $pilot
if (-not (Test-Path '.env')) { throw "Missing infra\pilot\.env (copy .env.laptop.example to .env and fill it in)" }

$compose = @('compose', '-f', 'docker-compose.pilot.yml', '-f', 'docker-compose.laptop.yml')
function Dc { & docker @compose @args; if ($LASTEXITCODE -ne 0) { throw "docker compose $args failed ($LASTEXITCODE)" } }

$port = (Select-String -Path '.env' -Pattern '^LAPTOP_HTTP_PORT=(\d+)' | Select-Object -First 1)
$port = if ($port) { $port.Matches[0].Groups[1].Value } else { '8080' }
$health = "http://127.0.0.1:$port/health/ready"

function Get-Health {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $health).Content }
  catch {
    # 503 = API up but a dependency is down: show which one
    $r = $_.Exception.Response
    if ($r) { try { return (New-Object IO.StreamReader($r.GetResponseStream())).ReadToEnd() } catch {} }
    return 'down (API not reachable)'
  }
}

switch ($Command) {
  'start' {
    $branch = git -C ../.. rev-parse --abbrev-ref HEAD
    if ($branch -ne 'main') { Write-Warning "Building from branch '$branch' (not main)." }
    Dc up -d --build
    docker image prune -f | Out-Null
    Write-Host 'Waiting for the API to become healthy...'
    for ($i = 0; $i -lt 40; $i++) {
      $h = Get-Health
      if ($h -match '"status":"ok"') { Write-Host $h; Write-Host "Pilot OK -> http://localhost:$port"; exit 0 }
      Start-Sleep -Seconds 5
    }
    Write-Host "API not healthy: $h"; Write-Host 'Last API logs:'; Dc logs --tail 30 api; exit 1
  }
  'status' { Dc ps; Write-Host (Get-Health) }
  'logs'   { Dc logs -f --tail 100 api }
  'seed'   { Dc exec api node_modules/.bin/tsx prisma/seed.ts }
  'backup' {
    $dir = Join-Path $env:USERPROFILE 'wrm-backups'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $out = Join-Path $dir ("wrm-{0}.dump" -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmm'))
    # dump inside the container, then copy out (PowerShell 5 pipes would corrupt binary data)
    Dc exec -T postgres pg_dump -U wrm -d wrm -Fc -f /tmp/wrm.dump
    Dc cp postgres:/tmp/wrm.dump $out
    Dc exec -T postgres rm -f /tmp/wrm.dump
    if (-not (Test-Path $out) -or (Get-Item $out).Length -eq 0) { throw "Backup is empty: $out" }
    Get-ChildItem $dir -Filter 'wrm-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
    Write-Host ("{0} backup OK: {1} ({2:N0} KB)" -f (Get-Date -Format s), $out, ((Get-Item $out).Length / 1KB))
  }
  'restore' {
    if (-not $File -or -not (Test-Path $File)) { throw 'usage: laptop.ps1 restore <file.dump>' }
    $answer = Read-Host "Replace the current database with $File ? Type YES"
    if ($answer -ne 'YES') { Write-Host 'Cancelled'; exit 1 }
    Dc cp $File postgres:/tmp/restore.dump
    Dc stop api
    Dc exec -T postgres pg_restore -U wrm -d wrm --clean --if-exists /tmp/restore.dump
    Dc exec -T postgres rm -f /tmp/restore.dump
    Dc start api
    Write-Host 'Restore done.'
  }
  'tunnel' {
    & docker @compose --profile tunnel up -d tunnel
    Write-Host 'Waiting for the tunnel URL...'
    for ($i = 0; $i -lt 20; $i++) {
      $m = (& docker @compose --profile tunnel logs tunnel 2>&1 | Out-String) | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches
      if ($m) {
        $url = $m.Matches[-1].Value
        Write-Host "Public URL: $url"
        Write-Host "Set PAYWAY_CALLBACK_URL=$url/v1/payway/callback in infra\pilot\.env, then run: laptop.ps1 start"
        exit 0
      }
      Start-Sleep -Seconds 2
    }
    throw 'No tunnel URL found; check: docker compose ... --profile tunnel logs tunnel'
  }
  'stop'   { & docker @compose --profile tunnel down; if ($LASTEXITCODE -ne 0) { exit 1 } }
  default  { throw "Unknown command '$Command'. Use: start | status | logs | seed | backup | restore | tunnel | stop" }
}
