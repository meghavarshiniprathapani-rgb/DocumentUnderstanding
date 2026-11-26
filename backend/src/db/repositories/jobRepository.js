/**
 * Retrieva AI — Job Repository (AIML-59 / M1.5)
 * 
 * Provides persistence and queue lifecycle operations for ingestion jobs:
 * - Atomic job claiming with row-level locking (`FOR UPDATE`) preventing dual execution.
 * - Handles 'queued', 'running', 'done', 'degraded', and 'failed' states.
 * - Preserves complete job audit history even when documents are soft-deleted.
 * - Enforces retry attempt tracking.
 */

import { getConnection, query, sanitizeError } from '../pool.js';

export const VALID_JOB_STATUSES = new Set(['queued', 'running', 'done', 'degraded', 'failed']);
export const TERMINAL_COMPLETION_STATUSES = new Set(['done', 'degraded']);
export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_LEASE_TIMEOUT_SECONDS = 300;
export const MAX_WORKER_ID_LENGTH = 128;

export class LeaseOwnershipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeaseOwnershipError';
    this.code = 'ERR_LEASE_OWNERSHIP';
  }
}

export class InvalidJobTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidJobTransitionError';
    this.code = 'ERR_INVALID_JOB_TRANSITION';
  }
}

function normalizeWorkerId(workerId) {
  if (typeof workerId !== 'string') {
    throw new Error('workerId must be a non-empty string.');
  }
  const trimmed = workerId.trim();
  if (!trimmed || trimmed.length > MAX_WORKER_ID_LENGTH) {
    throw new Error(`workerId must be between 1 and ${MAX_WORKER_ID_LENGTH} characters.`);
  }
  return trimmed;
}

/**
 * Normalizes a job row from MySQL into a structured entity.
 */
function mapJobRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    doc_id: Number(row.doc_id),
    mode: row.mode,
    status: row.status,
    seconds: row.seconds !== null && row.seconds !== undefined ? Number(row.seconds) : null,
    error: row.error || null,
    attempts: Number(row.attempts),
    locked_by: row.locked_by || null,
    locked_at: row.locked_at || null,
    heartbeat_at: row.heartbeat_at || null,
    lease_timeout_seconds:
      row.lease_timeout_seconds !== null && row.lease_timeout_seconds !== undefined
        ? Number(row.lease_timeout_seconds)
        : DEFAULT_LEASE_TIMEOUT_SECONDS,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Resolves numeric doc_id from either a numeric ID or a string document_id.
 */
async function resolveNumericDocId(docIdOrDocumentId, connection = null) {
  if (docIdOrDocumentId === null || docIdOrDocumentId === undefined) return null;

  const num = Number(docIdOrDocumentId);
  if (Number.isInteger(num) && num > 0) return num;

  if (typeof docIdOrDocumentId === 'string') {
    const runner = connection || { query };
    const [rows] = await runner.query(`SELECT id FROM documents WHERE document_id = ? LIMIT 1`, [docIdOrDocumentId]);
    if (rows && rows.length > 0) return Number(rows[0].id);
  }

  return null;
}

let _testFailJobInsert = false;

export function _setTestFailJobInsert(flag) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error('Disabled outside test environment');
  }
  _testFailJobInsert = Boolean(flag);
}

export async function createJob(jobData, options = {}) {
  if (_testFailJobInsert && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'testing')) {
    throw new Error('Simulated job insertion failure in test environment');
  }

  const numericDocId = await resolveNumericDocId(jobData.doc_id, options?.connection);
  if (!numericDocId) {
    throw new Error(`Valid doc_id is required to create a job (got '${jobData.doc_id}').`);
  }
  if (!jobData.mode || typeof jobData.mode !== 'string') {
    throw new Error('mode is required and must be a string.');
  }

  const status = jobData.status || 'queued';
  if (!VALID_JOB_STATUSES.has(status)) {
    throw new Error(`Invalid job status '${status}'. Allowed: ${Array.from(VALID_JOB_STATUSES).join(', ')}`);
  }

  let leaseTimeoutSeconds = DEFAULT_LEASE_TIMEOUT_SECONDS;
  if (jobData.lease_timeout_seconds !== undefined && jobData.lease_timeout_seconds !== null) {
    const parsedTimeout = Number(jobData.lease_timeout_seconds);
    if (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0) {
      throw new Error('lease_timeout_seconds must be a positive integer.');
    }
    leaseTimeoutSeconds = parsedTimeout;
  }

  const sql = `
    INSERT INTO jobs (doc_id, mode, status, attempts, lease_timeout_seconds)
    VALUES (?, ?, ?, ?, ?)
  `;

  const runner = options?.connection || { query };
  const [result] = await runner.query(sql, [numericDocId, jobData.mode, status, 0, leaseTimeoutSeconds]);
  return await findById(result.insertId, { connection: options?.connection });
}

