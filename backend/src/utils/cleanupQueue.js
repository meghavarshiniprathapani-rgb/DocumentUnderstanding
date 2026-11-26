import fs from 'node:fs';
import path from 'node:path';
import { query } from '../db/pool.js';

let cleanupTableEnsured = false;

export async function ensureCleanupTable(runner = { query }) {
  if (cleanupTableEnsured) {
    return;
  }
  cleanupTableEnsured = true;
}

export function isBenchmarkAsset(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.resolve(filePath).toLowerCase();
  return normalized.includes('sample_documents');
}

export async function isReferencedByRunningJob(filePath, runner = { query }) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.resolve(filePath);
  const [rows] = await runner.query(
    `SELECT COUNT(*) AS running_count
     FROM jobs j
     JOIN documents d ON j.doc_id = d.id
     WHERE d.path = ? AND j.status = 'running'`,
    [normalized]
  );
  return Number(rows[0]?.running_count || 0) > 0;
}

export async function enqueueCleanup(filePath, reason, options = {}) {
  const runner = options?.connection || { query };
  await ensureCleanupTable(runner);
  const normalized = path.resolve(filePath);
  const [res] = await runner.query(
    `INSERT INTO cleanup_queue (file_path, reason, doc_id, status, last_error)
     VALUES (?, ?, ?, 'pending', ?)`,
    [normalized, reason || 'unspecified', options?.docId || null, options?.error || null]
  );
  return res.insertId;
}

export async function safeUnlinkFile(filePath, reason = 'cleanup', options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return { success: true, skipped: true, reason: 'empty_path' };
  }

  const normalized = path.resolve(filePath);

  if (isBenchmarkAsset(normalized)) {
    return { success: false, skipped: true, reason: 'protected_benchmark_asset' };
  }

  const runner = options?.connection || { query };
  const hasRunningJob = await isReferencedByRunningJob(normalized, runner);
  if (hasRunningJob) {
    return { success: false, skipped: true, reason: 'referenced_by_running_job' };
  }

  try {
    const exists = await fs.promises.stat(normalized).then(() => true).catch(() => false);
    if (!exists) {
      return { success: true, idempotent: true, reason: 'already_deleted' };
    }

    if (options?.simulatedFailure) {
      throw new Error(options.simulatedFailure);
    }

    await fs.promises.unlink(normalized);
    return { success: true, unlinked: true };
  } catch (unlinkErr) {
    try {
      await enqueueCleanup(normalized, reason, {
        docId: options?.docId || null,
        connection: runner,
        error: unlinkErr.message
      });
    } catch {}
    return { success: false, error: unlinkErr };
  }
}

export async function retryFailedCleanups(options = {}) {
  const runner = options?.connection || { query };
  await ensureCleanupTable(runner);

  const limit = Math.max(1, Math.min(Number(options?.limit) || 50, 200));
  const [rows] = await runner.query(
    `SELECT * FROM cleanup_queue
     WHERE status IN ('pending', 'failed') AND attempts < 5
     ORDER BY id ASC
     LIMIT ?`,
    [limit]
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of rows) {
    const filePath = item.file_path;

    if (isBenchmarkAsset(filePath)) {
      await runner.query(
        `UPDATE cleanup_queue
         SET status = 'completed', last_error = 'skipped_benchmark_asset'
         WHERE id = ?`,
        [item.id]
      );
      skipped++;
      continue;
    }

    const hasRunningJob = await isReferencedByRunningJob(filePath, runner);
    if (hasRunningJob) {
      skipped++;
      continue;
    }

    try {
      const exists = await fs.promises.stat(filePath).then(() => true).catch(() => false);
      if (exists) {
        if (options?.simulatedFailurePath === filePath) {
          throw new Error('Simulated retry failure');
        }
        await fs.promises.unlink(filePath);
      }

      await runner.query(
        `UPDATE cleanup_queue
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.id]
      );
      succeeded++;
    } catch (err) {
      const nextAttempts = Number(item.attempts) + 1;
      const nextStatus = nextAttempts >= 5 ? 'failed' : 'pending';
      await runner.query(
        `UPDATE cleanup_queue
         SET attempts = ?, status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, nextStatus, err.message, item.id]
      );
      failed++;
    }
  }

  return { processed: rows.length, succeeded, failed, skipped };
}
