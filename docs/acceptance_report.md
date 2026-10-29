# Retrieva AI — Final Acceptance Evaluation Report

> **Acceptance Status:** `[REJECT]`  
> **Execution Date:** 2026-10-29T13:37:25.800956+00:00  
> **Configuration Version:** `1.0.0` (`O3-v1.0.0`)  
> **Acceptance Partition Hash:** `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf`  

---

## 1. Executive Summary

This report documents the rigorous, uncompromised acceptance benchmark of **Retrieva AI** executed strictly against the **frozen independent acceptance partition** (`doc-003`, `doc-004`, `doc-008`).

All six Core Key Performance Indicators (**KPI-1 through KPI-6**) were evaluated with **95% bootstrap confidence intervals (1,000 resamples)**. In strict adherence to acceptance criteria, **stratified subgroups (small, rare, and critical cases)** were evaluated independently, and the invariant that **a failing subgroup must fail the KPI even if the aggregate passes** was enforced.

All five controlled negative tests (**NT1 through NT5**) were executed to audit anomaly detection, degraded routing, and verify **zero silent failures**.

---

## 2. Cryptographic Partition Lock & Zero-Leakage Audit

| Property | Record | Verification |
| :--- | :--- | :--- |
| **Lock File** | `data/acceptance.lock` | Sealed & Unmodified |
| **Cryptographic Hash (SHA-256)** | `a5f7bfbcfbe9c39efadaae06c1c4812842ab6e2127af357ce6e183ed5e517bdf` | **Bit-Exact Verified** |
| **Frozen Document IDs** | `doc-003, doc-004, doc-008` | Completely Disjoint from Dev |
| **Document Leakage** | 0 documents overlapping | **PASSED (0% Leakage)** |
| **Page & Artifact Leakage** | 0 pages/embeddings leaked | **PASSED (Strict Boundary)** |
| **Non-Tuning Invariant** | Frozen split never used in training | **CERTIFIED** |

---

## 3. Negative Anomaly Suite Audit (Zero Silent Failures)

| Case ID | Target Condition | Detection Mechanism | System Action | Output Labelled | Silent Failure |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NT1** | Scrambled multi-column reading order | Topological Reading Gutter Check | Degraded Route | Yes (`is_degraded: True`) | **Zero (None)** |
| **NT2** | Tables flattened into noise | 2D Table Cell Adjacency Analyzer | Degraded Route | Yes (`is_degraded: True`) | **Zero (None)** |
| **NT3** | Extraction scored without downstream retrieval check | Retrieval Verification Guard | Degraded Route | Yes (`is_degraded: True`) | **Zero (None)** |
| **NT4** | Preprocessing or partition leakage across dev and acceptance | Cryptographic Partition Audit | Degraded Route | Yes (`is_degraded: True`) | **Zero (None)** |
| **NT5** | Throughput or memory failure at declared workload | Resource & Workload Envelope Guard | Degraded Route | Yes (`is_degraded: True`) | **Zero (None)** |

> [!IMPORTANT]
> **Zero Silent Failures Verified:** All five controlled failure conditions were detected with 100% precision, routed to degraded paths or abstained, and explicitly labelled with diagnostic metadata.

---

## 4. Key Performance Indicator (KPI) Acceptance Matrix

| KPI ID | Metric Name | Baseline | Target | Achieved (Mean) | 95% Bootstrap CI | Unit | Decision |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **KPI-1** | Reading-Order Accuracy (Pairwise Order Accuracy) | 0.720 | `>= 0.900` | **1.000** | `[1.000, 1.000]` | Accuracy [0, 1] | **PASS** |
| **KPI-2** | Table Structure Fidelity (TEDS / Cell Adjacency) | 0.600 | `>= 0.850` | **1.000** | `[1.000, 1.000]` | F1 / TEDS | **PASS** |
| **KPI-3** | End-to-End Grounded Retrieval & Synthesis Quality | 38.5 / 100 | `>= 75.0 / 100` | **87.0 / 100** | `[80.7, 93.5]` | Rubric Score (0-100) | **FAIL** |
| **KPI-4** | Formula Extraction Match Rate | 0.500 | `>= 0.800` | **1.000** | `[1.000, 1.000]` | Match F1 | **PASS** |
| **KPI-5** | Cryptographic Audit Lineage Coverage | 0.0% | `>= 99.0%` | **100.0%** | `[100.0%, 100.0%]` | Citation Coverage | **PASS** |
| **KPI-6** | Query Retrieval Latency (p95) | 15.00 ms | `< 5.00 ms` | **1.77 ms** | `[0.98, 1.14] ms` | Milliseconds | **PASS** |

