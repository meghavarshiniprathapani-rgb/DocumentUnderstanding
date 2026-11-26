import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { getDedicatedConnection } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
export const LOCK_NAME = 'docuretrieve_migration_lock';
export const LOCK_TIMEOUT_SECONDS = 10;

export class MigrationLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationLockError';
  }
}

export class ChecksumMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChecksumMismatchError';
  }
}

export class MigrationExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationExecutionError';
  }
}

export class PostMigrationVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PostMigrationVerificationError';
  }
}

export class DocumentIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentIdentityError';
  }
}

export class DocumentIdentityUnresolvableError extends DocumentIdentityError {
  constructor(message) {
    super(message);
    this.name = 'DocumentIdentityUnresolvableError';
  }
}

export class DocumentIdentityMismatchError extends DocumentIdentityError {
  constructor(message) {
    super(message);
    this.name = 'DocumentIdentityMismatchError';
  }
}

export async function getDbConnection(customConfig = null) {
  return await getDedicatedConnection(customConfig);
}

export function computeChecksum(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export async function acquireLock(conn, timeoutSeconds = LOCK_TIMEOUT_SECONDS) {
  try {
    const [rows] = await conn.query(`SELECT GET_LOCK(?, ?) AS lock_acquired`, [
      LOCK_NAME,
      timeoutSeconds,
    ]);
    if (!rows || rows[0].lock_acquired !== 1) {
      throw new MigrationLockError(
        `Failed to acquire migration lock '${LOCK_NAME}' within ${timeoutSeconds}s. Another migration process may be running.`
      );
    }
  } catch (err) {
    if (err instanceof MigrationLockError) throw err;
    throw new MigrationLockError(`Error acquiring migration lock '${LOCK_NAME}': ${err.message}`);
  }
}

export async function releaseLock(conn) {
  try {
    await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
  } catch (err) {
    console.warn(`Warning: Failed to release migration lock cleanly: ${err.message}`);
  }
}

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

export async function detectPartialSchema(conn, version) {
  if (version === '001') {
    const [tables] = await conn.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    const tableNames = new Set(tables.map((t) => t.TABLE_NAME));
    const v1Tables = ['documents', 'elements', 'jobs', 'eval_runs'];
    const present = v1Tables.filter((t) => tableNames.has(t));
    const missing = v1Tables.filter((t) => !tableNames.has(t));
    if (present.length > 0 && missing.length > 0) {
      return {
        isPartial: true,
        diagnostic: `Partial v001 schema: tables present: [${present.join(', ')}], missing: [${missing.join(', ')}]`,
      };
    }
    return { isPartial: false, diagnostic: null };
  }

  if (version === '002') {
    const [cols] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
    );
    const colMap = new Map();
    for (const r of cols) {
      if (!colMap.has(r.TABLE_NAME)) colMap.set(r.TABLE_NAME, new Set());
      colMap.get(r.TABLE_NAME).add(r.COLUMN_NAME);
    }

    const docCols = colMap.get('documents') || new Set();
    const elemCols = colMap.get('elements') || new Set();
    const evalCols = colMap.get('eval_runs') || new Set();

    const [chkRows] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()`
    );
    const chkNames = new Set(chkRows.map((c) => c.CONSTRAINT_NAME));

    const v2Features = [
      { name: "documents.document_id", exists: docCols.has('document_id') },
      { name: "documents.deleted_at", exists: docCols.has('deleted_at') },
      { name: "elements.reading_order", exists: elemCols.has('reading_order') },
      { name: "elements.chk_elements_confidence", exists: chkNames.has('chk_elements_confidence') },
      { name: "eval_runs.acceptance_hash", exists: evalCols.has('acceptance_hash') },
    ];

    const present = v2Features.filter((f) => f.exists).map((f) => f.name);
    const missing = v2Features.filter((f) => !f.exists).map((f) => f.name);

    if (present.length > 0 && missing.length > 0) {
      return {
        isPartial: true,
        diagnostic: `Partial v002 schema detected:\n` +
          `    Present features: ${present.join(', ')}\n` +
          `    Missing features: ${missing.join(', ')}`,
      };
    }
    return { isPartial: false, diagnostic: null };
  }

  if (version === '003') {
    const [cols] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_sequences'`
    );
    const colNames = new Set(cols.map((r) => r.COLUMN_NAME));
    const v3Cols = ['sequence_name', 'current_val'];
    const present = v3Cols.filter((c) => colNames.has(c));
    const missing = v3Cols.filter((c) => !colNames.has(c));
    if (present.length > 0 && missing.length > 0) {
      return {
        isPartial: true,
        diagnostic: `Partial v003 schema detected on document_sequences: present: [${present.join(', ')}], missing: [${missing.join(', ')}]`,
      };
    }
    return { isPartial: false, diagnostic: null };
  }

  if (version === '004') {
    const [cols] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cleanup_queue'`
    );
    const colNames = new Set(cols.map((r) => r.COLUMN_NAME));
    const v4Cols = ['id', 'file_path', 'reason', 'status', 'attempts'];
    const present = v4Cols.filter((c) => colNames.has(c));
    const missing = v4Cols.filter((c) => !colNames.has(c));
    if (present.length > 0 && missing.length > 0) {
      return {
        isPartial: true,
        diagnostic: `Partial v004 schema detected on cleanup_queue: present: [${present.join(', ')}], missing: [${missing.join(', ')}]`,
      };
    }
    return { isPartial: false, diagnostic: null };
  }

  if (version === '005') {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'`
    );
    const colNames = new Set(cols.map((r) => r.COLUMN_NAME));
    const [stats] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'`
    );
    const indexNames = new Set(stats.map((r) => r.INDEX_NAME));

    const v5Features = [
      { name: 'jobs.locked_by', exists: colNames.has('locked_by') },
      { name: 'jobs.locked_at', exists: colNames.has('locked_at') },
      { name: 'jobs.heartbeat_at', exists: colNames.has('heartbeat_at') },
      { name: 'jobs.lease_timeout_seconds', exists: colNames.has('lease_timeout_seconds') },
      { name: 'jobs.idx_jobs_status_heartbeat', exists: indexNames.has('idx_jobs_status_heartbeat') },
      { name: 'jobs.idx_jobs_status_mode', exists: indexNames.has('idx_jobs_status_mode') },
    ];
    const present = v5Features.filter((f) => f.exists).map((f) => f.name);
    const missing = v5Features.filter((f) => !f.exists).map((f) => f.name);
    if (present.length > 0 && missing.length > 0) {
      return {
        isPartial: true,
        diagnostic: `Partial v005 schema detected on jobs:\n    Present features: ${present.join(', ')}\n    Missing features: ${missing.join(', ')}`,
      };
    }
    return { isPartial: false, diagnostic: null };
  }

  return { isPartial: false, diagnostic: null };
}