export async function findById(id, options = {}) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const runner = options?.connection || { query };
  const [rows] = await runner.query(`SELECT * FROM jobs WHERE id = ? LIMIT 1`, [numericId]);
  return rows.length > 0 ? mapJobRow(rows[0]) : null;
}

export async function cancelQueuedJobsForDocument(docId, reason = 'Document deleted before processing', options = {}) {
  const numericDocId = await resolveNumericDocId(docId, options?.connection);
  if (!numericDocId) return 0;

  const sql = `
    UPDATE jobs
    SET status = 'failed',
        error = ?,
        locked_by = NULL,
        locked_at = NULL,
        heartbeat_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE doc_id = ? AND status = 'queued'
  `;

  const runner = options?.connection || { query };
  const [result] = await runner.query(sql, [reason, numericDocId]);
  return result.affectedRows || 0;
}

/**
 * Finds all jobs associated with a document.
 * 
 * @param {number|string} docIdOrDocumentId
 * @param {Object} [options]
 * @param {string} [options.status]
 * @returns {Promise<Array<Object>>}
 */
export async function findByDocument(docIdOrDocumentId, options = {}) {
  const numericDocId = await resolveNumericDocId(docIdOrDocumentId);
  if (!numericDocId) return [];

  const whereClauses = ['doc_id = ?'];
  const params = [numericDocId];

  if (options.status) {
    whereClauses.push('status = ?');
    params.push(options.status);
  }

  const sql = `
    SELECT * FROM jobs
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY id DESC
  `;

  const [rows] = await query(sql, params);
  return rows.map(mapJobRow);
}

/**
 * Lists all pending (queued) jobs.
 * 
 * @param {Object} [options]
 * @param {number} [options.limit=50]
 * @param {string} [options.mode]
 * @returns {Promise<Array<Object>>}
 */
export async function listPending(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 500));
  const whereClauses = ["status = 'queued'"];
  const params = [];

  if (options.mode) {
    whereClauses.push('mode = ?');
    params.push(options.mode);
  }

  const sql = `
    SELECT * FROM jobs
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY id ASC
    LIMIT ?
  `;

  const [rows] = await query(sql, [...params, limit]);
  return rows.map(mapJobRow);
}

/**
 * Atomically claims the next available queued job using row-level locking (`FOR UPDATE SKIP LOCKED`).
 * 
 * Concurrency & Locking Semantics:
 * - Workers acquire an exclusive row-level lock (`FOR UPDATE`) on the matched row within an independent transaction.
 * - The `SKIP LOCKED` modifier instructs MySQL to skip any rows currently locked by competing transactions
 *   rather than blocking/waiting. This eliminates head-of-line lock contention across workers, allowing
 *   multiple workers to claim distinct queued jobs concurrently.
 * - Correctness Guarantee: Exactly one worker can claim any specific job row; no double claims occur.
 * 
 * Worker Ownership Limitations (CRITICAL):
 * - The `jobs` table schema in MySQL (001_init.sql) does NOT contain a `worker_id` column.
 * - The `workerId` parameter passed here is strictly non-persisted diagnostic telemetry returned
 *   only on the in-memory result entity (`claimedBy`).
 * - In-Memory Only: `claimedBy` is NOT written to MySQL.
 * - No Authorization: The application layer MUST NOT use `claimedBy` as a security boundary or authorization check.
 * - No Durable Leases: The database does not maintain worker heartbeats, durable leases, or automatic crash recovery.
 *   If a worker crashes while processing, the job remains in 'running' status until administrative or orchestrator intervention.
 * 
 * @param {string} [workerId=null] - Optional diagnostic identifier attached to returned object
 * @param {Object} [options]
 * @param {string} [options.mode] - Optional mode filter ('flat', 'reference', 'candidate', 'candidate_ft')
 * @returns {Promise<Object|null>} The claimed job, or null if no queued jobs remain
 */
