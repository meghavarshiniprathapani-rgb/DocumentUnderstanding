# M1.6.4.3.2 — Durable Worker Lease Repository Specification & Hardening Audit

This document records the durable worker lease repository API, legacy running-job recovery policy, claim-specific fencing semantics (`claim_token` and `lease_generation`), ownership validation rules, transaction boundaries, InnoDB lock-order fix, verification evidence, and known limitations for **M1.6.4.3.2**.

---

## 1. Scope & Migration Changes

- **Frozen Migrations (`001`–`005`)**: Migrations `001_init.sql` through `005_worker_leases.sql` were **not modified**.
- **Migration 005 Prerequisite**: [`005_worker_leases.sql`](file:///d:/DocumentUnderstanding/backend/src/db/migrations/005_worker_leases.sql) added `locked_by`, `locked_at`, `heartbeat_at`, `lease_timeout_seconds`, `idx_jobs_status_heartbeat`, and `idx_jobs_status_mode` to `jobs`.
- **Forward-Only Migration 006**: [`006_worker_claim_fencing.sql`](file:///d:/DocumentUnderstanding/backend/src/db/migrations/006_worker_claim_fencing.sql) (`SHA-256`: `d193d0c0acde7c731678ea7eafa1d6f41191e88db68693fa200c139739a7a52d`) adds claim-fencing columns to `jobs`:
  - `claim_token CHAR(36) NULL DEFAULT NULL AFTER locked_by`
  - `lease_generation INT NOT NULL DEFAULT 0 AFTER claim_token`
- **Migration Runner Hardening**: [`migrator.js`](file:///d:/DocumentUnderstanding/backend/src/db/migrator.js#L236-L266) adds partial-schema detection (`detectPartialSchema(conn, '006')`) and `verifySchema` checks ([`migrator.js`](file:///d:/DocumentUnderstanding/backend/src/db/migrator.js#L419-L428)) verifying `claim_token` (`char(36)`, nullable, default `NULL`) and `lease_generation` (`int`, `NOT NULL`, default `0`).
- **Deferred Scope**: Standalone worker polling, heartbeat interval scheduling, and FastAPI `/api/v1/internal/extract` dispatch remain deferred to subsequent phases. `jobs.status` ENUM (`'queued'`, `'running'`, `'done'`, `'degraded'`, `'failed'`) remains unchanged.

---

## 2. Repository API & Exports

### Constants & Custom Errors

Exported from [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L14-L35) and re-exported from [`repositories/index.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/index.js#L20-L30):

| Symbol | Value / Code | Purpose |
| :--- | :--- | :--- |
| `VALID_JOB_STATUSES` | `Set(['queued', 'running', 'done', 'degraded', 'failed'])` | Canonical allowed `jobs.status` values. |
| `TERMINAL_COMPLETION_STATUSES` | `Set(['done', 'degraded'])` | Allowed target statuses for [`completeJob`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L760-L774). |
| `DEFAULT_MAX_RETRY_ATTEMPTS` | `3` | Default attempt cap before transitioning failed or expired jobs to `'failed'`. |
| `DEFAULT_LEASE_TIMEOUT_SECONDS` | `300` | Default per-job lease duration used by [`createJob`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L150-L185) when omitted. |
| `MAX_WORKER_ID_LENGTH` | `128` | Maximum trimmed character length for `workerId` (`VARCHAR(128)`). |
| `MAX_CLAIM_TOKEN_LENGTH` | `64` | Maximum trimmed character length validated for `claimToken` (`CHAR(36)` UUIDv4). |
| `LeaseOwnershipError` | `code: 'ERR_LEASE_OWNERSHIP'` | Raised when target job is missing, `claimToken` is missing/invalid/stale, `locked_by !== workerId`, or `leaseGeneration` mismatches. |
| `InvalidJobTransitionError` | `code: 'ERR_INVALID_JOB_TRANSITION'` | Raised when a lease operation is invoked on a job not in `'running'` status, or when `completeJob` receives a non-terminal status. |

> [!NOTE]
> `_heartbeatJobCore`, `_completeJobCore`, and `_failJobCore` rethrow `LeaseOwnershipError` and `InvalidJobTransitionError` directly prior to calling [`sanitizeError`](file:///d:/DocumentUnderstanding/backend/src/db/pool.js) so callers receive exact error instances rather than wrapped generic `Error` objects.

### Operations & Test Adapter

| Method / Helper | Location | Input & Output Contract |
| :--- | :--- | :--- |
| `createJob(jobData, options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L150-L185) | Accepts optional positive integer `lease_timeout_seconds` (`300` default); initializes `attempts = 0`, `claim_token = NULL`, `lease_generation = 0`. |
| `claimJob(workerId, options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L434-L440) | Validates `workerId`, assigns UUIDv4 `claim_token`, increments `lease_generation` and `attempts`, sets `locked_at` and `heartbeat_at`, strips unsupported options/callbacks, returns `{ ...updatedJob, claimedBy }`. |
| `heartbeatJob(jobId, workerId, claimTokenOrOptions)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L640-L642) | Accepts string `claimToken` or `{ claimToken \| claim_token, leaseGeneration? }`; refreshes `heartbeat_at` and `updated_at` while preserving `locked_at`, `claim_token`, and `lease_generation`. |
| `completeJob(jobId, workerId, details)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L760-L774) | Requires valid `claimToken` (`details.claimToken \| claim_token`, optional `leaseGeneration`); transitions `'running'` -> `'done' \| 'degraded'`, clears `locked_by`, `claim_token`, `locked_at`, `heartbeat_at` while preserving `lease_generation`. |
| `failJob(jobId, workerId, details)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L923-L938) | Requires valid `claimToken` (`details.claimToken \| claim_token`, optional `leaseGeneration`); transitions to `'queued'` or `'failed'`, clears `locked_by`, `claim_token`, `locked_at`, `heartbeat_at`, preserves `lease_generation`, returns `{ ...updated, retryable }`. |
| `recoverExpiredLeases(options)` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L1096-L1102) | Accepts `{ limit = 10 [1..100], maxAttempts = 3 }`; returns `{ recoveredCount, requeuedCount, failedCount, jobs: [{ action, previousOwner, previousClaimToken, previousLeaseGeneration, legacyUnleased, job }] }`. |
| `cancelQueuedJobsForDocument` / `updateStatus` | [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L196-L224) | Also clear `locked_by = NULL`, `claim_token = NULL`, `locked_at = NULL`, `heartbeat_at = NULL` when moving out of `'running'` ([`updateStatus`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L506-L542)). |
| `jobTestAdapter` | [`jobTestAdapter.js`](file:///d:/DocumentUnderstanding/backend/src/db/tests/jobTestAdapter.js#L18-L44) | Exposes `claimJobWithHook`, `heartbeatJobWithHook(jobId, workerId, claimTokenOrOptions, hooks)`, `completeJobWithHook`, `failJobWithHook`, and `recoverExpiredLeasesWithHook`. All backing hooks fail closed outside `NODE_ENV === 'test' \| 'testing'`. |

---

## 3. Claim-Specific Fencing & Ownership Validation Rules

Relying solely on `locked_by` cannot distinguish two claims made by the same worker process identity (`workerId`): if Worker A's claim stalls, its lease expires and is requeued, and Worker A reclaims the job using the same `workerId`, a stalled execution from Claim 1 would still satisfy `locked_by === 'worker-A'`.

### Claim Token & Generation Semantics

1. **Per-Claim Assignment** ([`_claimJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L370-L396)):
   - Every successful `claimJob()` generates a fresh cryptographically random UUIDv4 `claim_token = crypto.randomUUID()` and atomically increments `lease_generation = lease_generation + 1`.
   - When a claim ends via `completeJob`, `failJob`, `recoverExpiredLeases`, `cancelQueuedJobsForDocument`, `updateStatus`, or `DELETE /api/v1/documents/:id`, `claim_token`, `locked_by`, `locked_at`, and `heartbeat_at` are cleared to `NULL`, while `lease_generation` **never resets** so claim generations remain strictly monotonic across the lifetime of the job row.
2. **Ownership Validation Rules** (`heartbeatJob`, `completeJob`, `failJob`):
   - **Strict Token Requirement**: `normalizeClaimToken` / `extractClaimOptions` ([`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L48-L88)) require a non-empty trimmed `claimToken` (`1..64` chars) on every `heartbeatJob`, `completeJob`, and `failJob` call. Calls omitting `claimToken` (relying on `workerId` alone) throw `LeaseOwnershipError`.
   - **Pre-Update & SQL Guards**: Inside an exclusive `SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE` transaction:
     1. Reject missing job row with `LeaseOwnershipError`.
     2. Enforce `current.status === 'running'`, else throw `InvalidJobTransitionError`.
     3. Enforce `current.locked_by === normalizedWorkerId`, else throw `LeaseOwnershipError`.
     4. Enforce `Boolean(current.claim_token) && current.claim_token === claimToken`, else throw `LeaseOwnershipError`.
     5. If `leaseGeneration` is supplied, enforce `Number(current.lease_generation) === leaseGeneration`, else throw `LeaseOwnershipError`.
     6. Execute `UPDATE jobs ... WHERE id = ? AND status = 'running' AND locked_by = ? AND claim_token = ? AND lease_generation = ?`, requiring `affectedRows === 1`.
   - **Fencing Behavior Across Reclaim**:
     - Between recovery (`status = 'queued'`) and reclaim: stale calls throw `InvalidJobTransitionError`.
     - After reclaim (even by the **same** `workerId` process identity): `current.claim_token` and `current.lease_generation` belong solely to Claim 2, so Claim 1's stale `heartbeatJob`, `completeJob`, or `failJob` throws `LeaseOwnershipError` without modifying the active claim's state or timestamps.

---

## 4. Legacy Running-Job Recovery Policy

### Root Cause Under Migration 005

On a database upgraded from Migration `004` to `005` (`005_worker_leases.sql`), any pre-existing job in `'running'` status naturally receives `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL`, and `lease_timeout_seconds = 300` (and after Migration `006`, `claim_token = NULL`, `lease_generation = 0`).

Under the original recovery predicate (`COALESCE(heartbeat_at, locked_at) IS NOT NULL AND ... < DATE_SUB(...)`), `COALESCE(NULL, NULL)` evaluated to `NULL`, making every legacy `'running'` job **permanently unrecoverable** by `recoverExpiredLeases()` while simultaneously un-completable by any leased worker because `locked_by` and `claim_token` were `NULL`.

### Explicit Policy ([`_recoverExpiredLeasesCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L963-L1087))

- **Preservation During Migration**: Neither `005_worker_leases.sql` nor `006_worker_claim_fencing.sql` alters existing job rows or grants abandoned jobs a synthetic full lease (`locked_at = CURRENT_TIMESTAMP`). All existing fields, `attempts`, timestamps, and `jobs.status` ENUM remain untouched.
- **Recovery Eligibility Query**:

```sql
WHERE status = 'running'
  AND (
    (locked_at IS NULL AND heartbeat_at IS NULL)
    OR (
      COALESCE(heartbeat_at, locked_at) IS NOT NULL
      AND COALESCE(heartbeat_at, locked_at) < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL lease_timeout_seconds SECOND)
    )
  )
ORDER BY id ASC
LIMIT ?
FOR UPDATE SKIP LOCKED
```

- **Transition Semantics for Legacy Jobs (`(locked_at IS NULL AND heartbeat_at IS NULL)`)**:
  - Recovered immediately on the next `recoverExpiredLeases()` call (zero 300-second delay).
  - Locks parent `documents` row (`FOR SHARE`):
    - If document is soft-deleted (`deleted_at !== null`): transitions to `'failed'` with `'Document deleted before processing'`.
    - Else if `attempts < maxAttempts`: requeues to `'queued'` (`action: 'requeued'`, `legacyUnleased: true` when `locked_by` and `claim_token` are also null), recording `'Legacy running job without worker lease metadata recovered; requeued for retry'` (+ prior error if present) so a leased worker can claim it (`claim_token` assigned, `lease_generation` incremented `0 -> 1`).
    - Else (`attempts >= maxAttempts`): transitions to terminal `'failed'`, preserving existing attempt ceiling.

---

## 5. Transaction Boundaries & Lock Ordering

Every transaction touching both `jobs` and `documents` enforces **`jobs (PRIMARY id) -> documents -> secondary index updates on jobs`**:

- Point operations (`heartbeatJob`, `completeJob`, `failJob`) lock `PRIMARY (id)` via `WHERE id = ? LIMIT 1 FOR UPDATE`. (`failJob` validates `status`, `locked_by`, `claim_token`, and `lease_generation` before acquiring `documents FOR SHARE`.)
- Queue/recovery contenders (`claimJob`, `recoverExpiredLeases`) use `FOR UPDATE SKIP LOCKED` before locking parent `documents` (`FOR SHARE`).
- `DELETE /api/v1/documents/:id` ([`routes/documents.js`](file:///d:/DocumentUnderstanding/backend/src/routes/documents.js#L643-L704)) performs a non-locking `SELECT id FROM jobs WHERE doc_id = ? ORDER BY id ASC`, acquires row locks via clustered index `SELECT * FROM jobs WHERE id IN (?) ORDER BY id ASC FOR UPDATE` (eliminating the `idx_jobs_doc_status` <-> `PRIMARY` `ER_LOCK_DEADLOCK` inversion), enforces HTTP `409` if any job is `'running'`, locks `documents WHERE id = ? FOR UPDATE`, and cancels `'queued'` jobs while clearing `locked_by`, `claim_token`, `locked_at`, and `heartbeat_at`.

---

## 6. Verification & Concurrency Test Evidence

All six regression suites ran against real MySQL `8.4` strictly after the final code edit:

| Command | Result | Verified Scope |
| :--- | :--- | :--- |
| `node backend/src/db/tests/test_repositories.js` | `49 / 49 [PASS]` (exit `0`) | Sections 1–5 + Section 6 (`TEST 6.1`–[`TEST 6.15`](file:///d:/DocumentUnderstanding/backend/src/db/tests/test_repositories.js#L937-L1837)), including `TEST 6.14` (null-lease legacy running-job recovery across retryable, max-attempts, and deleted-doc cases without granting a new full lease) and `TEST 6.15` (same-worker reclaim + stale `heartbeatJob`, `completeJob`, `failJob`, and missing-token rejections + active claim completion). |
| `node backend/src/tests/test_upload_lifecycle.js` | `41/41 PASSED` (exit `0`) | Full HTTP upload, cancellation, cleanup queue, and [`SCENARIO 20.1`–`20.6`](file:///d:/DocumentUnderstanding/backend/src/tests/test_upload_lifecycle.js#L921-L1024) (`SCENARIO 7` updated to queue + `claimJob()` so active test leases include real lease metadata). |
| `node backend/src/db/tests/test_migration.js` | `23 PASS` (`[PASS]`, exit `0`) | Immutability of `001`–`005`, checksum & partial-schema verification for `006`, fresh `001 -> 006` migration (`TEST 6.2`), real `004 -> 005 -> 006` upgrade preserving legacy running job + invoking `jobRepository.recoverExpiredLeases()` + reclaiming & completing (`TEST 6.3`), and `006` schema checks (`TEST 6.4`). |
| `node backend/src/db/tests/test_pool.js` | `14 / 14 [PASS]` (exit `0`) | Pool timeout, credential scrubbing, lifecycle idempotency, advisory lock session isolation. |
| `node backend/src/tests/test_documents.js` | `28/28 PASSED` (exit `0`) | Document listing, pagination, mode filtering, segment reading order, error sanitization. |
| `node backend/src/tests/test_express.js` | `14/14 PASSED` (exit `0`) | Express server lifecycle, health/readiness endpoints, CORS, shutdown. |

- Zero code comments added (`git diff -U0 -- backend/src/`: `0` comment-like lines across `817` added lines; `006_worker_claim_fencing.sql`: `0` comment lines).
- Migrations `001`–`005`, `jobs.status` ENUM, and acceptance artifacts remain untouched.

---

## 7. Known Limitations

1. **MySQL `TIMESTAMP` 1-Second Granularity**: `locked_at` and `heartbeat_at` use 1-second precision `TIMESTAMP`. Distinct claims inside the same second are now safely distinguished by `claim_token` and `lease_generation` regardless of wall-clock precision, while consecutive heartbeats within the same second still produce equal `TIMESTAMP` values.
2. **Caller Contract Change on Lease Lifecycle Methods**: `heartbeatJob`, `completeJob`, and `failJob` now require the per-claim `claimToken` returned by `claimJob()`. Any future standalone worker implementation must retain and forward `claim.claim_token` (and optionally `claim.lease_generation`) rather than passing `workerId` alone.
3. **Pre-Lock Job ID Snapshot in Document Deletion**: `DELETE /api/v1/documents/:id` snapshots `jobIds` cleanly before locking by `PRIMARY`; if a future reprocessing feature creates jobs for existing documents concurrently with `DELETE`, job creation must synchronize on `documents` first.
4. **Deferred Worker Runtime**: Standalone worker polling loops, periodic heartbeat timers, and automated background calls to `recoverExpiredLeases()` remain deferred to subsequent M1.6.4 phases.
