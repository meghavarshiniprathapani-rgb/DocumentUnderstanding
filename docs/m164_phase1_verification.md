# M1.6.4.2 — Phase 1 Verification and Hardening Report

This document records the code-level verification, architectural audit, security hardening, and final acceptance fixes of the internal Python extraction endpoint (`POST /api/v1/internal/extract`) implemented for M1.6.4 Phase 1.

---

## 1. Mode Correctness and Pipeline Routing

The four extraction modes (`flat`, `reference`, `candidate`, `candidate_ft`) are enforced across schema validation, extractor selection, layout order recovery, confidence calibration, and vector chunking.

### Mode Pipeline Matrix

| Mode | Extractor Backend | Reading Order Strategy | Confidence Calibration | Degraded Path Routing | Telemetry Manifest |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `flat` | `PdfPlumberExtractor` | Naive geometric sort: `(page, y_min, x_min)` assigning linear order `0, 1, 2, ...` | Bypassed (`calibrated_confidence = None`) | Bypassed | `layout_engine: None:NaiveOrder`<br>`provenance: None:Uncalibrated` |
| `reference` | `PdfPlumberExtractor` | 2D Layout Recovery via `LayoutOrderRecovery` | Bypassed (`calibrated_confidence = None`) | Bypassed | `layout_engine: LayoutOrderRecovery:v1.0.0`<br>`provenance: None:Uncalibrated` |
| `candidate` | `PdfPlumberExtractor` | 2D Layout Recovery via `LayoutOrderRecovery` | Active: Multi-signal Platt scaling calibration | Active: Routing checks for low confidence, table flattening, reading order anomalies | `layout_engine: LayoutOrderRecovery:v1.0.0`<br>`provenance: O3:O3-v1.0.0` |
| `candidate_ft` | `DoclingExtractor` (fallback: `PyMuPDF_pdfplumber`) | Multimodal Docling hierarchy or `LayoutOrderRecovery` | Active: Multi-signal Platt scaling calibration | Active: Routing checks enabled | `layout_engine: DoclingLayout:v2.144.0` (or `LayoutOrderRecovery:v1.0.0` on fallback)<br>`provenance: O3:O3-v1.0.0` |

### Code Verification References