/**
 * Internal core implementation of claimJob.
 * 
 * @private
 * @param {string} [workerId=null] - Diagnostic worker ID
 * @param {Object} [options] - Sanitized options (e.g. mode)
 * @param {Object} [internalHooks] - Test-only hooks (isolated from public production API)
 * @param {Function} [internalHooks.afterLock] - Test hook executed while row lock is held
 * @returns {Promise<Object|null>}
 */
async function _claimJobCore(workerId = null, options = {}, internalHooks = {}) {
  const normalizedWorkerId = normalizeWorkerId(workerId);
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const whereClauses = ["status = 'queued'"];
    const params = [];

    if (options?.mode) {
      whereClauses.push('mode = ?');
      params.push(options.mode);
    }

    const selectSql = `
      SELECT * FROM jobs
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const [rows] = await conn.query(selectSql, params);
    if (!rows || rows.length === 0) {
      await conn.commit();
      return null;
    }

    const job = rows[0];

    if (typeof internalHooks?.afterJobLock === 'function') {
      await internalHooks.afterJobLock(mapJobRow(job), conn);
    }

    const [docRows] = await conn.query(
      `SELECT id, document_id, deleted_at FROM documents WHERE id = ? FOR SHARE`,
      [job.doc_id]
    );

    if (!docRows || docRows.length === 0 || docRows[0].deleted_at !== null) {
      await conn.query(
        `UPDATE jobs
         SET status = 'failed',
             error = 'Document deleted before processing',
             locked_by = NULL,
             locked_at = NULL,
             heartbeat_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [job.id]
      );
      await conn.commit();
      return null;
    }

    if (typeof internalHooks?.afterLock === 'function') {
      await internalHooks.afterLock(mapJobRow(job), conn);
    }

    const updateSql = `
      UPDATE jobs
      SET status = 'running',
          attempts = attempts + 1,
          locked_by = ?,
          locked_at = CURRENT_TIMESTAMP,
          heartbeat_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `;

    const [updateResult] = await conn.query(updateSql, [normalizedWorkerId, job.id]);
    if (updateResult.affectedRows !== 1) {
      await conn.rollback();
      return null;
    }

    const updatedJob = await findById(job.id, { connection: conn });
    await conn.commit();

    return {
      ...updatedJob,
      claimedBy: normalizedWorkerId,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

/**
 * Atomically claims the next available queued job using row-level locking (`FOR UPDATE SKIP LOCKED`).
 * 
 * Production API Safety Boundary:
 * - Production callers CANNOT pass arbitrary callbacks or hooks.
 * - Any callback or test hook property passed in `options` is stripped/ignored and will NOT execute.
 * - This guarantees that no production caller can hold a database row lock open with user-supplied code.
 * 
 * Concurrency & Locking Semantics:
 * - Workers acquire an exclusive row-level lock (`FOR UPDATE`) on the matched row within an independent transaction.
 * - The `SKIP LOCKED` modifier instructs MySQL to skip any rows currently locked by competing transactions
 *   rather than blocking/waiting. This eliminates head-of-line lock contention across workers, allowing
 *   multiple workers to claim distinct queued jobs concurrently.
 * - Correctness Guarantee: Exactly one worker can claim any specific job row; no double claims occur.
 * 
 * Worker Ownership Limitations (CRITICAL):
 * - The `jobs` table schema in MySQL (001_init.sql) does NOT contain a `worker_id` column.
 * - The `workerId` parameter passed here is strictly non-persisted diagnostic telemetry returned
 *   only on the in-memory result entity (`claimedBy`).
 * - In-Memory Only: `claimedBy` is NOT written to MySQL.
 * - No Authorization: The application layer MUST NOT use `claimedBy` as a security boundary or authorization check.
 * - No Durable Leases: The database does not maintain worker heartbeats, durable leases, or automatic crash recovery.
 *   If a worker crashes while processing, the job remains in 'running' status until administrative or orchestrator intervention.
 * 
 * @param {string} [workerId=null] - Optional diagnostic identifier attached to returned object
 * @param {Object} [options]
 * @param {string} [options.mode] - Optional mode filter ('flat', 'reference', 'candidate', 'candidate_ft')
 * @returns {Promise<Object|null>} The claimed job, or null if no queued jobs remain
 */
export async function claimJob(workerId = null, options = {}) {
  // Strip any callbacks or unsupported fields to guarantee production safety
  const safeOptions = {
    mode: typeof options?.mode === 'string' ? options.mode : undefined,
  };
  return _claimJobCore(workerId, safeOptions, {});
}

/**
 * Internal test-only execution bridge for deterministic concurrency verification.
 * 
 * Strict Isolation & Fail-Closed Guard:
 * - NOT exposed on the public repository entry point (backend/src/db/repositories/index.js).
 * - Only callable from test-only modules (such as backend/src/db/tests/jobTestAdapter.js).
 * - Fails closed: strictly throws if NODE_ENV is not explicitly set to 'test' or 'testing'.
 * 
 * @internal
 * @param {string} [workerId=null]
 * @param {Object} [options={}]
 * @param {Object} [internalHooks={}]
 * @returns {Promise<Object|null>}
 */
export async function _executeClaimJobForTest(workerId = null, options = {}, internalHooks = {}) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error(
      `_executeClaimJobForTest is strictly disabled outside of explicit test environments. Current NODE_ENV='${env}'.`
    );
  }
  const safeOptions = {
    mode: typeof options?.mode === 'string' ? options.mode : undefined,
  };
  return _claimJobCore(workerId, safeOptions, internalHooks);
}

