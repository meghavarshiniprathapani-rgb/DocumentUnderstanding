/**
 * Retrieva AI — Repository Layer Integration Test Suite (AIML-59 / M1.5)
 * 
 * Verifications:
 * 1. Document Repository:
 *    - Creation, lookup by ID / document_id / SHA-256, pagination, sorting.
 *    - Duplicate SHA-256 and duplicate document_id handling with DuplicateDocumentError.
 *    - Soft deletion (deleted_at), exclusion from standard queries, and restoration.
 *    - Status updating.
 * 2. Element Repository:
 *    - Bulk transactional insertion across all 4 modes ('flat', 'reference', 'candidate', 'candidate_ft').
 *    - Retrieval by document, page, and mode with deterministic reading_order.
 *    - Deep JSON preservation (bbox, structured table data, provenance, flags).
 *    - Validation of confidence ([0, 1]), page (>= 1), reading_order (>= 0), mode, and type.
 *    - Transaction rollback on bulk insert failure (all-or-nothing atomicity).
 *    - Selective mode deletion and element counting.
 * 3. Job Repository:
 *    - Job creation and status tracking ('queued', 'running', 'done', 'degraded', 'failed').
 *    - Concurrency protection: multiple concurrent workers competing for queued jobs via row-level locking.
 *    - Non-destructive audit preservation when parent document is soft-deleted.
 *    - Retry attempt incrementing.
 * 4. Evaluation Repository:
 *    - Recording evaluation run with config_hash, model_versions, split, hashes, and KPI telemetry.
 *    - Lookup by ID, latest run retrieval by split, and paginated listing.
 * 5. Security & Robustness:
 *    - SQL injection resistance on parameterized repository methods.
 *    - Guaranteed connection release in finally blocks across errors and failures.
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { query, getConnection, closePool, resetPool } from '../pool.js';
import * as documentRepo from '../repositories/documentRepository.js';
import * as elementRepo from '../repositories/elementRepository.js';
import * as jobRepo from '../repositories/jobRepository.js';
import * as evalRepo from '../repositories/evaluationRepository.js';
import { jobTestAdapter } from './jobTestAdapter.js';

// Explicitly enable test environment
process.env.NODE_ENV = 'test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

let passedTests = 0;
let totalTests = 0;

function reportTest(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  PASS: [${name}] ${detail}`);
  } else {
    console.error(`  FAIL: [${name}] ${detail}`);
  }
}

async function cleanRepositoryTestData() {
  // Clean up any test fixtures created by this suite without dropping tables
  await query(`DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-repo-%')`);
  await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-repo-%')`);
  await query(`DELETE FROM documents WHERE document_id LIKE 'test-repo-%'`);
  await query(`DELETE FROM eval_runs WHERE config_hash LIKE 'test_eval_config_%' OR config_hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'`);
}

async function runRepositoryTestSuite() {
  console.log('=================================================================');
  console.log('    RETRIEVA AI — M1.5 REPOSITORY LAYER INTEGRATION SUITE        ');
  console.log('=================================================================\n');

  try {
    await resetPool();
    await cleanRepositoryTestData();

    // =========================================================================
    // SECTION 1: DOCUMENT REPOSITORY VERIFICATIONS
    // =========================================================================
    console.log('--- SECTION 1: DOCUMENT REPOSITORY ---');

    // 1.1 Document Creation & Numeric/String ID Preservation
    const doc1 = await documentRepo.createDocument({
      document_id: 'test-repo-doc-001',
      filename: 'sample_contract_alpha.pdf',
      sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      path: '/data/sample_documents/sample_contract_alpha.pdf',
      pages_count: 3,
      doc_type: 'contract',
      split: 'ac3',
      status: 'ready',
      metadata: { original_author: 'Legal Team', extraction_priority: 'high' },
    });

    assert(doc1.id > 0, 'Document must receive auto-increment BIGINT id');
    assert.strictEqual(doc1.document_id, 'test-repo-doc-001');
    assert.strictEqual(doc1.pages_count, 3);
    assert.strictEqual(doc1.metadata.original_author, 'Legal Team');
    reportTest('TEST 1.1: Document Creation', true, `Created document id=${doc1.id}, document_id='${doc1.document_id}'`);

    // 1.2 Lookup Methods (by ID, document_id, and SHA-256)
    const foundById = await documentRepo.findById(doc1.id);
    assert.strictEqual(foundById.document_id, 'test-repo-doc-001');

    const foundByDocId = await documentRepo.findByDocumentId('test-repo-doc-001');
    assert.strictEqual(foundByDocId.id, doc1.id);

    const foundBySha = await documentRepo.findBySha256(doc1.sha256);
    assert.strictEqual(foundBySha.id, doc1.id);
    reportTest('TEST 1.2: Document Lookups', true, 'Successfully retrieved by numeric id, document_id, and sha256');

    // 1.3 Duplicate SHA-256 Enforcement
    let dupShaCaught = false;
    try {
      await documentRepo.createDocument({
        document_id: 'test-repo-doc-002',
        filename: 'sample_duplicate.pdf',
        sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', // Identical hash
        path: '/data/sample_documents/sample_duplicate.pdf',
      });
    } catch (err) {
      if (err instanceof documentRepo.DuplicateDocumentError) {
        dupShaCaught = true;
      }
    }
    assert(dupShaCaught, 'Duplicate SHA-256 must throw DuplicateDocumentError');
    reportTest('TEST 1.3: Duplicate Hash Enforcement', true, 'Duplicate SHA-256 rejected with DuplicateDocumentError');

    // 1.4 Soft Deletion and Exclusion from Ordinary Queries
    const softDeleted = await documentRepo.softDelete(doc1.id);
    assert.strictEqual(softDeleted, true, 'softDelete must return true');

    const lookupAfterDelete = await documentRepo.findById(doc1.id);
    assert.strictEqual(lookupAfterDelete, null, 'Ordinary findById must exclude soft-deleted record');

    const lookupWithDeleted = await documentRepo.findById(doc1.id, { includeDeleted: true });
    assert(lookupWithDeleted !== null, 'findById with includeDeleted must return record');
    assert(lookupWithDeleted.deleted_at !== null, 'deleted_at must be populated timestamp');
    reportTest('TEST 1.4: Soft Deletion Audit', true, 'Soft-deleted record excluded from standard queries; audit preserved');

    // 1.5 Restoration of Soft-Deleted Document
    const restored = await documentRepo.restore(doc1.id);
    assert.strictEqual(restored, true, 'restore must return true');

    const lookupAfterRestore = await documentRepo.findById(doc1.id);
    assert(lookupAfterRestore !== null, 'Restored document must be visible in ordinary queries');
    assert.strictEqual(lookupAfterRestore.deleted_at, null, 'deleted_at must be reset to null');
    reportTest('TEST 1.5: Document Restoration', true, 'Restored document visible again with deleted_at = null');

    // 1.6 Pagination and Listing
    // Create 2 additional documents for pagination test
    await documentRepo.createDocument({
      document_id: 'test-repo-doc-002',
      filename: 'file_beta.pdf',
      sha256: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      path: '/data/beta.pdf',
      split: 'ac3',
    });
    await documentRepo.createDocument({
      document_id: 'test-repo-doc-003',
      filename: 'file_gamma.pdf',
      sha256: 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
      path: '/data/gamma.pdf',
      split: 'dev',
    });

    const page1 = await documentRepo.listDocuments({ limit: 2, offset: 0, orderDirection: 'ASC' });
    assert(page1.documents.length <= 2, 'Page size must adhere to limit');
    assert(page1.total >= 3, 'Total count must reflect existing records');

    const ac3Filtered = await documentRepo.listDocuments({ split: 'ac3' });
    assert(ac3Filtered.documents.every((d) => d.split === 'ac3'), 'Filtered list must only return split=ac3');
    reportTest('TEST 1.6: Pagination & Filtering', true, `Pagination returned ${page1.documents.length} items; split filter verified`);

    // 1.7 Status Update
    const updatedDoc = await documentRepo.updateStatus(doc1.id, 'processed');
    assert.strictEqual(updatedDoc.status, 'processed');
    reportTest('TEST 1.7: Status Update', true, "Document status updated to 'processed'");

    // =========================================================================
    // SECTION 2: ELEMENT REPOSITORY VERIFICATIONS
    // =========================================================================
    console.log('\n--- SECTION 2: ELEMENT REPOSITORY ---');

    // 2.1 Bulk Transactional Insertion Across Modes
    const elementsToInsert = [
      {
        doc_id: doc1.id,
        mode: 'flat',
        type: 'heading',
        page: 1,
        reading_order: 0,
        text: 'Executive Summary',
        bbox: [50, 720, 500, 750],
        structured: null,
        confidence: 0.99,
        provenance: { extractor: 'pdfplumber', version: '0.11' },
        flags: ['is_section_header'],
        model_version: 'pdfplumber-0.11.0',
      },
      {
        doc_id: doc1.id,
        mode: 'flat',
        type: 'text',
        page: 1,
        reading_order: 1,
        text: 'This document specifies the architecture migration parameters.',
        bbox: [50, 680, 500, 715],
        structured: null,
        confidence: 0.95,
        provenance: { extractor: 'pdfplumber', version: '0.11' },
        flags: null,
        model_version: 'pdfplumber-0.11.0',
      },
      {
        doc_id: doc1.id,
        mode: 'candidate',
        type: 'table',
        page: 2,
        reading_order: 0,
        text: 'Quarterly Metric Summary',
        bbox: [50, 400, 500, 600],
        structured: {
          headers: ['Metric', 'Baseline', 'Target'],
          rows: [
            ['Accuracy', '0.92', '0.95'],
            ['Latency', '120ms', '80ms'],
          ],
        },
        confidence: 0.98,
        provenance: { extractor: 'docling', version: '2.0.0' },
        flags: ['table_grid_detected'],
        model_version: 'docling-2.0.0',
      },
      {
        doc_id: doc1.id,
        mode: 'reference',
        type: 'heading',
        page: 1,
        reading_order: 0,
        text: 'Executive Summary Ground Truth',
        bbox: [50, 720, 500, 750],
        confidence: 1.0,
      },
    ];

    const bulkResult = await elementRepo.bulkInsert(elementsToInsert);
    assert.strictEqual(bulkResult.insertedCount, 4);
    reportTest('TEST 2.1: Bulk Insert Across Modes', true, `Inserted 4 elements across 'flat', 'candidate', 'reference' modes`);

    // 2.2 Retrieval and JSON Preservation
    const flatElements = await elementRepo.findByDocumentAndMode(doc1.id, 'flat');
    assert.strictEqual(flatElements.length, 2);
    assert.strictEqual(flatElements[0].reading_order, 0);
    assert.strictEqual(flatElements[1].reading_order, 1);
    assert.deepStrictEqual(flatElements[0].bbox, [50, 720, 500, 750]);
    assert.deepStrictEqual(flatElements[0].flags, ['is_section_header']);

    const tableElements = await elementRepo.findByDocumentAndMode(doc1.id, 'candidate');
    assert.strictEqual(tableElements.length, 1);
    assert.strictEqual(tableElements[0].type, 'table');
    assert.deepStrictEqual(tableElements[0].structured.headers, ['Metric', 'Baseline', 'Target']);
    assert.strictEqual(tableElements[0].structured.rows.length, 2);
    reportTest('TEST 2.2: Element JSON Preservation', true, 'Deep structured JSON (table headers/rows, bbox, flags) preserved 100%');

    // 2.3 Retrieval by Document ID String & Page
    const page2Elements = await elementRepo.findByPage('test-repo-doc-001', 2);
    assert.strictEqual(page2Elements.length, 1);
    assert.strictEqual(page2Elements[0].type, 'table');
    reportTest('TEST 2.3: Retrieval by External document_id & Page', true, 'findByPage resolved external document_id string seamlessly');

    // 2.4 Pre-insertion Bounds Validation
    let invalidConfidenceCaught = false;
    try {
      await elementRepo.bulkInsert([
        {
          doc_id: doc1.id,
          mode: 'flat',
          type: 'text',
          page: 1,
          reading_order: 0,
          confidence: 1.5, // Invalid > 1.0
        },
      ]);
    } catch (err) {
      if (err instanceof elementRepo.ElementValidationError) {
        invalidConfidenceCaught = true;
      }
    }
    assert(invalidConfidenceCaught, 'Confidence > 1.0 must be rejected with ElementValidationError');

    let invalidPageCaught = false;
    try {
      await elementRepo.bulkInsert([
        {
          doc_id: doc1.id,
          mode: 'flat',
          type: 'text',
          page: 0, // Invalid < 1
          reading_order: 0,
          confidence: 0.9,
        },
      ]);
    } catch (err) {
      if (err instanceof elementRepo.ElementValidationError) {
        invalidPageCaught = true;
      }
    }
    assert(invalidPageCaught, 'Page < 1 must be rejected with ElementValidationError');
    reportTest('TEST 2.4: Element Constraint Validation', true, 'Invalid confidence (1.5) and page (0) rejected by validation layer');

    // 2.5 Transaction Rollback on Bulk Insertion Failure
    const countBeforeRollback = await elementRepo.countByDocument(doc1.id);
    let rollbackCaught = false;
    try {
      await elementRepo.bulkInsert([
        {
          doc_id: doc1.id,
          mode: 'flat',
          type: 'text',
          page: 3,
          reading_order: 0,
          confidence: 0.8,
        },
        {
          doc_id: doc1.id,
          mode: 'invalid_mode_xyz', // triggers validation error
          type: 'text',
          page: 3,
          reading_order: 1,
          confidence: 0.8,
        },
      ]);
    } catch {
      rollbackCaught = true;
    }
    assert(rollbackCaught, 'Invalid batch must throw error');
    const countAfterRollback = await elementRepo.countByDocument(doc1.id);
    assert.strictEqual(countBeforeRollback, countAfterRollback, 'Count must remain identical after rollback');
    reportTest('TEST 2.5: Transaction Rollback Atomicity', true, 'Batch insertion failed atomically; zero partial records written');

    // 2.6 Mode Deletion
    const deletedCandidateCount = await elementRepo.deleteByDocumentAndMode(doc1.id, 'candidate');
    assert.strictEqual(deletedCandidateCount, 1);
    const candidateRemaining = await elementRepo.findByDocumentAndMode(doc1.id, 'candidate');
    assert.strictEqual(candidateRemaining.length, 0);
    const flatRemaining = await elementRepo.findByDocumentAndMode(doc1.id, 'flat');
    assert.strictEqual(flatRemaining.length, 2, 'Flat mode elements must remain untouched');
    reportTest('TEST 2.6: Selective Mode Deletion', true, 'Deleted candidate mode elements without disturbing flat mode elements');

    // 2.7 Multi-Arm Mode Isolation (all 4 modes)
    await elementRepo.bulkInsert([
      { doc_id: doc1.id, mode: 'candidate', type: 'text', page: 1, reading_order: 2, confidence: 0.9 },
      { doc_id: doc1.id, mode: 'candidate_ft', type: 'text', page: 1, reading_order: 0, confidence: 0.95 },
    ]);
    const flatCount = await elementRepo.countByDocument(doc1.id, { mode: 'flat' });
    const refCount = await elementRepo.countByDocument(doc1.id, { mode: 'reference' });
    const candCount = await elementRepo.countByDocument(doc1.id, { mode: 'candidate' });
    const ftCount = await elementRepo.countByDocument(doc1.id, { mode: 'candidate_ft' });

    assert.strictEqual(flatCount, 2);
    assert.strictEqual(refCount, 1);
    assert.strictEqual(candCount, 1);
    assert.strictEqual(ftCount, 1);
    reportTest('TEST 2.7: Multi-Arm Mode Isolation', true, 'All 4 modes (flat, reference, candidate, candidate_ft) verified disjoint');

    // =========================================================================
    // SECTION 3: JOB REPOSITORY VERIFICATIONS
    // =========================================================================
    console.log('\n--- SECTION 3: JOB REPOSITORY ---');

    // 3.1 Job Creation
    const job1 = await jobRepo.createJob({
      doc_id: doc1.id,
      mode: 'reference',
      status: 'queued',
    });
    assert(job1.id > 0);
    assert.strictEqual(job1.status, 'queued');
    assert.strictEqual(job1.attempts, 0);
    reportTest('TEST 3.1: Job Creation', true, `Created queued job id=${job1.id}`);

    // 3.2 Atomic Job Claiming (Row-Level Locking)
    const claimedJob = await jobRepo.claimJob('worker-node-1');
    assert(claimedJob !== null);
    assert.strictEqual(claimedJob.id, job1.id);
    assert.strictEqual(claimedJob.status, 'running');
    assert.strictEqual(claimedJob.attempts, 1);
    reportTest('TEST 3.2: Atomic Job Claiming', true, 'Worker-node-1 claimed job; status transitioned to running, attempts=1');

    // 3.3 Status Update & Execution Time
    const finishedJob = await jobRepo.updateStatus(job1.id, 'done', {
      seconds: 1.45,
      error: null,
    });
    assert.strictEqual(finishedJob.status, 'done');
    assert.strictEqual(finishedJob.seconds, 1.45);
    reportTest('TEST 3.3: Job Status Update', true, "Job updated to 'done' with seconds=1.45");

    // 3.4 Increment Attempts
    const attemptsCount = await jobRepo.incrementAttempts(job1.id);
    assert.strictEqual(attemptsCount, 2);
    reportTest('TEST 3.4: Increment Attempts', true, 'Attempts successfully incremented to 2');

    // 3.5 Concurrent Workers Claiming Race Condition Test
    // Create exactly ONE queued job
    const raceJob = await jobRepo.createJob({
      doc_id: doc1.id,
      mode: 'candidate',
      status: 'queued',
    });

    // Launch 5 workers competing for that single queued job simultaneously
    const claimPromises = Array.from({ length: 5 }, (_, i) =>
      jobRepo.claimJob(`competitor-worker-${i}`)
    );
    const claimResults = await Promise.all(claimPromises);

    // Exactly one worker must have claimed the job, other 4 must receive null
    const successfulClaims = claimResults.filter((r) => r !== null);
    const nullClaims = claimResults.filter((r) => r === null);

    assert.strictEqual(successfulClaims.length, 1, 'Exactly one worker must succeed in claiming the job');
    assert.strictEqual(nullClaims.length, 4, 'Remaining workers must receive null');
    assert.strictEqual(successfulClaims[0].id, raceJob.id);
    reportTest(
      'TEST 3.5: Concurrent Worker Race Protection',
      true,
      '5 concurrent workers competed for 1 job: exactly 1 claimed, 4 safely returned null (zero race condition)'
    );

    // 3.6 Job History Preservation on Document Soft Deletion
    await documentRepo.softDelete(doc1.id);
    const jobsForSoftDeleted = await jobRepo.findByDocument(doc1.id);
    assert(jobsForSoftDeleted.length >= 2, 'Job audit records must persist intact after parent document is soft-deleted');
    await documentRepo.restore(doc1.id); // restore for remainder of test
    reportTest('TEST 3.6: Job Audit History Preservation', true, 'Job records preserved untouched when parent document was soft-deleted');

    // 3.7 SKIP LOCKED Multi-Worker Concurrency (True Parallelism)
    // Create 3 queued jobs simultaneously
    const pJob1 = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    const pJob2 = await jobRepo.createJob({ doc_id: doc1.id, mode: 'reference', status: 'queued' });
    const pJob3 = await jobRepo.createJob({ doc_id: doc1.id, mode: 'candidate', status: 'queued' });

    // 3 parallel workers invoke claimJob concurrently
    const [c1, c2, c3] = await Promise.all([
      jobRepo.claimJob('worker-A'),
      jobRepo.claimJob('worker-B'),
      jobRepo.claimJob('worker-C'),
    ]);

    assert(c1 && c2 && c3, 'All 3 concurrent workers must claim a job using SKIP LOCKED');
    const claimedIds = new Set([c1.id, c2.id, c3.id]);
    assert.strictEqual(claimedIds.size, 3, 'All 3 workers must claim distinct jobs without colliding');
    assert(claimedIds.has(pJob1.id) && claimedIds.has(pJob2.id) && claimedIds.has(pJob3.id));
    reportTest(
      'TEST 3.7: SKIP LOCKED Multi-Worker Parallelism',
      true,
      '3 parallel workers simultaneously claimed 3 distinct jobs using row-level locks with SKIP LOCKED (skipping locked rows rather than blocking)'
    );

    // 3.8 Retry Policy Verification (retryJob)
    const testRetryJob = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    await jobRepo.claimJob('worker-retry');
    await jobRepo.updateStatus(testRetryJob.id, 'failed', { error: 'OOM simulated error' });

    // Attempt 1 < maxAttempts 3 -> should be retryable
    const retry1 = await jobRepo.retryJob(testRetryJob.id, { maxAttempts: 3 });
    assert.strictEqual(retry1.retryable, true);
    assert.strictEqual(retry1.job.status, 'queued');
    assert.strictEqual(retry1.job.error, null);

    // Simulate exceeding max attempts
    await jobRepo.incrementAttempts(testRetryJob.id); // attempts = 2
    await jobRepo.incrementAttempts(testRetryJob.id); // attempts = 3
    await jobRepo.updateStatus(testRetryJob.id, 'failed', { error: 'Fatal failure' });

    const retryExceeded = await jobRepo.retryJob(testRetryJob.id, { maxAttempts: 3 });
    assert.strictEqual(retryExceeded.retryable, false);
    assert.strictEqual(retryExceeded.job.status, 'failed');
    reportTest(
      'TEST 3.8: Explicit Retry Policy',
      true,
      'Jobs with attempts < 3 retry cleanly; jobs with attempts >= 3 remain in terminal failure'
    );

    // 3.9 Deterministic Overlapping Transactions via jobTestAdapter
    // Create two queued jobs: jobAlpha and jobBeta
    const jobAlpha = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    const jobBeta = await jobRepo.createJob({ doc_id: doc1.id, mode: 'reference', status: 'queued' });

    let workerAStarted = false;
    let workerBClaimResult = null;

    // Worker A invokes the isolated test adapter jobTestAdapter.claimJobWithHook().
    // While Worker A's transaction holds the row-level lock on jobAlpha,
    // the test hook invokes Worker B's standard production jobRepo.claimJob() repository method directly!
    const workerAClaimResult = await jobTestAdapter.claimJobWithHook('worker-A', {}, {
      afterLock: async (lockedJobA) => {
        workerAStarted = true;
        assert.strictEqual(lockedJobA.id, jobAlpha.id, 'Worker A must lock jobAlpha first');

        // Worker B executes standard production claimJob() concurrently while Worker A's transaction is actively open
        workerBClaimResult = await jobRepo.claimJob('worker-B');
      },
    });

    assert(workerAStarted, 'Worker A test hook must have executed');
    assert(workerBClaimResult, 'Worker B must have successfully claimed a job via production API');
    assert.strictEqual(workerAClaimResult.id, jobAlpha.id, 'Worker A must claim jobAlpha');
    assert.strictEqual(workerBClaimResult.id, jobBeta.id, 'Worker B must skip jobAlpha and claim jobBeta');
    assert.strictEqual(workerAClaimResult.claimedBy, 'worker-A');
    assert.strictEqual(workerBClaimResult.claimedBy, 'worker-B');

    // Verify database state: both jobs claimed, exactly 1 attempt each, no duplicate claims
    const dbJobAlpha = await jobRepo.findById(jobAlpha.id);
    const dbJobBeta = await jobRepo.findById(jobBeta.id);
    assert.strictEqual(dbJobAlpha.status, 'running');
    assert.strictEqual(dbJobBeta.status, 'running');
    assert.strictEqual(dbJobAlpha.attempts, 1);
    assert.strictEqual(dbJobBeta.attempts, 1);
    reportTest(
      'TEST 3.9: Deterministic Overlapping Transactions via jobTestAdapter',
      true,
      'Worker B skipped Worker A locked jobAlpha and claimed jobBeta via production claimJob() while Worker A transaction was actively open'
    );

    // 3.10 Repository Claim Rollback and Connection Release on Failure via jobTestAdapter
    const failJob = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    let hookExecuted = false;

    await assert.rejects(
      async () => {
        await jobTestAdapter.claimJobWithHook('worker-fail', {}, {
          afterLock: async (lockedJob) => {
            hookExecuted = true;
            assert.strictEqual(lockedJob.id, failJob.id);
            throw new Error('Simulated failure during claim transaction');
          },
        });
      },
      /Simulated failure during claim transaction/,
      'claimJobWithHook must reject when test hook throws'
    );

    assert(hookExecuted, 'Test hook must execute prior to failure');
    const postFailCheck = await jobRepo.findById(failJob.id);
    assert.strictEqual(postFailCheck.status, 'queued', 'Job must remain queued following transaction rollback');
    assert.strictEqual(postFailCheck.attempts, 0, 'Attempts must remain 0 following rollback');
    // Clean up failJob state
    await jobRepo.updateStatus(failJob.id, 'done');

    // Verify connection was released by checking pool is responsive
    const pingConn = await getConnection();
    pingConn.release();
    reportTest(
      'TEST 3.10: Rollback on Claim Failure via jobTestAdapter',
      true,
      'Failed claim transaction rolled back cleanly; job remained queued with 0 attempts and connection was released'
    );

    // 3.11 Worker Ownership Limitation Verification
    const ownJob = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    const claimedOwn = await jobRepo.claimJob('worker-audit-diag-777');
    assert.strictEqual(claimedOwn.id, ownJob.id);
    assert.strictEqual(claimedOwn.claimedBy, 'worker-audit-diag-777', 'In-memory entity contains diagnostic claimedBy');

    // Query raw MySQL row from INFORMATION_SCHEMA / direct SQL
    const [rawRows] = await query(`SELECT * FROM jobs WHERE id = ?`, [ownJob.id]);
    const rawJob = rawRows[0];
    assert.strictEqual(rawJob.claimedBy, undefined, 'Database table MUST NOT have claimedBy column');
    assert.strictEqual(rawJob.worker_id, undefined, 'Database table MUST NOT have worker_id column');
    reportTest(
      'TEST 3.11: Worker Ownership Schema Limitation',
      true,
      'Verified workerId is strictly an in-memory diagnostic on returned entity; no unmigrated worker_id column exists in MySQL'
    );

    // 3.12 Production Callback Isolation
    // Verify that production claimJob() completely ignores arbitrary callbacks and cannot execute them while holding a row lock
    const safeJob = await jobRepo.createJob({ doc_id: doc1.id, mode: 'flat', status: 'queued' });
    let arbitraryCallbackExecuted = false;

    const claimedSafe = await jobRepo.claimJob('worker-safe', {
      _testHookAfterLock: () => { arbitraryCallbackExecuted = true; },
      afterLock: () => { arbitraryCallbackExecuted = true; },
      beforeCommit: () => { arbitraryCallbackExecuted = true; },
    });

    assert.strictEqual(claimedSafe.id, safeJob.id);
    assert.strictEqual(arbitraryCallbackExecuted, false, 'Production claimJob MUST NOT execute any caller-supplied callbacks');
    reportTest(
      'TEST 3.12: Production Callback Isolation',
      true,
      'Production claimJob API stripped user-supplied callbacks; no arbitrary callbacks can execute while database row lock is held'
    );

    // 3.13 Fail-Closed Test Adapter Guard
    // Verify that test adapter strictly rejects if NODE_ENV is set to production
    process.env.NODE_ENV = 'production';
    await assert.rejects(
      async () => {
        await jobTestAdapter.claimJobWithHook('worker-prod-fail');
      },
      /_executeClaimJobForTest is strictly disabled outside of explicit test environments/,
      'jobTestAdapter must fail closed when NODE_ENV is production'
    );
    process.env.NODE_ENV = 'test';
    reportTest(
      'TEST 3.13: Fail-Closed Test Adapter Guard',
      true,
      'jobTestAdapter strictly failed closed when NODE_ENV=production; test bridge cannot be executed in production'
    );

    // =========================================================================
    // SECTION 4: EVALUATION REPOSITORY VERIFICATIONS
    // =========================================================================
    console.log('\n--- SECTION 4: EVALUATION REPOSITORY ---');

    // 4.1 Evaluation Run Creation with Provenance
    const evalRun1 = await evalRepo.createRun({
      config_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // valid 64-char SHA-256
      model_versions: {
        docling: '2.0.0',
        pdfplumber: '0.11.0',
        fastapi: '0.115.0',
      },
      split: 'ac3',
      dataset_split_hash: 'dataset_hash_ac3_frozen_8765432109876543210987654321098765432109',
      acceptance_hash: 'acceptance_hash_lock_1122334455667788990011223344556677889900',
      kpi: {
        extraction_f1: 0.942,
        reading_order_acc: 0.978,
        table_f1: 0.915,
        latency_p95_ms: 142.5,
      },
      status: 'completed',
    });

    assert(evalRun1.id > 0);
    assert.strictEqual(evalRun1.split, 'ac3');
    assert.strictEqual(evalRun1.kpi.extraction_f1, 0.942);
    assert.strictEqual(evalRun1.model_versions.docling, '2.0.0');
    reportTest('TEST 4.1: Evaluation Run Recording', true, `Recorded evaluation run id=${evalRun1.id} with frozen provenance hashes`);

    // 4.2 Lookup by ID & Latest Run Retrieval
    const foundEval = await evalRepo.findById(evalRun1.id);
    assert.strictEqual(foundEval.config_hash, evalRun1.config_hash);

    const latestAc3 = await evalRepo.getLatestRun('ac3');
    assert.strictEqual(latestAc3.id, evalRun1.id);

    const runList = await evalRepo.listRuns({ split: 'ac3', limit: 10 });
    assert(runList.runs.length >= 1);
    assert.strictEqual(runList.runs[0].split, 'ac3');
    reportTest('TEST 4.2: Evaluation Run Queries', true, 'getLatestRun and listRuns returned exact provenance and KPI data');

    // 4.3 Canonical 6 Charter KPI Representation
    const expectedCharterKeys = [
      'reading_order_acc',
      'table_structure_fidelity',
      'downstream_retrieval_acc',
      'critical_scene_failure_rate',
      'cross_condition_gap',
      'inference_latency_ms',
    ];
    assert.deepStrictEqual(
      [...evalRepo.CHARTER_KPI_KEYS].sort(),
      expectedCharterKeys.sort(),
      'CHARTER_KPI_KEYS must contain exactly the 6 canonical charter dimensions'
    );
    assert(
      !evalRepo.CHARTER_KPI_KEYS.includes('formula_extraction_match_rate'),
      'formula_extraction_match_rate must NOT be in CHARTER_KPI_KEYS'
    );
    assert(
      !evalRepo.CHARTER_KPI_KEYS.includes('audit_lineage_coverage'),
      'audit_lineage_coverage must NOT be in CHARTER_KPI_KEYS'
    );
    assert(
      evalRepo.IMPLEMENTATION_METRIC_KEYS.includes('formula_extraction_match_rate'),
      'formula_extraction_match_rate must be classified as implementation metric'
    );
    assert(
      evalRepo.IMPLEMENTATION_METRIC_KEYS.includes('audit_lineage_coverage'),
      'audit_lineage_coverage must be classified as implementation metric'
    );
    reportTest(
      'TEST 4.3: Canonical 6 Charter KPI Representation',
      true,
      'Charter KPI set represents exactly the 6 canonical dimensions from the acceptance report'
    );

    // 4.4 Namespace Separation & Overwrite Prevention
    // Verify that passing an implementation metric in charter throws an error
    assert.throws(
      () => {
        evalRepo.formatKpiPayload({
          charter: {
            reading_order_acc: 1.0,
            formula_extraction_match_rate: 0.95, // ILLEGAL in charter namespace!
          },
        });
      },
      /formula_extraction_match_rate.*implementation metric/,
      'formatKpiPayload must reject implementation metrics inside charter namespace'
    );

    assert.throws(
      () => {
        evalRepo.formatKpiPayload({
          charter: {
            reading_order_acc: 1.0,
            audit_lineage_coverage: 100.0, // ILLEGAL in charter namespace!
          },
        });
      },
      /audit_lineage_coverage.*implementation metric/,
      'formatKpiPayload must reject audit_lineage_coverage inside charter namespace'
    );

    // Verify validateCharterKpiSet rejects missing charter metrics when required
    assert.throws(
      () => {
        evalRepo.validateCharterKpiSet(
          {
            reading_order_acc: 1.0,
            table_structure_fidelity: 1.0,
            downstream_retrieval_acc: 87.1,
            // missing critical_scene_failure_rate, cross_condition_gap, inference_latency_ms
          },
          { requireAll: true }
        );
      },
      /Missing required canonical charter KPI/,
      'Missing charter metrics must not be silently omitted or replaced'
    );
    reportTest(
      'TEST 4.4: Namespace Separation & Overwrite Prevention',
      true,
      'Implementation metrics cannot overwrite charter KPIs and missing charter KPIs cannot be silently substituted'
    );

    // 4.5 Full Acceptance Evaluation Run Recording with Reconciled Statistical Consistency
    const structuredKpi = evalRepo.formatKpiPayload({
      charter: {
        reading_order_acc: 1.0,
        table_structure_fidelity: 1.0,
        downstream_retrieval_acc: 87.1,
        critical_scene_failure_rate: 0.0, // authoritative measured value: 0.000 (0.0% silent failure)
        cross_condition_gap: 0.017, // authoritative measured value: 0.017 (1.7% degradation gap)
        inference_latency_ms: 1.37, // authoritative measured value: 1.37 ms p95 query retrieval latency
      },
      confidence_intervals: {
        reading_order_acc: [1.0, 1.0],
        table_structure_fidelity: [1.0, 1.0],
        downstream_retrieval_acc: [79.4, 93.7],
        critical_scene_failure_rate: [0.0, 0.0],
        cross_condition_gap: [0.0, 0.02],
        inference_latency_ms: {
          interval: [0.77, 0.83],
          statistic: 'mean', // Reconciled M1.5.4: CI is over sample mean, NOT p95
          illustrative: true, // Marked illustrative when presented alongside p95
          sample_count: 270,
          percentile_method: 'nearest_rank',
          bootstrap_resamples: 1000,
          confidence_level: 0.95,
        },
      },
      implementation: {
        formula_extraction_match_rate: 1.0,
        audit_lineage_coverage: 100.0,
        faiss_search_ms: 0.45, // subsystem vector search kept strictly separate from e2e inference_latency_ms
        cache_hit_rate: 0.88,
        peak_rss_mb: 310.5,
      },
      raw: {
        num_queries_evaluated: 50,
        warm_trials_count: 270,
        measurement_boundary: 'retriever_final.retrieve(q, top_k=5)',
      },
    });

    const evalRun2 = await evalRepo.createRun({
      config_hash: 'f4c1d55309fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999',
      model_versions: { docling: '2.0.0', pdfplumber: '0.11.0' },
      split: 'ac3',
      dataset_split_hash: 'dataset_hash_ac3_frozen_8765432109876543210987654321098765432109',
      acceptance_hash: 'acceptance_hash_lock_1122334455667788990011223344556677889900',
      kpi: structuredKpi,
      status: 'completed',
    });

    const retrievedEval2 = await evalRepo.findById(evalRun2.id);
    assert(retrievedEval2.kpi.charter, 'Charter KPI subtree must exist');
    assert(retrievedEval2.kpi.implementation, 'Implementation metric subtree must exist');
    assert.strictEqual(retrievedEval2.kpi.charter.reading_order_acc, 1.0);
    assert.strictEqual(retrievedEval2.kpi.charter.table_structure_fidelity, 1.0);
    assert.strictEqual(retrievedEval2.kpi.charter.downstream_retrieval_acc, 87.1);
    assert.strictEqual(retrievedEval2.kpi.charter.critical_scene_failure_rate, 0.0);
    assert.strictEqual(retrievedEval2.kpi.charter.cross_condition_gap, 0.017);
    assert.strictEqual(retrievedEval2.kpi.charter.inference_latency_ms, 1.37);
    assert.deepStrictEqual(retrievedEval2.kpi.charter.confidence_intervals.downstream_retrieval_acc, [79.4, 93.7]);

    // Verify statistical reconciliation on inference latency CI
    const latCiObj = retrievedEval2.kpi.charter.confidence_intervals.inference_latency_ms;
    assert.strictEqual(latCiObj.statistic, 'mean', 'Statistical attribute must reflect sample mean');
    assert.strictEqual(latCiObj.illustrative, true, 'Must be marked illustrative when presented alongside p95');
    assert.deepStrictEqual(latCiObj.interval, [0.77, 0.83]);
    assert.strictEqual(latCiObj.sample_count, 270);

    // Verify implementation metrics are isolated
    assert.strictEqual(retrievedEval2.kpi.implementation.formula_extraction_match_rate, 1.0);
    assert.strictEqual(retrievedEval2.kpi.implementation.audit_lineage_coverage, 100.0);
    assert.strictEqual(retrievedEval2.kpi.implementation.faiss_search_ms, 0.45);
    assert.strictEqual(retrievedEval2.kpi.implementation.cache_hit_rate, 0.88);
    assert.strictEqual(retrievedEval2.kpi.raw.num_queries_evaluated, 50);
    assert.strictEqual(retrievedEval2.kpi.raw.warm_trials_count, 270);
    reportTest(
      'TEST 4.5: Reconciled Statistical Telemetry & Full Charter Run Recording',
      true,
      'All 6 charter KPIs, reconciled bootstrap CI metadata, raw observations, and isolated implementation metrics persisted intact'
    );

    // =========================================================================
    // SECTION 5: SECURITY & RESILIENCE VERIFICATIONS
    // =========================================================================
    console.log('\n--- SECTION 5: SECURITY & RESILIENCE ---');

    // 5.1 SQL Injection Resistance
    const sqlInjectionPayload = "'; DROP TABLE documents; SELECT * FROM documents WHERE '1'='1";
    const injectionResult = await documentRepo.findByDocumentId(sqlInjectionPayload);
    assert.strictEqual(injectionResult, null, 'SQL injection string must be safely evaluated as literal string');

    const injectionSplitList = await documentRepo.listDocuments({ split: "' OR '1'='1" });
    assert.strictEqual(injectionSplitList.documents.length, 0, 'Injected split clause must return zero records');
    reportTest('TEST 5.1: SQL Injection Resistance', true, 'Parameterized queries strictly neutralized SQL injection payloads');

    // 5.2 Connection Release After Failures
    // Trigger intentional error in repository method
    try {
      await documentRepo.createDocument({
        document_id: 'test-repo-doc-001', // duplicate ID error
        filename: 'another.pdf',
        sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        path: '/tmp/test.pdf',
      });
    } catch {
      // expected duplicate error
    }

    // Immediately execute 10 queries through the pool to verify connection was released
    for (let i = 0; i < 10; i++) {
      const doc = await documentRepo.findByDocumentId('test-repo-doc-001');
      assert(doc !== null);
    }
    reportTest('TEST 5.2: Connection Release On Failure', true, 'Pool fully available and leak-free following repository exceptions');

    // Teardown test data
    await cleanRepositoryTestData();
    await closePool();

    console.log('\n=================================================================');
    console.log(`   ALL M1.5 REPOSITORY TESTS PASSED: ${passedTests} / ${totalTests} [PASS] `);
    console.log('=================================================================\n');
  } catch (err) {
    console.error('\nUNHANDLED EXCEPTION IN REPOSITORY TEST SUITE:', err);
    await closePool().catch(() => {});
    process.exit(1);
  }
}

runRepositoryTestSuite();
