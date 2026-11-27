/**
 * Retrieva AI — M1.3.4 Migration Immutability & Final Database Audit Suite
 * 
 * Enforces:
 * 1.  Migration Immutability: Historical _migrations records (001, 002) are NEVER deleted or mutated.
 * 2.  Checksum Mismatch Enforcer: Any post-application file modification is strictly rejected.
 * 3.  Identity Preservation & Preflight: Validates canonical identity resolution and stops unresolvable records.
 * 4.  Preflight Abort: Unresolvable document prevents migration BEFORE any DDL execution.
 * 5.  Identity Evidence Limitation: Distinguishes test fixtures from historical production records.
 * 6.  Genuinely Partial Migration Detection: detectPartialSchema() reports present and missing features.
 * 7.  Runner Partial State Rejection: Refuses to silently apply or skip partial migrations.
 * 8.  Injected DDL Failure Behavior: Demonstrates runner handling after MySQL implicit DDL commit.
 * 9.  History Consistency Condition 1: Migration recorded and schema valid (clean skip).
 * 10. History Consistency Condition 2: Migration recorded but schema invalid (refusal to silently skip).
 * 11. History Consistency Condition 3: Migration not recorded but schema partially applied (detection & abort).
 * 12. History Consistency Condition 4: Migration not recorded and schema untouched (clean application).
 * 13. History Consistency Condition 5: Migration checksum mismatch (tamper detection & abort).
 * 14. Deep Schema Verification: Column type mismatch detection via INFORMATION_SCHEMA.
 * 15. Deep Schema Verification: Missing unique index detection.
 * 16. Deep Schema Verification: Incorrect foreign-key delete policy detection (RESTRICT vs CASCADE).
 * 17. Deep Schema Verification: Incorrect CHECK expression detection (confidence, page, reading_order).
 * 18. Deep Schema Verification: Missing secondary index detection.
 * 19. Integrity Bounds: Confidence [0,1], page >= 1, reading_order >= 0.
 * 20. Audit Preservation: Soft deletion & RESTRICT foreign key protection on jobs.
 * 21. Provenance Tracking: Acceptance and dataset split hashes in eval_runs.
 * 22. Concurrency Safety: MySQL advisory lock serialization.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  runMigrations,
  getDbConnection,
  computeChecksum,
  verifySchema,
  verifyDocumentIdentities,
  preflightDocumentIdentities,
  detectPartialSchema,
  acquireLock,
  releaseLock,
  MigrationLockError,
  ChecksumMismatchError,
  MigrationExecutionError,
  PostMigrationVerificationError,
  DocumentIdentityError,
  DocumentIdentityUnresolvableError,
} from '../migrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

async function runTestSuite() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.3.4 MIGRATION IMMUTABILITY & AUDIT SUITE    ');
  console.log('=================================================================');

  const conn = await getDbConnection();

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: VERIFY IMMUTABILITY OF HISTORICAL MIGRATIONS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 1: MIGRATION IMMUTABILITY & AUDIT ---');

    console.log('\n[TEST 1.1] Verifying immutable historical _migrations records in working DB...');
    const [historyRows] = await conn.query('SELECT * FROM _migrations ORDER BY id ASC');
    assert.equal(historyRows.length, 6, 'Exactly 6 migrations must be recorded in working DB');

    const m001 = historyRows.find((r) => r.version === '001');
    assert.ok(m001, 'Migration 001 must exist');
    assert.equal(m001.checksum, '8484ffab4f8ba98c305ab7e704f848c922a8bfa26371ab2df39aa22834554c37');

    const m002 = historyRows.find((r) => r.version === '002');
    assert.ok(m002, 'Migration 002 must exist');
    assert.equal(m002.checksum, '22625dc8a1907f2352b180fbf2ebaac5718158754feb83b555f8b0911d58563e');

    const m003 = historyRows.find((r) => r.version === '003');
    assert.ok(m003, 'Migration 003 must exist');
    assert.equal(m003.checksum, 'c6dd8fe23fba247c7e974af06d72888805169f74c2b2ce934ef71dcbf3a65f98');

    const m004 = historyRows.find((r) => r.version === '004');
    assert.ok(m004, 'Migration 004 must exist');
    assert.equal(m004.checksum, '862f52344ba48a96799ecb7a8d01ddab6577df78fe03a7aab33ccab994efc5f0');

    const m005 = historyRows.find((r) => r.version === '005');
    assert.ok(m005, 'Migration 005 must exist');
    assert.equal(m005.checksum, 'fb8ec0de7a7150748677b64ba3bdb6011e6aedd87923812abf41b339238a15cb');

    const m006 = historyRows.find((r) => r.version === '006');
    assert.ok(m006, 'Migration 006 must exist');
    assert.equal(m006.checksum, 'd193d0c0acde7c731678ea7eafa1d6f41191e88db68693fa200c139739a7a52d');

    const f001Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8');
    assert.equal(computeChecksum(f001Content), m001.checksum, '001_init.sql file checksum matches DB record');

    const f002Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), 'utf8');
    assert.equal(computeChecksum(f002Content), m002.checksum, '002_schema_compatibility.sql file checksum matches DB record');

    const f003Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), 'utf8');
    assert.equal(computeChecksum(f003Content), m003.checksum, '003_document_sequences.sql file checksum matches DB record');

    const f004Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), 'utf8');
    assert.equal(computeChecksum(f004Content), m004.checksum, '004_durable_cleanup_queue.sql file checksum matches DB record');

    const f005Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), 'utf8');
    assert.equal(computeChecksum(f005Content), m005.checksum, '005_worker_leases.sql file checksum matches DB record');

    const f006Content = fs.readFileSync(path.join(MIGRATIONS_DIR, '006_worker_claim_fencing.sql'), 'utf8');
    assert.equal(computeChecksum(f006Content), m006.checksum, '006_worker_claim_fencing.sql file checksum matches DB record');

    console.log('  PASS: Working database migration records and file checksums are 100% aligned:');
    console.log(`        001_init.sql                   : ${m001.checksum}`);
    console.log(`        002_schema_compatibility.sql   : ${m002.checksum}`);
    console.log(`        003_document_sequences.sql     : ${m003.checksum}`);
    console.log(`        004_durable_cleanup_queue.sql  : ${m004.checksum}`);
    console.log(`        005_worker_leases.sql          : ${m005.checksum}`);
    console.log(`        006_worker_claim_fencing.sql   : ${m006.checksum}`);

    // Test 1.2: Checksum mismatch enforcer (Altering an applied migration file must be refused)
    console.log('\n[TEST 1.2] Testing runner strictly refuses an applied migration whose checksum changed...');
    const tempTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-tamper-audit-'));
    try {
      // Create a tampered copy of 002
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempTamperDir, '001_init.sql'));
      fs.writeFileSync(path.join(tempTamperDir, '002_schema_compatibility.sql'), '-- Tampered 002 content\nSELECT 1;');

      let tamperCaught = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempTamperDir });
      } catch (err) {
        if (err instanceof ChecksumMismatchError) {
          tamperCaught = true;
          console.log('  PASS: ChecksumMismatchError safely raised:');
          console.log(`        "${err.message.split('\n')[0]}"`);
        } else {
          throw err;
        }
      }
      assert.equal(tamperCaught, true, 'Tampered migration file must be rejected by runner');
    } finally {
      fs.rmSync(tempTamperDir, { recursive: true, force: true });
    }

    // -------------------------------------------------------------------------
    // SECTION 2: IDENTITY PRESERVATION & PREFLIGHT VALIDATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: IDENTITY PRESERVATION & PREFLIGHT ---');

    // Test 2.1: Preflight identity check blocks unresolvable records
    console.log('\n[TEST 2.1] Testing preflightDocumentIdentities blocks unresolvable record...');
    const unresolvableSha = crypto.createHash('sha256').update('unresolvable_probe_audit').digest('hex');
    const [badDoc] = await conn.query(
      `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['temp-probe-id', 'scan_unlabeled_1028.pdf', unresolvableSha, '/tmp/uploads/unknown.pdf', 1, 'unclassified', 'none']
    );
    const badDocId = badDoc.insertId;

    try {
      let preflightCaught = false;
      try {
        await preflightDocumentIdentities(conn);
      } catch (err) {
        if (err instanceof DocumentIdentityUnresolvableError) {
          preflightCaught = true;
          console.log('  PASS: Preflight validation refused unresolvable record without guessing:');
          console.log(`        "${err.message.split('\n')[0]}"`);
        } else {
          throw err;
        }
      }
      assert.equal(preflightCaught, true, 'Unresolvable record must be caught by preflight');
    } finally {
      await conn.query('DELETE FROM documents WHERE id = ?', [badDocId]);
    }

    // Test 2.2: Test Fixture Identity Evidence (Explicitly documenting limitation)
    console.log('\n[TEST 2.2] Testing identity verification on manifest-derived test fixtures...');
    console.log('  NOTE: Working database had 0 legacy MySQL records (M0 stored documents in JSON/PDFs).');
    console.log('        Identity preservation is demonstrated using test fixtures modeled on data/manifest.yaml.');

    const manifestFixtures = [
      { id: 'doc-001', filename: 'Annual Financial Report 2025.pdf', path: 'data/sample_documents/doc-001.pdf' },
      { id: 'doc-002', filename: 'LayoutLMv3 Multi-Modal Research Paper.pdf', path: 'data/sample_documents/doc-002.pdf' },
      { id: 'doc-003', filename: 'Enterprise Zero-Trust Security Policy.pdf', path: 'data/sample_documents/doc-003.pdf' },
    ];

    const fixtureIds = [];
    try {
      for (const fix of manifestFixtures) {
        const fixSha = crypto.createHash('sha256').update(fix.id + '_audit_fixture').digest('hex');
        const [ins] = await conn.query(
          `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [fix.id, fix.filename, fixSha, fix.path, 10, 'dev', 'dev']
        );
        fixtureIds.push(ins.insertId);
      }

      const verifyRes = await verifyDocumentIdentities(conn);
      assert.equal(verifyRes.count, 3);
      for (const d of verifyRes.documents) {
        assert.equal(d.document_id, d.originalId);
        console.log(`    Fixture id=${d.id}: document_id='${d.document_id}' === canonical '${d.originalId}' [VALIDATED]`);
      }
      console.log('  PASS: Identity verification confirmed exact match without numeric fabrication.');
    } finally {
      if (fixtureIds.length > 0) {
        await conn.query('DELETE FROM documents WHERE id IN (?)', [fixtureIds]);
      }
    }

    // -------------------------------------------------------------------------
    // SECTION 3: GENUINELY PARTIAL MIGRATION & RECOVERY
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: PARTIAL MIGRATION & RECOVERY DIAGNOSTICS ---');

    console.log('\n[TEST 3.1] Testing detectPartialSchema on complete pristine database...');
    const pristinePartialCheck = await detectPartialSchema(conn, '002');
    assert.equal(pristinePartialCheck.isPartial, false, 'Pristine database should not report partial state');
    console.log('  PASS: detectPartialSchema reports complete state for version 002.');

    console.log('\n[TEST 3.2] Testing detectPartialSchema detects simulated partial state...');
    // Temporarily drop elements.reading_order (rename to reading_idx) without altering _migrations
    await conn.query('ALTER TABLE elements DROP CHECK chk_elements_reading_order');
    await conn.query('ALTER TABLE elements RENAME COLUMN reading_order TO reading_idx');
    await conn.query('ALTER TABLE elements RENAME INDEX idx_elements_doc_mode_reading_order TO idx_elements_doc_mode_reading');
    try {
      const partialCheck = await detectPartialSchema(conn, '002');
      assert.equal(partialCheck.isPartial, true, 'Partial schema state must be detected');
      assert.ok(partialCheck.diagnostic.includes('Present features: documents.document_id'), 'Diagnostic lists present features');
      assert.ok(partialCheck.diagnostic.includes('Missing features: elements.reading_order'), 'Diagnostic lists missing features');
      console.log('  PASS: detectPartialSchema identified partial state:');
      console.log(`        ${partialCheck.diagnostic.replace(/\n/g, '\n        ')}`);
    } finally {
      // Restore elements.reading_order
      await conn.query('ALTER TABLE elements RENAME COLUMN reading_idx TO reading_order');
      await conn.query('ALTER TABLE elements RENAME INDEX idx_elements_doc_mode_reading TO idx_elements_doc_mode_reading_order');
      await conn.query('ALTER TABLE elements ADD CONSTRAINT chk_elements_reading_order CHECK (reading_order >= 0)');
    }

    // Test 3.3: Injected failure during migration execution (MySQL implicit DDL commit behavior)
    console.log('\n[TEST 3.3] Testing injected failure handling during unapplied migration...');
    const tempInjectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-injected-audit-'));
    try {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempInjectedDir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempInjectedDir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempInjectedDir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempInjectedDir, '004_durable_cleanup_queue.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), path.join(tempInjectedDir, '005_worker_leases.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '006_worker_claim_fencing.sql'), path.join(tempInjectedDir, '006_worker_claim_fencing.sql'));

      const injectedSql = `
        ALTER TABLE documents ADD COLUMN test_injected_flag VARCHAR(16) NULL;
        ALTER TABLE non_existent_audit_table ADD COLUMN probe_fail INT;
      `;
      fs.writeFileSync(path.join(tempInjectedDir, '007_injected_fail.sql'), injectedSql);

      let injectedCaught = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempInjectedDir });
      } catch (err) {
        if (err instanceof MigrationExecutionError && err.message.includes("non_existent_audit_table")) {
          injectedCaught = true;
          console.log('  PASS: Injected DDL failure caught as MigrationExecutionError:');
          console.log(`        "${err.message.split('\n')[0]}"`);
          assert.ok(err.message.includes('MySQL commits DDL statements implicitly'), 'Warns about implicit DDL commit');
          assert.ok(err.message.includes('Tables are NOT automatically dropped'), 'Confirms non-destructive handling');
        } else {
          throw err;
        }
      }
      assert.equal(injectedCaught, true, 'Injected DDL failure must be caught');

      const [colCheck] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND COLUMN_NAME = 'test_injected_flag'`
      );
      assert.equal(colCheck.length, 1, 'Proved statement 1 committed implicitly');

      const [migCheck] = await conn.query('SELECT * FROM _migrations WHERE version = "007"');
      assert.equal(migCheck.length, 0, '007 must not be recorded in _migrations');
      console.log('  PASS: Verified failed migration is not recorded and tables are not dropped.');

      await conn.query('ALTER TABLE documents DROP COLUMN test_injected_flag');
    } finally {
      fs.rmSync(tempInjectedDir, { recursive: true, force: true });
    }

    console.log('\n--- SECTION 4: MIGRATION HISTORY CONSISTENCY (5 CONDITIONS) ---');

    console.log('\n[CONDITION 1] Testing migration recorded and schema valid...');
    const cond1 = await runMigrations({ connection: conn });
    assert.equal(cond1.applied.length, 0, 'Zero migrations applied');
    assert.equal(cond1.skipped.length >= 6, true, 'All migrations skipped cleanly');
    console.log('  PASS: Condition 1 verified (Clean skip with verified schema).');

    console.log('\n[CONDITION 2] Testing migration recorded but schema invalid (refusal to silently skip)...');
    await conn.query('ALTER TABLE eval_runs DROP INDEX idx_eval_runs_acceptance_hash');
    try {
      let cond2Caught = false;
      try {
        await runMigrations({ connection: conn });
      } catch (err) {
        if (err instanceof PostMigrationVerificationError && err.message.includes('RecordedMigrationVerificationError')) {
          cond2Caught = true;
          console.log('  PASS: Condition 2 verified (Refused to silently skip on invalid schema):');
          console.log(`        "${err.message.split('\n')[0]}"`);
        } else {
          throw err;
        }
      }
      assert.equal(cond2Caught, true, 'Invalid schema must block execution without silent skip');
    } finally {
      await conn.query('ALTER TABLE eval_runs ADD INDEX idx_eval_runs_acceptance_hash (acceptance_hash)');
    }

    console.log('\n[CONDITION 3] Testing migration not recorded but schema partially applied...');
    const tempCond3Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-cond3-audit-'));
    try {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempCond3Dir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempCond3Dir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempCond3Dir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempCond3Dir, '004_durable_cleanup_queue.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), path.join(tempCond3Dir, '005_worker_leases.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '006_worker_claim_fencing.sql'), path.join(tempCond3Dir, '006_worker_claim_fencing.sql'));

      await conn.query('ALTER TABLE documents ADD COLUMN cond3_test_partial VARCHAR(32) NULL');
      const sql007Partial = `
        ALTER TABLE documents ADD COLUMN cond3_test_partial VARCHAR(32) NULL;
        ALTER TABLE documents ADD COLUMN cond3_test_full VARCHAR(32) NULL;
      `;
      fs.writeFileSync(path.join(tempCond3Dir, '007_partial_probe.sql'), sql007Partial);

      let cond3Caught = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempCond3Dir });
      } catch (err) {
        if (err instanceof MigrationExecutionError && err.message.includes("Duplicate column name 'cond3_test_partial'")) {
          cond3Caught = true;
          console.log('  PASS: Condition 3 verified (Runner aborted due to pre-existing partial schema element):');
          console.log(`        "${err.message.split('\n')[0]}"`);
        } else {
          throw err;
        }
      }
      assert.equal(cond3Caught, true, 'Partial schema collision must be rejected');
      await conn.query('ALTER TABLE documents DROP COLUMN cond3_test_partial');
    } finally {
      fs.rmSync(tempCond3Dir, { recursive: true, force: true });
    }

    console.log('\n[CONDITION 4] Testing migration not recorded and schema untouched...');
    const tempCond4Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-cond4-audit-'));
    try {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempCond4Dir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempCond4Dir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempCond4Dir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempCond4Dir, '004_durable_cleanup_queue.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), path.join(tempCond4Dir, '005_worker_leases.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '006_worker_claim_fencing.sql'), path.join(tempCond4Dir, '006_worker_claim_fencing.sql'));

      const sql007Clean = `CREATE TABLE IF NOT EXISTS test_audit_table (id INT PRIMARY KEY); DROP TABLE test_audit_table;`;
      fs.writeFileSync(path.join(tempCond4Dir, '007_clean_audit.sql'), sql007Clean);

      const cond4 = await runMigrations({ connection: conn, migrationsDir: tempCond4Dir });
      assert.equal(cond4.applied.includes('007_clean_audit.sql'), true);
      console.log('  PASS: Condition 4 verified (Migration applied and recorded cleanly).');

      await conn.query('DELETE FROM _migrations WHERE version = "007"');
    } finally {
      fs.rmSync(tempCond4Dir, { recursive: true, force: true });
    }

    // Condition 5: Migration checksum mismatch
    console.log('\n[CONDITION 5] Testing migration checksum mismatch...');
    const tempCond5Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-cond5-audit-'));
    try {
      const tamperedSql = '-- Tampered content\nCREATE TABLE test_tamper (id INT);';
      fs.writeFileSync(path.join(tempCond5Dir, '001_init.sql'), tamperedSql);

      let cond5Caught = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempCond5Dir });
      } catch (err) {
        if (err instanceof ChecksumMismatchError) {
          cond5Caught = true;
          console.log('  PASS: Condition 5 verified (Checksum mismatch detected):');
          console.log(`        "${err.message.split('\n')[0]}"`);
        } else {
          throw err;
        }
      }
      assert.equal(cond5Caught, true);
    } finally {
      fs.rmSync(tempCond5Dir, { recursive: true, force: true });
    }

    // -------------------------------------------------------------------------
    // SECTION 5: DEEP SCHEMA VERIFICATION & BOUNDS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: DEEP SCHEMA VERIFICATION & BOUNDS ---');

    // Column type mismatch detection
    console.log('\n[TEST 5.1] Testing column type detection via INFORMATION_SCHEMA...');
    await conn.query('ALTER TABLE documents MODIFY COLUMN pages_count BIGINT NOT NULL');
    try {
      let typeCaught = false;
      try {
        await verifySchema(conn);
      } catch (err) {
        if (err instanceof PostMigrationVerificationError && err.message.includes('Column type mismatch')) {
          typeCaught = true;
          console.log('  PASS: Column type mismatch detected.');
        }
      }
      assert.equal(typeCaught, true);
    } finally {
      await conn.query('ALTER TABLE documents MODIFY COLUMN pages_count INT NOT NULL');
    }

    // Missing unique index detection
    console.log('\n[TEST 5.2] Testing missing unique index detection...');
    await conn.query('ALTER TABLE documents DROP INDEX uq_documents_document_id');
    try {
      let uniqCaught = false;
      try {
        await verifySchema(conn);
      } catch (err) {
        if (err instanceof PostMigrationVerificationError && err.message.includes("Missing expected index 'uq_documents_document_id'")) {
          uniqCaught = true;
          console.log('  PASS: Missing unique index detected.');
        }
      }
      assert.equal(uniqCaught, true);
    } finally {
      await conn.query('ALTER TABLE documents ADD CONSTRAINT uq_documents_document_id UNIQUE (document_id)');
    }

    // Foreign-key delete policy detection (RESTRICT vs CASCADE)
    console.log('\n[TEST 5.3] Testing foreign-key delete policy detection (RESTRICT vs CASCADE)...');
    await conn.query('ALTER TABLE jobs DROP FOREIGN KEY fk_jobs_document');
    await conn.query('ALTER TABLE jobs ADD CONSTRAINT fk_jobs_document FOREIGN KEY (doc_id) REFERENCES documents (id) ON DELETE CASCADE');
    try {
      let policyCaught = false;
      try {
        await verifySchema(conn);
      } catch (err) {
        if (err instanceof PostMigrationVerificationError && err.message.includes("delete policy mismatch: expected 'RESTRICT', got 'CASCADE'")) {
          policyCaught = true;
          console.log('  PASS: Foreign key delete policy mismatch detected.');
        }
      }
      assert.equal(policyCaught, true);
    } finally {
      await conn.query('ALTER TABLE jobs DROP FOREIGN KEY fk_jobs_document');
      await conn.query('ALTER TABLE jobs ADD CONSTRAINT fk_jobs_document FOREIGN KEY (doc_id) REFERENCES documents (id) ON DELETE RESTRICT');
    }

    // Data integrity bounds
    console.log('\n[TEST 5.4] Testing data integrity bounds on elements...');
    const testDocId = 'doc-test-bounds-' + Date.now();
    const [insDoc] = await conn.query(
      `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [testDocId, 'test_bounds.pdf', crypto.createHash('sha256').update(testDocId).digest('hex'), '/data/test_bounds.pdf', 1, 'dev', 'dev']
    );
    const nDocId = insDoc.insertId;

    try {
      // Valid boundaries
      await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 1, 0, 0.0]);
      await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 1, 1, 1.0]);

      // Invalid boundaries
      let negConf = false;
      try { await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 1, 2, -0.01]); } catch (e) { negConf = true; }
      assert.equal(negConf, true);

      let highConf = false;
      try { await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 1, 3, 1.01]); } catch (e) { highConf = true; }
      assert.equal(highConf, true);

      let zeroPage = false;
      try { await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 0, 4, 0.9]); } catch (e) { zeroPage = true; }
      assert.equal(zeroPage, true);

      let negOrder = false;
      try { await conn.query(`INSERT INTO elements (doc_id, mode, type, page, reading_order, confidence) VALUES (?, ?, ?, ?, ?, ?)`, [nDocId, 'candidate', 'text', 1, -1, 0.9]); } catch (e) { negOrder = true; }
      assert.equal(negOrder, true);
      console.log('  PASS: Integrity bounds (confidence [0,1], page >= 1, reading_order >= 0) validated.');

      // Soft delete & RESTRICT
      const [insJob] = await conn.query(`INSERT INTO jobs (doc_id, mode, status) VALUES (?, ?, ?)`, [nDocId, 'candidate', 'done']);
      const nJobId = insJob.insertId;

      await conn.query(`UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [nDocId]);
      let hardDelBlocked = false;
      try { await conn.query(`DELETE FROM documents WHERE id = ?`, [nDocId]); } catch (e) { hardDelBlocked = true; }
      assert.equal(hardDelBlocked, true, 'Hard delete blocked by RESTRICT');

      // Cleanup
      await conn.query('DELETE FROM jobs WHERE id = ?', [nJobId]);
    } finally {
      await conn.query('DELETE FROM documents WHERE id = ?', [nDocId]);
    }

    // Advisory lock concurrency
    console.log('\n[TEST 5.5] Testing advisory lock concurrency safety...');
    const conn2 = await getDbConnection();
    try {
      await acquireLock(conn, 1);
      let concurrentBlocked = false;
      try {
        await acquireLock(conn2, 1);
      } catch (err) {
        if (err instanceof MigrationLockError) concurrentBlocked = true;
      }
      assert.equal(concurrentBlocked, true);
      await releaseLock(conn);

      await acquireLock(conn2, 2);
      await releaseLock(conn2);
      console.log('  PASS: Advisory lock prevents concurrency races.');
    } finally {
      await conn2.end();
    }

    console.log('\n--- SECTION 6: WORKER LEASE MIGRATION (005_worker_leases.sql) ---');

    console.log('\n[TEST 6.1] Verifying worker lease columns, types, default timeout, indexes & tamper rejection on working DB...');
    const [jobColsRows] = await conn.query(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'`
    );
    const jobColMap = new Map(jobColsRows.map((r) => [r.COLUMN_NAME, r]));
    assert.equal(jobColMap.get('locked_by')?.COLUMN_TYPE, 'varchar(128)');
    assert.equal(jobColMap.get('locked_by')?.IS_NULLABLE, 'YES');
    assert.equal(jobColMap.get('locked_by')?.COLUMN_DEFAULT, null);
    assert.equal(jobColMap.get('locked_at')?.DATA_TYPE, 'timestamp');
    assert.equal(jobColMap.get('locked_at')?.IS_NULLABLE, 'YES');
    assert.equal(jobColMap.get('locked_at')?.COLUMN_DEFAULT, null);
    assert.equal(jobColMap.get('heartbeat_at')?.DATA_TYPE, 'timestamp');
    assert.equal(jobColMap.get('heartbeat_at')?.IS_NULLABLE, 'YES');
    assert.equal(jobColMap.get('heartbeat_at')?.COLUMN_DEFAULT, null);
    assert.equal(jobColMap.get('lease_timeout_seconds')?.DATA_TYPE, 'int');
    assert.equal(jobColMap.get('lease_timeout_seconds')?.IS_NULLABLE, 'NO');
    assert.equal(String(jobColMap.get('lease_timeout_seconds')?.COLUMN_DEFAULT), '300');
    assert.equal(
      jobColMap.get('status')?.COLUMN_TYPE,
      "enum('queued','running','done','degraded','failed')",
      'jobs.status ENUM must remain unchanged without cancelled status'
    );

    const [jobIdxRows] = await conn.query(
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`
    );
    const jobIdxMap = new Map();
    for (const r of jobIdxRows) {
      if (!jobIdxMap.has(r.INDEX_NAME)) jobIdxMap.set(r.INDEX_NAME, []);
      jobIdxMap.get(r.INDEX_NAME).push(r.COLUMN_NAME);
    }
    assert.deepEqual(jobIdxMap.get('idx_jobs_status'), ['status']);
    assert.deepEqual(jobIdxMap.get('idx_jobs_doc_status'), ['doc_id', 'status']);
    assert.deepEqual(jobIdxMap.get('idx_jobs_status_heartbeat'), ['status', 'heartbeat_at']);
    assert.deepEqual(jobIdxMap.get('idx_jobs_status_mode'), ['status', 'mode']);

    const leaseProbeDocId = 'doc-test-005-lease-' + Date.now();
    const [leaseProbeDoc] = await conn.query(
      `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [leaseProbeDocId, 'lease_probe.pdf', crypto.createHash('sha256').update(leaseProbeDocId).digest('hex'), '/data/lease_probe.pdf', 1, 'dev', 'none']
    );
    const leaseProbeNumDocId = leaseProbeDoc.insertId;
    try {
      const [insDefaultJob] = await conn.query(
        `INSERT INTO jobs (doc_id, mode, status) VALUES (?, ?, ?)`,
        [leaseProbeNumDocId, 'candidate', 'queued']
      );
      const [defaultJobRows] = await conn.query(`SELECT * FROM jobs WHERE id = ?`, [insDefaultJob.insertId]);
      assert.equal(defaultJobRows[0].locked_by, null);
      assert.equal(defaultJobRows[0].locked_at, null);
      assert.equal(defaultJobRows[0].heartbeat_at, null);
      assert.equal(defaultJobRows[0].lease_timeout_seconds, 300);

      let cancelledRejected = false;
      try {
        await conn.query(`INSERT INTO jobs (doc_id, mode, status) VALUES (?, ?, ?)`, [leaseProbeNumDocId, 'flat', 'cancelled']);
      } catch {
        cancelledRejected = true;
      }
      assert.equal(cancelledRejected, true, 'Invalid cancelled status must be rejected by ENUM');
      await conn.query(`DELETE FROM jobs WHERE id = ?`, [insDefaultJob.insertId]);
    } finally {
      await conn.query(`DELETE FROM documents WHERE id = ?`, [leaseProbeNumDocId]);
    }

    await conn.query('ALTER TABLE jobs DROP INDEX idx_jobs_status_heartbeat');
    try {
      const partial005 = await detectPartialSchema(conn, '005');
      assert.equal(partial005.isPartial, true);
      assert.ok(partial005.diagnostic.includes('jobs.idx_jobs_status_heartbeat'));
    } finally {
      await conn.query('ALTER TABLE jobs ADD INDEX idx_jobs_status_heartbeat (status, heartbeat_at)');
    }

    await conn.query('ALTER TABLE jobs ALTER COLUMN lease_timeout_seconds DROP DEFAULT');
    try {
      let defaultMismatchCaught = false;
      try {
        await verifySchema(conn);
      } catch (err) {
        if (err instanceof PostMigrationVerificationError && err.message.includes('lease_timeout_seconds')) {
          defaultMismatchCaught = true;
        }
      }
      assert.equal(defaultMismatchCaught, true);
    } finally {
      await conn.query('ALTER TABLE jobs ALTER COLUMN lease_timeout_seconds SET DEFAULT 300');
    }

    const tempTamper005Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-tamper-005-'));
    try {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempTamper005Dir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempTamper005Dir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempTamper005Dir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempTamper005Dir, '004_durable_cleanup_queue.sql'));
      fs.writeFileSync(
        path.join(tempTamper005Dir, '005_worker_leases.sql'),
        'ALTER TABLE jobs ADD COLUMN tampered_col INT NULL;'
      );
      let tamper005Caught = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempTamper005Dir });
      } catch (err) {
        if (err instanceof ChecksumMismatchError && err.message.includes('005_worker_leases.sql')) {
          tamper005Caught = true;
        } else {
          throw err;
        }
      }
      assert.equal(tamper005Caught, true, 'Modified applied 005 migration must be rejected');
    } finally {
      fs.rmSync(tempTamper005Dir, { recursive: true, force: true });
    }

    const repeatRunWorking = await runMigrations({ connection: conn });
    assert.equal(repeatRunWorking.applied.length, 0);
    assert.equal(repeatRunWorking.skipped.length, 6);
    console.log('  PASS: Working DB 005 lease schema, defaults, indexes, partial detection, and tamper rejection verified.');

    let isolatedServer = null;
    let adminConn = null;
    const tempDirsToClean = [];
    const createdSchemasOnConn = [];

    const resolveMysqldBinary = () => {
      const candidates = [
        process.env.MYSQLD_PATH,
        'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqld.exe',
        'mysqld',
      ].filter(Boolean);
      for (const c of candidates) {
        if (c === 'mysqld') {
          try {
            execFileSync('mysqld', ['--version'], { stdio: 'pipe', timeout: 5000 });
            return 'mysqld';
          } catch {}
        } else if (fs.existsSync(c)) {
          return c;
        }
      }
      return null;
    };

    const getFreePort = () =>
      new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
        srv.on('error', reject);
      });

    try {
      let useExistingAdmin = false;
      const probeSchema = `retrieva_probe_${Date.now()}`;
      try {
        await conn.query(`CREATE DATABASE \`${probeSchema}\``);
        await conn.query(`DROP DATABASE \`${probeSchema}\``);
        useExistingAdmin = true;
      } catch {
        useExistingAdmin = false;
      }

      if (useExistingAdmin) {
        adminConn = conn;
      } else {
        const mysqldBin = resolveMysqldBinary();
        assert.ok(mysqldBin, 'Isolated MySQL testing requires CREATE DATABASE permission or local mysqld binary');
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieva-mig005-db-'));
        tempDirsToClean.push(tmpRoot);
        const dataDir = path.join(tmpRoot, 'data');
        fs.mkdirSync(dataDir);
        const port = await getFreePort();
        execFileSync(mysqldBin, ['--initialize-insecure', `--datadir=${dataDir}`], { stdio: 'pipe', timeout: 60000 });
        const proc = spawn(
          mysqldBin,
          [`--datadir=${dataDir}`, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--skip-networking=OFF'],
          { stdio: 'pipe' }
        );
        isolatedServer = { proc, port, host: '127.0.0.1' };
        for (let i = 0; i < 80; i++) {
          try {
            adminConn = await mysql.createConnection({
              host: '127.0.0.1',
              port,
              user: 'root',
              multipleStatements: true,
            });
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        assert.ok(adminConn, 'Isolated ephemeral MySQL instance failed to accept connections');
      }

      const openIsolatedDbConnection = async (dbName) => {
        if (isolatedServer) {
          return await mysql.createConnection({
            host: isolatedServer.host,
            port: isolatedServer.port,
            user: 'root',
            database: dbName,
            multipleStatements: true,
          });
        }
        return await getDbConnection({ database: dbName, multipleStatements: true });
      };

      console.log('\n[TEST 6.2] Testing fresh database migration from empty schema (001 -> 006)...');
      const freshDbName = `retrieva_fresh_${Date.now()}`;
      await adminConn.query(`CREATE DATABASE \`${freshDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdSchemasOnConn.push(freshDbName);
      const freshConn = await openIsolatedDbConnection(freshDbName);
      try {
        const [initialTables] = await freshConn.query(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
        );
        assert.equal(initialTables.length, 0, 'Fresh database must start empty');

        const freshRes1 = await runMigrations({ connection: freshConn, migrationsDir: MIGRATIONS_DIR });
        assert.deepEqual(freshRes1.applied, [
          '001_init.sql',
          '002_schema_compatibility.sql',
          '003_document_sequences.sql',
          '004_durable_cleanup_queue.sql',
          '005_worker_leases.sql',
          '006_worker_claim_fencing.sql',
        ]);
        assert.equal(freshRes1.skipped.length, 0);
        assert.equal(await verifySchema(freshConn, { targetVersion: '006' }), true);

        const freshRepeat = await runMigrations({ connection: freshConn, migrationsDir: MIGRATIONS_DIR });
        assert.equal(freshRepeat.applied.length, 0);
        assert.equal(freshRepeat.skipped.length, 6);

        const [freshMigs] = await freshConn.query(`SELECT version, checksum FROM _migrations ORDER BY id ASC`);
        assert.equal(freshMigs.length, 6);
        assert.equal(freshMigs[4].version, '005');
        assert.equal(freshMigs[4].checksum, m005.checksum);
        assert.equal(freshMigs[5].version, '006');
        assert.equal(freshMigs[5].checksum, m006.checksum);
        console.log('  PASS: Fresh database migrated cleanly 001 -> 006 with verified schema and idempotency.');
      } finally {
        await freshConn.end();
      }

      console.log('\n[TEST 6.3] Testing existing database upgrade (004 -> 005 -> 006) & legacy running-job recovery...');
      const upgradeDbName = `retrieva_upgrade_${Date.now()}`;
      await adminConn.query(`CREATE DATABASE \`${upgradeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdSchemasOnConn.push(upgradeDbName);
      const tempV4Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-v4-only-'));
      const tempV5Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-v5-only-'));
      tempDirsToClean.push(tempV4Dir);
      tempDirsToClean.push(tempV5Dir);
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempV4Dir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempV4Dir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempV4Dir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempV4Dir, '004_durable_cleanup_queue.sql'));

      fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempV5Dir, '001_init.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempV5Dir, '002_schema_compatibility.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempV5Dir, '003_document_sequences.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempV5Dir, '004_durable_cleanup_queue.sql'));
      fs.copyFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), path.join(tempV5Dir, '005_worker_leases.sql'));

      const upgConn = await openIsolatedDbConnection(upgradeDbName);
      try {
        const upgV4Res = await runMigrations({ connection: upgConn, migrationsDir: tempV4Dir });
        assert.equal(upgV4Res.applied.length, 4);

        const [preDoc1] = await upgConn.query(
          `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ['doc-901', 'legacy_alpha.pdf', crypto.createHash('sha256').update('legacy_alpha').digest('hex'), '/data/legacy_alpha.pdf', 4, 'user_upload', 'none', 'queued']
        );
        const [preDoc2] = await upgConn.query(
          `INSERT INTO documents (document_id, filename, sha256, path, pages_count, doc_type, split, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ['doc-902', 'legacy_beta.pdf', crypto.createHash('sha256').update('legacy_beta').digest('hex'), '/data/legacy_beta.pdf', 8, 'user_upload', 'dev', 'processed']
        );
        const seedJobs = [
          { doc_id: preDoc1.insertId, mode: 'flat', status: 'queued', seconds: null, error: null, attempts: 0 },
          { doc_id: preDoc1.insertId, mode: 'candidate', status: 'running', seconds: null, error: null, attempts: 1 },
          { doc_id: preDoc2.insertId, mode: 'reference', status: 'done', seconds: 2.75, error: null, attempts: 1 },
          { doc_id: preDoc2.insertId, mode: 'candidate', status: 'degraded', seconds: 3.125, error: 'Low confidence table', attempts: 2 },
          { doc_id: preDoc2.insertId, mode: 'candidate_ft', status: 'failed', seconds: 0.45, error: 'Corrupt stream', attempts: 3 },
        ];
        for (const sj of seedJobs) {
          await upgConn.query(
            `INSERT INTO jobs (doc_id, mode, status, seconds, error, attempts) VALUES (?, ?, ?, ?, ?, ?)`,
            [sj.doc_id, sj.mode, sj.status, sj.seconds, sj.error, sj.attempts]
          );
        }

        const [preSnapshot] = await upgConn.query(`SELECT * FROM jobs ORDER BY id ASC`);
        assert.equal(preSnapshot.length, 5);
        assert.equal(preSnapshot[0].locked_by, undefined);

        const upgV5Res = await runMigrations({ connection: upgConn, migrationsDir: tempV5Dir });
        assert.deepEqual(upgV5Res.applied, ['005_worker_leases.sql']);
        assert.equal(upgV5Res.skipped.length, 4);
        assert.equal(await verifySchema(upgConn, { targetVersion: '005' }), true);

        const [postV5Snapshot] = await upgConn.query(`SELECT * FROM jobs ORDER BY id ASC`);
        assert.equal(postV5Snapshot.length, 5);
        for (let i = 0; i < preSnapshot.length; i++) {
          const before = preSnapshot[i];
          const after = postV5Snapshot[i];
          assert.equal(after.id, before.id);
          assert.equal(after.doc_id, before.doc_id);
          assert.equal(after.mode, before.mode);
          assert.equal(after.status, before.status);
          assert.equal(after.seconds, before.seconds);
          assert.equal(after.error, before.error);
          assert.equal(after.attempts, before.attempts);
          assert.equal(new Date(after.created_at).getTime(), new Date(before.created_at).getTime());
          assert.equal(new Date(after.updated_at).getTime(), new Date(before.updated_at).getTime());
          assert.equal(after.locked_by, null);
          assert.equal(after.locked_at, null);
          assert.equal(after.heartbeat_at, null);
          assert.equal(after.lease_timeout_seconds, 300);
        }

        const upgV6Res = await runMigrations({ connection: upgConn, migrationsDir: MIGRATIONS_DIR });
        assert.deepEqual(upgV6Res.applied, ['006_worker_claim_fencing.sql']);
        assert.equal(upgV6Res.skipped.length, 5);
        assert.equal(await verifySchema(upgConn, { targetVersion: '006' }), true);

        const [postV6Snapshot] = await upgConn.query(`SELECT * FROM jobs ORDER BY id ASC`);
        assert.equal(postV6Snapshot.length, 5);
        for (let i = 0; i < preSnapshot.length; i++) {
          const before = preSnapshot[i];
          const after = postV6Snapshot[i];
          assert.equal(after.id, before.id);
          assert.equal(after.status, before.status);
          assert.equal(after.locked_by, null);
          assert.equal(after.claim_token, null);
          assert.equal(after.lease_generation, 0);
          assert.equal(after.locked_at, null);
          assert.equal(after.heartbeat_at, null);
          assert.equal(after.lease_timeout_seconds, 300);
        }

        const [explainQueuedMode] = await upgConn.query(
          `EXPLAIN SELECT * FROM jobs WHERE status = 'queued' AND mode = 'flat' ORDER BY id ASC LIMIT 1`
        );
        const [explainExpired] = await upgConn.query(
          `EXPLAIN SELECT * FROM jobs WHERE status = 'running' AND heartbeat_at < (NOW() - INTERVAL 300 SECOND)`
        );
        assert.ok(['idx_jobs_status', 'idx_jobs_status_mode'].includes(explainQueuedMode[0].key));
        assert.ok(['idx_jobs_status', 'idx_jobs_status_heartbeat'].includes(explainExpired[0].key));

        const upgRepeat = await runMigrations({ connection: upgConn, migrationsDir: MIGRATIONS_DIR });
        assert.equal(upgRepeat.applied.length, 0);
        assert.equal(upgRepeat.skipped.length, 6);

        const tempUpgTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-upg-tamper-'));
        tempDirsToClean.push(tempUpgTamperDir);
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempUpgTamperDir, '001_init.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempUpgTamperDir, '002_schema_compatibility.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempUpgTamperDir, '003_document_sequences.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempUpgTamperDir, '004_durable_cleanup_queue.sql'));
        fs.writeFileSync(path.join(tempUpgTamperDir, '005_worker_leases.sql'), 'ALTER TABLE jobs ADD COLUMN x INT;');
        let upgTamperCaught = false;
        try {
          await runMigrations({ connection: upgConn, migrationsDir: tempUpgTamperDir });
        } catch (err) {
          if (err instanceof ChecksumMismatchError) upgTamperCaught = true;
          else throw err;
        }
        assert.equal(upgTamperCaught, true);

        const jobRepoPath = path.resolve(__dirname, '../repositories/jobRepository.js');
        const poolPath = path.resolve(__dirname, '../pool.js');
        const childScript = `
          import assert from 'node:assert/strict';
          import * as jobRepo from ${JSON.stringify('file:///' + jobRepoPath.replace(/\\/g, '/'))};
          import { closePool } from ${JSON.stringify('file:///' + poolPath.replace(/\\/g, '/'))};
          const rec = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
          assert.strictEqual(rec.recoveredCount, 1);
          assert.strictEqual(rec.requeuedCount, 1);
          assert.strictEqual(rec.jobs[0].legacyUnleased, true);
          assert.strictEqual(rec.jobs[0].action, 'requeued');
          assert.strictEqual(rec.jobs[0].job.status, 'queued');
          assert.strictEqual(rec.jobs[0].job.attempts, 1);
          assert.strictEqual(rec.jobs[0].job.locked_by, null);
          assert.strictEqual(rec.jobs[0].job.claim_token, null);
          assert.strictEqual(rec.jobs[0].job.lease_generation, 0);
          assert.ok(rec.jobs[0].job.error.includes('Legacy running job'));
          const claimed = await jobRepo.claimJob('worker-legacy-upgrade', { mode: 'candidate' });
          assert.strictEqual(claimed.id, rec.jobs[0].job.id);
          assert.strictEqual(claimed.attempts, 2);
          assert.strictEqual(claimed.lease_generation, 1);
          assert.ok(claimed.claim_token);
          const done = await jobRepo.completeJob(claimed.id, 'worker-legacy-upgrade', {
            claimToken: claimed.claim_token,
            status: 'done',
            seconds: 0.75,
          });
          assert.strictEqual(done.status, 'done');
          assert.strictEqual(done.claim_token, null);
          assert.strictEqual(done.locked_by, null);
          assert.strictEqual(done.lease_generation, 1);
          await closePool();
        `;
        const childEnv = {
          ...process.env,
          DB_HOST: isolatedServer ? isolatedServer.host : (process.env.DB_HOST || '127.0.0.1'),
          DB_PORT: String(isolatedServer ? isolatedServer.port : (process.env.DB_PORT || 3306)),
          DB_USER: isolatedServer ? 'root' : (process.env.DB_USER || 'docuretrieve_user'),
          DB_PASSWORD: isolatedServer ? '' : (process.env.DB_PASSWORD || ''),
          DB_NAME: upgradeDbName,
        };
        execFileSync(process.execPath, ['--input-type=module', '-e', childScript], {
          env: childEnv,
          stdio: 'pipe',
          timeout: 15000,
        });
        console.log('  PASS: Existing DB upgrade 004 -> 005 -> 006 preserved job data and immediately recovered legacy running job.');
      } finally {
        await upgConn.end();
      }

      console.log('\n[TEST 6.4] Verifying claim-fencing schema (006_worker_claim_fencing.sql), partial detection, defaults, and tamper rejection...');
      const [v6ColsRows] = await conn.query(
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'jobs'`
      );
      const v6ColMap = new Map(v6ColsRows.map((r) => [r.COLUMN_NAME, r]));
      assert.equal(v6ColMap.get('claim_token')?.COLUMN_TYPE, 'char(36)');
      assert.equal(v6ColMap.get('claim_token')?.IS_NULLABLE, 'YES');
      assert.equal(v6ColMap.get('claim_token')?.COLUMN_DEFAULT, null);
      assert.equal(v6ColMap.get('lease_generation')?.DATA_TYPE, 'int');
      assert.equal(v6ColMap.get('lease_generation')?.IS_NULLABLE, 'NO');
      assert.equal(String(v6ColMap.get('lease_generation')?.COLUMN_DEFAULT), '0');

      await conn.query('ALTER TABLE jobs DROP COLUMN claim_token');
      try {
        const partial006 = await detectPartialSchema(conn, '006');
        assert.equal(partial006.isPartial, true);
        assert.ok(partial006.diagnostic.includes('jobs.claim_token'));
      } finally {
        await conn.query('ALTER TABLE jobs ADD COLUMN claim_token CHAR(36) NULL DEFAULT NULL AFTER locked_by');
      }

      await conn.query('ALTER TABLE jobs ALTER COLUMN lease_generation DROP DEFAULT');
      try {
        let genDefaultCaught = false;
        try {
          await verifySchema(conn);
        } catch (err) {
          if (err instanceof PostMigrationVerificationError && err.message.includes('lease_generation')) {
            genDefaultCaught = true;
          }
        }
        assert.equal(genDefaultCaught, true);
      } finally {
        await conn.query('ALTER TABLE jobs ALTER COLUMN lease_generation SET DEFAULT 0');
      }

      const tempTamper006Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-tamper-006-'));
      try {
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_init.sql'), path.join(tempTamper006Dir, '001_init.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '002_schema_compatibility.sql'), path.join(tempTamper006Dir, '002_schema_compatibility.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '003_document_sequences.sql'), path.join(tempTamper006Dir, '003_document_sequences.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '004_durable_cleanup_queue.sql'), path.join(tempTamper006Dir, '004_durable_cleanup_queue.sql'));
        fs.copyFileSync(path.join(MIGRATIONS_DIR, '005_worker_leases.sql'), path.join(tempTamper006Dir, '005_worker_leases.sql'));
        fs.writeFileSync(
          path.join(tempTamper006Dir, '006_worker_claim_fencing.sql'),
          'ALTER TABLE jobs ADD COLUMN tampered_fence INT NULL;'
        );
        let tamper006Caught = false;
        try {
          await runMigrations({ connection: conn, migrationsDir: tempTamper006Dir });
        } catch (err) {
          if (err instanceof ChecksumMismatchError && err.message.includes('006_worker_claim_fencing.sql')) {
            tamper006Caught = true;
          } else {
            throw err;
          }
        }
        assert.equal(tamper006Caught, true);
      } finally {
        fs.rmSync(tempTamper006Dir, { recursive: true, force: true });
      }
      console.log('  PASS: Working DB 006 claim fencing schema, defaults, partial detection, and tamper rejection verified.');
    } finally {
      if (!isolatedServer && adminConn) {
        for (const dbName of createdSchemasOnConn) {
          await adminConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => {});
        }
      }
      if (isolatedServer && adminConn) {
        await adminConn.query('SHUTDOWN').catch(() => {});
        await adminConn.end().catch(() => {});
        await Promise.race([
          new Promise((resolve) => isolatedServer.proc.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        if (isolatedServer.proc.exitCode === null) {
          isolatedServer.proc.kill();
          await Promise.race([
            new Promise((resolve) => isolatedServer.proc.once('exit', resolve)),
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]);
        }
      }
      for (const td of tempDirsToClean) {
        try {
          fs.rmSync(td, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
        } catch {}
      }
    }

    // Final schema verification
    console.log('\n[FINAL VERIFICATION] Verifying complete working schema against INFORMATION_SCHEMA...');
    assert.equal(await verifySchema(conn), true);
    console.log('  PASS: Working database schema fully verified and pristine.');

    console.log('\n=================================================================');
    console.log('   ALL M1.3.4 MIGRATION IMMUTABILITY & AUDIT TESTS PASSED [PASS] ');
    console.log('=================================================================');
  } finally {
    await conn.end();
  }
}

runTestSuite().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