/**
 * Evaluates and applies the retry policy for a failed or degraded job.
 * 
 * Retry Policy:
 * 1. A job in 'failed' or 'degraded' status is retryable if attempts < maxAttempts.
 * 2. If retryable, the job status is transitioned back to 'queued' and error diagnostic
 *    is cleared, allowing the job to be reclaimed by workers.
 * 3. If attempts >= maxAttempts, the job remains in its terminal status and is not retried.
 * 
 * @param {number|string} id - Job ID
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts before permanent failure
 * @returns {Promise<{retryable: boolean, job: Object|null}>}
 */
export async function retryJob(id, options = {}) {
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_RETRY_ATTEMPTS;
  const job = await findById(id);
  if (!job) return { retryable: false, job: null };

  if ((job.status === 'failed' || job.status === 'degraded') && job.attempts < maxAttempts) {
    const updated = await updateStatus(id, 'queued', { error: null });
    return { retryable: true, job: updated };
  }

  return { retryable: false, job };
}

/**
 * Updates status, execution seconds, and error diagnostic for a job.
 * 
 * @param {number|string} id - Job ID
 * @param {'queued'|'running'|'done'|'degraded'|'failed'} status - Target status
 * @param {Object} [details]
 * @param {number} [details.seconds] - Execution duration in seconds
 * @param {string} [details.error] - Error message if degraded or failed
 * @returns {Promise<Object|null>} Updated job entity
 */
export async function updateStatus(id, status, details = {}) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  if (!VALID_JOB_STATUSES.has(status)) {
    throw new Error(`Invalid status '${status}'. Allowed: ${Array.from(VALID_JOB_STATUSES).join(', ')}`);
  }

  const setClauses = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [status];

  if (status !== 'running') {
    setClauses.push('locked_by = NULL', 'locked_at = NULL', 'heartbeat_at = NULL');
  }

  if (details.seconds !== undefined) {
    setClauses.push('seconds = ?');
    params.push(details.seconds !== null ? Number(details.seconds) : null);
  }

  if (details.error !== undefined) {
    setClauses.push('error = ?');
    params.push(details.error ? String(details.error) : null);
  }

  const sql = `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`;
  const [result] = await query(sql, [...params, numericId]);

  if (result.affectedRows === 0) return null;
  return await findById(numericId);
}

/**
 * Atomically increments the retry attempt counter for a job.
 * 
 * @param {number|string} id - Job ID
 * @returns {Promise<number|null>} Updated attempt count or null if job not found
 */
