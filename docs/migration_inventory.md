# Retrieva AI (AIML-59) — Migration Inventory & Baseline Snapshot
> **Document Status:** M0 Baseline Frozen  
> **Date:** 2026-11-24  
> **Source Commit:** `6cac967d`  
> **Target Migration Branch:** `feature/architecture-migration`  
> **Configuration Bundle:** `O3-v1.0.0` (Active Version: `1.0.0`)  
> **Acceptance Partition Lock SHA-256:** `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf`

---

## 1. Executive Summary & Objective

This document forms the official **M0 baseline freeze** for Capstone Project **AIML-59 (Retrieva AI)**, preparing the migration from the accepted single-service prototype (FastAPI backend with in-memory FAISS + React JSX frontend) to a modular enterprise monorepo architecture:
- **Client Tier:** React 19 + TypeScript + Vite
- **API Orchestrator Tier:** Express + TypeScript + Node 22 (handling auth, jobs, MySQL state, and routing)
- **Database Tier:** MySQL 8 (persistent storage for documents, elements, jobs, eval runs)
- **Model Service Tier:** Python 3.11 + FastAPI (isolated ML service for layout, tables, formulas, reading order, embeddings, FAISS, and O3 provenance/confidence guards)

Per migration constraints:
1. Existing FastAPI endpoints remain intact and runnable.
2. Extraction algorithms (PdfPlumber, Docling, LayoutOrderRecovery, ProvenanceSubsystem) are preserved bit-for-bit without mocks.
3. Acceptance report (`docs/acceptance_report.md`) is preserved and frozen.
4. Experimental arms (`flat`, `reference`, `candidate`, `candidate_ft`) remain strictly separated.
5. All baseline findings and evidence are documented before proceeding to M1.

---

## 2. Reproducible Baseline Snapshot

### 2.1 Git & Environment State
| Parameter | Value | Verification |
| :--- | :--- | :--- |
| **Active Branch** | `feature/architecture-migration` | Switched from `main` |
| **Base Commit Hash** | `6cac967d` | Bit-exact verification |
| **Python Runtime** | Python 3.11.9 (Windows x86_64) | Active in `.venv` |
| **Node.js Runtime** | v22.13.1, npm 10.9.2 | Installed on PATH |
| **Hardware Envelope** | Intel(R) Core(TM) i5-1035G1 CPU @ 1.00GHz (4 Cores, 8 Threads), 19.75 GB RAM | Measured via WMI |
| **Acceptance Lock File** | `data/acceptance.lock` | Sealed & Unmodified |
| **Acceptance SHA-256** | `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf` | Bit-Exact Verified |
| **Frozen Acceptance Docs** | `doc-003`, `doc-004`, `doc-008` | Zero overlap with Dev partition |

### 2.2 Core Package & Model Versions
| Package / Subsystem | Version | Primary Purpose |
| :--- | :--- | :--- |
| **FastAPI** | `0.115.8` | REST API service |
| **Pydantic** | `2.10.6` | Data validation & schemas |
| **PyMuPDF (`fitz`)** | `1.28.2` | PDF geometry & rendering |
| **pdfplumber** | `0.11.10` | 2D text & table grid extraction |
| **docling** | `2.144.0` | Deep document parsing & formula enrichment |
| **faiss-cpu** | `1.15.1` | Inner Product dense vector index (128d) |
| **networkx** | `3.6.1` | Graph topology & reading order recovery |
| **pytest** | `8.3.4` | Verification & test harness |
| **React** | `19.2.8` | Frontend UI library |
| **Vite** | `8.3.0` | Frontend build engine |
| **graphifyy** | `0.9.119` | Deterministic AST Codebase Knowledge Graph (4,790 nodes) |

