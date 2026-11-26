# M1.6.4.3.2 — Durable Worker Lease Repository Specification & Concurrency Audit

This document records the durable worker lease repository API, state transition rules, lease expiration policy, transaction boundaries, InnoDB lock-order fix, verification evidence, and known limitations for **M1.6.4.3.2**.

---

## 1. Scope & Prerequisites

- Builds strictly on **Migration 005** ([`005_worker_leases.sql`](file:///d:/DocumentUnderstanding/backend/src/db/migrations/005_worker_leases.sql)), which added `locked_by`, `locked_at`, `heartbeat_at`, `lease_timeout_seconds`, `idx_jobs_status_heartbeat`, and `idx_jobs_status_mode` to `jobs`.
- Does **not** modify migrations `001`–`005` or `jobs.status` ENUM values (`'queued'`, `'running'`, `'done'`, `'degraded'`, `'failed'`).
- Leaves the standalone Node.js worker loop, heartbeat timer scheduling, and Python service invocation to subsequent phases.

---

## 2. Repository API & Exports

### Constants & Custom Errors

Exported from [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L13-L33) and re-exported from [`repositories/index.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/index.js#L20-L29):

| Symbol | Value / Code | Purpose |
| :--- | :--- | :--- |
| `VALID_JOB_STATUSES` | `Set(['queued', 'running', 'done', 'degraded', 'failed'])` | Canonical allowed `jobs.status` values. |
| `TERMINAL_COMPLETION_STATUSES` | `Set(['done', 'degraded'])` | Allowed target statuses for [`completeJob`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L670-L677). |
| `DEFAULT_MAX_RETRY_ATTEMPTS` | `3` | Default attempt cap before transitioning failed or expired jobs to `'failed'`. |
| `DEFAULT_LEASE_TIMEOUT_SECONDS` | `300` | Default per-job lease duration used by [`createJob`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L100-L135) when `lease_timeout_seconds` is omitted. |
| `MAX_WORKER_ID_LENGTH` | `128` | Maximum allowed trimmed character length for `workerId` (`VARCHAR(128)`). |
| `LeaseOwnershipError` | `code: 'ERR_LEASE_OWNERSHIP'` | Raised when the target job is missing or owned by another worker (`locked_by !== workerId`). |
| `InvalidJobTransitionError` | `code: 'ERR_INVALID_JOB_TRANSITION'` | Raised when a lease operation is invoked on a job not in `'running'` status, or when `completeJob` receives a non-terminal status. |

> [!NOTE]
> [`_heartbeatJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L513-L570), [`_completeJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L586-L668), and [`_failJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L694-L795) rethrow `LeaseOwnershipError` and `InvalidJobTransitionError` directly prior to calling [`sanitizeError`](file:///d:/DocumentUnderstanding/backend/src/db/pool.js) so callers receive exact error instances rather than wrapped generic `Error` objects.

### Operations & Test Adapter

| Method / Helper | Location | Input & Output Contract |
| :--- | :--- | :--- |
| `createJob(jobData, options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L100-L135) | Accepts optional positive integer `lease_timeout_seconds` (defaults to `300`); inserts `queued` job with `attempts = 0`. |
| `claimJob(workerId, options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L379-L385) | Validates non-empty trimmed `workerId` (`<= 128` chars), accepts `{ mode? }`, strips unsupported properties/callbacks, and returns `{ ...updatedJob, claimedBy: normalizedWorkerId }` or `null`. |
| `heartbeatJob(jobId, workerId)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L572-L574) | Refreshes `heartbeat_at` and `updated_at` for an active `'running'` job owned by `workerId`; returns updated job row. |
| `completeJob(jobId, workerId, details)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L670-L677) | Accepts `{ status = 'done' \| 'degraded', seconds?, error? }`; clears lease fields and returns updated job row. |
| `failJob(jobId, workerId, details)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L797-L805) | Accepts `{ error?, seconds?, retryable?, maxAttempts? }`; transitions to `'queued'` or `'failed'`, clears lease fields, and returns `{ ...updated, retryable }`. |
| `recoverExpiredLeases(options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L932-L938) | Accepts `{ limit = 10 [1..100], maxAttempts = 3 }`; returns `{ recoveredCount, requeuedCount, failedCount, jobs: [{ action, previousOwner, job }] }`. |
| `cancelQueuedJobsForDocument` / `updateStatus` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L146-L164) | Also clear `locked_by = NULL, locked_at = NULL, heartbeat_at = NULL` whenever status is `'queued'` or moved out of `'running'` ([`updateStatus`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L451-L481)). |
| `jobTestAdapter` | [`jobTestAdapter.js`](file:///d:/DocumentUnderstanding/backend/src/db/tests/jobTestAdapter.js#L18-L44) | Exposes `claimJobWithHook`, `heartbeatJobWithHook`, `completeJobWithHook`, `failJobWithHook`, and `recoverExpiredLeasesWithHook`. Every backing hook helper fails closed outside `NODE_ENV === 'test'` or `'testing'`. |

---

## 3. State Transition Rules & Lease Expiry Calculation

### Transition Matrix

1. **Claim (`queued` -> `running`)** ([`_claimJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L259-L348)):
   - Queries `SELECT * FROM jobs WHERE status = 'queued' [AND mode = ?] ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`.
   - Acquires `FOR SHARE` on the parent `documents` row; if the parent document is missing or soft-deleted (`deleted_at !== null`), cancels the job to `'failed'` with `'Document deleted before processing'` and clears lease columns, returning `null`.
   - Sets `status = 'running'`, `attempts = attempts + 1`, `locked_by = ?`, `locked_at = CURRENT_TIMESTAMP`, `heartbeat_at = CURRENT_TIMESTAMP`, `updated_at = CURRENT_TIMESTAMP` while leaving `lease_timeout_seconds` unchanged.
2. **Heartbeat (`running` -> `running`)** ([`_heartbeatJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L513-L570)):
   - Locks `jobs WHERE id = ? LIMIT 1 FOR UPDATE`.
   - Enforces `status === 'running'` (`InvalidJobTransitionError`) and `locked_by === normalizedWorkerId` (`LeaseOwnershipError`).
   - Updates `heartbeat_at = CURRENT_TIMESTAMP`, `updated_at = CURRENT_TIMESTAMP` gated by `WHERE id = ? AND status = 'running' AND locked_by = ?`, preserving `locked_at`.
3. **Complete (`running` -> `'done' | 'degraded'`)** ([`_completeJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L586-L668)):
   - Validates `targetStatus` is in `TERMINAL_COMPLETION_STATUSES` (`'done'` or `'degraded'`).
   - Locks `jobs WHERE id = ? LIMIT 1 FOR UPDATE`, checks `status === 'running'` and `locked_by === normalizedWorkerId`, sets terminal `status`, clears `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL`, and writes optional `seconds` and `error`.
4. **Fail & Retry (`running` -> `'queued' | 'failed'`)** ([`_failJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L694-L795)):
   - Locks `jobs WHERE id = ? LIMIT 1 FOR UPDATE`, verifies `status === 'running'` and `locked_by === normalizedWorkerId`, then checks parent `documents WHERE id = ? FOR SHARE`.
   - Computes `allowRetry = details?.retryable !== false && !docDeleted && Number(current.attempts) < maxAttemptsRaw`.
   - Transitions to `'queued'` if `allowRetry` or `'failed'` otherwise, always clearing `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL`. When `docDeleted` and `details?.error === undefined`, records `'Document deleted before processing'`.
5. **Recover Expired Leases (`running` -> `'queued' | 'failed'`)** ([`_recoverExpiredLeasesCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L823-L930)):
   - Scans eligible expired `'running'` rows in ascending `id` order using `LIMIT ? FOR UPDATE SKIP LOCKED`.
   - Locks each job's parent `documents` row (`FOR SHARE`).
   - Requeues to `'queued'` when `!docDeleted && Number(row.attempts) < maxAttempts`; otherwise transitions to `'failed'`.
   - Records diagnostic `error` context (either `'Document deleted before processing'` when soft-deleted, or lease expiration duration `lease_timeout_seconds`, owning worker `locked_by || 'unknown'`, and any prior `row.error`).
   - Clears `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL` gated by `WHERE id = ? AND status = 'running'`.

### Lease Expiration Predicate

In [`_recoverExpiredLeasesCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L835-L844), expiration is evaluated atomically inside MySQL as:

```sql
WHERE status = 'running'
  AND COALESCE(heartbeat_at, locked_at) IS NOT NULL
  AND COALESCE(heartbeat_at, locked_at) < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL lease_timeout_seconds SECOND)
ORDER BY id ASC
LIMIT ?
FOR UPDATE SKIP LOCKED
```

This evaluates each job's own persisted `lease_timeout_seconds`, uses strict `<` to avoid premature expiration on exact boundary seconds, and falls back to `locked_at` when `heartbeat_at` is null.

---

## 4. Transaction Boundaries & Lock Ordering

Every transaction touching both `jobs` and `documents` enforces the global lock hierarchy:

1. **Clustered `jobs` row lock (`PRIMARY id`) first**:
   - Point operations (`heartbeatJob`, `completeJob`, `failJob`) acquire X-locks directly via `SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE`.
   - Multi-row contenders (`claimJob`, `recoverExpiredLeases`) scan status indexes with `FOR UPDATE SKIP LOCKED`, acquiring `PRIMARY (id)` X-locks on non-contended rows and skipping already-locked rows immediately.
2. **Parent `documents` row lock second**:
   - `claimJob`, `failJob`, and `recoverExpiredLeases` acquire `FOR SHARE` on `documents WHERE id = ?`.
   - `DELETE /api/v1/documents/:id` acquires `FOR UPDATE` on `documents WHERE id = ?`.
3. **Secondary index mutations on `jobs` last**:
   - `UPDATE jobs SET status = ...` mutates `idx_jobs_doc_status` and `idx_jobs_status*` only after the transaction already holds X-locks on `PRIMARY (id)` and the appropriate lock on `documents`.

### Secondary-Index Inversion Fix (`ER_LOCK_DEADLOCK` Elimination)

During concurrent stress testing (`TEST 6.13`), running `DELETE /api/v1/documents/:id` concurrently against `recoverExpiredLeases` exposed an InnoDB `ER_LOCK_DEADLOCK` (1213) hazard inside `jobs` itself:

- `recoverExpiredLeases` (and `claimJob`) lock `jobs` via `idx_jobs_status* -> PRIMARY (id)`, lock `documents (FOR SHARE)`, and then execute `UPDATE jobs SET status = ...`, which requests X-locks on `idx_jobs_doc_status`.
- Previously, `DELETE /api/v1/documents/:id` executed `SELECT * FROM jobs WHERE doc_id = ? FOR UPDATE`, acquiring X-locks on `idx_jobs_doc_status` *before* acquiring X-locks on `PRIMARY (id)`. Under concurrent interleaving, recovery held `PRIMARY (id)` waiting for `idx_jobs_doc_status`, while deletion held `idx_jobs_doc_status` waiting for `PRIMARY (id)`.

Fixed in [`routes/documents.js`](file:///d:/DocumentUnderstanding/backend/src/routes/documents.js#L643-L703) and verified in [`test_repositories.js`](file:///d:/DocumentUnderstanding/backend/src/db/tests/test_repositories.js#L1409-L1480):

- Deletion performs a non-locking lookup `SELECT id FROM jobs WHERE doc_id = ? ORDER BY id ASC`.
- When job IDs exist, deletion locks directly on the clustered index via `SELECT * FROM jobs WHERE id IN (?) ORDER BY id ASC FOR UPDATE`, eliminating upfront locking on `idx_jobs_doc_status`.
- After verifying no job has `status === 'running'` (otherwise returning HTTP `409`) and locking `documents WHERE id = ? FOR UPDATE`, deletion cancels queued jobs using `WHERE id IN (?) AND status = 'queued'` while clearing `locked_by`, `locked_at`, and `heartbeat_at`.

---

## 5. Verification & Concurrency Test Evidence

All checks below ran after the final edit on MySQL `8.4`:

| Command | Result | Verified Scope |
| :--- | :--- | :--- |
| `node backend/src/db/tests/test_repositories.js` | `47 / 47 [PASS]` (exit `0`) | Sections 1–5 + Section 6 (`TEST 6.1`–[`TEST 6.13`](file:///d:/DocumentUnderstanding/backend/src/db/tests/test_repositories.js#L888-L1488)): claims, competing claimants, owner vs non-owner heartbeat/complete/fail, retry requeue/exhaustion, lease expiry + stale fence-out, `SKIP LOCKED` dual recovery, heartbeat vs recovery, complete vs recovery, and deadlock-free deletion vs recovery in both interleavings. |
| `node backend/src/tests/test_upload_lifecycle.js` | `41/41 PASSED` (exit `0`) | Full HTTP lifecycle including [`SCENARIO 20.5` & `SCENARIO 20.6`](file:///d:/DocumentUnderstanding/backend/src/tests/test_upload_lifecycle.js#L975-L1024): HTTP `DELETE /api/v1/documents/:id` vs `recoverExpiredLeases` in both recovery-first and deletion-first interleavings. |
| `node backend/src/db/tests/test_pool.js` | `14 / 14 [PASS]` (exit `0`) | Pool timeout, credential scrubbing, lifecycle idempotency, advisory lock session isolation. |
| `node backend/src/db/tests/test_migration.js` | `22 PASS` (`[PASS]`, exit `0`) | Checksums for `001`–`005`, preflight identity checks, partial schema detection, deep `INFORMATION_SCHEMA` validation. |
| `node backend/src/tests/test_documents.js` | `28/28 PASSED` (exit `0`) | Document listing, pagination, mode filtering, segment reading order, error sanitization. |
| `node backend/src/tests/test_express.js` | `14/14 PASSED` (exit `0`) | Express server lifecycle, health/readiness endpoints, CORS, shutdown. |
| `node backend/src/db/migrator.js` | `0 applied, 5 skipped` (exit `0`) | Schema verification and idempotency on working DB. |

- Live database teardown check after all test runs confirmed `jobs` table empty (`[]`) and `_migrations` applied through `005`.
- Repository `git diff` across `backend/src/` added `0` comment-like lines across `1781` added lines.
- Knowledge graph updated via `graphify update .` (`exit 0`).

---

## 6. Known Limitations

1. **MySQL `TIMESTAMP` 1-Second Granularity**: `locked_at` and `heartbeat_at` use MySQL `TIMESTAMP` (1-second precision). Heartbeat renewals occurring inside the same wall-clock second produce identical timestamp values; deterministic tests account for this explicitly without `sleep` flakiness.
2. **Pre-Lock Job ID Snapshot in Document Deletion**: `DELETE /api/v1/documents/:id` discovers `jobIds` with a non-locking `SELECT id FROM jobs WHERE doc_id = ? ORDER BY id ASC` under InnoDB `REPEATABLE READ` prior to acquiring `PRIMARY` locks. This is safe under the current one-job-at-upload lifecycle; if a future endpoint inserts new jobs for an already-existing document (such as reprocessing), deletion and job creation should serialize via `documents` or reject job creation once deletion begins.
3. **Worker Loop & Periodic Lease Recovery**: Periodic claiming, heartbeat interval management, scheduled calls to `recoverExpiredLeases`, and FastAPI `/api/v1/internal/extract` dispatch are intentionally deferred to subsequent M1.6.4 phases.