export async function verifySchema(conn, options = {}) {
  let targetVersion = options.targetVersion || options.upToVersion;
  if (!targetVersion) {
    const [history] = await conn.query(
      `SELECT version FROM _migrations ORDER BY id DESC LIMIT 1`
    );
    targetVersion = history.length > 0 ? history[0].version : '005';
  }

  const isV2 = targetVersion === '002' || targetVersion >= '002';
  const isV3 = targetVersion === '003' || targetVersion >= '003';
  const isV4 = targetVersion === '004' || targetVersion >= '004';
  const isV5 = targetVersion === '005' || targetVersion >= '005';

  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  );
  const tableNames = new Set(tables.map((t) => t.TABLE_NAME));
  const expectedTables = ['_migrations', 'documents', 'elements', 'jobs', 'eval_runs'];
  if (isV3) expectedTables.push('document_sequences');
  if (isV4) expectedTables.push('cleanup_queue');

  for (const t of expectedTables) {
    if (!tableNames.has(t)) {
      throw new PostMigrationVerificationError(`Missing required table '${t}' in database.`);
    }
  }

  const [columns] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
     FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const colMap = new Map();
  for (const r of columns) {
    const key = `${r.TABLE_NAME}.${r.COLUMN_NAME}`;
    colMap.set(key, r);
  }

  const assertColumn = (table, col, expectedType, nullable) => {
    const key = `${table}.${col}`;
    const actual = colMap.get(key);
    if (!actual) {
      throw new PostMigrationVerificationError(
        `Missing required column '${col}' on table '${table}'.`
      );
    }
    if (actual.DATA_TYPE !== expectedType && actual.COLUMN_TYPE !== expectedType) {
      throw new PostMigrationVerificationError(
        `Column type mismatch on '${table}.${col}': expected '${expectedType}', got '${actual.COLUMN_TYPE}'.`
      );
    }
    const expectedNullable = nullable ? 'YES' : 'NO';
    if (actual.IS_NULLABLE !== expectedNullable) {
      throw new PostMigrationVerificationError(
        `Column nullability mismatch on '${table}.${col}': expected IS_NULLABLE='${expectedNullable}', got '${actual.IS_NULLABLE}'.`
      );
    }
  };

  assertColumn('_migrations', 'id', 'int', false);
  assertColumn('_migrations', 'version', 'varchar', false);
  assertColumn('_migrations', 'name', 'varchar', false);
  assertColumn('_migrations', 'checksum', 'char', false);
  assertColumn('_migrations', 'applied_at', 'timestamp', false);

  assertColumn('documents', 'id', 'bigint', false);
  assertColumn('documents', 'filename', 'varchar', false);
  assertColumn('documents', 'sha256', 'char', false);
  assertColumn('documents', 'path', 'varchar', false);
  assertColumn('documents', 'pages_count', 'int', false);
  assertColumn('documents', 'doc_type', 'varchar', false);
  assertColumn('documents', 'split', 'enum', false);
  assertColumn('documents', 'status', 'varchar', false);
  assertColumn('documents', 'metadata', 'json', true);
  assertColumn('documents', 'created_at', 'timestamp', false);
  assertColumn('documents', 'updated_at', 'timestamp', false);

  assertColumn('elements', 'id', 'bigint', false);
  assertColumn('elements', 'doc_id', 'bigint', false);
  assertColumn('elements', 'mode', 'enum', false);
  assertColumn('elements', 'type', 'enum', false);
  assertColumn('elements', 'page', 'int', false);
  assertColumn('elements', 'confidence', 'float', false);
  assertColumn('elements', 'text', 'mediumtext', true);
  assertColumn('elements', 'bbox', 'json', true);
  assertColumn('elements', 'structured', 'json', true);
  assertColumn('elements', 'provenance', 'json', true);
  assertColumn('elements', 'flags', 'json', true);
  assertColumn('elements', 'model_version', 'varchar', true);
  assertColumn('elements', 'created_at', 'timestamp', false);

  assertColumn('jobs', 'id', 'bigint', false);
  assertColumn('jobs', 'doc_id', 'bigint', false);
  assertColumn('jobs', 'mode', 'varchar', false);
  assertColumn('jobs', 'status', 'enum', false);
  assertColumn('jobs', 'seconds', 'float', true);
  assertColumn('jobs', 'error', 'text', true);
  assertColumn('jobs', 'attempts', 'int', false);
  assertColumn('jobs', 'created_at', 'timestamp', false);
  assertColumn('jobs', 'updated_at', 'timestamp', false);

  assertColumn('eval_runs', 'id', 'bigint', false);
  assertColumn('eval_runs', 'config_hash', 'char', false);
  assertColumn('eval_runs', 'model_versions', 'json', false);
  assertColumn('eval_runs', 'split', 'varchar', false);
  assertColumn('eval_runs', 'kpi', 'json', false);
  assertColumn('eval_runs', 'status', 'varchar', false);
  assertColumn('eval_runs', 'created_at', 'timestamp', false);

  if (isV2) {
    assertColumn('documents', 'document_id', 'varchar', false);
    assertColumn('documents', 'deleted_at', 'timestamp', true);
    assertColumn('elements', 'reading_order', 'int', false);
    if (colMap.has('elements.reading_idx')) {
      throw new PostMigrationVerificationError(
        `Obsolete column 'reading_idx' still present on table 'elements'. Expected rename to 'reading_order'.`
      );
    }
    assertColumn('eval_runs', 'dataset_split_hash', 'char', true);
    assertColumn('eval_runs', 'acceptance_hash', 'char', true);
  }

  if (isV3) {
    assertColumn('document_sequences', 'sequence_name', 'varchar', false);
    assertColumn('document_sequences', 'current_val', 'bigint', false);
  }

  if (isV4) {
    assertColumn('cleanup_queue', 'id', 'bigint', false);
    assertColumn('cleanup_queue', 'file_path', 'varchar', false);
    assertColumn('cleanup_queue', 'reason', 'varchar', false);
    assertColumn('cleanup_queue', 'doc_id', 'bigint', true);
    assertColumn('cleanup_queue', 'attempts', 'int', false);
    assertColumn('cleanup_queue', 'status', 'enum', false);
    assertColumn('cleanup_queue', 'last_error', 'text', true);
    assertColumn('cleanup_queue', 'created_at', 'timestamp', false);
    assertColumn('cleanup_queue', 'updated_at', 'timestamp', false);
  }

  if (isV5) {
    assertColumn('jobs', 'locked_by', 'varchar(128)', true);
    assertColumn('jobs', 'locked_at', 'timestamp', true);
    assertColumn('jobs', 'heartbeat_at', 'timestamp', true);
    assertColumn('jobs', 'lease_timeout_seconds', 'int', false);
    const leaseTimeoutCol = colMap.get('jobs.lease_timeout_seconds');
    if (String(leaseTimeoutCol?.COLUMN_DEFAULT) !== '300') {
      throw new PostMigrationVerificationError(
        `Default mismatch on 'jobs.lease_timeout_seconds': expected '300', got '${leaseTimeoutCol?.COLUMN_DEFAULT}'.`
      );
    }
    const jobStatusCol = colMap.get('jobs.status');
    if (jobStatusCol?.COLUMN_TYPE !== "enum('queued','running','done','degraded','failed')") {
      throw new PostMigrationVerificationError(
        `Job status enum mismatch on 'jobs.status': got '${jobStatusCol?.COLUMN_TYPE}'.`
      );
    }
  }

  const [stats] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX 
     FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const indexMap = new Map();
  for (const s of stats) {
    const key = `${s.TABLE_NAME}.${s.INDEX_NAME}`;
    if (!indexMap.has(key)) {
      indexMap.set(key, { nonUnique: s.NON_UNIQUE === 1, columns: [] });
    }
    indexMap.get(key).columns[s.SEQ_IN_INDEX - 1] = s.COLUMN_NAME;
  }

  const assertIndex = (table, indexName, expectedCols, isUnique) => {
    const key = `${table}.${indexName}`;
    const actual = indexMap.get(key);
    if (!actual) {
      throw new PostMigrationVerificationError(
        `Missing expected index '${indexName}' on table '${table}'.`
      );
    }
    if (actual.nonUnique === isUnique) {
      throw new PostMigrationVerificationError(
        `Uniqueness mismatch on index '${table}.${indexName}': expected unique=${isUnique}, got unique=${!actual.nonUnique}.`
      );
    }
    for (let i = 0; i < expectedCols.length; i++) {
      if (actual.columns[i] !== expectedCols[i]) {
        throw new PostMigrationVerificationError(
          `Index column mismatch on '${table}.${indexName}' at position ${i + 1}: expected '${expectedCols[i]}', got '${actual.columns[i]}'.`
        );
      }
    }
  };

  assertIndex('documents', 'PRIMARY', ['id'], true);
  assertIndex('elements', 'PRIMARY', ['id'], true);
  assertIndex('jobs', 'PRIMARY', ['id'], true);
  assertIndex('eval_runs', 'PRIMARY', ['id'], true);
  assertIndex('_migrations', 'PRIMARY', ['id'], true);

  assertIndex('documents', 'uq_documents_sha256', ['sha256'], true);
  assertIndex('_migrations', 'version', ['version'], true);

  assertIndex('documents', 'idx_documents_split', ['split'], false);
  assertIndex('documents', 'idx_documents_status', ['status'], false);
  assertIndex('elements', 'idx_elements_doc_page', ['doc_id', 'page'], false);
  assertIndex('elements', 'idx_elements_doc_type', ['doc_id', 'type'], false);
  assertIndex('jobs', 'idx_jobs_status', ['status'], false);
  assertIndex('jobs', 'idx_jobs_doc_status', ['doc_id', 'status'], false);
  assertIndex('eval_runs', 'idx_eval_runs_config_hash', ['config_hash'], false);
  assertIndex('eval_runs', 'idx_eval_runs_split', ['split'], false);

  if (isV2) {
    assertIndex('documents', 'uq_documents_document_id', ['document_id'], true);
    assertIndex('documents', 'idx_documents_deleted_at', ['deleted_at'], false);
    assertIndex('elements', 'idx_elements_doc_mode_reading_order', ['doc_id', 'mode', 'reading_order'], false);
    assertIndex('eval_runs', 'idx_eval_runs_acceptance_hash', ['acceptance_hash'], false);
  }

  if (isV3) {
    assertIndex('document_sequences', 'PRIMARY', ['sequence_name'], true);
  }

  if (isV4) {
    assertIndex('cleanup_queue', 'PRIMARY', ['id'], true);
    assertIndex('cleanup_queue', 'idx_cleanup_status', ['status'], false);
  }

  if (isV5) {
    assertIndex('jobs', 'idx_jobs_status_heartbeat', ['status', 'heartbeat_at'], false);
    assertIndex('jobs', 'idx_jobs_status_mode', ['status', 'mode'], false);
  }

  const [refs] = await conn.query(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE 
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS 
     WHERE CONSTRAINT_SCHEMA = DATABASE()`
  );
  const refMap = new Map();
  for (const r of refs) {
    refMap.set(r.CONSTRAINT_NAME, r);
  }

  const elemFk = refMap.get('fk_elements_document');
  if (!elemFk) {
    throw new PostMigrationVerificationError(`Missing foreign key constraint 'fk_elements_document'.`);
  }
  if (elemFk.TABLE_NAME !== 'elements' || elemFk.REFERENCED_TABLE_NAME !== 'documents') {
    throw new PostMigrationVerificationError(`Foreign key 'fk_elements_document' reference mismatch.`);
  }
  if (elemFk.DELETE_RULE !== 'CASCADE') {
    throw new PostMigrationVerificationError(
      `Foreign key 'fk_elements_document' delete rule mismatch: expected 'CASCADE', got '${elemFk.DELETE_RULE}'.`
    );
  }

  const jobFk = refMap.get('fk_jobs_document');
  if (!jobFk) {
    throw new PostMigrationVerificationError(`Missing foreign key constraint 'fk_jobs_document'.`);
  }
  if (jobFk.TABLE_NAME !== 'jobs' || jobFk.REFERENCED_TABLE_NAME !== 'documents') {
    throw new PostMigrationVerificationError(`Foreign key 'fk_jobs_document' reference mismatch.`);
  }
  const expectedJobDeleteRule = isV2 ? 'RESTRICT' : 'CASCADE';
  if (jobFk.DELETE_RULE !== expectedJobDeleteRule) {
    throw new PostMigrationVerificationError(
      `Foreign key 'fk_jobs_document' delete policy mismatch: expected '${expectedJobDeleteRule}', got '${jobFk.DELETE_RULE}'.`
    );
  }

  if (isV2) {
    const [chks] = await conn.query(
      `SELECT CONSTRAINT_NAME, CHECK_CLAUSE 
       FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS 
       WHERE CONSTRAINT_SCHEMA = DATABASE()`
    );
    const chkMap = new Map();
    for (const c of chks) {
      chkMap.set(c.CONSTRAINT_NAME, c.CHECK_CLAUSE);
    }

    const assertCheck = (chkName, requiredSubstrings) => {
      const clause = chkMap.get(chkName);
      if (!clause) {
        throw new PostMigrationVerificationError(`Missing CHECK constraint '${chkName}'.`);
      }
      for (const sub of requiredSubstrings) {
        if (!clause.toLowerCase().includes(sub.toLowerCase())) {
          throw new PostMigrationVerificationError(
            `CHECK constraint '${chkName}' clause mismatch: missing expression '${sub}'. Actual clause: '${clause}'.`
          );
        }
      }
    };

    assertCheck('chk_elements_confidence', ['confidence', '>= 0', '<= 1']);
    assertCheck('chk_elements_page', ['page', '>= 1']);
    assertCheck('chk_elements_reading_order', ['reading_order', '>= 0']);
  }

  return true;
}

export async function preflightDocumentIdentities(conn) {
  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'`
  );
  if (tables.length === 0) return { count: 0, identities: new Map() };

  const [rows] = await conn.query(
    `SELECT id, filename, path, sha256 FROM documents ORDER BY id ASC`
  );
  if (rows.length === 0) return { count: 0, identities: new Map() };

  const idMap = new Map();
  const seenIds = new Set();

  for (const doc of rows) {
    let resolvedId = null;

    const fnMatch = doc.filename ? doc.filename.match(/^doc-\d{3}/) : null;
    if (fnMatch) resolvedId = fnMatch[0];

    if (!resolvedId && doc.path) {
      const pathMatch = doc.path.match(/doc-\d{3}/);
      if (pathMatch) resolvedId = pathMatch[0];
    }

    if (!resolvedId) {
      throw new DocumentIdentityUnresolvableError(
        `Preflight Identity Validation Failed: Cannot establish authoritative original API identity for document ` +
        `id=${doc.id}, filename='${doc.filename}', path='${doc.path}'. ` +
        `Refusing to guess or fabricate identity using numeric IDs. Migration aborted BEFORE executing DDL.`
      );
    }

    if (seenIds.has(resolvedId)) {
      throw new DocumentIdentityError(
        `Preflight Identity Validation Failed: Duplicate document identity '${resolvedId}' detected for document id=${doc.id}.`
      );
    }

    seenIds.add(resolvedId);
    idMap.set(doc.id, resolvedId);
  }

  return { count: rows.length, identities: idMap };
}

