# Retrieva AI — Final Defect Register

> **Execution Date:** 2026-11-03T12:48:00Z  
> **Evaluation Lead:** Independent QA Lead & Validation Engineer (AIML-59)  
> **Status:** AUDITED & CATALOGED  
> **Total Logged Findings:** 5 (0 P0 Blocker, 1 P1 High, 2 P2 Medium, 2 P3 Low)  

---

## 1. Executive Defect Summary

The comprehensive verification campaign identified **zero P0 Critical Blockers**. The core engine, layout recovery, provenance subsystem, FAISS retrieval, negative anomaly routing, and acceptance harness operate nominally and satisfy all passing thresholds.

However, five engineering findings were cataloged spanning metric naming alignment, frontend fallback transparency, telemetry file persistence, documentation synchronization, and client bundle chunk optimization.

| Defect ID | Priority | Category | Affected Module / File | Status |
| :--- | :---: | :--- | :--- | :---: |
| **DEF-001** | **P1 (High)** | Metric Specification | `eval/run_acceptance.py`, `README.md`, `status.md` | Cataloged |
| **DEF-002** | **P2 (Medium)** | Frontend Reliability | `src/services/api.js` | Cataloged |
| **DEF-003** | **P2 (Medium)** | Telemetry Pipeline | `eval/negative_recorder.py` | Cataloged |
| **DEF-004** | **P3 (Low)** | Documentation | `README.md`, `status.md`, `docs/acceptance_report.md` | Cataloged |
| **DEF-005** | **P3 (Low)** | Frontend Build | `vite.config.js`, `package.json` | Cataloged |

---

## 2. Detailed Defect Catalog

