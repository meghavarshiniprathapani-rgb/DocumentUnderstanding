/**
 * Retrieva AI — Safe Relational Migration Runner
 * 
 * Enforces:
 * 1. Migration history tracking in `_migrations` table.
 * 2. SHA-256 checksum validation preventing silent post-application modifications.
 * 3. Database-level advisory migration lock (`GET_LOCK` / `RELEASE_LOCK`).
 * 4. Duplicate execution prevention & idempotency.
 * 5. Clear, granular failure diagnostics.
 * 
 * Note on MySQL DDL:
 * MySQL automatically triggers an implicit COMMIT on DDL statements (e.g. CREATE TABLE).
 * Therefore, DDL cannot be rolled back atomically in a standard transaction block.
 * This runner executes statements sequentially and records applied migrations upon full completion.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const LOCK_NAME = 'docuretrieve_migration_lock';
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Creates connection pool or returns the provided one.
 */
export async function getDbConnection(customConfig = null) {
  const config = customConfig || {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'docuretrieve_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'docuretrieve',
    multipleStatements: true,
  };
  return await mysql.createConnection(config);
}

/**
 * Computes SHA-256 checksum of file content.
 */
export function computeChecksum(content) {
  // Normalize Windows/Unix line endings to ensure deterministic checksum across platforms
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Initializes the migration history table.
 */
async function ensureMigrationsTable(conn) {
  const sql = `
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await conn.query(sql);
}

/**
 * Acquires database-level advisory lock.
 */
async function acquireLock(conn) {
  const [rows] = await conn.query(`SELECT GET_LOCK(?, ?) AS lock_acquired`, [
    LOCK_NAME,
    LOCK_TIMEOUT_SECONDS,
  ]);
  if (!rows || rows[0].lock_acquired !== 1) {
    throw new Error(
      `MigrationLockError: Failed to acquire lock '${LOCK_NAME}' within ${LOCK_TIMEOUT_SECONDS}s. Another migration may be running.`
    );
  }
}

/**
 * Releases database-level advisory lock.
 */
async function releaseLock(conn) {
  try {
    await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
  } catch (err) {
    console.warn(`Warning: Failed to release migration lock cleanly: ${err.message}`);
  }
}

/**
 * Runs all unapplied migrations in alphanumeric order.
 * 
 * @param {Object} [options]
 * @param {Object} [options.connection] - Existing connection to use
 * @param {string} [options.migrationsDir] - Custom directory for migration files
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function runMigrations(options = {}) {
  const conn = options.connection || (await getDbConnection(options.config));
  const migrationsDir = options.migrationsDir || MIGRATIONS_DIR;
  const isDedicatedConnection = !options.connection;

  const applied = [];
  const skipped = [];

  try {
    await ensureMigrationsTable(conn);
    await acquireLock(conn);

    // Read and sort migration files
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // Fetch existing applied migrations
    const [historyRows] = await conn.query(
      `SELECT version, name, checksum, applied_at FROM _migrations ORDER BY id ASC`
    );
    const appliedMap = new Map();
    for (const row of historyRows) {
      appliedMap.set(row.version, row);
    }

    for (const file of files) {
      const match = file.match(/^(\d+)_(.*)\.sql$/);
      const version = match ? match[1] : file;
      const filePath = path.join(migrationsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const checksum = computeChecksum(content);

      if (appliedMap.has(version)) {
        const recorded = appliedMap.get(version);
        if (recorded.checksum !== checksum) {
          throw new Error(
            `ChecksumMismatchError: Migration '${file}' has been altered after application!\n` +
              `  Recorded Checksum : ${recorded.checksum}\n` +
              `  Current Checksum  : ${checksum}\n` +
              `  Applied At        : ${recorded.applied_at}\n` +
              `Aborting to prevent corrupted schema state.`
          );
        }
        skipped.push(file);
      } else {
        // Execute migration
        try {
          await conn.query(content);
          await conn.query(
            `INSERT INTO _migrations (version, name, checksum) VALUES (?, ?, ?)`,
            [version, file, checksum]
          );
          applied.push(file);
        } catch (err) {
          throw new Error(
            `MigrationExecutionError: Failed executing '${file}':\n${err.message}`
          );
        }
      }
    }

    return { applied, skipped };
  } finally {
    await releaseLock(conn);
    if (isDedicatedConnection) {
      await conn.end();
    }
  }
}

// CLI Execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('--- Retrieva AI Migration Runner ---');
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(`Summary: ${applied.length} applied, ${skipped.length} skipped.`);
      if (applied.length > 0) {
        applied.forEach((f) => console.log(`  [APPLIED] ${f}`));
      }
      if (skipped.length > 0) {
        skipped.forEach((f) => console.log(`  [SKIPPED] ${f}`));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Migration Failed:\n${err.message}`);
      process.exit(1);
    });
}
