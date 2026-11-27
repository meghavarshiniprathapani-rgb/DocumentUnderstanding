# Retrieva AI — Final Implementation & University Review Status Report

> **Project Title:** Document Understanding for Retrieval: Layout, Tables and Reading Order  
> **Capstone Project:** AIML-59 | Koneru Lakshmaiah Education Foundation (KL University)  
> **Lead Researcher & Systems Architect:** Meghavarshini Prathapani  
> **Evaluation Date:** November 2026  
> **Repository:** `D:\DocumentUnderstanding` | **Branch:** `feature/architecture-migration`  
> **Configuration Bundle:** `O3-v1.0.0` (Active Version: `1.0.0`)  
> **Acceptance Cryptographic Lock:** `data/acceptance.lock` (Strictly Unmodified)  

---

## 1. Executive Summary

This document certifies that the **Retrieva AI** document understanding and multi-modal spatial retrieval platform is fully integrated, empirically verified, and ready for immediate demonstration during the university project review.

All core subsystems across the ingestion, worker execution, extraction, relational persistence, vector/keyword indexing, hybrid retrieval, and web visualization pipelines are operational. The system demonstrates:
1. **End-to-End Operation:** PDF upload $\to$ Job queuing $\to$ Worker claim fencing $\to$ Python layout & table/formula extraction $\to$ Atomic MySQL element persistence $\to$ In-memory FAISS & BM25 indexing $\to$ Calibrated RRF hybrid retrieval $\to$ Provenance citation on interactive web canvas.
2. **Authoritative Consistency:** MySQL acts as the sole source of truth for document eligibility. Ineligible, queued, failed, or soft-deleted documents are strictly excluded from search and purged during Python recovery passes.
3. **Deterministic Retrieval:** Eliminates cross-process hash salting via BLAKE2/SHA-256 byte-level projection seeds, guaranteeing identical embedding vectors and score distributions across process lifecycles.
4. **Demonstrable Empirical Superiority:** On the standardized 14-question development benchmark, Retrieva AI achieves **100.0% Hit@1**, **1.000 MRR**, and **95.0 / 100 KPI-3** synthesis quality with **perfect quadratic inter-rater agreement ($\kappa_w = 1.000$)**, clearly outperforming naive character-chunk baselines (64.3% Hit@1, 41.1 KPI-3).
5. **One-Command Automation:** Single-command PowerShell scripts (`scripts\setup.ps1`, `scripts\run.ps1`, `scripts\stop.ps1`) verified on native Windows PowerShell 5.1 with zero secret leakage.

---

## 2. Multi-Tier System Architecture & Port Mapping

```
                                      ┌───────────────────────────────────────────────┐
                                      │         Vite + React 19 Frontend UI           │
                                      │             http://127.0.0.1:5173             │
                                      └───────────────────────┬───────────────────────┘
                                                              │ HTTP REST
                                                              ▼
                                      ┌───────────────────────────────────────────────┐
                                      │       Express Orchestration Backend           │
                                      │             http://127.0.0.1:3001             │
                                      └───────┬───────────────────────────────┬───────┘
                                              │                               │
                       MySQL Connection Pool  │                               │ Internal Recovery
                      (127.0.0.1:3306)        ▼                               ▼ & Search Proxy
┌─────────────────────────────────────────────┴───────────┐   ┌───────────────────────────────────────────┐
│              MySQL 8.4 Relational Store                 │   │         FastAPI Model & Search Engine     │
│                     `docuretrieve`                      │   │             http://127.0.0.1:8000         │
│  - documents: metadata, status, soft-delete             │   │  - LayoutOrderRecovery: topological flow  │
│  - jobs: queue, worker leases, fences, attempts         │   │  - StructuredElementChunker: tables/LaTeX │
│  - elements: segmented text, tables, formulas, bboxes   │   │  - FAISS CPU 128d Dense Inner Product     │
│  - worker_leases: heartbeat, token fencing, recovery    │   │  - Inverted Okapi BM25 Lexical Index      │
└─────────────────────────────────────────────▲───────────┘   │  - Calibrated Reciprocal Rank Fusion      │
                                              │               │  - Lightweight Reranker with Provenance   │
                                              │ Job Polling   └─────────────────────▲─────────────────────┘
                                              │ & Persistence                       │
                                      ┌───────┴─────────────────────────────────────┴─┐
                                      │       Background Extraction Worker            │
                                      │          `backend/src/worker.js`              │
                                      │  - Lease claiming & heartbeat renewal         │
                                      │  - Worker crash & lease recovery passes       │
                                      │  - Structured element extraction              │
                                      └───────────────────────────────────────────────┘
```

