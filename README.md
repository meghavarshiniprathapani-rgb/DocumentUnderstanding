# Retrieva AI — Document Understanding & Spatial Retrieval System (AIML-59, KL University)

[![Python 3.13.5](https://img.shields.io/badge/Python-3.13.5-3776AB.svg?style=flat&logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115.8-009688.svg?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19.2.8-61DAFB.svg?style=flat&logo=react)](https://react.dev/)
[![Vite 8](https://img.shields.io/badge/Vite-8.3.0-646CFF.svg?style=flat&logo=vite)](https://vitejs.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4.3.3-38B2AC.svg?style=flat&logo=tailwindcss)](https://tailwindcss.com/)
[![Pytest 8](https://img.shields.io/badge/Pytest-8.3.4-0A9EDC.svg?style=flat&logo=pytest)](https://pytest.org/)
[![Oxlint](https://img.shields.io/badge/Oxlint-v1.81.0-orange.svg?style=flat)](https://oxc.rs/)
[![Acceptance Status](https://img.shields.io/badge/Acceptance-VERIFIED_PASS-success.svg?style=flat)](docs/acceptance_report.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](LICENSE)

---

> **Institution:** Koneru Lakshmaiah Education Foundation (KL University), Vaddeswaram, AP, India  
> **Department:** Department of Computer Science & Engineering / Artificial Intelligence & Machine Learning  
> **Project Code:** Capstone Project AIML-59  
> **Lead Researcher & Engineer:** Meghavarshini Prathapani  
> **Configuration Bundle:** `O3-v1.0.0` (Active Version: `1.0.0`)  
> **Acceptance Split SHA-256:** `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf`  
> **Evaluation Report:** [`/docs/acceptance_report.md`](docs/acceptance_report.md) | **API Reference:** [`/docs/api.md`](docs/api.md) | **Operations:** [`/docs/operating_guide.md`](docs/operating_guide.md)

---

## 1. Problem Statement

Enterprise documents—including regulatory filings, financial statements, clinical study reports, compliance covenants, and technical research whitepapers—are complex **two-dimensional visual artifacts**. Standard text extraction and retrieval-augmented generation (RAG) pipelines suffer from five critical failure modes:

1. **Reading-Order Scrambling in Multi-Column Layouts**: Conventional extractors sort tokens naively by vertical coordinate ($y$), reading horizontally across page gutters. This interleaves adjacent columns and fractures paragraph semantics into incoherent text strings.
2. **Tabular Disintegration**: Complex multi-row and multi-column tables lose their structural coordinate grids when flattened into unstructured prose. Queries targeting specific balance-sheet cells or benchmark rows hallucinate numbers from adjacent columns.
3. **Mathematical Formula Corruption**: Display and inline formulas are stripped of syntactic operators, superscripts, and subscripts, destroying mathematical integrity.
4. **Absence of Verifiable Cryptographic Lineage**: Standard RAG frameworks return coarse text snippets without spatial bounding boxes ($[x, y, w, h]$) or document hash lineage, making visual verification on the original PDF impossible.
5. **Silent Failures in Degraded States**: Traditional search engines return low-confidence or corrupt text without diagnostic warnings, silently passing corrupted extractions to downstream generative models.

Retrieva AI addresses these failure modes by combining **multi-column reading-order recovery**, **structured table cell extraction**, **syntactic LaTeX formula preservation**, **cryptographic SHA-256 provenance tracking**, and **calibrated multi-signal confidence gating with transparent degraded routing**.

---

## 2. System Architecture

Retrieva AI integrates a Python FastAPI backend and a React 19 frontend into an auditable document intelligence pipeline:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                RETRIEVA AI ARCHITECTURE                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  1. INGESTION & PARSING                                                                │
│     PDF Upload ──► Magic Byte & Size Validation ──► PdfPlumberExtractor (fitz/plumber)│
│                                                                                        │
│  2. TOPOLOGY & READING ORDER RECOVERY                                                  │
│     Raw Elements ──► Multi-Column Gutter Detection ──► Floating Sidebar Isolation      │
│                      ──► LayoutOrderRecovery (Sequential Column-First Traversal)       │
│                                                                                        │
│  3. O3 CRYPTOGRAPHIC PROVENANCE & CALIBRATION                                          │
│     Ordered Elements ──► SHA-256 File Digest ──► Spatial BBox Tracking                 │
│                          ──► Multi-Signal Fusion (Table F1 + Dual Agreement + Order)   │
│                          ──► Platt Scaling Calibration ──► DegradedPathRouter          │
│                                                                                        │
│  4. CHUNKING & DENSE VECTOR RETRIEVAL                                                  │
│     Enriched Elements ──► StructuredElementChunker (Preserves Tables & Formulas Whole) │
│                         ──► DenseDeterministicEmbedding (128d Orthonormal Subspace)    │
│                         ──► FaissRetriever (Confidence-Weighted Vector Search)         │
│                                                                                        │
│  5. REST API & INTERACTIVE CANVAS INSPECTOR                                            │
│     FastAPI (/api/v1) ──► PDF.js Underlay ──► Interactive Bounding Box Canvas Overlays │
│                           ──► Tri-Pane Inspector (Provenance, Confidence, Latex, Grid) │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architectural Subsystems
- **Extractor Module (`backend/extractors/`)**: Dual-engine interface (`base.py`) supporting Extractor A (Docling) and Extractor B (PyMuPDF + pdfplumber). As documented in [ADR-001](docs/adr_001_reference_choice.md), Extractor B was selected as the reference implementation due to a 130x latency advantage ($11.97\text{ ms}$ vs $1,615\text{ ms}$ p50) and 30x lower memory overhead ($0.09\text{ MB}$ vs $2.96\text{ MB}$).
- **Layout & Reading-Order Recovery (`backend/layout/`)**: Multi-column segmentation engine that detects gutter whitespace, isolates running headers and footers, and preserves body reading flow without fracturing on floating sidebars.
- **O3 Provenance & Calibrated Confidence Subsystem (`backend/provenance/`)**: Isolated subsystem that computes document SHA-256 digests, tracks spatial bounding boxes, fits Platt scaling calibration across independent signals, and routes uncertain extractions ($< 0.75$) to degraded mode.
- **Structured Retrieval Engine (`backend/retrieval/`)**: Boundary-aware chunker that keeps tables and display formulas intact, coupled to a FAISS `IndexFlatIP` retriever utilizing 128-dimensional dense subword embeddings.
- **API & UI Layer (`backend/app/`, `src/`)**: FastAPI REST service exposing structured logging, timing headers, and recovery paths, connected to a React 19 / Vite console featuring PDF.js page rendering with clickable bounding-box overlays.

---

## 3. How to Reproduce

Evaluation can be reproduced on the frozen acceptance partition with **one command**:

### 3.1 One-Command Acceptance Run

```bash
# On Windows Command Prompt / PowerShell
make accept
# or:
make.cmd accept

# On POSIX / Linux / macOS
make accept
```

This single command executes [`eval/run_acceptance.py`](eval/run_acceptance.py), which automatically:
1. Cryptographically verifies [`data/acceptance.lock`](data/acceptance.lock) against [`data/manifest.yaml`](data/manifest.yaml) (asserting SHA-256 hash match).
2. Audits partitions to confirm zero document or page leakage between dev and acceptance splits.
3. Runs all 5 controlled negative anomaly tests (NT1 to NT5) and asserts zero silent failures.
4. Executes AC-1 (representative operation on acceptance documents `doc-003`, `doc-004`, `doc-008`).
5. Executes AC-2 (boundary and failure mode operation).
6. Computes KPI-1 through KPI-6 with 95% bootstrap confidence intervals (1,000 resamples), evaluating small, rare, and critical cases independently.
7. Measures query latency and memory across 270 warm trials for AC-4 parity evaluation.
8. Writes empirical artifacts to [`docs/acceptance_report.md`](docs/acceptance_report.md) and [`eval/results/acceptance_latest.json`](eval/results/acceptance_latest.json).

### 3.2 Full Environment Setup & Testing

```bash
# 1. Setup virtual environment and install pinned dependencies
make setup

# 2. Execute backend unit test suite (91 tests) and build frontend
make test

# 3. Run code quality linters (Ruff and Oxlint)
make lint

# 4. Start the FastAPI backend server (http://localhost:8000)
make run-backend

# 5. Start the Vite frontend development server (http://localhost:5173)
make run-frontend
```

---

## 4. Empirical Evaluation Results

All figures reported below were measured directly on the **frozen independent acceptance partition** (`doc-003`, `doc-004`, `doc-008`) and are linked to their source JSON artifacts in [`eval/results/`](eval/results/).

### 4.1 Key Performance Indicator (KPI) Acceptance Matrix

| KPI ID | Performance Dimension | Baseline | Target | Achieved (Mean) | 95% Bootstrap CI | Unit | Subgroups | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **KPI-1** | Reading-Order Accuracy (POA) | 0.720 | $\ge 0.900$ | **1.000** | `[1.000, 1.000]` | Accuracy [0, 1] | All Pass | **PASS** |
| **KPI-2** | Table Structure Fidelity (TEDS / F1) | 0.600 | $\ge 0.850$ | **1.000** | `[1.000, 1.000]` | Cell-Adjacency F1 | All Pass | **PASS** |
| **KPI-3** | Grounded Retrieval & Synthesis | 38.5 / 100 | $\ge 75.0$ / 100 | **84.7 / 100** | `[75.7, 92.9]` | Rubric (0-100) | All Pass | **PASS** |
| **KPI-4** | Formula Extraction Match Rate | 0.500 | $\ge 0.800$ | **1.000** | `[1.000, 1.000]` | Normalization F1 | All Pass | **PASS** |
| **KPI-5** | Audit Lineage Coverage | 0.0% | $\ge 99.0\%$ | **100.0%** | `[100.0%, 100.0%]` | % Coverage | All Pass | **PASS** |
| **KPI-6** | Query Retrieval Latency (p95) | 15.00 ms | $< 5.00$ ms | **1.44 ms** | `[0.87, 0.94]` ms | Milliseconds | All Pass | **PASS** |

*Primary Evidence Artifact:* [`eval/results/acceptance_latest.json`](eval/results/acceptance_latest.json) | *Full Report:* [`docs/acceptance_report.md`](docs/acceptance_report.md)

### 4.2 Auxiliary Benchmark Metrics
- **Peak Process Memory**: **0.04 MB** traced via `tracemalloc` (budget $< 50.0\text{ MB}$).
- **Inter-Rater Reliability**: Quadratically weighted Cohen's kappa $\kappa_w = \mathbf{1.0000}$ on the KPI-3 rubric across two independent raters.
- **Downstream Retrieval Precision**: $\text{Hit@1} = 0.667$, $\text{Hit@3} = 0.889$, $\text{MRR} = 0.800$, $\text{Answer Grounding Rate} = 0.556$.
- **Negative Anomaly Suite**: 5/5 failure cases detected; **0 silent failures** ([`eval/results/negative_latest.json`](eval/results/negative_latest.json)).

### 4.3 Subgroup Failure Rule Compliance
Under acceptance criteria AC-3, three difficulty strata (**Small Cases**, **Rare Cases**, and **Critical Cases**) were evaluated independently. Even if the aggregate mean exceeds the target, any subgroup failing its target fails the KPI. All subgroups passed their individual thresholds:
- *Small Cases (single-line notices, footnotes)*: KPI-1: 1.000, KPI-3: 87.2 / 100, KPI-6: 1.40 ms.
- *Rare Cases (3-column layout, floating sidebars, LaTeX formulas)*: KPI-1: 1.000, KPI-3: 82.6 / 100, KPI-6: 1.48 ms.
- *Critical Cases (compliance covenants, benchmark tables, theorems)*: KPI-1: 1.000, KPI-3: 85.8 / 100, KPI-6: 1.49 ms.

---

## 5. System Limitations

To maintain scientific and technical honesty, the known functional boundaries of Retrieva AI are stated explicitly:

1. **Digital Vector PDFs Only**: The system parses text objects, font streams, vector paths, and raster bounding boxes from born-digital PDFs. Scanned image-only PDFs containing non-vector handwritten notes require an external OCR pre-processing step.
2. **File Format Constraints**: Ingestion is restricted to PDF files validated by magic bytes (`%PDF-`). Office formats (`.docx`, `.pptx`) and plain text files are rejected at the API boundary.
3. **Cross-Page Formulas**: Mathematical expressions that span across a physical page boundary are parsed as two independent formula segments and are not automatically merged.
4. **Extreme Rotation**: Pages with rotated text orientations (90° or 270°) must undergo orientation correction before extraction; otherwise, vertical gutter projection assumes standard 0° orientation.
5. **Dynamic Server Sandboxing**: In Windows sandbox environments, network loopback bindings may require running local servers unsandboxed (`make run-backend`).

---

## 6. Residual Risks

1. **Topological Ambiguity in Borderless Financial Tables**: Financial footnotes with irregular indentations and no graphical cell borders can exhibit ambiguous column alignments, potentially triggering degraded mode ($< 0.75$ confidence).
2. **Confidence Threshold Sensitivity**: The threshold of $0.75$ was calibrated empirically on the development partition. Sparse single-word headers can occasionally fall near this boundary, requiring administrative review via the Document Inspector.
3. **Vector Dimension Scaling**: The dense deterministic embedding uses a 128-dimensional orthonormal projection. While sufficient for collections of thousands of chunks, scaling to millions of documents would necessitate upgrading to an approximate nearest neighbor graph (HNSW / IVF) with higher-dimensional embeddings.

---

## 7. Project AIML-59 Team Roles & Contributions

**Department of Computer Science & Engineering, KL University**

| Team Member / Role | Primary Responsibilities & Contributions |
| :--- | :--- |
| **Meghavarshini Prathapani**<br>*Lead Researcher & Full-Stack Architect* | • Conceptualized and designed end-to-end multi-modal retrieval architecture.<br>• Implemented layout analysis, multi-column segmentation, and floating sidebar isolation.<br>• Engineered O3 cryptographic provenance tracking and multi-signal Platt confidence calibration.<br>• Built FastAPI REST backend with structured logging, degraded mode, and health metrics.<br>• Developed React 19 frontend with PDF.js canvas overlays and Document Inspector.<br>• Authored benchmark harnesses, negative anomaly suite (NT1–NT5), and verification reports. |
| **Capstone Faculty Guide & Mentors**<br>*Department of CSE / AIML, KL University* | • Provided academic supervision, research direction, and methodology validation.<br>• Standardized the 5-criterion KPI-3 evaluation rubric and inter-rater agreement protocols.<br>• Reviewed partition isolation, non-tuning invariants, and architectural decisions. |

---

## 8. Licenses and Data Provenance

### 8.1 Software Licenses
- **Retrieva AI Codebase**: Licensed under the [MIT License](LICENSE).
- **Core Open-Source Dependencies**:
  - `PyMuPDF` (v1.28.2): GNU AGPL v3 / Commercial License (Artifex Software, Inc.).
  - `pdfplumber` (v0.11.10): MIT License (Jeremy Singer-Vine).
  - `faiss-cpu` (v1.15.1): MIT License (Meta AI Research).
  - `fastapi` (v0.115.8) & `pydantic` (v2.12.5): MIT License.
  - `react` (v19.2.8) & `vite` (v8.3.0): MIT License.
  - `tailwindcss` (v4.3.3): MIT License.

### 8.2 Benchmark Dataset Provenance
All document benchmarks are stored under `data/` and adhere to reproducible partition boundaries:

- **Development Partition (`doc-001`, `doc-002`, `doc-005`, `doc-006`, `doc-007`, `doc-009`, `doc-010`)**:
  - Research papers from arXiv (Open Access, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)): Attention Is All You Need (Vaswani et al.), BERT (Devlin et al.), LayoutLMv3 (Huang et al.).
  - Public corporate disclosures from SEC EDGAR (Public Domain): Form 10-K financial disclosures.
- **Frozen Acceptance Partition (`doc-003`, `doc-004`, `doc-008`)**:
  - `doc-003`: Synthetic enterprise zero-trust security architecture specification ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
  - `doc-004`: Technical whitepaper on 2D spatial attention transformers ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
  - `doc-008`: Academic benchmark specification for DocVQA visual question answering ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- **Partition Lock**: Stored in [`data/acceptance.lock`](data/acceptance.lock) with cryptographic SHA-256 integrity checks enforced before every test run.

---

## 9. Comprehensive Documentation Sitemap

| Document | Purpose |
| :--- | :--- |
| [`/docs/acceptance_report.md`](docs/acceptance_report.md) | Official acceptance report with complete KPI tables, bootstrap CIs, and subgroup breakdowns |
| [`/docs/operating_guide.md`](docs/operating_guide.md) | Operations manual: structured logging, health metrics, degraded mode, and recovery |
| [`/docs/api.md`](docs/api.md) | Complete REST API reference manual with JSON schemas and curl examples |
| [`/docs/source_to_claim_map.md`](docs/source_to_claim_map.md) | Traceability matrix mapping every claim to its exact code file, line, and test |
| [`/docs/adr_001_reference_choice.md`](docs/adr_001_reference_choice.md) | Architecture Decision Record comparing Extractor A (Docling) vs Extractor B (PyMuPDF) |
| [`/docs/kpi3_rubric.md`](docs/kpi3_rubric.md) | 5-criterion scoring rubric (0–100) and inter-rater agreement instructions |
| [`/docs/provenance_confidence_subsystem.md`](docs/provenance_confidence_subsystem.md) | Detailed mathematical specification of Platt scaling and multi-signal confidence |
