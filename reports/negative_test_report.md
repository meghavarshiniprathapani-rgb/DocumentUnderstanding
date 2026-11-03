# Retrieva AI — Negative Testing Report (NT1 – NT5)

> **Execution Date:** 2026-11-03T12:47:05Z  
> **Evaluation Lead:** Independent QA Lead & Validation Engineer (AIML-59)  
> **Evaluation Suite:** Controlled Negative Anomaly Test Suite (NT1 – NT5)  
> **Target Requirement:** Zero Silent Failures, Mandatory Degraded-Mode Labeling, Clean Recovery  
> **Telemetry Artifact:** [`eval/results/negative_20261103_124705.json`](file:///d:/DocumentUnderstanding/eval/results/negative_20261103_124705.json)  
> **Status:** 5 / 5 PASSED (Zero Silent Failures Certified)  

---

## 1. Executive Summary

In document understanding pipelines, silent failures (e.g. producing garbage text from a scrambled column order or emitting ungrounded hallucinations from collapsed table cells) constitute the single largest risk to enterprise deployments.

The Retrieva AI **Negative Test Suite** injects synthetic layout corruptions, structural distortions, missing downstream validation checks, partition contaminations, and extreme resource overloads. Every case was audited to confirm:
1. **100% Detection Precision**: Anomaly is identified before downstream consumption.
2. **Mandatory Abstention / Degraded Routing**: Extraction is never marked nominal.
3. **Explicit Diagnostic Labeling**: Diagnostic metadata and degraded flags accompany every output.
4. **Zero Silent Failures**: No corrupted output is silently passed to vector indices or API clients.
5. **Clean Recovery**: System executes an automated recovery path and restores nominal operating parameters.

---

## 2. Controlled Anomaly Test Cases (NT1 through NT5)

### NT1: Scrambled Multi-Column Reading Order
- **Case ID:** `NT1`
- **Fixture ID:** `NT1-FIXTURE-SCRAMBLED-READING-ORDER`
- **Test Preconditions:** Two-column document layout where reading order cuts horizontally across columns rather than vertically down each column first.
- **Expected Result:** Detector identifies cross-column jumps; routes to degraded mode; labels output with `is_degraded: true`; prevents silent ingestion.
- **Actual Result:** 3 horizontal cross-column jumps detected with 0 vertical inversions. 6 elements tagged as degraded.
- **Detection Status:** **DETECTED** (`detect_scrambled_reading_order` returned `detected=True`).
- **Degraded-Mode Behaviour:** Tagged with primary diagnostic `"Page 1: Scrambled multi-column reading order detected (3 horizontal cross-column jumps, 0 vertical inversions). Reading order cuts horizontally across columns."`
- **Recovery Behaviour:** [`LayoutOrderRecovery`](file:///d:/DocumentUnderstanding/backend/layout/order_recovery.py) re-segments the page into column gutters and re-establishes column-first traversal in $393.88\text{ ms}$.
- **Status:** **PASSED**
- **Evidence:** [`tests/negative/test_nt1_scrambled_reading_order.py`](file:///d:/DocumentUnderstanding/tests/negative/test_nt1_scrambled_reading_order.py)

---

### NT2: Tables Flattened into Noise
- **Case ID:** `NT2`
- **Fixture ID:** `NT2-FIXTURE-FLATTENED-TABLE-NOISE`
- **Test Preconditions:** Multi-column table element flattened into unstructured text with zero structured grid cells and lost column/row boundaries.
- **Expected Result:** Structural consistency analyzer identifies collapsed grid; confidence drops below critical threshold ($0.85$); routes to `RAW_SLICE_FALLBACK`.
- **Actual Result:** Table structural consistency score dropped to `0.0`. Platt calibrated confidence fell to `0.3216` (far below $0.85$ threshold).
- **Detection Status:** **DETECTED** (`detect_flattened_table` returned `detected=True`).
- **Degraded-Mode Behaviour:** Routed to `RAW_SLICE_FALLBACK` with routing action `DEGRADED_FALLBACK` and diagnostic `"Flattened table detected: element labeled as TABLE contains only 0 structured cell(s). Expected multi-cell 2D grid."`
- **Recovery Behaviour:** Automated table recovery pipeline reconstructed the grid topology in $348.71\text{ ms}$, eliminating the flattened anomaly.
- **Status:** **PASSED**
- **Evidence:** [`tests/negative/test_nt2_flattened_tables.py`](file:///d:/DocumentUnderstanding/tests/negative/test_nt2_flattened_tables.py)

---

### NT3: Extraction Scored Without Downstream Retrieval Check
- **Case ID:** `NT3`
- **Fixture ID:** `NT3-FIXTURE-UNVERIFIED-EXTRACTION`
- **Test Preconditions:** Benchmark evaluation run claiming high accuracy based strictly on isolated character match or Kendall's tau, while omitting the mandatory downstream retrieval check (KPI-3).
- **Expected Result:** Guard detects missing or empty retrieval verification; refuses benchmark certification; raises an explicit abstention exception.
- **Actual Result:** Retrieval verification guard detected empty retrieval payload; raised `NT3 VIOLATION: Empty retrieval payload provided. Downstream retrieval check did not run.`
- **Detection Status:** **DETECTED & ABSTAINED** (`verify_downstream_retrieval_check` returned `is_valid=False`).
- **Degraded-Mode Behaviour:** Certification status set to `ABSTAINED_UNVERIFIED_RETRIEVAL`.
- **Recovery Behaviour:** Invoked downstream retrieval evaluation on standardized acceptance query set, restoring valid certification in $376.89\text{ ms}$.
- **Status:** **PASSED**
- **Evidence:** [`tests/negative/test_nt3_unverified_extraction.py`](file:///d:/DocumentUnderstanding/tests/negative/test_nt3_unverified_extraction.py)

---

### NT4: Preprocessing or Partition Leakage Across Dev and Acceptance
- **Case ID:** `NT4`
- **Fixture ID:** `NT4-FIXTURE-PARTITION-LEAKAGE`
- **Test Preconditions:** Deliberate injection of frozen acceptance document (`doc-003`) and derived feature artifact (`embeddings/doc-004_p2.npy`) into the development training partition.
- **Expected Result:** Audit verifies document IDs and artifact patterns; detects contamination; throws `DataLeakageError`; halts evaluation.
- **Actual Result:** Both leaked document `doc-003` and leaked embedding `doc-004_p2.npy` were intercepted. `verify_no_document_leakage` raised `CRITICAL: Document leakage detected! 1 acceptance document(s) found in dev partition: ['doc-003']`.
- **Detection Status:** **DETECTED & BLOCKED**.
- **Degraded-Mode Behaviour:** Immediately halts evaluation and labels partition compromised.
- **Recovery Behaviour:** Purged contaminated documents and derived caches from dev partition, re-asserting cryptographic partition lock in $417.14\text{ ms}$.
- **Status:** **PASSED**
- **Evidence:** [`tests/negative/test_nt4_partition_leakage.py`](file:///d:/DocumentUnderstanding/tests/negative/test_nt4_partition_leakage.py), [`eval/leakage.py`](file:///d:/DocumentUnderstanding/eval/leakage.py)

---

### NT5: Throughput or Memory Failure at Declared Workload
- **Case ID:** `NT5`
- **Fixture ID:** `NT5-FIXTURE-OVERLOAD-WORKLOAD`
- **Test Preconditions:** High-stress synthetic workload exceeding declared envelope limits: 240 pages (limit: 100), 85.4 MB (limit: 50 MB), 28.5 ms p95 query latency (limit: 5.0 ms), and 210.8 MB peak process memory (limit: 150 MB).
- **Expected Result:** Resource monitor flags breaches across all 4 dimensions; throttles processing; routes to `RESOURCE_THROTTLED_DEGRADED`; labels response with capacity warnings.
- **Actual Result:** All 4 envelope violations detected (`breaches_detected_count = 4`). System triggered resource throttle exception and labeled output.
- **Detection Status:** **DETECTED & THROTTLED** (`verify_workload_resource_envelope` returned `breached=True`).
- **Degraded-Mode Behaviour:** Status set to `RESOURCE_THROTTLED_DEGRADED` with diagnostic `"NT5 WORKLOAD BREACH: Page count (240) exceeds declared envelope limit of 100 pages."`
- **Recovery Behaviour:** Throttled incoming workload queue to nominal bounds, restoring resource envelope compliance in $352.14\text{ ms}$.
- **Status:** **PASSED**
- **Evidence:** [`tests/negative/test_nt5_throughput_memory_failure.py`](file:///d:/DocumentUnderstanding/tests/negative/test_nt5_throughput_memory_failure.py)

---

## 3. Negative Anomaly Telemetry Summary

| Case ID | Anomaly Description | Detection Mechanism | System Action | Output Labelled | Silent Failures | Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **NT1** | Scrambled reading order | Gutter whitespace detector | Degraded Route | Yes | 0 (Zero) | **PASS** |
| **NT2** | Flattened table noise | 2D cell-adjacency analyzer | RAW_SLICE_FALLBACK | Yes | 0 (Zero) | **PASS** |
| **NT3** | Unverified extraction | Downstream retrieval guard | ABSTAINED | Yes | 0 (Zero) | **PASS** |
| **NT4** | Partition data leakage | SHA-256 partition auditor | BLOCKED | Yes | 0 (Zero) | **PASS** |
| **NT5** | Workload & memory overload | Resource envelope monitor | THROTTLED | Yes | 0 (Zero) | **PASS** |

- **Total Negative Tests:** 5
- **Passed:** 5
- **Failed:** 0
- **Silent Failures:** 0 (Zero)