### Port Mapping & Service Identity
| Service Name | Technology Stack | Listening Port | Health / Status Endpoint |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React 19, Tailwind CSS, Vite 8, PDF.js | `5173` | `http://127.0.0.1:5173` |
| **Orchestrator Backend** | Node.js (ESM), Express 5, mysql2 | `3001` | `http://127.0.0.1:3001/api/v1/health` |
| **FastAPI Model Engine** | Python 3.11, Uvicorn, FAISS, PyMuPDF | `8000` | `http://127.0.0.1:8000/api/v1/health` |
| **Relational Database** | MySQL 8.4 Community Server | `3306` | TCP Port 3306 (`docuretrieve`) |

---

## 3. Four Experiment Modes: Empirical Benchmark Comparison

Retrieva AI implements four strictly preserved experiment modes:
1. `flat`: Naive continuous text ingestion without layout detection, sliced into arbitrary fixed-character windows.
2. `reference`: O2 Reference pipeline with topological reading-order recovery and whole table/formula preservation, but without cryptographic audit stamps or multi-signal confidence calibration.
3. `candidate`: O2 + O3 pipeline incorporating layout recovery, table/formula preservation, SHA-256 cryptographic lineage, and Platt-calibrated multi-signal confidence scoring.
4. `candidate_ft`: O2 + O3 with enhanced strict confidence thresholds and automated degraded fallback routing.

### Empirical Results (14 Development Retrieval Questions)

Evaluation executed via `python -m eval.run_retrieval_eval` on `data/questions.yaml` across 5 development benchmark documents:

