$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$runtimeDir = Join-Path $repoRoot "runtime"
$pidsFile = Join-Path $runtimeDir "pids\pids.json"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   RETRIEVA AI — SERVICE SHUTDOWN                                " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (-not (Test-Path $pidsFile)) {
    Write-Host "No active pids.json found. Checking known ports..." -ForegroundColor Yellow
} else {
    try {
        $pids = Get-Content $pidsFile -Raw | ConvertFrom-Json
        foreach ($prop in @("frontend", "worker", "express", "fastapi")) {
            $pidVal = $pids.$prop
            if ($pidVal) {
                $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host "  -> Stopping $prop (PID: $pidVal)..." -ForegroundColor Yellow
                    Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Milliseconds 300
                } else {
                    Write-Host "  -> $prop (PID: $pidVal) was not running" -ForegroundColor Gray
                }
            }
        }
        Remove-Item $pidsFile -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "Could not parse pids.json: $_"
    }
}

foreach ($port in @(5173, 3001, 8000)) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $owningPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $owningPids) {
            if ($p -gt 0) {
                Write-Host "  -> Cleaning up lingering process on port $port (PID: $p)..." -ForegroundColor Yellow
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   ALL RETRIEVA AI SERVICES STOPPED CLEANLY                      " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
