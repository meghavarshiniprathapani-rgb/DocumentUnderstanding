# Retrieva AI — Source-to-Claim Traceability Matrix

This document provides a verifiable mapping connecting every performance, architectural, and methodological claim made in the project documentation to the exact empirical evidence file, source code implementation, test fixture, or benchmark output that substantiates it.

---

## 1. Traceability Summary Matrix

| Claim ID | Category | Claim Description | Empirical Evidence / Metric | Evidence File Path | Code Symbol / JSON Field |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CLM-001** | Security & Governance | Frozen acceptance partition is cryptographically locked with zero data leakage | SHA-256 hash `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf`, 0 overlapping docs | [`data/acceptance.lock`](file:///c:/Disk%20D/Capstone/data/acceptance.lock), [`eval/leakage.py`](file:///c:/Disk%20D/Capstone/eval/leakage.py) | `acceptance_hash`, `verify_no_document_leakage()` |
| **CLM-002** | Reliability | Negative anomaly test suite passes with zero silent failures across 5 conditions | 5/5 negative tests detected and routed to degraded mode | [`eval/results/negative_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/negative_latest.json), [`tests/negative/`](file:///c:/Disk%20D/Capstone/tests/negative/) | `summary.zero_silent_failures: true`, `cases.NT1..NT5` |
| **CLM-003** | Reading Order | Multi-column layout reading order achieves target $\ge 0.900$ POA | **1.000** achieved ($95\%\text{ CI } [1.000, 1.000]$) vs 0.720 baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `kpi_table[0]`, `eval.metrics:calculate_reading_order_accuracy` |
| **CLM-004** | Table Structure | Structured table cell extraction preserves 2D grid topology | **1.000** Cell-Adjacency F1 ($95\%\text{ CI } [1.000, 1.000]$) vs 0.600 baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `kpi_table[1]`, `eval.metrics:calculate_table_structure_fidelity` |
| **CLM-005** | Retrieval Quality | End-to-end grounded retrieval scores $\ge 75.0/100$ on 5-criterion rubric | **84.7 / 100** ($95\%\text{ CI } [75.7, 92.9]$) vs 38.5 naive baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json), [`docs/kpi3_rubric.md`](file:///c:/Disk%20D/Capstone/docs/kpi3_rubric.md) | `kpi_table[2]`, `eval.rate_kpi3:score_chunk_kpi3` |
| **CLM-006** | Inter-Rater Agreement | Two independent raters agree on KPI-3 grounded retrieval quality | Quadratically weighted Cohen's kappa $\kappa_w = \mathbf{1.0000}$ | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `retrieval_benchmarks.cohens_kappa_weighted` |
| **CLM-007** | Formula Fidelity | Mathematical formula extraction preserves LaTeX syntax and operators | **1.000** Match F1 ($95\%\text{ CI } [1.000, 1.000]$) vs 0.500 baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `kpi_table[3]`, `eval.metrics:calculate_formula_match` |
| **CLM-008** | Provenance Audit | All elements carry verifiable SHA-256 hash, spatial bbox, and timestamp | **100.0% Coverage** ($95\%\text{ CI } [100.0\%, 100.0\%]$) vs 0.0% baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `kpi_table[4]`, `backend.provenance.schema:ProvenanceRecord` |
| **CLM-009** | Latency Budget | Vector retrieval latency p95 satisfies strict $< 5.00\text{ ms}$ budget | **1.44 ms** p95 latency across 270 warm trials vs 15.00 ms baseline | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `kpi_table[5]`, `parity_benchmark.final_o3.latency_p95_ms` |
| **CLM-010** | Memory Budget | Query retrieval process memory satisfies $< 50.0\text{ MB}$ budget | **0.04 MB** peak memory traced via `tracemalloc` | [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) | `parity_benchmark.final_o3.peak_memory_mb` |
| **CLM-011** | Extractor Choice | PyMuPDF + pdfplumber chosen over Docling due to 130x lower latency | PyMuPDF 11.97ms p50, 0.09MB vs Docling 1615ms p50, 2.96MB | [`docs/adr_001_reference_choice.md`](file:///c:/Disk%20D/Capstone/docs/adr_001_reference_choice.md), [`eval/results/baseline_20261029_052740.json`](file:///c:/Disk%20D/Capstone/eval/results/baseline_20261029_052740.json) | `summary.extractor_b_pymupdf_pdfplumber` |
| **CLM-012** | Calibration | Platt scaling multi-signal fusion improves confidence calibration | Dual agreement, table consistency, and reading order signals calibrated | [`eval/results/ablation_20261029_054134.json`](file:///c:/Disk%20D/Capstone/eval/results/ablation_20261029_054134.json), [`backend/provenance/calibration.py`](file:///c:/Disk%20D/Capstone/backend/provenance/calibration.py) | `ProvenanceSubsystem.process_elements()`, `apply_platt_scaling()` |
| **CLM-013** | Subgroup Robustness | Small, rare, and critical cases all pass individual KPI thresholds | All 3 difficulty strata achieve PASS across all 6 KPIs | [`docs/acceptance_report.md`](file:///c:/Disk%20D/Capstone/docs/acceptance_report.md) | Section 5: Stratified Subgroup Performance Breakdowns |
| **CLM-014** | Code Quality | Entire Python backend and JavaScript frontend pass all tests and linters | 91/91 pytest passed (51.12s); oxlint 0 errors (25 files); Vite 1.57s clean build | Workspace execution outputs | `pytest tests/`, `npm run lint`, `npm run build` |

---

## 2. Detailed Evidence Breakdown by KPI

### 2.1 KPI-1: Reading-Order Accuracy
- **Target**: $\ge 0.900$ Pairwise Order Accuracy (POA).
- **Achieved Score**: $1.000$ (Point estimate), $95\%\text{ CI } [1.000, 1.000]$.
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[0]`.
  - Implementation: [`backend/layout/order_recovery.py`](file:///c:/Disk%20D/Capstone/backend/layout/order_recovery.py) (`LayoutOrderRecovery.process()`).
  - Unit tests: [`tests/test_reading_order.py`](file:///c:/Disk%20D/Capstone/tests/test_reading_order.py) (6 passing tests).
  - Ground truth acceptance data: [`data/benchmarks/ground_truth_acceptance/doc-004_p1.json`](file:///c:/Disk%20D/Capstone/data/benchmarks/ground_truth_acceptance/doc-004_p1.json), [`doc-008_p1.json`](file:///c:/Disk%20D/Capstone/data/benchmarks/ground_truth_acceptance/doc-008_p1.json).

### 2.2 KPI-2: Table Structure Fidelity
- **Target**: $\ge 0.850$ Cell-Adjacency Graph F1.
- **Achieved Score**: $1.000$ (Point estimate), $95\%\text{ CI } [1.000, 1.000]$.
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[1]`.
  - Implementation: [`eval/metrics.py`](file:///c:/Disk%20D/Capstone/eval/metrics.py) (`calculate_table_structure_fidelity()`).
  - Unit tests: [`tests/test_oracle_metrics.py`](file:///c:/Disk%20D/Capstone/tests/test_oracle_metrics.py) (`test_table_structure_exact_2x2`, `test_table_structure_spanning_cell`).

### 2.3 KPI-3: Downstream Retrieval & Synthesis Quality
- **Target**: $\ge 75.0 / 100$ on the 5-criterion rubric.
- **Achieved Score**: $84.7 / 100$ (Mean), $95\%\text{ CI } [75.7, 92.9]$.
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[2]`.
  - Question benchmark: [`data/acceptance_questions.yaml`](file:///c:/Disk%20D/Capstone/data/acceptance_questions.yaml) (9 standardized questions).
  - Scoring rubric: [`docs/kpi3_rubric.md`](file:///c:/Disk%20D/Capstone/docs/kpi3_rubric.md).
  - Implementation: [`eval/rate_kpi3.py`](file:///c:/Disk%20D/Capstone/eval/rate_kpi3.py) (`score_chunk_kpi3()`).

### 2.4 KPI-4: Formula Extraction Match Rate
- **Target**: $\ge 0.800$ Syntactic Normalization Match F1.
- **Achieved Score**: $1.000$ (Point estimate), $95\%\text{ CI } [1.000, 1.000]$.
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[3]`.
  - Implementation: [`eval/metrics.py`](file:///c:/Disk%20D/Capstone/eval/metrics.py) (`calculate_formula_match()`, `normalize_latex()`).
  - Unit tests: [`tests/test_oracle_metrics.py`](file:///c:/Disk%20D/Capstone/tests/test_oracle_metrics.py) (`test_formula_syntactic_normalization_match`).

### 2.5 KPI-5: Cryptographic Audit Lineage Coverage
- **Target**: $\ge 99.0\%$ verifiable audit coverage.
- **Achieved Score**: $100.0\%$ ($95\%\text{ CI } [100.0\%, 100.0\%]$).
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[4]`.
  - Implementation: [`backend/provenance/subsystem.py`](file:///c:/Disk%20D/Capstone/backend/provenance/subsystem.py) (`ProvenanceSubsystem.process_elements()`).
  - Schema: [`backend/provenance/schema.py`](file:///c:/Disk%20D/Capstone/backend/provenance/schema.py) (`ProvenanceRecord`).

### 2.6 KPI-6: Query Retrieval Latency & Memory Envelope
- **Target**: Query Latency p95 $< 5.00\text{ ms}$, Peak Memory $< 50.0\text{ MB}$.
- **Achieved Score**: $1.44\text{ ms}$ p95 latency, $0.04\text{ MB}$ peak process memory.
- **Evidence Files**:
  - Evaluation results: [`eval/results/acceptance_latest.json`](file:///c:/Disk%20D/Capstone/eval/results/acceptance_latest.json) line `kpi_table[5]`.
  - Implementation: [`backend/retrieval/retriever.py`](file:///c:/Disk%20D/Capstone/backend/retrieval/retriever.py) (`FaissRetriever.retrieve()`).
  - Unit tests: [`tests/test_retrieval.py`](file:///c:/Disk%20D/Capstone/tests/test_retrieval.py) (`test_faiss_retriever_ranking_and_retrieval`).

---

## 3. Negative Anomaly Suite Traceability (NT1 – NT5)

| Case ID | Anomaly Condition | Controlled Fixture | Detector Function | Test File | Telemetry Key in negative_latest.json |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NT1** | Scrambled multi-column reading order | [`fixture_nt1_scrambled_reading_order.json`](file:///c:/Disk%20D/Capstone/tests/negative/fixtures/fixture_nt1_scrambled_reading_order.json) | `detect_scrambled_reading_order` | [`test_nt1_scrambled_reading_order.py`](file:///c:/Disk%20D/Capstone/tests/negative/test_nt1_scrambled_reading_order.py) | `cases.NT1.observed.degraded_or_abstained: true` |
| **NT2** | Tables flattened into noise | [`fixture_nt2_flattened_table.json`](file:///c:/Disk%20D/Capstone/tests/negative/fixtures/fixture_nt2_flattened_table.json) | `detect_flattened_table` | [`test_nt2_flattened_tables.py`](file:///c:/Disk%20D/Capstone/tests/negative/test_nt2_flattened_tables.py) | `cases.NT2.observed.degraded_or_abstained: true` |
| **NT3** | Extraction scored without downstream check | [`fixture_nt3_unverified_extraction.json`](file:///c:/Disk%20D/Capstone/tests/negative/fixtures/fixture_nt3_unverified_extraction.json) | `verify_downstream_retrieval_check` | [`test_nt3_unverified_extraction.py`](file:///c:/Disk%20D/Capstone/tests/negative/test_nt3_unverified_extraction.py) | `cases.NT3.observed.degraded_or_abstained: true` |
| **NT4** | Partition leakage across dev and acceptance | [`fixture_nt4_leakage_manifest.yaml`](file:///c:/Disk%20D/Capstone/tests/negative/fixtures/fixture_nt4_leakage_manifest.yaml) | `verify_partition_leakage` | [`test_nt4_partition_leakage.py`](file:///c:/Disk%20D/Capstone/tests/negative/test_nt4_partition_leakage.py) | `cases.NT4.observed.degraded_or_abstained: true` |
| **NT5** | Throughput or memory failure at workload | [`fixture_nt5_overload_workload.json`](file:///c:/Disk%20D/Capstone/tests/negative/fixtures/fixture_nt5_overload_workload.json) | `verify_workload_resource_envelope` | [`test_nt5_throughput_memory_failure.py`](file:///c:/Disk%20D/Capstone/tests/negative/test_nt5_throughput_memory_failure.py) | `cases.NT5.observed.degraded_or_abstained: true` |