- Schema enforcement: [`backend/app/schemas/internal.py`](file:///d:/DocumentUnderstanding/backend/app/schemas/internal.py#L8-L11) defines `mode: Literal["flat", "reference", "candidate", "candidate_ft"]`.
- Mode-aware extractor resolution: [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L622-L668).
- Layout recovery and calibration branching: [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L670-L710).
- Telemetry version tagging: [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L880-L905).

---

## 2. candidate_ft Environment Evidence & Experimental Integrity

To establish empirical evidence of multimodal extraction capability without relying exclusively on mocked fallback assertions, the `candidate_ft` pipeline was evaluated across four distinct operational dimensions in the configured `.venv` environment:

### Empirical Operational Audit

| Dimension | Evaluation Command / Test | Result | Evidence / Details |
| :--- | :--- | :--- | :--- |
| **1. Package Installation** | `python -c "import docling; print(docling.__version__)"` | **OPERATIONAL** | Docling version `2.144.0` installed in `.venv`. |
| **2. Model Initialization** | `from backend.extractors.docling_extractor import DoclingExtractor; e = DoclingExtractor()` | **OPERATIONAL** | `DoclingExtractor` successfully instantiated underlying `DocumentConverter()`. |
| **3. Actual Document Conversion** | `e.extract('data/sample_documents/doc-001.pdf')` | **OPERATIONAL** | Real weights loaded; multimodal extraction completed with elements successfully extracted. |
| **4. Fallback Execution** | `tests/test_internal_extract.py::test_candidate_ft_fallback_integrity` | **OPERATIONAL** | Graceful fallback to `PyMuPDF_pdfplumber` occurs on failure, forcing `status: "degraded"`. |

### Fallback Tracking Architecture

1. **Extractor Resolution & Error Interception**:
   - In [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L622-L668), when `mode == "candidate_ft"`, the service attempts to instantiate and extract using `DoclingExtractor`.
   - If `DoclingExtractor` initialization or execution throws an exception, the service falls back to `self.extractor` (`PyMuPDF_pdfplumber`).
   - The fallback state is explicitly flagged:
     - `fallback_occurred = True`
     - `fallback_reason = "Docling initialization error: ..." | "Docling extraction error: ..."`
2. **Metadata & Schema Reporting**:
   - `InternalExtractResponse` includes a dedicated `fallback` structure:
     ```json
     {
       "fallback_occurred": true,
       "requested_mode": "candidate_ft",
       "actual_extractor": "PyMuPDF_pdfplumber",
       "reason": "Docling native model execution failure"
     }
     ```
   - `extractor` object explicitly reports `name`, `version`, `fallback_occurred`, and `fallback_reason`.
   - `model_versions` adjusts `layout_engine` dynamically to reflect the actual fallback (`LayoutOrderRecovery:v1.0.0` vs `DoclingLayout:v2.144.0`).
3. **Degradation Enforcement**:
   - Fallback runs are **never** reported with `status: "processed"`.
   - Any fallback execution automatically forces `is_doc_degraded = True` and sets `status = "degraded"`.
   - An explanatory warning is prepended to `extraction_warnings`: `"Fallback to PyMuPDF_pdfplumber: <reason>"`.
   - This ensures benchmark pipelines and downstream evaluation analyzers can reliably isolate genuine Docling candidate runs from fallback runs without fabricating execution.

---

## 3. Indexing Diagnostics and Worker Contract

When FAISS vector indexing fails during extraction, ambiguous binary flags (e.g. `searchable: false`) do not clarify whether a previously indexed version remains searchable or whether the new version failed. The endpoint provides explicit, disambiguated diagnostic fields.

### Disambiguated Diagnostics Schema

The `indexing_diagnostics` payload in `InternalExtractResponse` provides explicit separation:

```json
{
  "vector_store": "FAISS",
  "latest_version_indexed": false,
  "previous_version_searchable": true,
  "searchable": true,
  "error": "Forced FAISS index failure after partial mutation",
  "error_type": "RuntimeError"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `latest_version_indexed` | `bool` | Explicitly states whether the latest extracted document version was successfully embedded and added to the active index. |
| `previous_version_searchable` | `bool` | Explicitly states whether a prior valid vector index exists for this `document_id` and remains queryable via vector search following rollback. |
| `searchable` | `bool` | Backward-compatibility boolean indicating overall availability in search results (`previous_version_searchable` on failure, `true` on success). |
| `error` | `Optional[str]` | Sanitized diagnostic error string when indexing fails. |
| `error_type` | `Optional[str]` | Exception class name (e.g., `"RuntimeError"`). |

### Expected Express Worker Behavior

The future Phase 2 Express worker must adhere to the following mapping protocol when interpreting `indexing_diagnostics`:

| `latest_version_indexed` | `previous_version_searchable` | Python `data.status` | Expected MySQL `jobs.status` | Expected MySQL `documents.status` | Interpretation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `true` | `false` | `"processed"` | `'done'` | `'ready'` | Initial document version cleanly processed and indexed. |
| `true` | `true` | `"processed"` | `'done'` | `'ready'` | Re-extracted document version cleanly replaced existing index. |
| `false` | `true` | `"degraded"` | `'degraded'` | `'degraded'` | **Latest version NOT indexed.** Previous version remains searchable. Worker captures error and marks job degraded. **Never mark `ready`.** |
| `false` | `false` | `"degraded"` | `'degraded'` | `'degraded'` | **First-time index failed.** Zero versions in vector store. Worker captures error. **Never mark `ready`.** |

---

## 4. FAISS Partial-Mutation Failure and Rollback

### Design & Rollback Architecture

[`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L720-L765) implements snapshot-based rollback to protect index integrity against partial mutations:

1. **Pre-mutation Snapshots**:
   - `saved_all_chunks = list(self.all_chunks)`
   - `saved_retriever_chunks = list(getattr(self.retriever, "chunks", []))`
   - `saved_faiss_index = getattr(self.retriever, "index_faiss", None)`