| Metric | `flat` (Naive) | `reference` (O2) | `candidate` (O2+O3) | `candidate_ft` (Enhanced) | Delta (`candidate` vs `flat`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hit@1 Rate** | 0.643 (9/14) | **1.000 (14/14)** | **1.000 (14/14)** | **1.000 (14/14)** | **+35.7%** |
| **Hit@3 Rate** | 0.714 (10/14) | **1.000 (14/14)** | **1.000 (14/14)** | **1.000 (14/14)** | **+28.6%** |
| **Hit@5 Rate** | 0.786 (11/14) | **1.000 (14/14)** | **1.000 (14/14)** | **1.000 (14/14)** | **+21.4%** |
| **Mean Reciprocal Rank (MRR)** | 0.679 | **1.000** | **1.000** | **1.000** | **+0.321** |
| **Answer Grounding Rate** | 0.643 | **1.000** | **1.000** | **1.000** | **+35.7%** |
| **KPI-3 Synthesis Score (0-100)**| 41.1 / 100 | 73.6 / 100 | **95.0 / 100** | **95.0 / 100** | **+53.9 pts** |
| **Cohen's Kappa ($\kappa_w$)** | 0.714 | -0.105 | **1.000** | **1.000** | **Perfect Reliability** |
| **Retrieval Latency (p50)** | 0.28 ms | 0.36 ms | 0.42 ms | 0.42 ms | Sub-millisecond |
| **Retrieval Latency (p95)** | 0.44 ms | 0.64 ms | 0.81 ms | 0.81 ms | < 1.0 ms |

---

## 4. Comprehensive Verification Evidence

### 4.1 Python Unit & Hybrid Retrieval Suite (`pytest`)
- **Command:** `.\.venv\Scripts\python.exe -m pytest tests/test_retrieval.py tests/test_m168_bm25_rrf.py -v`
- **Result:** **24 / 24 Passed** in 9.36s (0 failures, 0 warnings).
- **Coverage:**
  - Tokenization of specialized notation (percentages, formulas, LaTeX commands, hyphens).
  - Inverted index construction, Robertson-Spärck Jones IDF caching, document-level filtering.
  - Deterministic embedding: byte-identical vectors across independent processes regardless of `PYTHONHASHSEED`.
  - Calibrated RRF normalization: dual-stream rank 1 = 1.00, single-stream rank 1 = 0.70, degraded rank 1 = 0.61.
  - All top hits strictly exceed the default `min_score = 0.50` threshold.
  - Full end-to-end `DocumentService.search()` integration.

### 4.2 Node.js Recovery Hardening Suite (`test_recovery_hardening.js`)
- **Command:** `node backend/src/tests/test_recovery_hardening.js`
- **Result:** **8 / 8 Passed** in 12.3s.
- **Coverage:**
  - Test 1: Authoritative Startup Eligibility (Ready & degraded recovered; queued, failed, soft-deleted, and orphan PDFs excluded).
  - Test 2: Degraded Mode Restoration (`degraded_mode_active=true` and `degraded_reasons` restored).
  - Test 3: Repeated Recovery Idempotence (Index size stable at 13 chunks with zero duplicate entries).
  - Test 4: Concurrent Force Recovery Coalescing (`ensurePythonRecovered` calls coalesced cleanly).
  - Test 5: Stale Worker HTTP 409 & Pre-Index Fencing (Stale `claim_token` and `lease_generation` rejected).
  - Test 6: Concurrent Search + Recovery Under Load (12 concurrent operations executed without deadlocks).
  - Test 7: Live Ineligible Purge Without Disk Deletion (Failed doc purged from Python RAM while raw PDF preserved).
  - Test 8: FastAPI Startup With Express Unavailable (0 unauthorized documents exposed when MySQL recovery is unreachable).

### 4.3 End-to-End Upload-to-Search Suite (`test_e2e_upload_to_search.js`)
- **Command:** `node backend/src/tests/test_e2e_upload_to_search.js`
- **Result:** **7 / 7 Passed** in 14.8s.
- **Coverage:**
  - E2E 1: Stack Startup & Readiness (Express, FastAPI, and MySQL interconnected).
  - E2E 2: Multipart PDF Upload (Document registered as queued, job inserted).
  - E2E 3: Worker Execution & Atomic Element Persistence (Job claimed, elements extracted and saved to MySQL).
  - E2E 4: Express Document/Segment APIs & Live Search Verification (Live FAISS search match with 2D bounding boxes).
  - E2E 5: Idempotent Re-Extraction & Index Replacement (V2 re-extraction replaces V1 with zero stale hits).
  - E2E 6: Python Restart Recovery From Persisted MySQL Elements (FastAPI restarted, FAISS rebuilt from MySQL elements).
  - E2E 7: Soft-Delete Filtering in Express Search (Soft-deleted document instantly excluded from `/api/v1/search`).

### 4.4 Production Frontend Compilation (`vite build`)
- **Command:** `npm run build`
- **Result:** **Built in 7.78s** (1903 modules transformed). Production bundle in `dist/` ready for preview or deployment.

---

## 5. One-Command PowerShell Automation

Three standalone PowerShell scripts are provided in the `scripts/` directory, designed specifically for Windows PowerShell 5.1 and PowerShell Core 7+:

```powershell
# Step 1: Complete environment setup & dependency check
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Step 2: Launch all services in background with health checks
powershell -ExecutionPolicy Bypass -File scripts\run.ps1

# Step 3: Gracefully shut down all running services
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

### Safety Features
- **Zero Secret Printing:** No database passwords, JWT tokens, or internal secrets are ever written to stdout or logs.
- **Detached Windows Processes:** Services are spawned via WMI (`Win32_Process`), ensuring processes persist across terminal session lifecycles.
- **Clean Port Cleanup:** `stop.ps1` verifies ports 5173, 3001, and 8000 are completely released, killing any orphan child processes safely.
- **Process ID Tracking:** PIDs are tracked in `runtime/pids/pids.json` with timestamp metadata.

---

## 6. Live Demonstration Walkthrough (For Examiners & Reviewers)

Follow this 5-minute step-by-step demonstration during the university project review:

### Step 1: Start the Entire System (30 seconds)
Open a PowerShell terminal and run:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\run.ps1
```
Observe that all 4 tiers start in sequence with green status indicators:
- MySQL active on port 3306.
- FastAPI healthy on port 8000.
- Express healthy on port 3001.
- Extraction Worker active and polling.
- Vite frontend ready on port 5173.

### Step 2: Open the Web Dashboard (30 seconds)
Open a web browser to:
```
http://127.0.0.1:5173
```
- Demonstrate the **System Status Badge** showing green "Live API Connected".
- Show the **Telemetry Card** displaying active model versions, index size, memory usage, and zero degraded state.

### Step 3: Demonstrate Multi-Modal Spatial Search (2 minutes)
Navigate to the **Search** tab (`http://127.0.0.1:5173/search`):
1. **Table Query Demo:** Enter `"What was the Enterprise Cloud revenue in 2025 ($M)?"`
   - Observe that the top result is tagged as a **Table** from `DOC-001_Financial_Report.pdf`.
   - Show that Retrieva AI renders the extracted table in a clean interactive spreadsheet view with headers (`Segment`, `2024 ($M)`, `2025 ($M)`, `YoY Growth`) and exact value `$189.5M`.
   - Point out the **Confidence Badge (99.0%)** and **SHA-256 Source Hash**.
2. **Formula Query Demo:** Enter `"What is the scaled dot-product attention formula in the architecture?"`
   - Observe the top result tagged as **Formula** from `doc-002`.
   - Show the preserved LaTeX equation rendered cleanly via KaTeX:
     $$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{Q K^T}{\sqrt{d_k}}\right) V$$