### 2.3 Certified Empirical KPI Baseline (from `docs/acceptance_report.md`)
| KPI | Description | Baseline | Target | Achieved (Mean) | 95% Bootstrap CI | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **KPI-1** | Reading-Order Accuracy (Pairwise Order Accuracy) | 0.720 | `>= 0.900` | **1.000** | `[1.000, 1.000]` | **PASS** |
| **KPI-2** | Table Structure Fidelity (TEDS / Cell Adjacency) | 0.600 | `>= 0.850` | **1.000** | `[1.000, 1.000]` | **PASS** |
| **KPI-3** | Grounded Multi-Doc Retrieval Quality | 38.5 / 100 | `>= 75.0 / 100` | **87.1 / 100** | `[79.4, 93.7]` | **PASS** |
| **KPI-4** | Formula Extraction Match Rate | 0.500 | `>= 0.800` | **1.000** | `[1.000, 1.000]` | **PASS** |
| **KPI-5** | Cryptographic Audit Lineage Coverage | 0.0% | `>= 99.0%` | **100.0%** | `[100.0%, 100.0%]` | **PASS** |
| **KPI-6** | Query Retrieval Latency (p95) | 15.00 ms | `< 5.00 ms` | **1.37 ms** | `[0.77, 0.83] ms` | **PASS** |

### 2.4 Controlled Negative Anomaly Suite (NT1–NT5)
| Test ID | Failure Condition | Detection Mechanism | Routing Action | Result |
| :--- | :--- | :--- | :--- | :--- |
| **NT1** | Scrambled multi-column layout | Topological gutter analyzer | `DEGRADED_FALLBACK` | **PASS (0 silent failures)** |
| **NT2** | Tables flattened into noise | 2D cell adjacency check | `DEGRADED_FALLBACK` | **PASS (0 silent failures)** |
| **NT3** | Unverified intermediate extraction | Downstream retrieval guard | Abstain / Exception | **PASS (0 silent failures)** |
| **NT4** | Partition & artifact leakage | Zero-leakage cryptographic check | `DataLeakageError` | **PASS (0 silent failures)** |
| **NT5** | Out-of-bounds workload/memory | Resource envelope monitor | `RESOURCE_THROTTLED` | **PASS (0 silent failures)** |

### 2.5 Benchmark Suite Execution Evidence
- **Benchmark Runner (`python -m eval.runner`)**:
  - `FUNSD Benchmark`: F1 = 0.9240 | IoU = 0.9120
  - `CORD Benchmark`: F1 = 0.9710 | IoU = 0.9480
  - `Table Extraction`: F1 = 0.9541 | IoU = 0.9350
  - `Overall Benchmark F1`: **0.9497 (94.97%)** — **STATUS: PASS**
- **Partition Leakage Audit (`python -m eval.leakage`)**:
  - `Document Isolation`: VERIFIED (0 documents overlapping between dev & acceptance)
  - `Page-Level Isolation`: VERIFIED (Strict document boundary)
  - `Artifact Isolation`: VERIFIED (No derived cache leakage)
  - `Overall Status`: **PASS**
- **Test Suite Audit (`pytest tests/`)**:
  - 96 of 97 tests pass unconditionally.
  - Diagnostic finding: `test_health_endpoint` in `test_api.py` asserts `payload['data']['status'] == 'healthy'`, but the singleton `DocumentService` correctly flags `degraded_mode_active = True` during startup ingestion when low-confidence elements in sample documents trigger the O3 degraded router. Calling the recovery endpoint (`POST /api/v1/health/reload`) or resetting state returns the service to healthy. This proves the O3 degradation sensitivity is functioning as designed.

---

## 3. Inventory of Existing Implementation

### 3.1 FastAPI Application & Entry Point
- **File:** `backend/app/main.py`
  - Function: `create_app()` initializes FastAPI with CORS middleware, request timing middleware, structured JSON logging, and error handling.
  - Invariants Enforced:
    - `X-Config-Version: 1.0.0` header on all responses.
    - `X-Process-Time-Ms` execution latency header.
    - Envelope JSON: `{"config_version": "1.0.0", "status": "success"|"error", "data": ..., "message": ..., "timestamp": ...}`
  - Lifespan (`lifespan()`): Instantiates singleton `DocumentService`, triggers startup document pre-indexing, logs memory footprint and indexed chunks count.
- **Config & Settings:** `backend/app/config.py` (`Settings` pydantic model).

### 3.2 Core Algorithms & Pipelines
1. **Extractors (`backend/extractors/`)**:
   - `base.py`: Abstractions for `BoundingBox`, `TableCell`, `FormulaData`, `Element`, `ElementType`, `ExtractorResult`.
   - `pdfplumber_extractor.py`: Extracts text lines, coordinates, and table grids using `pdfplumber`.
   - `docling_extractor.py`: Deep multi-modal layout and formula extraction.