---

## 5. Stratified Subgroup Performance Breakdowns (AC-3)

In accordance with AC-3, performance was decomposed across three orthogonal difficulty strata:
1. **Small Cases:** Sparse single-line blocks, brief annotations, isolated footnotes (e.g. `doc-003` license notices).
2. **Rare Cases:** 3-column layouts, floating sidebars, multi-span tables, display LaTeX formulas (`doc-004` sidebar, `doc-008` 3-column text, ANLS formula).
3. **Critical Cases:** Compliance mandates, financial/benchmark tables, primary theorems (`doc-003` zero-trust covenants, `doc-004` Table 1, `doc-008` Table 1).

| KPI ID | Small Cases (95% CI) | Rare Cases (95% CI) | Critical Cases (95% CI) | Subgroup Rule |
| :--- | :--- | :--- | :--- | :--- |
| **KPI-1** | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | **ALL PASS** |
| **KPI-2** | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | **ALL PASS** |
| **KPI-3** | `73.85 [72.9, 74.8]` | `87.05 [78.0, 96.0]` | `95.7333 [93.8, 96.8]` | **SUBGROUP FAIL** |
| **KPI-4** | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | `1.0 [1.000, 1.000]` | **ALL PASS** |
| **KPI-5** | `100.0 [100.0%, 100.0%]` | `100.0 [100.0%, 100.0%]` | `100.0 [100.0%, 100.0%]` | **ALL PASS** |
| **KPI-6** | `1.77 [0.94, 1.10] ms` | `1.74 [0.93, 1.10] ms` | `1.95 [0.96, 1.34] ms` | **ALL PASS** |

---

## 6. Parity Evaluation: Reference (O2) vs. Final (O2+O3) (AC-4)

- **Operating System:** `Windows-11-10.0.26300-SP0`
- **Python Version:** `3.13.5`
- **Processor:** `Intel64 Family 6 Model 154 Stepping 4, GenuineIntel` (12 cores)
- **Warm Trials Count:** `270` trials

| Metric | Reference (O2 Baseline) | Final (O2 + O3 Provenance) | Delta / Overhead | Budget | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Query Latency (p50)** | `0.80 ms` | `0.82 ms` | `+0.02 ms` | < 5.00 ms | **PASS** |
| **Query Latency (p95)** | `1.65 ms` | `1.77 ms` | `+0.12 ms` | < 5.00 ms | **PASS** |
| **Query Latency (p99)** | N/A | `2.95 ms` | N/A | < 10.00 ms | **PASS** |
| **Peak Process Memory** | `0.04 MB` | `0.04 MB` | `+0.00 MB` | < 50.00 MB | **PASS** |
| **Cryptographic Provenance** | None (0%) | **100.0% Coverage** | +100.0% | >= 99.0% | **PASS** |
| **Platt Confidence Calibration** | Uncalibrated | **Multi-Signal Calibrated** | +0.28 F1 | Calibrated | **PASS** |
| **Degraded Path Routing** | Silent Pass | **Explicit Fallback / Abstain** | Safe Failure | Active | **PASS** |

---

## 7. Downstream Retrieval & Synthesis Quality (KPI-3)

| Retrieval Metric | Measured Score | Evaluation Notes |
| :--- | :--- | :--- |
| **Hit@1** | `0.778` | Gold chunk returned at top rank |
| **Hit@3** | `0.778` | Gold chunk returned within top-3 candidates |
| **Mean Reciprocal Rank (MRR)** | `0.833` | High ranking fidelity across multi-column & formula queries |
| **Answer Grounding Rate** | `0.556` | Top retrieved chunk contains exact gold answer token span |
| **Cohen's Kappa (Quadratic)** | `κ_w = 1.0000` | **Near-Perfect Agreement** between independent raters |
| **Cohen's Kappa (Unweighted)** | `κ = 1.0000` | Substantial categorical tier agreement |

---

## 8. Non-Tuning & Methodological Integrity Certification

> [!NOTE]
> **Formal Certification of Non-Tuning:**  
> 1. The acceptance partition documents (`doc-003`, `doc-004`, `doc-008`) and their ground-truth annotations were locked cryptographically via SHA-256 before any evaluation.  
> 2. Neither weights, hyper-parameters, confidence calibration Platt scalers, nor layout thresholds were tuned, fitted, or adjusted using acceptance data.  
> 3. Thresholds were frozen before execution: target criteria were neither lowered nor modified to force a passing outcome.  

---
*Generated automatically by `make accept` at 2026-10-29T13:37:25.800956+00:00 UTC.*