export async function verifyDocumentIdentities(conn, options = {}) {
  const [rows] = await conn.query(
    `SELECT id, document_id, filename, path, sha256 FROM documents ORDER BY id ASC`
  );

  const seenIds = new Set();
  const verified = [];

  for (const doc of rows) {
    if (doc.document_id === null || doc.document_id === undefined || doc.document_id === '') {
      throw new DocumentIdentityError(
        `Document id=${doc.id} ('${doc.filename}') has NULL or empty document_id.`
      );
    }

    if (seenIds.has(doc.document_id)) {
      throw new DocumentIdentityError(
        `Duplicate document_id '${doc.document_id}' detected on document id=${doc.id}.`
      );
    }
    seenIds.add(doc.document_id);

    let originalId = null;

    const fnMatch = doc.filename ? doc.filename.match(/^doc-\d{3}/) : null;
    if (fnMatch) {
      originalId = fnMatch[0];
    }

    if (!originalId && doc.path) {
      const pathMatch = doc.path.match(/doc-\d{3}/);
      if (pathMatch) {
        originalId = pathMatch[0];
      }
    }

    if (!originalId && options.manifestMap && options.manifestMap.has(doc.sha256)) {
      originalId = options.manifestMap.get(doc.sha256);
    }

    if (!originalId) {
      throw new DocumentIdentityUnresolvableError(
        `Cannot establish original API identity for document id=${doc.id}, filename='${doc.filename}', path='${doc.path}'. ` +
        `Refusing to guess or fabricate identity.`
      );
    }

    if (doc.document_id !== originalId) {
      throw new DocumentIdentityMismatchError(
        `Identity fabrication detected for document id=${doc.id}: ` +
        `expected original identity '${originalId}', but found '${doc.document_id}'.`
      );
    }

    verified.push({ id: doc.id, document_id: doc.document_id, originalId });
  }

  return {
    count: rows.length,
    documents: verified,
  };
}

