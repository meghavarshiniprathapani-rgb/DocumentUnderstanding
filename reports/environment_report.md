# Retrieva AI — Environment Verification Report

> **Execution Date:** 2026-11-03T12:45:35Z  
> **Evaluation Lead:** Independent QA Lead & Validation Engineer (AIML-59)  
> **Status:** VERIFIED & COMPLIANT  
> **System Architecture:** Hybrid Python FastAPI Backend + React 19 / Vite 8 Frontend  

---

## 1. Executive Environment Summary

The Retrieva AI execution environment was audited across runtime binaries, virtual environment package graphs, daemon background services, API loopback interfaces, and production bundle generation. All core runtimes comply with the pinned specification requirements.

| Component | Target Version | Installed Version | Status | Evidence Command / Reference |
| :--- | :--- | :--- | :---: | :--- |
| **Operating System** | Windows 10/11 x64 | Windows-10-10.0.26300-SP0 | **PASS** | `[System.Environment]::OSVersion` |
| **CPU Architecture** | x86_64 / AMD64 | Intel64 Family 6 Model 126 Stepping 5 (8 cores) | **PASS** | `os.cpu_count() == 8` |
| **Python Runtime** | `3.11.x` | `Python 3.11.9` | **PASS** | `python --version` |
| **Node.js Runtime** | `>= 20.x` | `v22.13.1` | **PASS** | `node --version` |
| **NPM Package Manager**| `>= 10.x` | `11.19.0` | **PASS** | `npm --version` |
| **Python Virtualenv** | `.venv` | `D:\DocumentUnderstanding\.venv` | **PASS** | `sys.prefix` |
| **Backend Daemon** | FastAPI / Uvicorn | `127.0.0.1:8000` (Uptime: 1207s) | **PASS** | `GET /api/v1/health` |
| **Frontend Daemon** | Vite Dev Server | `127.0.0.1:5173` | **PASS** | `GET http://127.0.0.1:5173` |
| **Configuration Bundle**| `O3-v1.0.0` | `1.0.0` | **PASS** | `Settings.config_version` |

---

## 2. Dependency Graph Audit

### 2.1 Python Virtual Environment
Execution of `.venv\Scripts\pip.exe check`:
- **Result:** `No broken requirements found.`
- **Core backend libraries:**
  - `fastapi==0.115.11`
  - `uvicorn==0.34.0`
  - `pydantic==2.10.6`
  - `pydantic-settings==2.8.1`
  - `pymupdf==1.25.3` (Fitz engine `1.28.2`)
  - `pdfplumber==0.11.5`
  - `faiss-cpu==1.10.0`
  - `numpy==2.2.3`
  - `pytest==8.3.4`

### 2.2 Node.js Frontend Dependencies
Execution of `npm list --depth=0`:
- **Core packages:**
  - `react@19.2.8`
  - `react-dom@19.2.8`
  - `vite@8.3.0`
  - `@tailwindcss/vite@4.3.3`
  - `lucide-react@1.16.0`
  - `pdfjs-dist@5.4.448`
  - `oxlint@1.51.0`

---

## 3. Production Build Verification

Execution of `npm run build`:
- **Command:** `npx vite build`
- **Modules Transformed:** 1903 client modules
- **Build Duration:** 1.00s
- **Output Artifacts:**
  - `dist/index.html` (1.17 kB, gzip: 0.63 kB)
  - `dist/assets/pdf.worker.min-CjEcRF4W.mjs` (1,264.34 kB)
  - `dist/assets/index-BZoAdIn9.css` (66.14 kB, gzip: 11.28 kB)
  - `dist/assets/index-XSkgdHh2.js` (835.23 kB, gzip: 239.01 kB)
- **Exit Code:** `0` (Clean build)

---

## 4. Environment Verification Test Matrix

| Test ID | Test Description | Execution Command | Actual Result | Status | Evidence Location |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **ENV-001** | Python version compatibility | `.venv\Scripts\python.exe --version` | `Python 3.11.9` | **PASSED** | CLI stdout |
| **ENV-002** | Node.js version compatibility | `node --version` | `v22.13.1` | **PASSED** | CLI stdout |
| **ENV-003** | NPM version compatibility | `npm --version` | `11.19.0` | **PASSED** | CLI stdout |
| **ENV-004** | Python dependency consistency | `.venv\Scripts\pip.exe check` | `No broken requirements found.` | **PASSED** | Pip CLI stdout |
| **ENV-005** | Backend service health endpoint | `GET http://127.0.0.1:8000/api/v1/health` | HTTP 200, status `healthy`, config `O3-v1.0.0` | **PASSED** | `backend/app/main.py` |
| **ENV-006** | Frontend dev server reachability | `GET http://127.0.0.1:5173` | HTTP 200, HTML document returned | **PASSED** | `task-793` log |
| **ENV-007** | Backend live document repository | `GET http://127.0.0.1:8000/api/v1/documents` | HTTP 200, returns 6 documents including user upload | **PASSED** | `backend/app/services/document_service.py` |
| **ENV-008** | Frontend production build | `npm run build` | 1903 modules built in 1.00s, exit code 0 | **PASSED** | `dist/` directory |
| **ENV-009** | Configuration immutability | Python Settings inspect | `config_version: "1.0.0"`, `confidence_threshold: 0.85` | **PASSED** | `backend/app/config.py` |
| **ENV-010** | System memory envelope at rest | Memory telemetry inspect | `memory_usage_mb: 120.15 MB` (budget < 150 MB) | **PASSED** | Telemetry payload |

---

## 5. Environment Status Summary

- **Total Tests:** 10
- **Passed:** 10
- **Failed:** 0
- **Blocked:** 0
- **Not Tested:** 0
