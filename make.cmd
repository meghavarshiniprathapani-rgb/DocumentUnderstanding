@echo off
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=help"

set "VENV_PYTHON=.venv\Scripts\python.exe"
set "VENV_PIP=.venv\Scripts\pip.exe"
set "VENV_UVICORN=.venv\Scripts\uvicorn.exe"
set "VENV_PYTEST=.venv\Scripts\pytest.exe"
set "VENV_RUFF=.venv\Scripts\ruff.exe"

goto :%TARGET% 2>nul || goto :unknown

:help
echo ==================================================================
echo                RETRIEVA AI -- BUILD TARGETS
echo ==================================================================
echo   make setup         Initialize virtualenv, install Python and npm deps
echo   make test          Execute backend pytest suite and frontend checks
echo   make accept        Execute frozen acceptance partition evaluation suite (AC-1..AC-4)
echo   make run-backend   Start FastAPI server with auto-reload (port 8000)
echo   make run-frontend  Start Vite development server (port 5173)
echo   make run-eval      Run benchmark evaluation suite (FUNSD/CORD/Table)
echo   make partition     Partition documents into dev and frozen acceptance sets
echo   make audit-leakage Check for document, page, or artifact leakage
echo   make lint          Run Ruff (Python) and Oxlint (JS/JSX) linters
echo   make clean         Remove build artifacts and caches
echo ==================================================================
exit /b 0

:setup
echo [*] Running Retrieva AI Setup...
if not exist ".venv" (
    echo [*] Creating Python virtual environment in .venv...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment. Ensure Python 3.11+ is installed.
        exit /b 1
    )
)
echo [*] Installing pinned Python dependencies...
cmd /c "%VENV_PIP% install -r requirements.txt"
if errorlevel 1 exit /b 1
echo [*] Installing npm dependencies...
cmd /c "npm install"
if errorlevel 1 exit /b 1
echo [OK] Setup completed successfully!
exit /b 0

:test
echo [*] Running Backend Pytest Suite...
cmd /c "%VENV_PYTEST% tests -v"
if errorlevel 1 exit /b 1
echo [*] Verifying Frontend Production Build...
cmd /c "npm run build"
if errorlevel 1 exit /b 1
echo [OK] All tests and build verifications passed!
exit /b 0

:accept
echo [*] Running Frozen Acceptance Benchmark Suite (AC-1..AC-4, KPI-1..KPI-6, NT1..NT5)...
cmd /c "%VENV_PYTHON% -m eval.run_acceptance"
exit /b %errorlevel%

:run-backend
echo [*] Starting FastAPI Backend on http://localhost:8000 ...
cmd /c "%VENV_UVICORN% backend.app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend"
exit /b %errorlevel%

:run-frontend
echo [*] Starting Vite Frontend on http://localhost:5173 ...
cmd /c "npm run dev"
exit /b %errorlevel%

:run-eval
echo [*] Running Multi-Modal Evaluation Benchmarks...
cmd /c "%VENV_PYTHON% -m eval.runner"
exit /b %errorlevel%

:partition
echo [*] Running Document Partitioning (Fixed Seed)...
cmd /c "%VENV_PYTHON% -m eval.partition"
exit /b %errorlevel%

:audit-leakage
echo [*] Running Zero-Leakage Audit...
cmd /c "%VENV_PYTHON% -m eval.leakage"
exit /b %errorlevel%

:lint
echo [*] Running Ruff Python Linter...
cmd /c "%VENV_RUFF% check backend eval tests"
if errorlevel 1 exit /b 1
echo [*] Running Oxlint Frontend Linter...
cmd /c "npm run lint"
exit /b %errorlevel%

:clean
echo [*] Cleaning build caches and temp files...
if exist "dist" rmdir /s /q "dist"
if exist ".pytest_cache" rmdir /s /q ".pytest_cache"
if exist ".ruff_cache" rmdir /s /q ".ruff_cache"
echo [OK] Cleanup complete.
exit /b 0

:unknown
echo [ERROR] Unknown target: %TARGET%
echo Run 'make help' for a list of valid targets.
exit /b 1