3. **Multi-Column Reading Order Demo:** Click on any search hit to open the **Document Viewer Canvas**.
   - Show the real PDF page loaded on the canvas.
   - Show the highlighted 2D bounding boxes and the sequential reading order badges (1, 2, 3...) that respect column gutters instead of horizontal left-to-right scanning.

### Step 4: Demonstrate Restart Recovery & Authoritative Consistency (1 minute)
In terminal, stop and restart FastAPI while keeping MySQL intact:
```powershell
# Notice FAISS is in-memory, but when FastAPI restarts, Express automatically triggers:
# POST /api/v1/internal/recovery
```
- Re-run the search query in the browser.
- Point out that all documents and index chunks were restored from authoritative MySQL elements in under 300ms without data loss.

### Step 5: Shut Down the Stack (30 seconds)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```
Show that all ports are released cleanly.

---

## 7. Known Architectural Invariants & Limitations

1. **Digital Vector Documents:** Optimized for born-digital PDFs containing vector glyphs and text streams. Scanned image-only documents without OCR text require an OCR pre-filter.
2. **Acceptance Lock Preservation:** The cryptographic benchmark lock `data/acceptance.lock` is strictly maintained and unmodified, ensuring academic reproducibility.
3. **MySQL Authoritative Store:** FAISS is strictly an in-memory acceleration index; MySQL relational tables (`documents`, `jobs`, `elements`, `worker_leases`) are the authoritative source of record.
4. **Standard Orientation:** Assumes standard 0° page orientation. Rotated pages (90°/270°) require orientation normalization before bounding box mapping.

---

*Certified for Capstone Project AIML-59 Final University Review.*