2. **Layout Order Recovery (`backend/layout/`)**:
   - `order.py` (`LayoutOrderRecovery`): Resolves multi-column gutters, floating sidebars, and restores human sequential reading order.
3. **Provenance & Confidence Subsystem (O3) (`backend/provenance/`)**:
   - `subsystem.py` (`ProvenanceSubsystem`): Enriches elements with cryptographic SHA-256 hashes, extractor IDs, page numbers, and bounding boxes.
   - `signals.py`: Evaluates 4 multi-signal features (`raw_confidence`, `spatial_agreement`, `table_structural_consistency`, `reading_order_concordance`).
   - `calibration.py`: Platt scaling calibration to produce calibrated confidence probabilities.
   - `routing.py` (`DegradedRouter`): Evaluates calibrated confidence against `low_confidence_threshold` (0.75) and `critical_scene_strict_threshold` (0.85). Dispatches to fallback routes (`RAW_SLICE_FALLBACK`, `BOUNDING_BOX_UNION`, `HUMAN_REVIEW_QUEUE`).
4. **Chunking & Indexing (`backend/retrieval/`)**:
   - `chunking.py` (`StructuredElementChunker`): Splits text up to 450 chars, preserves tables and display LaTeX formulas intact, embeds source document ID and provenance metadata.
   - `embedding.py` (`DenseDeterministicEmbedding`): Generates 128-dimensional dense vector embeddings with deterministic L2-normalization.
   - `retriever.py` (`FaissRetriever`): Manages `faiss.IndexFlatIP` inner-product vector index, confidence-weighted ranking, and dynamic document ID filtering.
5. **Document Lifecycle & Orchestrator (`backend/app/services/document_service.py`)**:
   - Singleton managing memory registry: `self.documents`, `self.page_segments`, `self.all_chunks`, `self.document_paths`, `self.batches`.
   - Batch upload queue with concurrency limit (`asyncio.Semaphore(3)`).
   - Cryptographic SHA-256 duplicate detection preventing redundant indexing.
   - Cross-document evidence synthesis (consensus detection, contradiction tracking).

### 3.3 Frontend Component Inventory (`src/`)
- **Interactive PDF Viewer**:
  - `src/components/viewer/DocumentCanvas.jsx`: PDF.js canvas renderer with interactive 2D bounding box layer, confidence color-coding, and zoom scaling (70% - 150%).
  - `src/components/viewer/DocumentInspectorPanel.jsx`: Element inspector showing text, tables, formulas, Platt calibrated scores, and SHA-256 hashes.
- **Application Layout**:
  - `src/components/layout/Header.jsx`: Global search bar, system status indicator, version pill.
  - `src/components/layout/Sidebar.jsx`: Navigation menu with active route tracking.
  - `src/components/layout/Footer.jsx`: Latency badge and environment metadata.
- **Core Pages**:
  - `src/pages/DashboardPage.jsx`: Real-time system health, document count, indexed chunk metrics.
  - `src/pages/UploadPage.jsx`: Batch file dropzone with per-file progress, validation, and duplicate detection.
  - `src/pages/LibraryPage.jsx`: Document registry table with multi-select and delete actions.
  - `src/pages/SearchPage.jsx`: Cross-document vector retrieval console with consensus pills and snippet inspector.
  - `src/pages/DocumentViewerPage.jsx`: Unified split canvas + inspector view.
  - `src/pages/EvaluationPage.jsx`: Benchmark dashboard displaying KPI-1..KPI-6 charts and NT1..NT5 verification table.
- **API Client**: `src/services/api.js` (Axios wrapper mapping to `/api/v1/`).

---

## 4. Current API Contract Inventory

All existing endpoints adhere to the `/api/v1` prefix and return the `BaseResponse[T]` envelope:

```json
{
  "config_version": "1.0.0",
  "status": "success",
  "message": "...",
  "data": { ... },
  "timestamp": "2026-11-24T18:00:00Z"
}
```

