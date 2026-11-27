# M1.6.4.4.2 — Python Extraction Integration

## 1. Overview & Architecture Changes

Milestone M1.6.4.4.2 integrates the standalone Node.js document-processing worker ([worker.js](file:///d:/DocumentUnderstanding/backend/src/worker.js) and [backend/src/worker/](file:///d:/DocumentUnderstanding/backend/src/worker/index.js)) with the authenticated FastAPI internal extraction endpoint (`POST /api/v1/internal/extract`), while preserving all durable worker lease, claim-token, lease-generation fencing, heartbeat, retry, and graceful shutdown guarantees from M1.6.4.3.2 and M1.6.4.4.1.

### Components Added and Updated
- **Python Client & Schema Validator**: [pythonClient.js](file:///d:/DocumentUnderstanding/backend/src/worker/pythonClient.js) (`createPythonExtractionClient`, `validateInternalExtractResponse`, `interpretIndexingDiagnostics`, and typed `PythonClientError` hierarchy).
- **Worker Extraction Handler**: [extractionHandler.js](file:///d:/DocumentUnderstanding/backend/src/worker/extractionHandler.js) (`createExtractionJobHandler`, `DocumentUnavailableForExtractionError`). Resolves `job.doc_id` through `documentRepository.findById()` to supply canonical `documents.document_id` and `documents.path`, and maps successful/degraded Python responses into an explicit intermediate outcome rather than a terminal job completion.
- **Worker Runner & Intermediate Outcome Fencing**: [runner.js](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js) (`WorkerRunner`) supports `{ outcome: 'extracted', extractionStatus, isDegraded, seconds, extractionResult }` without invoking `completeJob(..., 'done')`. Before accepting any intermediate extraction outcome, `WorkerRunner` runs a final `repository.heartbeatJob()` fencing check under the active `claimToken` and `leaseGeneration`.
- **Configuration & Secret Redaction**: [config.js](file:///d:/DocumentUnderstanding/backend/src/worker/config.js), [sanitize.js](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js), [worker.js](file:///d:/DocumentUnderstanding/backend/src/worker.js), and [.env.example](file:///d:/DocumentUnderstanding/.env.example).

### Explicit Outcome Semantics Architecture Change
In M1.6.4.4.1, `WorkerRunner._executeClaimedJob` transitioned every resolved handler to `completeJob` (`'done'` or `'degraded'`). Because M1.6.4.4.2 strictly prohibits marking jobs `'done'` or documents `'ready'` before MySQL element persistence and latest-version indexing verification are implemented in a subsequent phase:
1. `createExtractionJobHandler` returns `{ outcome: 'extracted', extractionStatus: 'processed' | 'degraded', isDegraded, seconds, extractionResult }` instead of `{ status: 'done' }`.
2. `WorkerRunner` rejects any handler returning neither `outcome === 'extracted'` nor an explicit terminal `status === 'done' | 'degraded'`, eliminating accidental `'done'` transitions.
3. On `{ outcome: 'extracted' }`, `WorkerRunner` performs an authoritative `heartbeatJob()` fencing verification, stops the entry's heartbeat timer, increments `metrics.jobsExtracted` and either `metrics.jobsExtractedClean` or `metrics.jobsExtractedDegraded`, records a bounded sanitized summary in `lastExtractionOutcomes`, emits `job_extracted` (INFO) or `job_extracted_degraded` (WARN), and leaves `jobs.status = 'running'` in MySQL (`jobsCompleted` remains `0`). Because periodic heartbeats stop once Phase 4.2 extraction settles, un-persisted jobs remain recoverable via `recoverExpiredLeases()` after `lease_timeout_seconds`.

---

## 2. Exact Request and Response Contract

Derived directly from [internal.py](file:///d:/DocumentUnderstanding/backend/app/api/v1/internal.py), [internal.py schema definitions](file:///d:/DocumentUnderstanding/backend/app/schemas/internal.py), [common.py](file:///d:/DocumentUnderstanding/backend/app/schemas/common.py), and [document_service.py](file:///d:/DocumentUnderstanding/backend/app/services/document_service.py):

### Request
- **Method & Path**: `POST /api/v1/internal/extract`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Internal-Secret: <INTERNAL_API_SECRET>`
- **Body (`InternalExtractRequest`)**:
```json
{
  "document_id": "doc-...",
  "file_path": "data/uploads/...",
  "mode": "flat | reference | candidate | candidate_ft"
}
```
Note: `jobs.doc_id` is the numeric foreign key referencing `documents.id`. `extractionHandler.js` resolves the non-deleted `documents` record via `documentRepository.findById(job.doc_id)` and dispatches `doc.document_id`, `doc.path`, and `job.mode`.

### Response (`BaseResponse[InternalExtractResponse]`)
```json
{
  "config_version": "1.0.0",
  "status": "success",
  "message": "Document extraction completed successfully",
  "data": {
    "document_id": "doc-...",
    "mode": "reference",
    "status": "processed | degraded",
    "page_count": 2,
    "elements": [
      {
        "element_id": "...",
        "page": 1,
        "type": "heading",
        "reading_order": 0,
        "text": "...",
        "bbox": {
          "x0": 72.0,
          "y0": 72.0,
          "x1": 540.0,
          "y1": 95.0,
          "x": 72.0,
          "y": 72.0,
          "width": 468.0,
          "height": 23.0
        },
        "table_data": null,
        "formula_latex": null,
        "raw_confidence": 0.98,
        "calibrated_confidence": null,
        "provenance": null,
        "flags": {
          "is_degraded": false,
          "degraded_reasons": []
        },
        "model_version": "..."
      }
    ],
    "processing_time_ms": 48.23,
    "extractor": {
      "name": "...",
      "version": "...",
      "fallback_occurred": false,
      "fallback_reason": null
    },
    "model_versions": {
      "extractor": "...",
      "embedding": "...",
      "layout_engine": "...",
      "provenance_subsystem": "..."
    },
    "extraction_warnings": [],
    "indexing_status": "Indexed | Skipped | Failed",
    "indexing_diagnostics": {
      "vector_store": "FAISS",
      "latest_version_indexed": true,
      "previous_version_searchable": false,
      "searchable": true,
      "chunk_count": 2
    },
    "fallback": null
  },
  "timestamp": "2026-11-27T00:00:00Z"
}
```

### Validated Response Guarantees (`validateInternalExtractResponse`)
- Outer envelope requires `status === 'success'`, non-empty `config_version`, and plain-object `data`.
- `data.document_id` must match the claimed job's resolved `doc.document_id` (`document_id_mismatch`).
- `data.mode` must be in `['flat', 'reference', 'candidate', 'candidate_ft']` and match `job.mode` (`mode_mismatch`).
- `data.status` must be `'processed'` or `'degraded'`.
- `data.page_count` must be a positive integer (`>= 1`); `data.processing_time_ms` must be finite `>= 0`.
- `data.elements` must be a non-empty array where every item validates `page`, `type`, `reading_order`, `text`, numeric `bbox` values, `raw_confidence` within `[0, 1]`, and optional fields (`calibrated_confidence`, `table_data`, `formula_latex`, `provenance`, `flags`, `model_version`).
- `data.extractor` (`name`, `version`, optional boolean `fallback_occurred`) and string-valued `data.model_versions` are required.
- `data.indexing_status` (`'Indexed' | 'Skipped' | 'Failed'`) and `data.indexing_diagnostics` (`latest_version_indexed` boolean, `searchable` boolean, optional `previous_version_searchable` boolean) must be mutually consistent (`Indexed` requires `latest_version_indexed === true`; `Skipped`/`Failed` require `latest_version_indexed === false`).
- `isDegraded` is evaluated as `data.status === 'degraded' || fallbackOccurred || indexing.status === 'Failed' || !indexing.latestVersionIndexed`, keeping degraded outcomes strictly distinguishable from clean extractions.

---

## 3. Configuration

| Variable | Default | Validation Rule |
| :--- | :--- | :--- |
| `PYTHON_SERVICE_URL` | `http://127.0.0.1:8000` | Valid single-line `http:` or `https:` URL with non-empty host; rejects whitespace, embedded credentials, query strings, and fragments. |
| `INTERNAL_API_SECRET` | Required (no secret default) | Non-empty single-line trimmed string required when starting the Python extraction worker (`loadWorkerConfig` / `runStandaloneWorker`). Rejected with `WorkerConfigError` (`ERR_WORKER_CONFIG`) if missing, blank, or multi-line. |
| `PYTHON_EXTRACTION_TIMEOUT_MS` | `60000` | Integer in `[100, 600000]`. |

[.env.example](file:///d:/DocumentUnderstanding/.env.example) includes placeholder configuration entries only; no real secrets are committed or hardcoded.

---

## 4. Authentication and Secret Redaction

- Outbound requests send `X-Internal-Secret: <INTERNAL_API_SECRET>` on `POST /api/v1/internal/extract`.
- `loadWorkerConfig()` attaches `internalApiSecret` as a **non-enumerable** read-only property on the frozen config object and exposes only `internalApiSecretConfigured: Boolean(...)` as an enumerable field, preventing `WorkerRunner.getState()`, `_buildStopSummary()`, `JSON.stringify()`, and `worker_started` logs from ever leaking the secret.
- [sanitize.js](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js) collects `INTERNAL_API_SECRET`, `PYTHON_INTERNAL_API_SECRET`, `DB_PASSWORD`, and overrides, and scrubs `x-internal-secret`, `authorization`, `bearer <token>`, and embedded URL credentials from errors, HTTP error response bodies, and worker logs.
- No HTTP request headers or raw secrets are logged.

---

## 5. Timeout, Cancellation, and Lease-Loss Behavior

- `createPythonExtractionClient.extract()` composes an internal `AbortController` combining the caller's `executionContext.signal` with a per-request timer of `timeoutMs`. Timers and abort listeners are deterministically cleaned up in `finally`.
- **Timeout**: Exceeding `PYTHON_EXTRACTION_TIMEOUT_MS` aborts the underlying `fetch()` call and throws `PythonTimeoutError` (`ERR_PYTHON_TIMEOUT`, `retryable: true`). No false completion occurs.
- **AbortSignal Cancellation**: If `signal` is already aborted before dispatch, no HTTP request is sent (`PythonAbortError`, `retryable: false`). If aborted mid-flight (for example by lease loss or shutdown grace expiration), the HTTP request is aborted immediately and rejects with `PythonAbortError`.
- **Lease Loss During Extraction**:
  1. Periodic heartbeats running during extraction detect `LeaseOwnershipError` / `InvalidJobTransitionError`, set `entry.leaseLost = true`, increment `metrics.leaseLosses`, and call `entry.abortController.abort()` to terminate the in-flight HTTP call.
  2. Immediately after `extractionHandler` returns `{ outcome: 'extracted' }`, `WorkerRunner` runs an explicit `heartbeatJob` fence check before recording metrics/outcomes, blocking stale results if another worker reclaimed the expired lease right before Python responded.
- **Shutdown During Extraction**:
  - `WorkerRunner.stop()` stops new claims and waits up to `WORKER_SHUTDOWN_GRACE_MS` for in-flight extractions (allowing short extractions and their final DB fence check to finish cleanly before `closePool()`).
  - When `WORKER_SHUTDOWN_GRACE_MS` expires, `_handleGraceExpiration()` marks `entry.graceExpired = true`, increments `metrics.graceTimeouts`, aborts `entry.abortController`, closes the DB pool, and suppresses any subsequent `failJob` or `completeJob` write.

---

## 6. Failure Classification

| Failure Condition | Error Class | Code | `retryable` | Worker Behavior |
| :--- | :--- | :--- | :--- | :--- |
| Invalid client/worker config | `WorkerConfigError` / `PythonConfigurationError` | `ERR_WORKER_CONFIG` / `ERR_PYTHON_CONFIG` | `false` | Rejected at startup or config check |
| Document missing or soft-deleted | `DocumentUnavailableForExtractionError` | `ERR_DOCUMENT_UNAVAILABLE` | `false` | `failJob(..., retryable: false)` -> `failed` |
| Unreachable / refused socket / DNS | `PythonNetworkError` | `ERR_PYTHON_NETWORK` | `true` | `failJob(..., retryable: true)` -> re-queued until `maxAttempts` |
| Request exceeded `timeoutMs` | `PythonTimeoutError` | `ERR_PYTHON_TIMEOUT` | `true` | `failJob(..., retryable: true)` -> re-queued until `maxAttempts` |
| Aborted via `AbortSignal` | `PythonAbortError` | `ERR_PYTHON_ABORTED` | `false` | Skipped if `leaseLost` / `graceExpired`; else `failJob(..., retryable: false)` |
| HTTP `401` / `403` | `PythonAuthenticationError` | `ERR_PYTHON_AUTH` | `false` | `failJob(..., retryable: false)` -> `failed` |
| HTTP `400` / `404` / `422` (other `4xx`) | `PythonHttpError` | `ERR_PYTHON_HTTP` | `false` | `failJob(..., retryable: false)` -> `failed` |
| HTTP `408` / `429` / `5xx` | `PythonHttpError` | `ERR_PYTHON_HTTP` | `true` | `failJob(..., retryable: true)` -> re-queued until `maxAttempts` |
| Malformed JSON / Schema / ID or mode mismatch | `PythonResponseValidationError` | `ERR_PYTHON_RESPONSE_INVALID` | `false` | `failJob(..., retryable: false)` -> `failed` |

`pythonClient` performs **zero** internal retries; all retry scheduling is governed exclusively by `WorkerRunner` and `jobRepository.failJob()` with `WORKER_MAX_ATTEMPTS`.

---

## 7. Verification & Test Results

All verification suites ran against live MySQL 8 (`docuretrieve` at migration `006`) and a live FastAPI `uvicorn` instance in `.venv`:

| Command | Result | Exit Code |
| :--- | :--- | :--- |
| `node backend/src/tests/test_python_worker.js` | `16/16 TESTS PASSED` (includes live FastAPI uvicorn HTTP extraction + 401 auth test) | `0` |
| `node backend/src/tests/test_worker.js` | `11 / 11 [PASS]` | `0` |
| `node backend/src/db/tests/test_repositories.js` | `49 / 49 [PASS]` | `0` |
| `node backend/src/tests/test_upload_lifecycle.js` | `41/41 PASSED` | `0` |
| `node backend/src/db/tests/test_migration.js` | `ALL M1.3.4 MIGRATION IMMUTABILITY & AUDIT TESTS PASSED [PASS]` (24 checks) | `0` |
| `node backend/src/db/tests/test_pool.js` | `14 / 14 [PASS]` | `0` |
| `node backend/src/tests/test_documents.js` | `28/28 PASSED` | `0` |
| `node backend/src/tests/test_express.js` | `14/14 PASSED` | `0` |
| `.\.venv\Scripts\python.exe -m pytest tests/test_internal_extract.py -q` | `20 passed in 143.52s` | `0` |

---

## 8. Known Limitations & Scope Boundaries

- **Elements are NOT yet persisted**: Extracted elements returned in `InternalExtractResponse.elements` are validated in memory and summarized in worker telemetry/hooks, but are **not** written to the MySQL `elements` table in M1.6.4.4.2.
- **Jobs are NOT considered fully processed**: Successfully extracted jobs remain `status = 'running'` (never marked `'done'`), and parent `documents.status` is **not** marked `'ready'`. Full completion transitions await the persistence and verification milestone.
- **FAISS indexing is in-memory / non-durable**: `indexing_diagnostics.vector_store = "FAISS"` and `latest_version_indexed` reflect the Python FastAPI process's in-memory FAISS index only; FAISS vector state is **not** disk-persistent across Python restarts.
- **No migrations or schema changes**: `jobs.status` ENUM (`'queued','running','done','degraded','failed'`), existing migrations (`001`–`006`), Python extraction algorithms, acceptance datasets, and `acceptance.lock` are unchanged.