export async function incrementAttempts(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const sql = `
    UPDATE jobs
    SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  const [result] = await query(sql, [numericId]);
  if (result.affectedRows === 0) return null;

  const job = await findById(numericId);
  return job ? job.attempts : null;
}

function normalizePositiveJobId(jobId) {
  const numericId = Number(jobId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`Valid positive integer jobId is required (got '${jobId}').`);
  }
  return numericId;
}

async function _heartbeatJobCore(jobId, workerId, internalHooks = {}) {
  const numericId = normalizePositiveJobId(jobId);
  const normalizedWorkerId = normalizeWorkerId(workerId);

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE`, [numericId]);
    if (!rows || rows.length === 0) {
      throw new LeaseOwnershipError(`Job ${numericId} not found.`);
    }

    const current = rows[0];

    if (typeof internalHooks?.afterLock === 'function') {
      await internalHooks.afterLock(mapJobRow(current), conn);
    }

    if (current.status !== 'running') {
      throw new InvalidJobTransitionError(
        `Cannot renew heartbeat for job ${numericId}: status is '${current.status}', expected 'running'.`
      );
    }

    if (current.locked_by !== normalizedWorkerId) {
      throw new LeaseOwnershipError(
        `Worker '${normalizedWorkerId}' does not own job ${numericId} (locked_by='${current.locked_by || 'none'}').`
      );
    }

    const [result] = await conn.query(
      `UPDATE jobs
       SET heartbeat_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running' AND locked_by = ?`,
      [numericId, normalizedWorkerId]
    );

    if (result.affectedRows !== 1) {
      throw new LeaseOwnershipError(
        `Failed to renew heartbeat for job ${numericId} owned by '${normalizedWorkerId}'.`
      );
    }

    const updated = await findById(numericId, { connection: conn });
    await conn.commit();
    return updated;
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err instanceof LeaseOwnershipError || err instanceof InvalidJobTransitionError) {
      throw err;
    }
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function heartbeatJob(jobId, workerId) {
  return _heartbeatJobCore(jobId, workerId, {});
}

export async function _executeHeartbeatJobForTest(jobId, workerId, internalHooks = {}) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error(
      `_executeHeartbeatJobForTest is strictly disabled outside of explicit test environments. Current NODE_ENV='${env}'.`
    );
  }
  return _heartbeatJobCore(jobId, workerId, internalHooks);
}

async function _completeJobCore(jobId, workerId, details = {}, internalHooks = {}) {
  const numericId = normalizePositiveJobId(jobId);
  const normalizedWorkerId = normalizeWorkerId(workerId);
  const targetStatus = details?.status !== undefined ? details.status : 'done';

  if (!TERMINAL_COMPLETION_STATUSES.has(targetStatus)) {
    throw new InvalidJobTransitionError(
      `Invalid completion status '${targetStatus}'. Allowed: ${Array.from(TERMINAL_COMPLETION_STATUSES).join(', ')}`
    );
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE`, [numericId]);
    if (!rows || rows.length === 0) {
      throw new LeaseOwnershipError(`Job ${numericId} not found.`);
    }

    const current = rows[0];

    if (typeof internalHooks?.afterLock === 'function') {
      await internalHooks.afterLock(mapJobRow(current), conn);
    }

    if (current.status !== 'running') {
      throw new InvalidJobTransitionError(
        `Cannot complete job ${numericId}: status is '${current.status}', expected 'running'.`
      );
    }

    if (current.locked_by !== normalizedWorkerId) {
      throw new LeaseOwnershipError(
        `Worker '${normalizedWorkerId}' does not own job ${numericId} (locked_by='${current.locked_by || 'none'}').`
      );
    }

    const setClauses = [
      'status = ?',
      'locked_by = NULL',
      'locked_at = NULL',
      'heartbeat_at = NULL',
      'updated_at = CURRENT_TIMESTAMP',
    ];
    const params = [targetStatus];

    if (details?.seconds !== undefined) {
      setClauses.push('seconds = ?');
      params.push(details.seconds !== null ? Number(details.seconds) : null);
    }

    if (details?.error !== undefined) {
      setClauses.push('error = ?');
      params.push(details.error ? String(details.error) : null);
    }

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = ? AND status = 'running' AND locked_by = ?
    `;

    const [result] = await conn.query(sql, [...params, numericId, normalizedWorkerId]);
    if (result.affectedRows !== 1) {
      throw new LeaseOwnershipError(
        `Failed to complete job ${numericId} for worker '${normalizedWorkerId}'.`
      );
    }

    const updated = await findById(numericId, { connection: conn });
    await conn.commit();
    return updated;
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err instanceof LeaseOwnershipError || err instanceof InvalidJobTransitionError) {
      throw err;
    }
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function completeJob(jobId, workerId, details = {}) {
  const safeDetails = {
    status: details?.status,
    seconds: details?.seconds,
    error: details?.error,
  };
  return _completeJobCore(jobId, workerId, safeDetails, {});
}

export async function _executeCompleteJobForTest(jobId, workerId, details = {}, internalHooks = {}) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error(
      `_executeCompleteJobForTest is strictly disabled outside of explicit test environments. Current NODE_ENV='${env}'.`
    );
  }
  const safeDetails = {
    status: details?.status,
    seconds: details?.seconds,
    error: details?.error,
  };
  return _completeJobCore(jobId, workerId, safeDetails, internalHooks);
}