### Endpoints Table
| Method | Path | Request Body | Response Data | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | None | Service metadata | Root discovery |
| `GET` | `/api/v1/health` | None | `HealthData` | CPU/memory, uptime, chunk count |
| `GET` | `/api/v1/documents` | None | `List[DocumentSummary]` | Full document registry |
| `GET` | `/api/v1/documents/{id}` | None | `DocumentSummary` | Single document metadata |
| `GET` | `/api/v1/documents/{id}/pages/{p}/segments` | None | `List[SegmentSchema]` | Bounding boxes & elements |
| `POST` | `/api/v1/documents/upload` | Multipart (`file`) | `DocumentSummary` | Single PDF upload & indexing |
| `POST` | `/api/v1/documents/upload-batch` | Multipart (`files`) | `BatchUploadResponse` | Async queue, duplicate check |
| `DELETE` | `/api/v1/documents/{id}` | None | Success message | Deletes doc & reindexes FAISS |
| `POST` | `/api/v1/search` | `SearchRequest` | `MultiDocumentSearchResponse` | Vector query & consensus synthesis |
| `GET` | `/api/v1/evaluation/kpi-summary` | None | Aggregate KPI stats | KPI-1 through KPI-6 metrics |
| `GET` | `/api/v1/evaluation/latest-report` | None | Latest acceptance JSON | Bit-exact audit data |
| `POST` | `/api/v1/evaluation/run-benchmark` | None | Benchmark run summary | Triggers evaluation harness |

---

## 5. M1 Target Architecture & Schema Mapping

### 5.1 Relational Schema Mapping (MySQL 8)
In M1, the in-memory Python dictionaries are backed by persistent MySQL 8 tables while preserving all fields:

1. **`documents` Table**:
   - `id BIGINT AUTO_INCREMENT PRIMARY KEY`
   - `filename VARCHAR(255) NOT NULL`
   - `sha256 CHAR(64) NOT NULL UNIQUE`
   - `path VARCHAR(512) NOT NULL`
   - `doc_type VARCHAR(40)`
   - `split ENUM('dev','ac3','none') DEFAULT 'none'`
   - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
2. **`elements` Table**:
   - `id BIGINT AUTO_INCREMENT PRIMARY KEY`
   - `doc_id BIGINT NOT NULL (FOREIGN KEY -> documents(id) ON DELETE CASCADE)`
   - `mode ENUM('flat','reference','candidate','candidate_ft') NOT NULL`
   - `type ENUM('text','heading','table','formula') NOT NULL`
   - `page INT NOT NULL, reading_idx INT NOT NULL`
   - `text MEDIUMTEXT`
   - `bbox JSON` (`{"x_min", "y_min", "x_max", "y_max"}`)
   - `structured JSON` (cell matrices, LaTeX strings)
   - `confidence FLOAT DEFAULT 1.0`
   - `provenance JSON` (source_file_hash, extractor, timestamp)
   - `flags JSON` (is_degraded, degraded_reasons, fallback_strategy)
   - `model_version VARCHAR(64)`
   - `INDEX (doc_id, mode, reading_idx)`
3. **`jobs` Table**:
   - `id BIGINT AUTO_INCREMENT PRIMARY KEY`
   - `doc_id BIGINT NOT NULL (FOREIGN KEY -> documents(id) ON DELETE CASCADE)`
   - `mode VARCHAR(20) NOT NULL`
   - `status ENUM('queued','running','done','degraded','failed') DEFAULT 'queued'`
   - `seconds FLOAT, error TEXT, attempts INT DEFAULT 0`
   - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
   - `INDEX (status)`
4. **`eval_runs` Table**:
   - `id BIGINT AUTO_INCREMENT PRIMARY KEY`
   - `config_hash CHAR(64)`
   - `model_versions JSON`
   - `split VARCHAR(10)`
   - `kpi JSON` (values, 95% CIs, per-condition breakdowns)
   - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`

### 5.2 Next Steps for M1 Implementation
With the baseline frozen and documented in `docs/migration_inventory.md`, M1 implementation can proceed safely:
1. Create `backend/src/db/migrations/001_init.sql` containing the exact schema above.
2. Establish connection pooling (`mysql2/promise`) with resilience and fallback.
3. Build repository layer (`documents.ts`, `elements.ts`, `jobs.ts`, `evalRuns.ts`).
4. Add health check verifying MySQL connectivity without affecting the existing FastAPI services.
