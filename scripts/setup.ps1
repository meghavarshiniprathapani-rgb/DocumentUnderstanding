$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   RETRIEVA AI — SYSTEM SETUP & VERIFICATION                    " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

Write-Host "[1/6] Checking system prerequisites..." -ForegroundColor Yellow
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js >= 18."
    exit 1
}
Write-Host "  -> Node.js version: $nodeVersion" -ForegroundColor Green

$pythonExe = $null
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $pythonExe = $venvPython
    Write-Host "  -> Using existing Python virtual environment: $venvPython" -ForegroundColor Green
} else {
    $sysPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $sysPython) {
        Write-Error "Python is not installed or not in PATH. Please install Python >= 3.11."
        exit 1
    }
    Write-Host "  -> Creating virtual environment at .venv..." -ForegroundColor Yellow
    & python -m venv (Join-Path $repoRoot ".venv")
    $pythonExe = $venvPython
}

$pyVer = & $pythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
Write-Host "  -> Python version: $pyVer" -ForegroundColor Green

Write-Host "[2/6] Verifying environment configuration..." -ForegroundColor Yellow
$envPath = Join-Path $repoRoot ".env"
$envExample = Join-Path $repoRoot ".env.example"
if (-not (Test-Path $envPath) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envPath
    Write-Host "  -> Created .env from .env.example" -ForegroundColor Green
} else {
    Write-Host "  -> .env file is present" -ForegroundColor Green
}

Write-Host "[3/6] Installing Python dependencies..." -ForegroundColor Yellow
& $pythonExe -m pip install --quiet --upgrade pip
if (Test-Path (Join-Path $repoRoot "requirements.txt")) {
    & $pythonExe -m pip install --quiet -r (Join-Path $repoRoot "requirements.txt")
}
if (Test-Path (Join-Path $repoRoot "pyproject.toml")) {
    & $pythonExe -m pip install --quiet -e $repoRoot
}
Write-Host "  -> Python packages verified" -ForegroundColor Green

Write-Host "[4/6] Installing Node.js dependencies..." -ForegroundColor Yellow
npm install --no-audit --no-fund --silent
Write-Host "  -> Node.js packages verified" -ForegroundColor Green

Write-Host "[5/6] Verifying MySQL 8 connectivity and migrations..." -ForegroundColor Yellow
$mysqlPortCheck = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if (-not $mysqlPortCheck) {
    $startMysqlScript = Join-Path $scriptDir "start_mysql.ps1"
    if (Test-Path $startMysqlScript) {
        Write-Host "  -> Starting local MySQL daemon..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$startMysqlScript`"" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

$mysqlPortCheck = Get-NetTCPConnection -LocalPort 3306 -ErrorAction SilentlyContinue
if (-not $mysqlPortCheck) {
    Write-Warning "MySQL port 3306 is not open. Ensure MySQL is running on 127.0.0.1:3306."
} else {
    Write-Host "  -> MySQL listening on port 3306" -ForegroundColor Green
    node backend/src/db/migrator.js
}

Write-Host "[6/6] Building production frontend assets..." -ForegroundColor Yellow
npm run build --silent
Write-Host "  -> Frontend build completed successfully" -ForegroundColor Green

$runtimeDir = Join-Path $repoRoot "runtime"
$logsDir = Join-Path $runtimeDir "logs"
$pidsDir = Join-Path $runtimeDir "pids"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
if (-not (Test-Path $pidsDir)) { New-Item -ItemType Directory -Path $pidsDir -Force | Out-Null }

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   SETUP COMPLETE! To start all services, run:                   " -ForegroundColor Green
Write-Host "   powershell -ExecutionPolicy Bypass -File scripts\run.ps1      " -ForegroundColor White
Write-Host "=================================================================" -ForegroundColor Cyan