async function _failJobCore(jobId, workerId, details = {}, internalHooks = {}) {
  const numericId = normalizePositiveJobId(jobId);
  const normalizedWorkerId = normalizeWorkerId(workerId);

  const maxAttemptsRaw =
    details?.maxAttempts !== undefined ? Number(details.maxAttempts) : DEFAULT_MAX_RETRY_ATTEMPTS;
  if (!Number.isInteger(maxAttemptsRaw) || maxAttemptsRaw < 1) {
    throw new Error('maxAttempts must be a positive integer.');
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE`, [numericId]);
    if (!rows || rows.length === 0) {
      throw new LeaseOwnershipError(`Job ${numericId} not found.`);
    }

    const current = rows[0];

    if (typeof internalHooks?.afterJobLock === 'function') {
      await internalHooks.afterJobLock(mapJobRow(current), conn);
    }

    if (current.status !== 'running') {
      throw new InvalidJobTransitionError(
        `Cannot fail job ${numericId}: status is '${current.status}', expected 'running'.`
      );
    }

    if (current.locked_by !== normalizedWorkerId) {
      throw new LeaseOwnershipError(
        `Worker '${normalizedWorkerId}' does not own job ${numericId} (locked_by='${current.locked_by || 'none'}').`
      );
    }

    const [docRows] = await conn.query(
      `SELECT id, deleted_at FROM documents WHERE id = ? FOR SHARE`,
      [current.doc_id]
    );

    if (typeof internalHooks?.afterLock === 'function') {
      await internalHooks.afterLock(mapJobRow(current), conn);
    }

    const docDeleted = !docRows || docRows.length === 0 || docRows[0].deleted_at !== null;
    const allowRetry = details?.retryable !== false && !docDeleted && Number(current.attempts) < maxAttemptsRaw;
    const nextStatus = allowRetry ? 'queued' : 'failed';

    const setClauses = [
      'status = ?',
      'locked_by = NULL',
      'locked_at = NULL',
      'heartbeat_at = NULL',
      'updated_at = CURRENT_TIMESTAMP',
    ];
    const params = [nextStatus];

    if (details?.seconds !== undefined) {
      setClauses.push('seconds = ?');
      params.push(details.seconds !== null ? Number(details.seconds) : null);
    }

    if (details?.error !== undefined) {
      setClauses.push('error = ?');
      params.push(details.error ? String(details.error) : null);
    } else if (docDeleted) {
      setClauses.push('error = ?');
      params.push('Document deleted before processing');
    }

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE id = ? AND status = 'running' AND locked_by = ?
    `;

    const [result] = await conn.query(sql, [...params, numericId, normalizedWorkerId]);
    if (result.affectedRows !== 1) {
      throw new LeaseOwnershipError(
        `Failed to update failure status for job ${numericId} owned by '${normalizedWorkerId}'.`
      );
    }

    const updated = await findById(numericId, { connection: conn });
    await conn.commit();

    return {
      ...updated,
      retryable: allowRetry,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err instanceof LeaseOwnershipError || err instanceof InvalidJobTransitionError) {
      throw err;
    }
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function failJob(jobId, workerId, details = {}) {
  const safeDetails = {
    error: details?.error,
    seconds: details?.seconds,
    retryable: details?.retryable,
    maxAttempts: details?.maxAttempts,
  };
  return _failJobCore(jobId, workerId, safeDetails, {});
}

export async function _executeFailJobForTest(jobId, workerId, details = {}, internalHooks = {}) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error(
      `_executeFailJobForTest is strictly disabled outside of explicit test environments. Current NODE_ENV='${env}'.`
    );
  }
  const safeDetails = {
    error: details?.error,
    seconds: details?.seconds,
    retryable: details?.retryable,
    maxAttempts: details?.maxAttempts,
  };
  return _failJobCore(jobId, workerId, safeDetails, internalHooks);
}

