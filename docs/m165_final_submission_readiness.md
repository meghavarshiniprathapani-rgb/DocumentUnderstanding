# Retrieva AI (AIML-59) — M1.6.5 Final Stabilization & Submission Readiness Guide

> **Milestone**: M1.6.5 — Final Stabilization and Submission Readiness  
> **Project**: Retrieva AI — Multi-Modal Document Understanding & Cross-Document Spatial Retrieval (`AIML-59`)  
> **Config Bundle**: `O3-v1.0.0` (`config_version: 1.0.0`)  
> **Frozen Acceptance Artifacts**: `data/acceptance.lock` (477 bytes, unmodified) and applied SQL migrations `001`–`006` (verified checksum-aligned)

---

## 1. Architecture Overview

Retrieva AI uses a five-component decoupled architecture separating interactive presentation, API orchestration and relational state ownership, background job execution, statistical/spatial NLP extraction & dense vector retrieval, and transactional MySQL persistence:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 1. Frontend UI Tier (React 19.2.8 + Vite 8.3.0 + Tailwind CSS v4 + PDF.js)│
│    Default Dev Origin: http://localhost:5173 (VITE_API_BASE_URL)         │
│    Dashboard | Upload | Library | Document Viewer | Search | Evaluation   │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │ HTTP / JSON (/api/v1, CORS)
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ 2. Express API Orchestrator Tier (Node.js ESM + Express 5.3.0, Port 3001) │
│    backend/src/server.js · app.js · config.js · routes/*                  │
│    • Exclusive HTTP gateway for frontend & upload lifecycle               │
│    • Enforces PDF MIME/magic-bytes, 50MB limit, SHA-256 deduplication     │
│    • Enqueues jobs cleanly & serves persisted elements/analytics/PDFs     │
│    • Proxies Search, Health Reload, & Evaluation; excludes soft-deletes   │
│    • Serves Internal Recovery API (/api/v1/internal/recovery/documents)   │
└───────────┬─────────────────────────────────────────┬─────────────────────┘
            │ Transactional MySQL Pool                │ HTTP (/api/v1/search,
            │ (mysql2/promise, max pool = 5)          │ /health, /internal/index)
            ▼                                         ▼
┌───────────────────────────────┐         ┌─────────────────────────────────┐
│ 3. MySQL 8.4.9 Relational DB  │         │ 4. Python FastAPI Intelligence  │
│    (InnoDB, utf8mb4, :3306)   │         │    Service (:8000, Uvicorn)     │
│    • documents                │         │    backend/app/main.py          │
│    • jobs (leased queue)      │         │    • PyMuPDF + pdfplumber       │
│    • elements (source-of-     │         │    • LayoutOrderRecovery        │
│      truth extracted blocks)  │         │    • Provenance & Platt scaling │
│    • eval_runs                │         │    • In-memory FAISS IndexFlatIP│
│    • document_sequences       │         │    • Startup & on-demand MySQL  │
│    • cleanup_queue            │         │      element recovery           │
│    • _migrations              │         └─────────────────▲───────────────┘
└───────────────▲───────────────┘                           │
                │ SELECT ... FOR UPDATE SKIP LOCKED         │ POST /api/v1/internal/extract
                │ Transactional element replacement         │ POST /api/v1/internal/index
                │ Fenced completeJob / failJob              │ POST /api/v1/search
┌───────────────┴───────────────────────────────────────────┴───────────────┐
│ 5. Standalone Node.js Worker (backend/src/worker.js + backend/src/worker/) │
│    • Independent process (`WorkerRunner` + `createExtractionJobHandler`)  │
│    • Durable lease claim, periodic heartbeats, claim-token + lease-gen    │
│      fencing, retry backoff, graceful/timeout AbortSignal shutdown        │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Responsibilities

| Component | Entrypoints & Core Modules | Primary Responsibilities |
| :--- | :--- | :--- |
| **React Frontend** | [src/App.jsx](file:///d:/DocumentUnderstanding/src/App.jsx), [src/services/api.js](file:///d:/DocumentUnderstanding/src/services/api.js), `src/pages/*` | Six primary views: **Dashboard** (live repository KPIs & recent docs), **Upload** (multipart upload + async worker completion polling), **Library** (search/status filtering, grid/list views, safe soft-delete modal), **Document Viewer** (PDF.js rendering + 2D bounding box overlay + O3 provenance/JSON inspector), **Search** (dense vector search + cross-doc consensus + calibrated/raw confidence indicators), and **Evaluation** (oracle KPI-1..KPI-6 matrix). |
| **Express Orchestrator** | [backend/src/server.js](file:///d:/DocumentUnderstanding/backend/src/server.js), [backend/src/app.js](file:///d:/DocumentUnderstanding/backend/src/app.js), [backend/src/routes/documents.js](file:///d:/DocumentUnderstanding/backend/src/routes/documents.js), [backend/src/routes/search.js](file:///d:/DocumentUnderstanding/backend/src/routes/search.js), [backend/src/routes/health.js](file:///d:/DocumentUnderstanding/backend/src/routes/health.js), [backend/src/routes/evaluation.js](file:///d:/DocumentUnderstanding/backend/src/routes/evaluation.js), [backend/src/routes/internalRecovery.js](file:///d:/DocumentUnderstanding/backend/src/routes/internalRecovery.js), [backend/src/services/recoveryService.js](file:///d:/DocumentUnderstanding/backend/src/services/recoveryService.js) | Sole REST gateway for UI clients (`/api/v1`). Allocates atomic `doc-NNN` IDs, stores validated PDFs in `data/uploads/`, inserts `documents` + queued `jobs` inside one transaction, exposes document metadata/PDF streaming/segments/analytics, enforces soft-delete filtering on search results, proxies evaluation KPIs (with `eval/results/acceptance_latest.json` fallback), and coordinates Python FAISS index recovery via `ensurePythonRecovered()` whenever Python starts or restarts (`instance_id` tracking). |
| **Standalone Worker** | [backend/src/worker.js](file:///d:/DocumentUnderstanding/backend/src/worker.js), [backend/src/worker/runner.js](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js), [backend/src/worker/extractionHandler.js](file:///d:/DocumentUnderstanding/backend/src/worker/extractionHandler.js), [backend/src/worker/pythonClient.js](file:///d:/DocumentUnderstanding/backend/src/worker/pythonClient.js), [backend/src/worker/config.js](file:///d:/DocumentUnderstanding/backend/src/worker/config.js), [backend/src/worker/sanitize.js](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js) | Independent background process. Polls `jobs` using `SKIP LOCKED`, maintains active lease heartbeats across extraction/persistence/indexing, enforces claim-token + `lease_generation` fencing, redacts secrets (`DB_PASSWORD`, `INTERNAL_API_SECRET`) from logs/DB errors, handles `SIGINT`/`SIGTERM` grace timeouts with `AbortController`, and drives Python extraction + MySQL persistence + FAISS indexing + search verification before completing a job. |
| **Python Intelligence Service** | [backend/app/main.py](file:///d:/DocumentUnderstanding/backend/app/main.py), [backend/app/services/document_service.py](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py), [backend/app/api/v1/internal.py](file:///d:/DocumentUnderstanding/backend/app/api/v1/internal.py), [backend/app/api/v1/router.py](file:///d:/DocumentUnderstanding/backend/app/api/v1/router.py) | Runs PDF extraction (`PdfPlumberExtractor` / PyMuPDF), `LayoutOrderRecovery` reading-order topological sorting, `ProvenanceSubsystem` (Platt calibration + SHA-256 lineage), and `FaissRetriever` (`StructuredElementChunker` + in-memory `IndexFlatIP`). Exposes `POST /api/v1/internal/extract` and `POST /api/v1/internal/index` guarded by timing-safe `X-Internal-Secret` auth and symlink/traversal path validation (`validate_pdf_path`), and syncs persisted MySQL elements from Express during `lifespan` startup. |
| **MySQL Repository & Migrator** | [backend/src/db/pool.js](file:///d:/DocumentUnderstanding/backend/src/db/pool.js), [backend/src/db/migrator.js](file:///d:/DocumentUnderstanding/backend/src/db/migrator.js), `backend/src/db/repositories/*.js` | Manages pooled connections, advisory-locked (`docuretrieve_migration_lock`) forward-only SQL migrations with SHA-256 immutability verification, atomic document sequences, durable file cleanup queue, and fenced repository operations (`claimJob`, `heartbeatJob`, `completeJob`, `failJob`, `recoverExpiredLeases`, `replacePersistedElementsFenced`). |

---

## 3. Database Schema Overview

Schema changes are strictly forward-only under `backend/src/db/migrations/` and tracked by SHA-256 checksums in `_migrations`:

| Migration | Tables / Columns Added or Enforced | Purpose |
| :--- | :--- | :--- |
| `001_init.sql` | `documents`, `elements`, `jobs`, `eval_runs` | Base relational schema (`InnoDB`, `utf8mb4`). Unique `documents.sha256`; `elements` supporting modes `('flat', 'reference', 'candidate', 'candidate_ft')` and types `('text', 'heading', 'table', 'formula', 'figure', 'caption')`; `jobs` status ENUM `('queued', 'running', 'done', 'degraded', 'failed')`. |
| `002_schema_compatibility.sql` | `documents.document_id`, `documents.deleted_at`, `jobs` FK `ON DELETE RESTRICT`, `elements.reading_order` + CHECK constraints, `eval_runs` provenance hashes | Adds canonical external ID (`doc-NNN`), soft-delete timestamp, non-destructive job audit FK (`RESTRICT`), `reading_order` column rename, domain bounds (`confidence` in `[0,1]`, `page >= 1`, `reading_order >= 0`), and `dataset_split_hash` / `acceptance_hash`. |
| `003_document_sequences.sql` | `document_sequences` (`sequence_name`, `current_val`) | Atomic transactional counter for monotonically assigning `doc-NNN` external IDs without race conditions. |
| `004_durable_cleanup_queue.sql` | `cleanup_queue` (`id`, `file_path`, `reason`, `doc_id`, `attempts`, `status`, `last_error`) | Durable retry queue (max 5 attempts) when disk cleanup of rolled-back or deleted PDFs fails transiently. |
| `005_worker_leases.sql` | `jobs.locked_by`, `jobs.locked_at`, `jobs.heartbeat_at`, `jobs.lease_timeout_seconds`, composite indexes `(status, heartbeat_at)` & `(status, mode)` | Enables distributed worker lease acquisition, heartbeating, and expired lease recovery (including legacy null-lease recovery). |
| `006_worker_claim_fencing.sql` | `jobs.claim_token` (`CHAR(36)`), `jobs.lease_generation` (`INT NOT NULL DEFAULT 0`) | Monotonic claim fencing so stale workers whose lease expired cannot overwrite elements or transition job/document state. |

---

## 4. End-to-End Extraction, Retrieval & Recovery Pipeline

### 4.1 Ingestion to Searchable Indexing (`upload` -> `done`/`degraded`)
1. **HTTP Ingestion (Express `POST /api/v1/documents/upload` or `/upload-batch`)**:
   - Streams multipart PDF to temp storage, validates `.pdf` extension + `%PDF-` binary header + 50 MB size cap, computes SHA-256 (`documents.sha256`), and moves the file to `data/uploads/<document_id>_<filename>`.
   - Atomically inserts `documents` (`status = 'queued'`) and `jobs` (`status = 'queued'`, `mode = 'flat'` default or requested mode). Returns HTTP `201`.
2. **Fenced Claim & Active Heartbeat (Worker `WorkerRunner`)**:
   - Claims an eligible queued job via `claimJob()` (`SELECT ... FOR UPDATE SKIP LOCKED`), assigning `status = 'running'`, `locked_by = WORKER_ID`, `claim_token = UUIDv4`, incremented `lease_generation`, and incremented `attempts`.
   - Starts periodic `heartbeatJob()` renewals that remain active throughout extraction, MySQL persistence, indexing, and search verification.
3. **Python Extraction (`POST /api/v1/internal/extract`, `skip_indexing: true`)**:
   - Authenticated with `X-Internal-Secret`; `validate_pdf_path` rejects symlinks (`O_NOFOLLOW`), directory traversal, and non-PDF streams.
   - Runs layout extraction, reading-order recovery, and provenance calibration (`O3-v1.0.0`), returning structured elements and `processed` or `degraded` status without mutating FAISS prematurely.
4. **Transactional, Fenced MySQL Persistence (`elementRepository.replacePersistedElementsFenced`)**:
   - Inside one MySQL transaction, verifies the job row is still `running` with matching `(locked_by, claim_token, lease_generation)`.
   - Deletes prior elements for `(doc_id, mode)` and bulk-inserts the newly extracted elements; verifies persisted count via `findByDocumentAndMode()`. Any lease loss aborts before commit.
5. **Latest-Version FAISS Indexing (`POST /api/v1/internal/index`)**:
   - FastAPI `index_persisted_elements()` normalizes persisted bboxes (supporting both `{x_min, y_min, x_max, y_max}` and `{x, y, width, height}`), replaces any previous in-memory chunks/segments for `document_id`, and rebuilds the FAISS index cleanly so stale versions are never served.
6. **Live Search Verification (`POST /api/v1/search`)**:
   - Worker runs a verification query derived from the document's persisted elements against Python `/api/v1/search` and confirms the active `document_id` / `file_hash` matches.
7. **Fenced Completion (`jobRepository.completeJob`)**:
   - Only after steps 2–6 succeed (and `heartbeatJob` confirms intact claim ownership, without expired shutdown grace), updates `jobs.status = 'done' | 'degraded'`, updates `documents.status = 'ready' | 'degraded'`, `pages_count`, and live `metadata` metrics (`text_blocks`, `tables`, `figures`, `headings`, `chunk_count`, `parsing_accuracy`, `search_verified`), and clears lease columns.

### 4.2 Python Restart Recovery & Soft-Delete Exclusion
- **Startup Recovery**: Python's `lifespan()` assigns a unique `instance_id = uuid.uuid4().hex` on `DocumentService` and calls `sync_from_express_recovery()` against Express `GET /api/v1/internal/recovery/documents` (authenticated with `X-Internal-Secret`), purging deleted document IDs and rebuilding in-memory FAISS indexes from persisted MySQL elements via `index_persisted_elements()`.
- **On-Demand Express Reconciliation**: If Express starts before Python or Python restarts independently afterward, `recoveryService.ensurePythonRecovered()` detects any changed Python `instance_id` during Express `startServer()`, `/api/v1/ready`, `/api/v1/health/reload`, `POST /api/v1/search`, or `POST /api/v1/search/aggregate`, re-syncing active MySQL elements and purging soft-deleted documents without creating duplicates.
- **Soft-Delete Filtering**: `DELETE /api/v1/documents/:id` cancels queued jobs, soft-deletes `documents.deleted_at`, purges Python in-memory state via `purgeDocumentFromPython()`, and queues disk PDF removal via `cleanup_queue`. Express `searchRouter` also runs `fetchDeletedDocumentIds()` against MySQL to guarantee soft-deleted documents never appear in search results even across out-of-band deletions or partial restarts.

---

## 5. Local Run Instructions

### Prerequisites
- **Node.js** `v22.13.1` (tested; v20+ required for native ESM & `fetch`) and **npm**
- **Python 3.11+** with virtual environment at `.venv/` (`.\.venv\Scripts\python.exe`)
- **MySQL Server 8.4+** running locally (default `127.0.0.1:3306`, database `docuretrieve`)

### Configuration (`.env`)
Copy `.env.example` to `.env` and populate non-default values cleanly (never commit real secrets):
```dotenv
NODE_ENV=development
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=docuretrieve_user
DB_PASSWORD=<set-db-password>
DB_NAME=docuretrieve
PYTHON_SERVICE_URL=http://127.0.0.1:8000
INTERNAL_API_SECRET=<set-shared-internal-secret>
PYTHON_EXTRACTION_TIMEOUT_MS=60000
EXPRESS_SERVICE_URL=http://127.0.0.1:3001
```
Optional worker environment variables:
- `WORKER_ID` (defaults to generated `worker_<hostname>_<pid>_<hex>`)
- `WORKER_CONCURRENCY` (default `1`, validated `1..64`)
- `WORKER_POLL_INTERVAL_MS` (default `2000`)
- `WORKER_HEARTBEAT_INTERVAL_MS` (default `15000`)
- `WORKER_SHUTDOWN_GRACE_MS` (default `30000`)
- `WORKER_MAX_ATTEMPTS` (default `3`)

### Startup Commands (Run Each Process in Its Own Terminal)

1. **Ensure MySQL 8.4 is running & apply schema migrations (`001`–`006`)**:
   ```powershell
   node -e "import('./backend/src/db/migrator.js').then(async (m) => { await m.runMigrations(); process.exit(0); })"
   ```
2. **Start Python FastAPI Intelligence Service (`port 8000`)**:
   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
   ```
3. **Start Express API Orchestrator (`port 3001`)**:
   ```powershell
   node backend/src/server.js
   ```
4. **Start Standalone Node.js Worker (independent process)**:
   ```powershell
   node backend/src/worker.js
   ```
5. **Start Vite Frontend (`port 5173`)**:
   ```powershell
   npm run dev
   ```

### Health & Readiness Verification
- Express liveness: `GET http://127.0.0.1:3001/api/v1/health` (`status: "healthy"`, `python_instance_id`)
- Express readiness: `GET http://127.0.0.1:3001/api/v1/ready` (`status: "ready"`, checks `mysql` + `python_service`)
- FastAPI health: `GET http://127.0.0.1:8000/api/v1/health` (`status: "healthy"`, `instance_id`, `index_size`)
- Frontend UI: `http://localhost:5173/`

---

## 6. Exact Verified Test Commands & Results

All verification checks below ran against the final codebase state (`0` added comments in diffs/new files, clean MySQL state `{ docs: 0, jobs: 0, elements: 0 }` afterward):

| Suite / Check | Exact Command | Observed Result |
| :--- | :--- | :--- |
| **Frontend & JS/JSX Lint** | `npm run lint` | `Found 45 warnings and 0 errors. Finished in 84ms on 74 files` (`exit=0`) |
| **Vite Production Build** | `npm run build` | `1903 modules transformed... built in 1.33s` (`exit=0`) |
| **Python Lint (Modified Targets)** | `.\.venv\Scripts\ruff.exe check backend/app/main.py backend/app/config.py backend/app/api/v1/internal.py backend/app/schemas/common.py backend/app/schemas/internal.py backend/app/services/document_service.py backend/retrieval/retriever.py tests/test_internal_extract.py` | `All checks passed!` (`exit=0`) |
| **Full Python Suite (Pytest)** | `.\.venv\Scripts\python.exe -m pytest -v --tb=short` | `121 passed in 400.16s (0:06:40)` (`exit=0`) |
| **DB Migration Immutability & Audit** | `node backend/src/db/tests/test_migration.js` | `ALL M1.3.4 MIGRATION IMMUTABILITY & AUDIT TESTS PASSED [PASS]` (`exit=0`) |
| **MySQL Connection Pool Audit** | `node backend/src/db/tests/test_pool.js` | `ALL M1.4.1 AUDIT TESTS PASSED: 14 / 14 [PASS]` (`exit=0`) |
| **Repository & Lease Fenced Concurrency** | `node backend/src/db/tests/test_repositories.js` | `ALL M1.5 REPOSITORY TESTS PASSED: 49 / 49 [PASS]` (`exit=0`) |
| **Documents & Elements Integration** | `node backend/src/tests/test_documents.js` | `28/28 PASSED` (`exit=0`) |
| **Express Server Integration** | `node backend/src/tests/test_express.js` | `14/14 PASSED` (`exit=0`) |
| **Upload & Durable Cleanup Lifecycle** | `node backend/src/tests/test_upload_lifecycle.js` | `41/41 PASSED` (`exit=0`) |
| **Standalone Worker Foundation** | `node backend/src/tests/test_worker.js` | `11 / 11` PASSED (`exit=0`) |
| **Worker + Python Extraction & Fencing** | `node backend/src/tests/test_python_worker.js` | `SUMMARY: 18/18 TESTS PASSED` (includes live Uvicorn integration, `exit=0`) |
| **End-to-End Upload -> Search -> Restart Recovery** | `node backend/src/tests/test_e2e_upload_to_search.js` | `7/7 PASSED` (`exit=0`, verified Python restart recovery & soft-delete search exclusion) |
| **Fresh Full-Stack Startup Probe** | `node .../scratch/verify_fresh_startup.mjs` | `FRESH_STARTUP_VERIFIED` (`mysql: healthy`, `fastapi: healthy`, `express: healthy/ready`, `worker_started: true`, `vite_html_ok: true`, `secrets_leaked: 0`, `exit=0`) |
| **Live Browser UI Verification (Playwright)** | Live interaction across all 6 screens against running Vite + Express + Worker + FastAPI + MySQL | `0` console errors, `0` warnings; verified Dashboard metrics, Upload live worker polling (`1 / 1 Succeeded`, `Indexed & Ready`), Library delete flow, Document Viewer PDF.js + bbox inspector, Search pre/post Python restart + `"Low Confidence"` fix, and Evaluation KPI matrix |

*Note on repository-wide Ruff*: Running `.\.venv\Scripts\ruff.exe check backend eval tests` also flags 2 pre-existing `I001` import-order notices in untouched test files (`tests/test_api.py` and `tests/test_multi_document.py`).

---

## 7. Known Limitations

1. **In-Memory Non-Durable FAISS Index**:
   - `FaissRetriever` (`IndexFlatIP`) stores embeddings strictly in RAM inside the Python FastAPI process and does **not** persist FAISS binary indexes directly to disk.
   - *Mitigation*: Every extracted element is stored transactionally in MySQL (`elements`). When Python restarts, either Python's startup hook (`sync_from_express_recovery`) or Express's `instance_id`-keyed `ensurePythonRecovered()` automatically rebuilds FAISS chunks from persisted MySQL elements (`index_persisted_elements`) without re-running PDF extraction and purges soft-deleted documents.
2. **SHA-256 Deduplication Across Soft-Deleted Records**:
   - `documents.sha256` enforces a table-wide `UNIQUE` constraint (`uq_documents_sha256`). Soft-deleting a document sets `deleted_at` while keeping the row for job audit history (`fk_jobs_document ... ON DELETE RESTRICT`), so re-uploading byte-identical PDF content after soft deletion is rejected / marked `Failed` explaining that a document with that SHA-256 already exists.
3. **Seed Corpus Files in `data/uploads/`**:
   - On startup, Python's `DocumentService._initialize_baseline_repository()` loads existing PDF files present in `data/uploads/` into Python's in-memory search corpus (`documents_count: 158`, `indexed_chunks: 602`), whereas Express's `documents` endpoints and MySQL track only explicitly uploaded relational documents. Searching Express `/api/v1/search` can return matches from both newly uploaded MySQL-backed documents and pre-existing seed PDFs in `data/uploads/` (soft-deleted MySQL `document_id`s are explicitly filtered out).
4. **Pre-Existing Lint Warnings**:
   - `npm run lint` reports 45 pre-existing warnings (`0` errors) across legacy files/tests, and global `ruff check backend eval tests` has 2 untouched `I001` warnings in `tests/test_api.py` and `tests/test_multi_document.py`.

---

## 8. End-to-End Demo Walkthrough

1. **Start Stack**: Start MySQL (`3306`), FastAPI (`8000`), Express (`3001`), Worker (`backend/src/worker.js`), and Vite (`5173`). Open `http://localhost:5173` — **Dashboard** shows live repository counts (`0` initially on a clean database) and sidebar footer shows `FastAPI Connected • Live`.
2. **Batch Upload & Live Worker Progress**: Navigate to **Upload Documents**, select a PDF containing searchable domain text, and click **Upload & Ingest All 1 File**. Express returns `201` with `Queued`, the standalone worker claims the job, extracts via `POST /api/v1/internal/extract`, saves elements to MySQL, indexes into FAISS via `POST /api/v1/internal/index`, verifies search, and marks the doc `ready`. Upload page polling automatically updates the card to **Indexed & Ready** (`1 / 1 Succeeded`).
3. **Cross-Document Search & Document Viewer**: Navigate to **Search & Retrieval**, enter a phrase from the PDF, and run **Search**. Confirm top match relevance score and click **Inspect in Viewer** to open **Document Viewer**, showing the rendered PDF canvas, spatial bounding box overlays, sequence order (`Seq #0`), calibrated/raw confidence, and exact `[x, y, w, h]` coordinates.
4. **Live Python Restart Recovery**: Stop the FastAPI Uvicorn process cleanly, then restart it. Return to **Search & Retrieval** and re-run the same query. Express / FastAPI startup recovery rebuilds FAISS from persisted MySQL `elements` (`recovered_from_mysql: 1`), and the document remains immediately searchable with zero duplicate hits.
5. **Evaluation & KPIs**: Open **Evaluation & KPIs** to inspect the empirical `KPI-1`..`KPI-6` matrix served via `/api/v1/evaluation/latest` (`ACCEPT`, `1.000` Cohen's kappa, frozen `data/acceptance.lock`).
6. **Soft Delete & Search Exclusion**: Open **Documents Library**, click **Delete** -> **Delete Document**. Express marks `deleted_at` in MySQL, purges Python's in-memory index entry, and schedules disk cleanup; re-running Search confirms the deleted document is excluded from retrieval results.
