# M1.6.4.3.1 — Worker Lease Database Migration Specification & Audit

This document records the schema design, migration strategy, index rationale, backward-compatibility guarantees, empirical test evidence, and known limitations for **Migration 005 (`005_worker_leases.sql`)**.

---

## 1. Schema Changes

**Migration File**: [`backend/src/db/migrations/005_worker_leases.sql`](file:///d:/DocumentUnderstanding/backend/src/db/migrations/005_worker_leases.sql)  
**SHA-256 Checksum (LF-normalized)**: `fb8ec0de7a7150748677b64ba3bdb6011e6aedd87923812abf41b339238a15cb`  
**Target Table**: `jobs` (InnoDB, `utf8mb4_unicode_ci`)

### Added Columns

| Column Name | SQL Type | Nullable | Default | Position | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `locked_by` | `VARCHAR(128)` | `YES` | `NULL` | `AFTER attempts` | Persistent worker instance identity holding the active claim (e.g., `worker_<hostname>_<pid>_<hex>`). Sized at 128 chars to avoid truncation on long container/cloud hostnames. |
| `locked_at` | `TIMESTAMP` | `YES` | `NULL` | `AFTER locked_by` | UTC timestamp when the worker claimed the job. Matches existing `TIMESTAMP` semantics on `jobs.created_at` and `jobs.updated_at`. |
| `heartbeat_at` | `TIMESTAMP` | `YES` | `NULL` | `AFTER locked_at` | UTC timestamp of the most recent liveness pulse from the owning worker (planned initial heartbeat interval: 15 seconds). |
| `lease_timeout_seconds` | `INT` | `NO` | `300` | `AFTER heartbeat_at` | Durable per-job lease expiration duration in seconds (default policy: 300 seconds). |

### Added Indexes

| Index Name | Columns | Uniqueness | Purpose |
| :--- | :--- | :--- | :--- |
| `idx_jobs_status_heartbeat` | `(status, heartbeat_at)` | Non-unique | Efficiently locate active running jobs with expired heartbeats during crash recovery. |
| `idx_jobs_status_mode` | `(status, mode)` | Non-unique | Efficiently claim and list queued jobs when filtering by extraction `mode` (`flat`, `reference`, `candidate`, `candidate_ft`). |

### Unchanged Schema Invariants

- Migrations `001_init.sql`, `002_schema_compatibility.sql`, `003_document_sequences.sql`, and `004_durable_cleanup_queue.sql` were **not modified**.
- `jobs.status` remains `ENUM('queued','running','done','degraded','failed') NOT NULL DEFAULT 'queued'`; no `'cancelled'` or extra enum values were added.
- `documents`, `elements`, `eval_runs`, `document_sequences`, and `cleanup_queue` schemas were **not modified**.
- Foreign key `fk_jobs_document` (`ON DELETE RESTRICT`) remains unchanged.

---

## 2. Migration Strategy & Runner Guarantees

1. **Forward-Only Single-Statement DDL**:
   - `005_worker_leases.sql` combines all four `ADD COLUMN` clauses and both `ADD INDEX` clauses into a single `ALTER TABLE jobs ...` statement. In MySQL 8.4 InnoDB, single-statement DDL updates the data dictionary atomically for normal execution.
2. **Partial Schema Detection (`005`)**:
   - [`detectPartialSchema()`](file:///d:/DocumentUnderstanding/backend/src/db/migrator.js#L207-L234) inspects `INFORMATION_SCHEMA.COLUMNS` and `INFORMATION_SCHEMA.STATISTICS` on `jobs` for all six v005 artifacts (`locked_by`, `locked_at`, `heartbeat_at`, `lease_timeout_seconds`, `idx_jobs_status_heartbeat`, `idx_jobs_status_mode`) and aborts with diagnostics if a subset exists without `_migrations` history.
3. **Deep Schema Verification (`verifySchema`)**:
   - [`verifySchema()`](file:///d:/DocumentUnderstanding/backend/src/db/migrator.js#L379-L471) checks column names, exact `varchar(128)` / `timestamp` / `int` types, nullability, `COLUMN_DEFAULT = '300'` on `jobs.lease_timeout_seconds`, exact `jobs.status` ENUM definition, and index column ordering for both `idx_jobs_status_heartbeat` and `idx_jobs_status_mode`.
4. **Concurrency, Idempotency & Tamper Protection**:
   - Runs under MySQL session advisory lock `GET_LOCK('docuretrieve_migration_lock', 10)`.
   - Repeated runs verify schema and checksum, cleanly skipping already applied migrations (`0 applied, 5 skipped`).
   - Post-application file modification triggers `ChecksumMismatchError` and aborts before DDL execution.

---

## 3. Index Design Rationale

### Existing Query Patterns Inspected

| Query Source | SQL Pattern | Covered By |
| :--- | :--- | :--- |
| [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L221-L227) (`_claimJobCore`, unfiltered) & `listPending` | `SELECT * FROM jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED` | **Existing `idx_jobs_status (status)`** (InnoDB physical key `(status, id)` matches filter + `ORDER BY id ASC` without filesort). |
| [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L158-L167) & [`_claimJobCore`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L216-L227) (mode-filtered) | `SELECT * FROM jobs WHERE status = 'queued' AND mode = ? ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED` | **New `idx_jobs_status_mode (status, mode)`** (InnoDB physical key `(status, mode, id)` avoids scanning queued jobs of unrelated modes). |
| [`routes/documents.js`](file:///d:/DocumentUnderstanding/backend/src/routes/documents.js#L644) & [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js#L105-L107) | `WHERE doc_id = ? [AND status = 'queued']` | **Existing `idx_jobs_doc_status (doc_id, status)`**. |
| Point claim/heartbeat/status updates | `WHERE id = ? [AND locked_by = ? AND status = 'running']` | **Existing `PRIMARY KEY (id)`**. |
| Future stale-job recovery query | `WHERE status = 'running' AND heartbeat_at < (NOW() - INTERVAL ? SECOND)` / `heartbeat_at < (NOW() - INTERVAL lease_timeout_seconds SECOND)` | **New `idx_jobs_status_heartbeat (status, heartbeat_at)`** (narrows scan directly to `'running'` jobs; supports range scan for cutoff predicates and tight `status = 'running'` prefix scan for per-row timeout expressions). |

Both new indexes avoid modifying or dropping `idx_jobs_status` and `idx_jobs_doc_status`, preserving existing query plans and `verifySchema()` guarantees.

---

## 4. Existing-Data Compatibility

- Applying `005_worker_leases.sql` to an existing database at v004 preserves all existing `jobs` rows (`id`, `doc_id`, `mode`, `status`, `seconds`, `error`, `attempts`, `created_at`, `updated_at`) without touching `updated_at`.
- Existing rows automatically populate `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL`, and `lease_timeout_seconds = 300`.
- Existing repository queries in [`jobRepository.js`](file:///d:/DocumentUnderstanding/backend/src/db/repositories/jobRepository.js) (including `INSERT INTO jobs (doc_id, mode, status, attempts)`) continue operating unmodified because the new columns are nullable or defaulted (`DEFAULT 300`).

---

## 5. Verification & Test Evidence

### Migration Execution on Working DB

1. Initial upgrade from v004 to v005:
   - Command: `node backend/src/db/migrator.js`
   - Output: `Summary: 1 applied, 4 skipped.` (`[APPLIED] 005_worker_leases.sql`, exit code `0`).
2. Repeated invocation (idempotency):
   - Command: `node backend/src/db/migrator.js`
   - Output: `Summary: 0 applied, 5 skipped.` (exit code `0`).
3. Live working DB state post-migration: `eval_runs` preserved intact (`14` baseline rows + `1` test row from repository suite), `_migrations` records `001`–`005` matching file SHA-256 checksums.

### Regression & Migration Audit Suites

| Suite Command | Result / Assertions | Exit Code | Key Verified Behaviors |
| :--- | :--- | :--- | :--- |
| `node backend/src/db/tests/test_migration.js` | **22 PASS checks** (Sections 1–6 + Final Verification) | `0` | Working DB `_migrations` checksums `001`–`005`; fresh empty MySQL 8.4.9 DB migration `001 -> 005`; existing DB upgrade `004 -> 005` preserving jobs across all 5 statuses (`queued`, `running`, `done`, `degraded`, `failed`) + timestamps + `lease_timeout_seconds = 300`; lease column types; index existence; repeated invocations; partial v005 detection; default mismatch rejection; tampered `005` `ChecksumMismatchError`. |
| `node backend/src/db/tests/test_pool.js` | **14 / 14 PASSED** | `0` | Pool acquisition timeouts, error scrubbing, dedicated connection lock isolation. |
| `node backend/src/db/tests/test_repositories.js` | **34 / 34 PASSED** | `0` | Unmodified `jobRepository`, `documentRepository`, `elementRepository`, `evaluationRepository` compatibility and `SKIP LOCKED` concurrency. |
| `node backend/src/tests/test_documents.js` | **28 / 28 PASSED** | `0` | Express document/element read API compatibility. |
| `node backend/src/tests/test_upload_lifecycle.js` | **39 / 39 PASSED** | `0` | Atomic upload, lock-ordered deletion/worker race protection, cleanup retries. |
| `node backend/src/tests/test_express.js` | **14 / 14 PASSED** | `0` | Express server startup, health/readiness, shutdown. |

---

## 6. Known Limitations

1. **Persistence Not Yet Wired in `jobRepository.js`**: Consistent with M1.6.4.3.1 scope constraints, `jobRepository.claimJob()`, `updateStatus()`, `retryJob()`, heartbeat renewal, and stale-job recovery have not been modified yet. Until M1.6.4.3.2+, `locked_by`, `locked_at`, and `heartbeat_at` remain `NULL` during claims unless populated by future worker code.
2. **Legacy `'running'` Jobs Upgraded from v004**: Any pre-existing job already in `status = 'running'` before migration `005` is upgraded with `locked_by = NULL`, `locked_at = NULL`, `heartbeat_at = NULL`, and `lease_timeout_seconds = 300`. Future stale-job recovery logic must decide how to handle `status = 'running' AND heartbeat_at IS NULL` (or `claimJob` must guarantee non-null `locked_at` and `heartbeat_at` upon claim).
3. **Per-Row `lease_timeout_seconds` Predicate Characteristics**: Querying `WHERE status = 'running' AND heartbeat_at < (NOW() - INTERVAL lease_timeout_seconds SECOND)` uses `idx_jobs_status_heartbeat` as a `ref` prefix scan on `status = 'running'` (scanning active running rows rather than pure B-tree range cutoff) because the bound references a column on each row. Under the initial policy (one worker, or a small worker pool), cardinality of `'running'` rows is tiny; if large worker fleets are ever introduced, either a bounded parameterized cutoff (`heartbeat_at < NOW() - INTERVAL ? SECOND`) or a stored/indexed `lease_expires_at` column can be introduced in a subsequent forward-only migration.
4. **Database Clock Authority**: `locked_at` and `heartbeat_at` are `TIMESTAMP` columns intended to be written and compared using MySQL server time (`CURRENT_TIMESTAMP` / `NOW()`) rather than worker host wall clocks to avoid clock skew between application hosts and MySQL.
5. **Isolated Fresh/Upgrade Harness Behavior**: In environments where the configured MySQL user (`docuretrieve_user`) lacks `CREATE DATABASE` privileges, `test_migration.js` boots a temporary isolated `mysqld` 8.4 instance on an ephemeral local port in `os.tmpdir()` and shuts it down cleanly upon exit, preserving existing `docuretrieve` data. If neither `CREATE DATABASE` permission nor a local `mysqld` binary is available, Tests 6.2/6.3 will fail closed.