async function _recoverExpiredLeasesCore(options = {}, internalHooks = {}) {
  const limit = Math.max(1, Math.min(Number(options?.limit) || 10, 100));
  const maxAttemptsRaw =
    options?.maxAttempts !== undefined ? Number(options.maxAttempts) : DEFAULT_MAX_RETRY_ATTEMPTS;
  const maxAttempts = Number.isInteger(maxAttemptsRaw) && maxAttemptsRaw >= 1
    ? maxAttemptsRaw
    : DEFAULT_MAX_RETRY_ATTEMPTS;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM jobs
       WHERE status = 'running'
         AND COALESCE(heartbeat_at, locked_at) IS NOT NULL
         AND COALESCE(heartbeat_at, locked_at) < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL lease_timeout_seconds SECOND)
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    if (!rows || rows.length === 0) {
      await conn.commit();
      return {
        recoveredCount: 0,
        requeuedCount: 0,
        failedCount: 0,
        jobs: [],
      };
    }

    if (typeof internalHooks?.afterJobLock === 'function') {
      await internalHooks.afterJobLock(rows.map(mapJobRow), conn);
    }

    const recoveredJobs = [];
    let requeuedCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      const [docRows] = await conn.query(
        `SELECT id, deleted_at FROM documents WHERE id = ? FOR SHARE`,
        [row.doc_id]
      );

      if (typeof internalHooks?.afterLock === 'function') {
        await internalHooks.afterLock(mapJobRow(row), conn);
      }

      const docDeleted = !docRows || docRows.length === 0 || docRows[0].deleted_at !== null;
      const canRetry = !docDeleted && Number(row.attempts) < maxAttempts;
      const nextStatus = canRetry ? 'queued' : 'failed';
      const ownerLabel = row.locked_by || 'unknown';

      let diagError;
      if (docDeleted) {
        diagError = 'Document deleted before processing';
      } else if (canRetry) {
        const msg = `Lease expired after ${row.lease_timeout_seconds}s while owned by worker '${ownerLabel}'; requeued for retry`;
        diagError = row.error ? `${msg}; previous error: ${row.error}` : msg;
      } else {
        const msg = `Lease expired after ${row.lease_timeout_seconds}s while owned by worker '${ownerLabel}' with max retry attempts (${maxAttempts}) exhausted`;
        diagError = row.error ? `${msg}; previous error: ${row.error}` : msg;
      }

      await conn.query(
        `UPDATE jobs
         SET status = ?,
             error = ?,
             locked_by = NULL,
             locked_at = NULL,
             heartbeat_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running'`,
        [nextStatus, diagError, row.id]
      );

      const updated = await findById(row.id, { connection: conn });
      if (nextStatus === 'queued') {
        requeuedCount += 1;
      } else {
        failedCount += 1;
      }

      recoveredJobs.push({
        action: nextStatus === 'queued' ? 'requeued' : 'failed',
        previousOwner: row.locked_by || null,
        job: updated,
      });
    }

    await conn.commit();

    return {
      recoveredCount: recoveredJobs.length,
      requeuedCount,
      failedCount,
      jobs: recoveredJobs,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function recoverExpiredLeases(options = {}) {
  const safeOptions = {
    limit: options?.limit,
    maxAttempts: options?.maxAttempts,
  };
  return _recoverExpiredLeasesCore(safeOptions, {});
}

export async function _executeRecoverExpiredLeasesForTest(options = {}, internalHooks = {}) {
  const env = process.env.NODE_ENV;
  if (env !== 'test' && env !== 'testing') {
    throw new Error(
      `_executeRecoverExpiredLeasesForTest is strictly disabled outside of explicit test environments. Current NODE_ENV='${env}'.`
    );
  }
  const safeOptions = {
    limit: options?.limit,
    maxAttempts: options?.maxAttempts,
  };
  return _recoverExpiredLeasesCore(safeOptions, internalHooks);
}