### DEF-001: Semantic Substitution of Charter KPIs (KPI-4 & KPI-5)
- **Severity / Priority:** `P1` (High Priority)
- **Classification:** Metric Specification Inconsistency
- **Affected File Path:** [`eval/run_acceptance.py`](file:///d:/DocumentUnderstanding/eval/run_acceptance.py#L542-L600), [`README.md`](file:///d:/DocumentUnderstanding/README.md#L130-L140), [`status.md`](file:///d:/DocumentUnderstanding/status.md#L120-L130)
- **Affected Symbols:** `run_acceptance_evaluation()`, `kpi_table`
- **Description:** The AIML-59 project charter formally defines:
  - `KPI-4`: Critical-Scene Failure Rate (CSFR) (Target: $\le 0.05$)
  - `KPI-5`: Cross-Condition Performance Gap (Target: $\le 0.15$)
  
  In `eval/run_acceptance.py`, `README.md`, and `status.md`, `KPI-4` is reported as "Formula Extraction Match Rate" ($\ge 0.800$) and `KPI-5` is reported as "Cryptographic Audit Lineage Coverage" ($\ge 99.0\%$). While both formula extraction and audit lineage are vital architectural pillars, substituting them into the primary KPI slots creates an audit discrepancy against the original charter.
- **Empirical Status:** When evaluated, the original charter metrics achieve **PASS** (`CSFR = 0.000`, `Condition Gap = 0.017`), as do the auxiliary metrics (`Formula = 1.000`, `Lineage = 100.0%`).
- **Remediation Recommendation:** Update `kpi_table` in `eval/run_acceptance.py` to report all eight metrics clearly: the six authoritative Charter KPIs followed by the two Auxiliary Architectural Metrics.

---

### DEF-002: Silent Catch-and-Fallback to Mock Data in Client API Layer
- **Severity / Priority:** `P2` (Medium Priority)
- **Classification:** UI Fault Masking / Silent Degradation
- **Affected File Path:** [`src/services/api.js`](file:///d:/DocumentUnderstanding/src/services/api.js#L149-L153), [`src/services/api.js`](file:///d:/DocumentUnderstanding/src/services/api.js#L301-L306), [`src/services/api.js`](file:///d:/DocumentUnderstanding/src/services/api.js#L353-L356)
- **Affected Symbols:** `api.listDocuments()`, `api.getPageLayout()`, `api.searchDocuments()`, `api.getEvaluationReport()`
- **Description:** In `src/services/api.js`, network or backend 500 exceptions are caught in `try...catch` blocks that log a `console.warn` and immediately return static mock fixtures (`MOCK_DOCUMENTS`, `MOCK_SEARCH_ITEMS`). While designed for offline presentation resiliency, in live testing this behavior can mask server-side regressions from users and QA engineers.
- **Remediation Recommendation:** Introduce an explicit visual alert banner when an unexpected API failure occurs, or only fall back to mock data when `isDemoMode()` is explicitly toggled by the user in Settings.

---

### DEF-003: Missing Canonical `negative_latest.json` Telemetry Link
- **Severity / Priority:** `P2` (Medium Priority)
- **Classification:** Telemetry File Persistence
- **Affected File Path:** [`eval/negative_recorder.py`](file:///d:/DocumentUnderstanding/eval/negative_recorder.py#L40-L75)
- **Affected Symbols:** `NegativeTestRecorder.save_results()`
- **Description:** While `eval/run_acceptance.py` saves both a timestamped file (`acceptance_YYYYMMDD_HHMMSS.json`) and an un-timestamped canonical copy (`acceptance_latest.json`), `NegativeTestRecorder` only writes timestamped outputs (`negative_YYYYMMDD_HHMMSS.json`). Automated CI scripts and documentation references expecting `eval/results/negative_latest.json` fail to locate the file.
- **Remediation Recommendation:** Update `save_results()` in `eval/negative_recorder.py` to also write or copy to `eval/results/negative_latest.json`.

---

### DEF-004: Latency and Metric Drift Across Documentation Snapshots
- **Severity / Priority:** `P3` (Low Priority)
- **Classification:** Documentation Drift
- **Affected File Path:** [`README.md`](file:///d:/DocumentUnderstanding/README.md), [`status.md`](file:///d:/DocumentUnderstanding/status.md), [`docs/acceptance_report.md`](file:///d:/DocumentUnderstanding/docs/acceptance_report.md)
- **Description:** Historical evaluation snapshots recorded slightly varying figures across different benchmark iterations:
  - KPI-3 Grounded Retrieval: Reported as `84.7 / 100` in README, `85.3 / 100` in status.md, and `83.9 / 100` in `docs/acceptance_report.md`.
  - KPI-6 p95 Latency: Reported as `1.44 ms` in README, `0.70 ms` in status.md, and `1.20 ms` in `docs/acceptance_report.md`.
- **Remediation Recommendation:** Synchronize all documentation tables to reflect the official frozen acceptance run recorded in `eval/results/acceptance_latest.json`.

---

### DEF-005: Vite Production Bundle Chunk Size Warning on PDF.js Worker
- **Severity / Priority:** `P3` (Low Priority)
- **Classification:** Frontend Build Asset Optimization
- **Affected File Path:** [`vite.config.js`](file:///d:/DocumentUnderstanding/vite.config.js), [`package.json`](file:///d:/DocumentUnderstanding/package.json)
- **Description:** Running `npm run build` generates a warning: `Some chunks are larger than 500 kB after minification`. The compiled PDF.js worker `pdf.worker.min-CjEcRF4W.mjs` is $1,264\text{ kB}$ and `index-XSkgdHh2.js` is $835\text{ kB}$. While functional and well within browser capabilities, production optimization warrants vendor code-splitting or adjusting Vite's chunk size limit.
- **Remediation Recommendation:** Configure `build.rollupOptions.output.manualChunks` in `vite.config.js` to isolate PDF.js and vendor packages.

---

## 3. Overall Campaign Test Disposition

| Test Suite Category | Total Cases | Passed | Failed | Blocked | Not Tested | Pass Rate |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Phase 1: Environment Tests** | 10 | 10 | 0 | 0 | 0 | 100.0% |
| **Phase 2: Backend Pipeline Tests** | 48 | 48 | 0 | 0 | 0 | 100.0% |
| **Phase 3: Frontend Page Tests** | 12 | 12 | 0 | 0 | 0 | 100.0% |
| **Phase 4: Negative Anomaly Tests** | 5 | 5 | 0 | 0 | 0 | 100.0% |
| **Phase 5: Charter Acceptance Criteria**| 4 | 4 | 0 | 0 | 0 | 100.0% |
| **Phase 5: Charter KPIs (KPI-1..6)** | 6 | 6 | 0 | 0 | 0 | 100.0% |
| **Phase 6: Auxiliary Metrics (AUX-1..2)**| 2 | 2 | 0 | 0 | 0 | 100.0% |
| **TOTAL VERIFICATION TESTS** | **87** | **87** | **0** | **0** | **0** | **100.0%** |
