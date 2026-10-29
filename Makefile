# ==============================================================================
# Retrieva AI — Reproducible Build Automation Makefile
# Unified targets: setup, test, run-backend, run-frontend, run-eval
# ==============================================================================

.PHONY: help setup test accept run-backend run-frontend run-eval partition audit-leakage lint clean

# Environment detection (Windows vs POSIX)
ifeq ($(OS),Windows_NT)
    VENV_BIN := .venv/Scripts
    PYTHON := $(VENV_BIN)/python.exe
    PIP := $(VENV_BIN)/pip.exe
    UVICORN := $(VENV_BIN)/uvicorn.exe
    PYTEST := $(VENV_BIN)/pytest.exe
    RUFF := $(VENV_BIN)/ruff.exe
    NPM := cmd.exe /c npm
else
    VENV_BIN := .venv/bin
    PYTHON := $(VENV_BIN)/python
    PIP := $(VENV_BIN)/pip
    UVICORN := $(VENV_BIN)/uvicorn
    PYTEST := $(VENV_BIN)/pytest
    RUFF := $(VENV_BIN)/ruff
    NPM := npm
endif

# Default Target
all: help

help:
	@echo "=================================================================="
	@echo "               RETRIEVA AI — BUILD TARGETS                        "
	@echo "=================================================================="
	@echo "  make setup         Initialize virtualenv, install Python & npm deps"
	@echo "  make test          Execute backend pytest suite and frontend checks
  make accept        Execute frozen acceptance partition evaluation suite (AC-1..AC-4)"
	@echo "  make run-backend   Start FastAPI server with auto-reload (port 8000)"
	@echo "  make run-frontend  Start Vite development server (port 5173)"
	@echo "  make run-eval      Run benchmark evaluation suite (FUNSD/CORD/Table)"
	@echo "  make partition     Partition documents into dev & frozen acceptance sets"
	@echo "  make audit-leakage Check for document, page, or artifact leakage"
	@echo "  make lint          Run Ruff (Python) and Oxlint (JS/JSX) linters"
	@echo "  make clean         Remove build artifacts and caches"
	@echo "=================================================================="

# One-command setup: creates .venv, installs Python dependencies, and runs npm install
setup:
ifeq ($(OS),Windows_NT)
	@if not exist .venv ( python -m venv .venv )
else
	@test -d .venv || python3 -m venv .venv
endif
	$(PIP) install -r requirements.txt
	$(NPM) install

# One-command test: runs Python tests with config_version verification
test:
	$(PYTEST) tests -v
	$(NPM) run build

# Run frozen acceptance benchmark suite (AC-1..AC-4, KPI-1..KPI-6, NT1..NT5)
accept:
	$(PYTHON) -m eval.run_acceptance

# Start FastAPI backend server
run-backend:
	$(UVICORN) backend.app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend

# Start Vite frontend server
run-frontend:
	$(NPM) run dev

# Run benchmark evaluation runner
run-eval:
	$(PYTHON) -m eval.runner

# Re-run document partitioning (fixed seed)
partition:
	$(PYTHON) -m eval.partition

# Audit partitions for data leakage
audit-leakage:
	$(PYTHON) -m eval.leakage

# Code quality and linting
lint:
	$(RUFF) check backend eval tests
	$(NPM) run lint

# Clean build caches
clean:
ifeq ($(OS),Windows_NT)
	@if exist dist rmdir /s /q dist
	@if exist .pytest_cache rmdir /s /q .pytest_cache
	@if exist .ruff_cache rmdir /s /q .ruff_cache
else
	rm -rf dist .pytest_cache .ruff_cache __pycache__ */__pycache__ */*/__pycache__
endif

