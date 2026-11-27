# M1.6.4.4.1 — Standalone Node.js Worker Foundation

This document specifies the architecture, validated configuration, claim-fencing identity model, polling and exponential backoff behavior, graceful shutdown semantics, and verification evidence for the **standalone Node.js document-processing worker foundation** (**M1.6.4.4.1**).

---

## 1. Architecture & Scope Boundaries

The worker executes as an independent Node.js process decoupled from the Express HTTP server (`backend/src/server.js`):

- **CLI Entrypoint**: [`worker.js`](file:///d:/DocumentUnderstanding/backend/src/worker.js) — exports [`runStandaloneWorker`](file:///d:/DocumentUnderstanding/backend/src/worker.js#L14) and auto-starts when invoked directly (`node backend/src/worker.js`).
- **Worker Subsystem Modules (`backend/src/worker/`)**:
  - [`config.js`](file:///d:/DocumentUnderstanding/backend/src/worker/config.js) — environment/override parsing, range checks, stable identity generation, and `WorkerConfigError`.
  - [`sanitize.js`](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js) — recursive secret/credential scrubbing for errors, stack traces, and structured logs.
  - [`logger.js`](file:///d:/DocumentUnderstanding/backend/src/worker/logger.js) — structured JSON logger outputting `INFO`/`WARN`/`ERROR` lines without leaking DB passwords or internal API secrets.
  - [`runner.js`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js) — [`WorkerRunner`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L13) lifecycle state machine, bounded polling loop, lease heartbeat timers, claim-fencing execution, and shutdown grace drain.
  - [`index.js`](file:///d:/DocumentUnderstanding/backend/src/worker/index.js) — public exports (`createWorker`, `WorkerRunner`, `loadWorkerConfig`, `DEFAULT_WORKER_CONFIG`, `WorkerConfigError`, `generateWorkerId`, `createWorkerLogger`, `sanitizeWorkerError`).
- **Deferred Scope**: Python extraction dispatch (`POST /api/v1/internal/extract`), MySQL `elements` persistence, and FAISS indexing remain out of scope for Phase 4.1 (`defaultFoundationHandler` rejects cleanly via `failJob` rather than marking jobs complete if an unconfigured CLI instance encounters queued work). No database migrations or `jobs.status` ENUM values were altered.

---

## 2. Validated Worker Configuration

Validated at startup by [`loadWorkerConfig`](file:///d:/DocumentUnderstanding/backend/src/worker/config.js#L111) using existing database settings (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` via [`getDefaultDbConfig`](file:///d:/DocumentUnderstanding/backend/src/db/pool.js#L55)):

| Environment Variable | Default | Validation Constraints |
| :--- | :--- | :--- |
| `WORKER_ID` | Auto-generated `worker_<host>_<pid>_<hex4>` | Trimmed string `1..128` printable chars (`<= MAX_WORKER_ID_LENGTH`), no newlines or null bytes. |
| `WORKER_CONCURRENCY` | `1` | Integer in `1..64`. |
| `WORKER_POLL_INTERVAL_MS` | `2000` | Integer in `10..300000` ms. |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `15000` | Integer in `10..300000` ms. |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000` | Integer in `0..600000` ms. |
| `WORKER_MAX_ATTEMPTS` | `3` | Integer in `1..20`. |
| `WORKER_MODE` (optional) | `undefined` (all modes) | When set, must be one of `'flat'`, `'reference'`, `'candidate'`, `'candidate_ft'`. |
| `WORKER_POLL_BACKOFF_INITIAL_MS` | `500` | Integer in `10..300000` ms. |
| `WORKER_POLL_BACKOFF_MAX_MS` | `30000` | Integer in `10..300000` ms, `>= WORKER_POLL_BACKOFF_INITIAL_MS`. |

- **Fail-Fast & Sanitization**: Invalid settings throw `WorkerConfigError` (`ERR_WORKER_CONFIG`) at startup before polling starts; CLI startup failures exit with code `1` after passing errors through [`sanitizeWorkerError`](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js#L73).
- **Secret Protection**: Both [`sanitizeWorkerError`](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js#L73) and [`sanitizeValue`](file:///d:/DocumentUnderstanding/backend/src/worker/sanitize.js#L47) scrub `DB_PASSWORD`, `INTERNAL_API_SECRET`, `PYTHON_INTERNAL_API_SECRET`, `API_SECRET`, `JWT_SECRET`, URI passwords, and secret/token key-value patterns. `getState().config` exposes host, port, and database name without DB passwords or API secrets.

---

## 3. Worker Identity & Claim-Specific Ownership

- [`WorkerRunner`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L13) binds a single immutable `workerId` at initialization (`generateWorkerId` or validated `WORKER_ID`).
- On every claim in [`_runPollLoop`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L303), [`_hasValidClaimOwnership`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js) verifies non-empty `claim_token`, `lease_generation >= 1`, and `locked_by === workerId` before launching execution. Tokenless or mismatched claim responses are rejected with backoff rather than treated as owned.
- [`_startJobExecution`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js) attaches each job's own `{ claimToken, leaseGeneration }` to its isolated execution context (`executionContext`) and self-rescheduling heartbeat timer ([`_scheduleHeartbeat`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L422)).
- Every repository lease pulse and transition (`heartbeatJob`, `completeJob`, `failJob`) forwards `{ claimToken, leaseGeneration }`; claim tokens are never reused across jobs or retries. If `heartbeatJob` raises `LeaseOwnershipError` or `InvalidJobTransitionError`, the runner sets `leaseLost = true`, stops heartbeating, aborts the handler's `AbortController`, and refuses any late completion/failure overwrite.

---

## 4. Polling Loop & Error Backoff Behavior

- **Bounded Concurrency**: [`_runPollLoop`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L303) claims queued jobs up to `activeJobs.size < config.concurrency`. When at full capacity, polling suspends (`_waitForWake(null)`) until an active job settles or shutdown begins.
- **No Busy-Loop on Empty Queue**: When `claimJob()` returns `null`, polling pauses for `pollIntervalMs` via interruptible timer (`_waitForWake(pollIntervalMs)`), waking immediately only if `stop()` is called.
- **Bounded Backoff on DB Errors**: Poll exceptions (such as MySQL connection loss) increment `consecutivePollErrors` and schedule `backoffMs = Math.min(maxPollErrorBackoffMs, pollErrorBackoffMs * 2 ** (consecutivePollErrors - 1))`, resetting `consecutivePollErrors` and `lastBackoffMs` cleanly once a poll succeeds.
- **Diagnostics**: [`getState()`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L63) returns `{ workerId, status, shuttingDown, shutdownReason, config, activeJobCount, activeJobs, timedOutJobIds, metrics, lastPollError, databaseClosed }`.

---

## 5. Graceful Shutdown & Grace Timeout Semantics

Signal handlers (`SIGINT` and `SIGTERM`) in [`runStandaloneWorker`](file:///d:/DocumentUnderstanding/backend/src/worker.js#L14) and programmatic [`stop()`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L122) execute [`_performStop`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L135):

1. Transition worker state to `'stopping'` and immediately wake and drain [`_runPollLoop`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L303) so no new jobs are claimed.
2. Allow active job handlers to finish up to `shutdownGraceMs` while **continuing periodic `heartbeatJob` renewals** for active jobs throughout the grace window.
3. Handlers finishing before grace expiry transition cleanly via `completeJob` (`'done'` / `'degraded'`) or `failJob` with their `{ claimToken, leaseGeneration }`.
4. **If Shutdown Grace Expires** ([`_handleGraceExpiration`](file:///d:/DocumentUnderstanding/backend/src/worker/runner.js#L205)):
   - Marks `graceExpired = true`, records `timedOutJobIds`, stops all scheduled heartbeat timers, signals `abortController.abort(...)`, and awaits any already-dispatched DB calls briefly before pool teardown.
   - **No False Completion**: Never calls `completeJob` for handlers that did not finish in time.
   - **No Premature Release**: Never resets still-running jobs back to `'queued'` while handlers have not stopped safely; jobs remain `'running'` in MySQL until lease timeout allows [`recoverExpiredLeases`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L1096) to reclaim them cleanly.
5. Closes MySQL pool resources via `closePool()` (`databaseClosed: true`).

---

## 6. Verification & Integration Test Evidence

All assertions below ran against real MySQL `8.4` strictly after the final code edits:

| Command | Result | Verified Scope |
| :--- | :--- | :--- |
| `node backend/src/tests/test_worker.js` | `11 / 11 [PASS]` (exit `0`) | [`TEST 1`–`TEST 12`](file:///d:/DocumentUnderstanding/backend/src/tests/test_worker.js#L167-L895): startup/config defaults & validation, CLI invalid-config exit `1` without secret leakage, non-busy-loop empty polling & `closePool()`, exponential poll backoff recovery (`40ms -> 80ms -> 100ms` cap), `concurrency = 2` limit, claim-token & `lease_generation = 2` propagation on same-worker reclaim, `SIGINT`/`SIGTERM` stopping new claims while continuing heartbeats during drain, shutdown grace timeout with `signal.aborted`, no false `'done'`, no premature requeue, and post-timeout lease recovery, handler failure redaction + retry into `'degraded'`, `runStandaloneWorker` signal handlers + spawned `worker.js`, mid-flight heartbeat lease loss abort, and tokenless-claim rejection. |
| `node backend/src/db/tests/test_repositories.js` | `49 / 49 [PASS]` (exit `0`) | Repository lease, concurrency, legacy recovery, and same-worker reclaim fencing suite unaffected. |
| `node backend/src/tests/test_express.js` | `14/14 PASSED` (exit `0`) | Express HTTP server remains independent of worker lifecycle. |
| Zero-comment & DB hygiene checks | `exit 0` | `0` comment lines across all 7 worker/test source files (`2,004` total lines checked); live DB cleaned (`jobs: []`). |