2. **Re-indexing Execution**:
   - `updated_chunks = [c for c in self.all_chunks if c.source_doc_id != document_id]`
   - `updated_chunks.extend(new_chunks)`
   - `self.retriever.index(updated_chunks)`
3. **Rollback on Partial Mutation Failure**:
   - If an error occurs during `retriever.index()`—even after `retriever.chunks` or `retriever.index_faiss` has been partially mutated or replaced with an incomplete structure—the `except Exception as idx_err:` block restores:
     - `self.all_chunks = saved_all_chunks`
     - `self.retriever.chunks = saved_retriever_chunks`
     - `self.retriever.index_faiss = saved_faiss_index`
   - The exact prior `index_faiss` pointer and chunk mappings are restored.
4. **Idempotency & Zero Duplication**:
   - Subsequent successful reprocessing replaces existing chunks rather than duplicating vectors in `all_chunks`.

### Automated Partial-Mutation Verification

In [`tests/test_internal_extract.py`](file:///d:/DocumentUnderstanding/tests/test_internal_extract.py#L409-L485), `test_faiss_failure_injection_and_search_preservation` verifies the entire 5-stage lifecycle under partial mutation:
1. **Initial Indexing**: Creates a document with unique searchable tokens (`"Uniquely Identifiable Search Alpha Bravo 98765"`), extracts and indexes it, and verifies `doc_service.search()` succeeds.
2. **Partial Mutation & Failure Injection**: Reprocesses the same document while executing a custom indexer that mutates `doc_service.retriever.chunks` and replaces `doc_service.retriever.index_faiss` with an empty index, then raises `RuntimeError`. Verifies the response returns:
   - `indexing_status == "Failed"`
   - `status == "degraded"`
   - `latest_version_indexed is False`
   - `previous_version_searchable is True`
   - `searchable is True`
3. **Chunk & Index Reference Rollback**: Asserts `doc_service.retriever.index_faiss is initial_faiss_index` (exact reference restored), `doc_service.retriever.chunks == initial_retriever_chunks`, and total chunks count matches pre-failure snapshot.
4. **Search Preservation**: Executes `doc_service.search()` during the degraded state and verifies the original chunk remains retrievable from the restored index.
5. **Clean Reprocessing**: Reprocesses the document without errors, asserting `indexing_status == "Indexed"`, `latest_version_indexed is True`, chunk count is not duplicated (`len(doc_service.all_chunks) == total_chunks_before`), and search continues to function seamlessly.

---

## 5. Health-State Reset Review & Baseline Integrity

### Baseline Health Tracking Architecture

In [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py#L96-L238), `_initialize_baseline_repository()` tracks genuine degradation throughout the baseline initialization lifecycle:

1. **State Isolation**: `baseline_has_degradation = False` is initialized at startup.
2. **Ground Truth Validation**: During baseline ground-truth parsing and element enrichment:
   - If an exception occurs: `self.record_error(..., "startup")` and `baseline_has_degradation = True`.
   - If routing checks flag degradation: `baseline_has_degradation = True`.
3. **Index Build Validation**:
   - If baseline retriever indexing fails: `self.record_error(..., "startup_index")` and `baseline_has_degradation = True`.
4. **Final Health Assignment**:
   - `self.degraded_mode_active = baseline_has_degradation`
   - If baseline initialization succeeded cleanly without degradation, any previous startup error is cleared (`self.last_error = None`).
   - If genuine degradation occurred during baseline initialization, `self.degraded_mode_active` remains `True`, ensuring `/api/v1/health` reports `status: "degraded"`.

### Automated Health Verification

In [`tests/test_api.py`](file:///d:/DocumentUnderstanding/tests/test_api.py#L91-L116), two dedicated tests verify both states:
- `test_baseline_initialization_successful_health`: Confirms that a pristine baseline initialization reports `degraded_mode_active: false` and `/api/v1/health` reports `status: "healthy"`.
- `test_baseline_initialization_genuine_degradation_health`: Injects a simulated baseline parsing failure, confirms that `degraded_mode_active` is set to `true`, and verifies that `/api/v1/health` reports `status: "degraded"` and `degraded_mode_active: true`. Clean reinitialization resets the health state to `"healthy"`.

---

## 6. Element Schema Compatibility

The table below contrasts the API transport schema `ExtractedElementSchema` with the relational schema of the MySQL `elements` table.

| Schema Field (`ExtractedElementSchema`) | MySQL `elements` Column | Storage Format / Transformation | Constraints & Invariants |
| :--- | :--- | :--- | :--- |
| `element_id` | N/A (API-only) | Persisted inside `provenance.element_id` | `elements` uses `id BIGINT AUTO_INCREMENT` |
| `page` | `page` | `INT NOT NULL` | Check constraint: `page >= 1` |
| `type` | `type` | `ENUM('text','heading','table','formula','figure','caption')` | Validated by repository set before insert |
| `reading_order` | `reading_order` | `INT NOT NULL` | Renamed from `reading_idx` in migration 002; check constraint `reading_order >= 0` |
| `text` | `text` | `MEDIUMTEXT NULL` | Raw and formatted element text |
| `bbox` | `bbox` | `JSON NULL` | Normalized spatial dictionary: `{x, y, width, height, x0, y0, x1, y1}` |
| `table_data` | `structured` | `JSON NULL` | Matrix structure `{num_rows, num_cols, headers, rows}` stored in `structured` column |
| `formula_latex` | `structured` | `JSON NULL` | Mathematical expressions stored as `{"latex": formula_latex}` in `structured` column |
| `raw_confidence` | `provenance` | `JSON NULL` | Preserved in `provenance.raw_confidence` audit lineage |
| `calibrated_confidence` | `confidence` | `FLOAT NOT NULL DEFAULT 1.0` | Maps to `confidence` column; defaults to `raw_confidence` if calibration is bypassed; check constraint `[0.0, 1.0]` |
| `provenance` | `provenance` | `JSON NULL` | Cryptographic SHA-256 hash, extraction timestamp, config identifier |
| `flags` | `flags` | `JSON NULL` | Operational flags: `{is_degraded, degraded_reasons}` |
| `model_version` | `model_version` | `VARCHAR(64) NULL` | Version string of the active extractor backend |

---

## 7. Authentication and File Security

### Fail-Closed Authentication

[`backend/app/api/v1/internal.py`](file:///d:/DocumentUnderstanding/backend/app/api/v1/internal.py#L14-L40):
- **Server Misconfiguration Guard**: If `settings.internal_api_secret` is unset or empty, requests fail closed with `HTTP 500 Internal Server Error`.
- **Client Header Validation**: Requests lacking `X-Internal-Secret` or `Authorization: Bearer <secret>` are rejected with `HTTP 401 Unauthorized`.
- **Constant-Time Comparison**: `secrets.compare_digest` prevents timing attacks on token verification.

### File Boundary Containment and Path Traversal Protection

[`backend/app/api/v1/internal.py`](file:///d:/DocumentUnderstanding/backend/app/api/v1/internal.py#L42-L130):
- **Relative Path Resolution**: Relative file paths are resolved strictly against `upload_dir` (`data/uploads`), handling relative prefixes while rejecting directory traversal attempts (`../../`, `../requirements.txt`).
- **Symlink Defense & TOCTOU Prevention**:
  - Pre-resolution checks (`raw_path.is_symlink()`, `os.path.islink()`).
  - Canonical path resolution (`os.path.realpath`).
  - Secure file descriptor opening using `os.O_NOFOLLOW` and `os.O_RDONLY` to prevent Time-of-Check to Time-of-Use symlink substitution.
- **Path Sanitization**: Client error messages return sanitized basenames (`safe_name = raw_path.name`) rather than leaking server filesystem paths.
- **Binary Header Verification**: PDF binary magic bytes (`%PDF-`) are checked on the secured file descriptor before triggering parser libraries.

---

## 8. Test Execution Evidence and Suite Results

### 1. Complete Python Test Suite
- **Command**: `.venv\Scripts\pytest.exe -v`
- **Total Collected**: 119
- **Passed**: 119
- **Failed**: 0
- **Skipped**: 0
- **Exit Code**: `0`
- **Duration**: 473.97 seconds (7m 53s)

### 2. Internal Extraction Endpoint Suite
- **Command**: `.venv\Scripts\pytest.exe tests/test_internal_extract.py -v`
- **Total Collected**: 20
- **Passed**: 20
- **Failed**: 0
- **Skipped**: 0
- **Exit Code**: `0`
- **Duration**: 67.58 seconds

Test breakdown:
1. `test_successful_extraction_and_doc_id_preservation`: PASSED
2. `test_all_four_supported_modes`: PASSED
3. `test_invalid_authentication`: PASSED
4. `test_path_traversal_rejection`: PASSED
5. `test_symbolic_link_escape_rejection`: PASSED
6. `test_missing_file_handling`: PASSED
7. `test_invalid_pdf_magic_bytes`: PASSED
8. `test_unsupported_mode_rejection`: PASSED
9. `test_empty_document_id_rejection`: PASSED
10. `test_extraction_exception_handling`: PASSED
11. `test_empty_extraction_result`: PASSED
12. `test_repeated_request_behavior`: PASSED
13. `test_existing_public_upload_endpoint_regression`: PASSED
14. `test_fail_closed_server_secret_misconfiguration`: PASSED
15. `test_faiss_failure_rollback_atomicity`: PASSED
16. `test_mode_divergence_behavior`: PASSED
17. `test_path_sanitization_in_errors`: PASSED
18. `test_relative_path_resolution_within_uploads`: PASSED
19. `test_candidate_ft_fallback_integrity`: PASSED
20. `test_faiss_failure_injection_and_search_preservation`: PASSED

### 3. Node.js Express & Repository Regression Suites

All 6 Express test suites executed and passed cleanly:

| Suite File | Assertions Passed | Exit Code | Purpose |
| :--- | :--- | :--- | :--- |
| `backend/src/db/tests/test_pool.js` | 14 / 14 | `0` | Connection pool saturation, credential scrubbing, advisory lock isolation |
| `backend/src/db/tests/test_migration.js` | 18 / 18 | `0` | Migration checksum validation, identity preservation, deep schema verification |
| `backend/src/db/tests/test_repositories.js` | 34 / 34 | `0` | Document, element, job, and evaluation repositories; SKIP LOCKED concurrency |
| `backend/src/tests/test_documents.js` | 28 / 28 | `0` | Document pagination, reading order preservation, formula LaTeX, error handling |
| `backend/src/tests/test_upload_lifecycle.js` | 39 / 39 | `0` | Atomic upload rollback, multi-instance allocator, lock ordering, durable cleanup |
| `backend/src/tests/test_express.js` | 14 / 14 | `0` | Express foundation, CORS, request IDs, error envelopes, graceful shutdown |

**Total Node.js Assertions**: **147 / 147 PASSED** (Exit Code `0` across all suites).

---

## 9. Compliance and Invariant Audit

- **Schema Immutability**: No migration 005 was created; MySQL schema and migrations 001–004 remain intact and protected by checksum tests.
- **Phase Boundary**: No Phase 2 Node.js worker implementation code was introduced.
- **Frozen Baselines**: `acceptance.lock`, evaluation partitions, and charter KPIs remain frozen.
- **Zero Comment Invariant**: Verified zero code comments (`#`, `//`, `/* */`, `--`) across all created and modified source files ([`backend/app/api/v1/internal.py`](file:///d:/DocumentUnderstanding/backend/app/api/v1/internal.py), [`backend/app/schemas/internal.py`](file:///d:/DocumentUnderstanding/backend/app/schemas/internal.py), [`backend/app/services/document_service.py`](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py), [`tests/test_internal_extract.py`](file:///d:/DocumentUnderstanding/tests/test_internal_extract.py), and [`tests/test_api.py`](file:///d:/DocumentUnderstanding/tests/test_api.py)).