export async function runMigrations(options = {}) {
  const conn = options.connection || (await getDbConnection(options.config));
  const migrationsDir = options.migrationsDir || MIGRATIONS_DIR;
  const isDedicatedConnection = !options.connection;

  const applied = [];
  const skipped = [];
  let lockAcquired = false;

  try {
    await acquireLock(conn);
    lockAcquired = true;

    await ensureMigrationsTable(conn);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const [historyRows] = await conn.query(
      `SELECT version, name, checksum, applied_at FROM _migrations ORDER BY id ASC`
    );
    const appliedMap = new Map();
    for (const row of historyRows) {
      appliedMap.set(row.version, row);
    }

    if (appliedMap.size > 0) {
      const highestRecorded = Array.from(appliedMap.keys()).sort().pop();
      try {
        await verifySchema(conn, { targetVersion: highestRecorded });
      } catch (err) {
        throw new PostMigrationVerificationError(
          `RecordedMigrationVerificationError: Migration history is recorded up to version '${highestRecorded}', ` +
            `but live schema verification failed:\n  ${err.message}\n` +
            `The live database schema does not match recorded migration history. Refusing to silently skip.\n` +
            `Manual administrative recovery required. Tables are NOT automatically dropped.`
        );
      }
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
          throw new ChecksumMismatchError(
            `Migration '${file}' has been altered after application!\n` +
              `  Recorded Checksum : ${recorded.checksum}\n` +
              `  Current Checksum  : ${checksum}\n` +
              `  Applied At        : ${recorded.applied_at}\n` +
              `Aborting to prevent corrupted schema state.`
          );
        }
        skipped.push(file);
      } else {
        const partialDiag = await detectPartialSchema(conn, version);
        if (partialDiag.isPartial) {
          throw new MigrationExecutionError(
            `PartialMigrationDetectedError: Migration '${file}' is not recorded as applied, but partial schema elements were detected:\n` +
              `  ${partialDiag.diagnostic}\n` +
              `MySQL commits DDL implicitly. Prior migration execution may have failed midway.\n` +
              `Recovery Instruction: Inspect the schema, resolve the failure manually, and complete or revert partial changes before re-running.\n` +
              `Automatic drop or table recreation is disabled to prevent data loss.`
          );
        }

        if (version === '002') {
          await preflightDocumentIdentities(conn);
        }

        try {
          await conn.query(content);
        } catch (err) {
          const postFailDiag = await detectPartialSchema(conn, version);
          throw new MigrationExecutionError(
            `Failed executing migration '${file}':\n${err.message}\n` +
              (postFailDiag.isPartial ? `Partial Schema State Detected:\n  ${postFailDiag.diagnostic}\n` : '') +
              `MySQL commits DDL statements implicitly. Migration was NOT recorded in _migrations.\n` +
              `Recovery Instruction: Inspect database manually. Tables are NOT automatically dropped.`
          );
        }

        try {
          await verifySchema(conn, { upToVersion: version });
          if (version === '002') {
            await verifyDocumentIdentities(conn);
          }
        } catch (err) {
          throw new PostMigrationVerificationError(
            `Post-migration verification failed for '${file}' before recording into _migrations:\n` +
              `  ${err.message}\n` +
              `Note: MySQL DDL commits implicitly. Some changes may have taken effect on disk.\n` +
              `Migration has NOT been recorded in _migrations history table.\n` +
              `Manual administrative recovery required. Tables are NOT automatically dropped.`
          );
        }

        try {
          await conn.query(
            `INSERT INTO _migrations (version, name, checksum) VALUES (?, ?, ?)`,
            [version, file, checksum]
          );
        } catch (err) {
          throw new MigrationExecutionError(
            `Failed recording migration '${file}' in _migrations table:\n${err.message}`
          );
        }

        applied.push(file);
      }
    }

    return { applied, skipped };
  } finally {
    if (lockAcquired) {
      try {
        await releaseLock(conn);
      } catch (err) {
        console.warn(`Warning: Failed to release migration lock: ${err.message}`);
      }
    }
    if (isDedicatedConnection) {
      try {
        await conn.end();
      } catch (err) {
        console.warn(`Warning: Failed to close database connection: ${err.message}`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('--- Retrieva AI Migration Runner & Verifier ---');
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
      console.error(`Migration Failed [${err.name}]:\n${err.message}`);
      process.exit(1);
    });
}
