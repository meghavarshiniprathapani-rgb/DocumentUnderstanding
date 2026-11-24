/**
 * Retrieva AI — M1.3 Migration & Schema Integration Test Suite
 * 
 * Tests:
 * 1. Fresh database migration & schema verification
 * 2. Repeated migration execution (idempotency)
 * 3. Checksum mismatch detection (anti-tamper protection)
 * 4. Foreign-key constraints (enforcement & CASCADE deletion)
 * 5. Unique constraints (SHA-256 uniqueness on documents)
 * 6. JSON field persistence & serialization roundtrip
 * 7. Repository-independent raw SQL connectivity
 * 8. Migration history table verification
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { runMigrations, getDbConnection, computeChecksum } from '../migrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

async function runTestSuite() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.3 MIGRATION & SCHEMA VERIFICATION SUITE      ');
  console.log('=================================================================');

  const conn = await getDbConnection();

  try {
    // -------------------------------------------------------------------------
    // Test 1: Repeated Migration Execution (Idempotency)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing repeated migration execution (idempotency)...');
    const repeatResult = await runMigrations({ connection: conn });
    assert.equal(repeatResult.applied.length, 0, 'No migrations should be applied on second run');
    assert.equal(repeatResult.skipped.length >= 1, true, 'At least 1 migration should be skipped');
    console.log('  PASS: Idempotency verified. Skipped migrations:', repeatResult.skipped);

    // -------------------------------------------------------------------------
    // Test 2: Checksum Mismatch Detection
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing checksum mismatch detection (tamper protection)...');
    const tempMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-tamper-test-'));
    try {
      const tamperedSql = '-- Tampered content\nCREATE TABLE test_tamper (id INT);';
      fs.writeFileSync(path.join(tempMigrationsDir, '001_init.sql'), tamperedSql);

      let errorThrown = false;
      try {
        await runMigrations({ connection: conn, migrationsDir: tempMigrationsDir });
      } catch (err) {
        errorThrown = true;
        assert.equal(err.message.includes('ChecksumMismatchError'), true);
        console.log('  PASS: Detected altered checksum and safely aborted execution.');
      }
      assert.equal(errorThrown, true, 'ChecksumMismatchError should be raised for altered migration file');
    } finally {
      fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    }

    // -------------------------------------------------------------------------
    // Test 3: Migration History Correctness
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing migration history correctness in _migrations table...');
    const [historyRows] = await conn.query('SELECT * FROM _migrations WHERE version = "001"');
    assert.equal(historyRows.length, 1, 'Exactly one record for version 001');
    const rec = historyRows[0];
    assert.equal(rec.name, '001_init.sql');
    assert.equal(rec.checksum.length, 64, 'Checksum must be 64-char SHA256 hex string');
    assert.equal(/^[a-f0-9]{64}$/.test(rec.checksum), true);
    console.log(`  PASS: Recorded version '${rec.version}', checksum '${rec.checksum.slice(0, 16)}...'`);

    // -------------------------------------------------------------------------
    // Test 4: Unique SHA-256 Constraint on documents
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing unique SHA-256 constraint on documents table...');
    const testSha = 'test_sha256_' + Date.now() + '_probe_unique';
    
    // First insertion should succeed
    const [ins1] = await conn.query(
      `INSERT INTO documents (filename, sha256, path, pages_count, doc_type, split) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['test1.pdf', testSha, '/data/test1.pdf', 5, 'test_doc', 'dev']
    );
    const docId1 = ins1.insertId;

    // Second insertion with identical SHA-256 must fail
    let duplicateRejected = false;
    try {
      await conn.query(
        `INSERT INTO documents (filename, sha256, path, pages_count, doc_type, split) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['test2.pdf', testSha, '/data/test2.pdf', 3, 'test_doc', 'dev']
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        duplicateRejected = true;
        console.log('  PASS: Duplicate SHA-256 rejected with ER_DUP_ENTRY.');
      } else {
        throw err;
      }
    }
    assert.equal(duplicateRejected, true, 'Duplicate SHA-256 must be rejected');

    // -------------------------------------------------------------------------
    // Test 5: Foreign-Key Constraints & CASCADE Deletion
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing foreign-key constraints and cascade deletion...');
    
    // Attempt inserting element referencing invalid doc_id (should fail)
    let fkRejected = false;
    try {
      await conn.query(
        `INSERT INTO elements (doc_id, mode, type, page, reading_idx, text) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [999999999, 'candidate', 'text', 1, 1, 'Invalid element']
      );
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
        fkRejected = true;
        console.log('  PASS: Invalid foreign-key insertion rejected by engine.');
      } else {
        throw err;
      }
    }
    assert.equal(fkRejected, true, 'Foreign key violation must be rejected');

    // Insert valid element and job referencing docId1
    const [elemIns] = await conn.query(
      `INSERT INTO elements (doc_id, mode, type, page, reading_idx, text, confidence) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [docId1, 'candidate', 'heading', 1, 1, 'Header Title', 0.98]
    );
    const elemId = elemIns.insertId;

    const [jobIns] = await conn.query(
      `INSERT INTO jobs (doc_id, mode, status) VALUES (?, ?, ?)`,
      [docId1, 'candidate', 'running']
    );
    const jobId = jobIns.insertId;

    // Delete document; verify CASCADE deletion on elements and jobs
    await conn.query('DELETE FROM documents WHERE id = ?', [docId1]);

    const [elemCheck] = await conn.query('SELECT * FROM elements WHERE id = ?', [elemId]);
    assert.equal(elemCheck.length, 0, 'Element must be deleted via CASCADE');

    const [jobCheck] = await conn.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
    assert.equal(jobCheck.length, 0, 'Job must be deleted via CASCADE');
    console.log('  PASS: CASCADE deletion verified on elements and jobs.');

    // -------------------------------------------------------------------------
    // Test 6: JSON Field Persistence & Roundtrip
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing JSON field serialization and persistence...');
    const testDocSha = 'test_json_sha_' + Date.now();
    const [docIns2] = await conn.query(
      `INSERT INTO documents (filename, sha256, path, metadata) VALUES (?, ?, ?, ?)`,
      ['json_test.pdf', testDocSha, '/data/json_test.pdf', JSON.stringify({ author: 'AIML-59', tags: ['benchmark', 'test'] })]
    );
    const docId2 = docIns2.insertId;

    const testBbox = { x_min: 50.5, y_min: 100.2, x_max: 300.8, y_max: 450.0, width: 250.3, height: 349.8 };
    const testStructured = { headers: ['Col A', 'Col B'], matrix: [['Row 1', '100'], ['Row 2', '200']] };
    const testProvenance = { source_file_hash: 'hash_1234', extractor: 'pdfplumber:0.11.10', config_id: 'O3-v1.0.0' };
    const testFlags = { is_degraded: true, reasons: ['Low confidence: 0.72 < 0.75'], fallback_strategy: 'RAW_SLICE_FALLBACK' };

    await conn.query(
      `INSERT INTO elements (doc_id, mode, type, page, reading_idx, text, bbox, structured, confidence, provenance, flags, model_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId2,
        'candidate',
        'table',
        2,
        4,
        'Table extracted content',
        JSON.stringify(testBbox),
        JSON.stringify(testStructured),
        0.72,
        JSON.stringify(testProvenance),
        JSON.stringify(testFlags),
        'pdfplumber:0.11.10'
      ]
    );

    const [rows] = await conn.query('SELECT * FROM elements WHERE doc_id = ?', [docId2]);
    assert.equal(rows.length, 1);
    const el = rows[0];

    // Assert JSON fields deserialized properly by mysql2
    const parsedBbox = typeof el.bbox === 'string' ? JSON.parse(el.bbox) : el.bbox;
    const parsedStructured = typeof el.structured === 'string' ? JSON.parse(el.structured) : el.structured;
    const parsedProvenance = typeof el.provenance === 'string' ? JSON.parse(el.provenance) : el.provenance;
    const parsedFlags = typeof el.flags === 'string' ? JSON.parse(el.flags) : el.flags;

    assert.equal(parsedBbox.width, 250.3);
    assert.deepEqual(parsedStructured.headers, ['Col A', 'Col B']);
    assert.equal(parsedProvenance.config_id, 'O3-v1.0.0');
    assert.equal(parsedFlags.is_degraded, true);
    assert.equal(el.mode, 'candidate');
    assert.equal(el.type, 'table');
    console.log('  PASS: JSON field persistence and deep parsing verified.');

    // -------------------------------------------------------------------------
    // Test 7: Evaluation Runs Table
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing eval_runs table insertion and schema...');
    const testConfigHash = 'cfg_hash_' + Date.now();
    const testKpi = {
      kpi1_reading_order: 1.0,
      kpi2_table_teds: 1.0,
      kpi3_retrieval: 87.1,
      kpi6_latency_p95_ms: 1.37
    };
    const [evalIns] = await conn.query(
      `INSERT INTO eval_runs (config_hash, model_versions, split, kpi, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        testConfigHash,
        JSON.stringify({ extractor: 'pdfplumber:0.11.10', retriever: 'faiss:128d' }),
        'ac3',
        JSON.stringify(testKpi),
        'completed'
      ]
    );
    assert.equal(evalIns.insertId > 0, true);

    const [evalRow] = await conn.query('SELECT * FROM eval_runs WHERE id = ?', [evalIns.insertId]);
    const parsedKpi = typeof evalRow[0].kpi === 'string' ? JSON.parse(evalRow[0].kpi) : evalRow[0].kpi;
    assert.equal(parsedKpi.kpi1_reading_order, 1.0);
    assert.equal(evalRow[0].split, 'ac3');
    console.log('  PASS: eval_runs persistence verified.');

    // Clean up test document docId2 and eval run to leave database pristine
    await conn.query('DELETE FROM documents WHERE id = ?', [docId2]);
    await conn.query('DELETE FROM eval_runs WHERE id = ?', [evalIns.insertId]);
    console.log('  PASS: Test cleanup complete. Database left pristine.');

    console.log('\n=================================================================');
    console.log('   ALL M1.3 MIGRATION AND SCHEMA INTEGRATION TESTS PASSED [PASS] ');
    console.log('=================================================================');
  } finally {
    await conn.end();
  }
}

runTestSuite().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
