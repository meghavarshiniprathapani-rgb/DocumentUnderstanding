$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$runtimeDir = Join-Path $repoRoot "runtime"
$logsDir = Join-Path $runtimeDir "logs"
$pidsDir = Join-Path $runtimeDir "pids"
$pidsFile = Join-Path $pidsDir "pids.json"

if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
if (-not (Test-Path $pidsDir)) { New-Item -ItemType Directory -Path $pidsDir -Force | Out-Null }

function Start-DetachedProcess {
    param(
        [string]$CommandLine,
        [string]$WorkingDirectory
    )
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $CommandLine
        CurrentDirectory = $WorkingDirectory
    }
    if ($res.ReturnValue -ne 0) {
        throw "Failed to start process (code $($res.ReturnValue)): $CommandLine"
    }
    return $res.ProcessId
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   RETRIEVA AI — SERVICE RUNNER                                  " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if (Test-Path $pidsFile) {
    try {
        $existing = Get-Content $pidsFile -Raw | ConvertFrom-Json
        $anyRunning = $false
        foreach ($prop in @("fastapi", "express", "worker", "frontend")) {
            $pidVal = $existing.$prop
            if ($pidVal -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) {
                $anyRunning = $true
                break
            }
        }
        if ($anyRunning) {
            Write-Warning "Existing Retrieva AI processes are still running."
            Write-Host "Stop them first with: powershell -ExecutionPolicy Bypass -File scripts\stop.ps1" -ForegroundColor Yellow
            exit 1
        }
    } catch {}
}

Write-Host "[1/5] Checking MySQL 8 on port 3306..." -ForegroundColor Yellow
$mysqlConn = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if (-not $mysqlConn) {
    $startMysqlScript = Join-Path $scriptDir "start_mysql.ps1"
    if (Test-Path $startMysqlScript) {
        Write-Host "  -> Starting local MySQL daemon..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$startMysqlScript`"" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

$mysqlConn = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if (-not $mysqlConn) {
    Write-Error "MySQL is not accessible on 127.0.0.1:3306. Please start MySQL before running services."
    exit 1
}
Write-Host "  -> MySQL is active" -ForegroundColor Green

$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Error "Virtual environment not found at .venv. Please run scripts\setup.ps1 first."
    exit 1
}

Write-Host "[2/5] Starting FastAPI Model & Search Engine (Port 8000)..." -ForegroundColor Yellow
$fastapiLog = Join-Path $logsDir "fastapi.log"
$fastapiCmd = "cmd.exe /c `"`"$pythonExe`" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 > `"$fastapiLog`" 2>&1`""
$fastapiPid = Start-DetachedProcess -CommandLine $fastapiCmd -WorkingDirectory $repoRoot

$fastapiHealthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($resp) {
            $fastapiHealthy = $true
            break
        }
    } catch {}
}

if (-not $fastapiHealthy) {
    Write-Error "FastAPI failed to become ready within 15 seconds. Check $fastapiLog."
    Stop-Process -Id $fastapiPid -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  -> FastAPI healthy at http://127.0.0.1:8000 (PID: $fastapiPid)" -ForegroundColor Green

Write-Host "[3/5] Starting Express Orchestrator Backend (Port 3001)..." -ForegroundColor Yellow
$expressLog = Join-Path $logsDir "express.log"
$expressCmd = "cmd.exe /c `"node backend/src/server.js > `"$expressLog`" 2>&1`""
$expressPid = Start-DetachedProcess -CommandLine $expressCmd -WorkingDirectory $repoRoot

$expressHealthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/v1/health" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($resp) {
            $expressHealthy = $true
            break
        }
    } catch {}
}

if (-not $expressHealthy) {
    Write-Error "Express backend failed to become ready within 15 seconds. Check $expressLog."
    Stop-Process -Id $fastapiPid -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $expressPid -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  -> Express healthy at http://127.0.0.1:3001 (PID: $expressPid)" -ForegroundColor Green

Write-Host "[4/5] Starting Async Document Extraction Worker..." -ForegroundColor Yellow
$workerLog = Join-Path $logsDir "worker.log"
$workerCmd = "cmd.exe /c `"node backend/src/worker.js > `"$workerLog`" 2>&1`""
$workerPid = Start-DetachedProcess -CommandLine $workerCmd -WorkingDirectory $repoRoot
Start-Sleep -Seconds 1
Write-Host "  -> Worker running (PID: $workerPid)" -ForegroundColor Green

Write-Host "[5/5] Starting Vite Frontend UI (Port 5173)..." -ForegroundColor Yellow
$frontendLog = Join-Path $logsDir "frontend.log"
$frontendCmd = "cmd.exe /c `"npx.cmd vite --port 5173 --host 127.0.0.1 > `"$frontendLog`" 2>&1`""
$frontendPid = Start-DetachedProcess -CommandLine $frontendCmd -WorkingDirectory $repoRoot

$frontendReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $feConn = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
    if ($feConn) {
        $frontendReady = $true
        break
    }
}
Write-Host "  -> Frontend ready at http://127.0.0.1:5173 (PID: $frontendPid)" -ForegroundColor Green

$pidsData = @{
    fastapi = $fastapiPid
    express = $expressPid
    worker = $workerPid
    frontend = $frontendPid
    started_at = (Get-Date).ToString("o")
}
$pidsData | ConvertTo-Json | Set-Content $pidsFile

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   RETRIEVA AI STACK IS ONLINE                                  " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Web Dashboard:         http://127.0.0.1:5173" -ForegroundColor White
Write-Host "  Express API:           http://127.0.0.1:3001/api/v1/health" -ForegroundColor White
Write-Host "  FastAPI Engine & Docs: http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "  Logs Directory:        $logsDir" -ForegroundColor Gray
Write-Host ""
Write-Host "  To stop all services, run:" -ForegroundColor Yellow
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\stop.ps1" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Cyan
