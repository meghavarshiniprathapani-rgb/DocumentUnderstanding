import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { app } from '../app.js';
import { config } from '../config.js';
import { startServer, stopServer } from '../server.js';
import { query, closePool, resetPool, getConnection, getDedicatedConnection } from '../db/pool.js';
import * as documentRepository from '../db/repositories/documentRepository.js';
import * as jobRepository from '../db/repositories/jobRepository.js';
import { jobTestAdapter } from '../db/tests/jobTestAdapter.js';
import {
  getTempUploadDir,
  getUploadDir,
  allocateNextDocumentId,
  safeUnlinkFile,
  ensureSequenceTable,
  resetSequenceForTest
} from '../utils/uploadHelpers.js';
import { retryFailedCleanups } from '../utils/cleanupQueue.js';
import { _setTestDeleteHook } from '../routes/documents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';

const TEST_PORT = 3097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_UPLOAD_DIR = path.resolve(__dirname, '../../../data/uploads/test_m163');
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;

let totalTests = 0;
let passedTests = 0;

function reportTest(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  PASS: [${name}] ${detail}`);
  } else {
    console.error(`  FAIL: [${name}] ${detail}`);
  }
}

function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildMultipartPayload(parts, boundary = '----WebKitFormBoundaryM163TestBoundary') {
  const buffers = [];
  for (const part of parts) {
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="${part.fieldname}"`;
    if (part.filename) {
      header += `; filename="${part.filename}"`;
    }
    header += '\r\n';
    if (part.contentType) {
      header += `Content-Type: ${part.contentType}\r\n`;
    } else if (part.filename && part.filename.endsWith('.pdf')) {
      header += 'Content-Type: application/pdf\r\n';
    }
    header += '\r\n';
    buffers.push(Buffer.from(header, 'utf8'));
    if (Buffer.isBuffer(part.content)) {
      buffers.push(part.content);
    } else if (part.content !== undefined) {
      buffers.push(Buffer.from(String(part.content), 'utf8'));
    }
    buffers.push(Buffer.from('\r\n', 'utf8'));
  }
  buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(buffers)
  };
}

async function makeRequest(requestPath, options = {}) {
  const url = new URL(requestPath, BASE_URL);
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body;

  if (!headers['Connection']) {
    headers['Connection'] = 'close';
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent: false }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          rawBody: rawData
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function cleanTestData() {
  await query(
    `DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-m163-%' OR path LIKE '%test_m163%')`
  );
  await query(
    `DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-m163-%' OR path LIKE '%test_m163%')`
  );
  await query(
    `DELETE FROM documents WHERE document_id LIKE 'test-m163-%' OR path LIKE '%test_m163%'`
  );
  try {
    await query(`DELETE FROM cleanup_queue WHERE file_path LIKE '%test_m163%'`);
  } catch {}

  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    const files = fs.readdirSync(TEST_UPLOAD_DIR);
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(TEST_UPLOAD_DIR, f));
      } catch {}
    }
  }
  const tempDir = getTempUploadDir();
  if (fs.existsSync(tempDir)) {
    const tempFiles = fs.readdirSync(tempDir);
    for (const f of tempFiles) {
      try {
        fs.unlinkSync(path.join(tempDir, f));
      } catch {}
    }
  }
}

async function runUploadLifecycleTestSuite() {
  console.log('=================================================================');
  console.log('    RETRIEVA AI — M1.6.3.2 UPLOAD & DOCUMENT LIFECYCLE SUITE      ');
  console.log('=================================================================\n');

  try {
    await resetPool();
    if (!fs.existsSync(TEST_UPLOAD_DIR)) {
      fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
    }
    const tempUploadDir = getTempUploadDir();
    if (!fs.existsSync(tempUploadDir)) {
      fs.mkdirSync(tempUploadDir, { recursive: true });
    }
    await cleanTestData();

    console.log('--- SECTION 1: SERVER STARTUP ---');
    await startServer(TEST_PORT, '127.0.0.1');
    reportTest('TEST 1.1: Server Startup', true, `Express listening on 127.0.0.1:${TEST_PORT}`);

    console.log('\n--- SECTION 2: SINGLE DOCUMENT UPLOAD (VALID & VERIFIED) ---');
    const validPdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n150\n%%EOF'
    );

    const singleUpload = buildMultipartPayload([
      { fieldname: 'file', filename: 'alpha_report.pdf', content: validPdfBuffer }
    ]);

    const uploadRes1 = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': singleUpload.contentType,
        'X-Document-Id': 'test-m163-doc-001'
      },
      body: singleUpload.body
    });

    assert.strictEqual(uploadRes1.status, 201);
    assert.strictEqual(uploadRes1.body.status, 'success');
    assert.strictEqual(uploadRes1.body.config_version, '1.0.0');
    assert.strictEqual(uploadRes1.body.data.document_id, 'test-m163-doc-001');
    assert.strictEqual(uploadRes1.body.data.filename, 'alpha_report.pdf');
    assert(uploadRes1.body.data.status === 'queued' || uploadRes1.body.data.status === 'Queued');
    assert.strictEqual(uploadRes1.body.data.extraction_status, 'Queued');
    assert.strictEqual(uploadRes1.body.data.indexing_status, 'Pending');
    assert.strictEqual(uploadRes1.body.data.id, undefined);
    assert(uploadRes1.body.message.includes('queued'));

    const diskFiles = fs.readdirSync(TEST_UPLOAD_DIR);
    assert(diskFiles.some((f) => f.includes('test-m163-doc-001')));
    reportTest('TEST 2.1: Valid Single PDF Upload', true, 'Document uploaded, stored on disk, queued in MySQL, returned 201');

    const dbDoc = await documentRepository.findByDocumentId('test-m163-doc-001');
    assert(dbDoc !== null);
    assert.strictEqual(dbDoc.document_id, 'test-m163-doc-001');
    assert.strictEqual(dbDoc.status, 'queued');

    const [jobRows] = await query('SELECT * FROM jobs WHERE doc_id = ?', [dbDoc.id]);
    assert.strictEqual(jobRows.length, 1);
    assert.strictEqual(jobRows[0].status, 'queued');
    reportTest('TEST 2.2: Job Record Creation', true, 'Ingestion job created with status=queued in MySQL jobs table');

    console.log('\n--- SECTION 3: DUPLICATE SHA-256 HANDLING ---');
    const dupRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': singleUpload.contentType,
        'X-Document-Id': 'test-m163-doc-002-dup'
      },
      body: singleUpload.body
    });

    assert.strictEqual(dupRes.status, 200);
    assert.strictEqual(dupRes.body.status, 'success');
    assert.strictEqual(dupRes.body.data.document_id, 'test-m163-doc-001');
    assert(dupRes.body.message.includes('duplicate'));

    const currentDiskFiles = fs.readdirSync(TEST_UPLOAD_DIR);
    assert(!currentDiskFiles.some((f) => f.includes('test-m163-doc-002-dup')));
    reportTest('TEST 3.1: Duplicate SHA-256 Handling', true, 'Duplicate returned 200 with existing doc-001 without writing duplicate file');

    console.log('\n--- SECTION 4: FILE VALIDATIONS (EXTENSION, CONTENT, EMPTY) ---');
    const txtUpload = buildMultipartPayload([
      { fieldname: 'file', filename: 'malicious.txt', content: Buffer.from('hello text') }
    ]);
    const txtRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': txtUpload.contentType },
      body: txtUpload.body
    });
    assert.strictEqual(txtRes.status, 400);
    assert.strictEqual(txtRes.body.status, 'error');
    assert(txtRes.body.message.includes('Only PDF files are supported'));
    reportTest('TEST 4.1: Invalid File Extension Rejection', true, 'Rejected non-PDF extension (.txt) with 400');

    const fakePdfUpload = buildMultipartPayload([
      {
        fieldname: 'file',
        filename: 'not_really_pdf.pdf',
        content: Buffer.from('<html><body>Fake PDF content</body></html>')
      }
    ]);
    const fakePdfRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': fakePdfUpload.contentType },
      body: fakePdfUpload.body
    });
    assert.strictEqual(fakePdfRes.status, 400);
    assert(fakePdfRes.body.message.includes('%PDF-'));
    reportTest('TEST 4.2: Content Inspection Rejection (Fake PDF)', true, 'Rejected file lacking %PDF- magic bytes with 400');

    const emptyUpload = buildMultipartPayload([]);
    const emptyRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': emptyUpload.contentType },
      body: emptyUpload.body
    });
    assert.strictEqual(emptyRes.status, 400);
    assert(emptyRes.body.message.includes('No file provided'));
    reportTest('TEST 4.3: Missing File Rejection', true, 'Empty upload payload rejected with 400');

    console.log('\n--- SECTION 5: SECURITY & PATH TRAVERSAL DEFENSE ---');
    const uniqueTraversalBuffer = Buffer.from('%PDF-1.4\nUnique traversal test stream content\n%%EOF');
    const traversalUpload1 = buildMultipartPayload([
      { fieldname: 'file', filename: '../../etc/passwd.pdf', content: uniqueTraversalBuffer }
    ]);
    const traversalRes1 = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': traversalUpload1.contentType },
      body: traversalUpload1.body
    });
    assert.strictEqual(traversalRes1.status, 400);
    assert(traversalRes1.body.message.includes('unsafe filename') || traversalRes1.body.message.includes('traversal'));
    reportTest('TEST 5.1: Path Traversal (..) Rejection', true, 'Path traversal ../../ filename rejected with 400');

    const nullByteUpload = buildMultipartPayload([
      { fieldname: 'file', filename: 'exploit\0.pdf', content: uniqueTraversalBuffer }
    ]);
    const nullByteRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': nullByteUpload.contentType },
      body: nullByteUpload.body
    });
    assert.strictEqual(nullByteRes.status, 400);
    reportTest('TEST 5.2: Null Byte Injection Rejection', true, 'Null byte in filename rejected with 400');

    console.log('\n--- SECTION 6: OVERSIZED SINGLE UPLOAD ENFORCEMENT ---');
    const savedLimit = config.maxUploadSizeMb;
    config.maxUploadSizeMb = 0.0001;
    const oversizedBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 65)]);
    const oversizedUpload = buildMultipartPayload([
      { fieldname: 'file', filename: 'huge.pdf', content: oversizedBuffer }
    ]);
    const oversizedRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': oversizedUpload.contentType },
      body: oversizedUpload.body
    });
    config.maxUploadSizeMb = savedLimit;
    assert.strictEqual(oversizedRes.status, 413);
    assert.strictEqual(oversizedRes.body.status, 'error');
    assert(oversizedRes.body.message.includes('exceeds maximum allowed size'));
    reportTest('TEST 6.1: Oversized Single Upload Rejection', true, 'Upload exceeding size limit rejected with 413');

    console.log('\n--- SECTION 7: SCENARIO 1 & 2 & 3: ATOMIC TRANSACTION ROLLBACK ---');
    jobRepository._setTestFailJobInsert(true);

    const failJobBuffer = Buffer.from('%PDF-1.4\nUnique fail job test stream\n%%EOF');
    const failJobUpload = buildMultipartPayload([
      { fieldname: 'file', filename: 'fail_job.pdf', content: failJobBuffer }
    ]);

    const failJobRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': failJobUpload.contentType,
        'X-Document-Id': 'test-m163-fail-job-001'
      },
      body: failJobUpload.body
    });

    jobRepository._setTestFailJobInsert(false);

    assert.strictEqual(failJobRes.status, 500);

    const rolledBackDoc = await documentRepository.findByDocumentId('test-m163-fail-job-001', { includeDeleted: true });
    assert.strictEqual(rolledBackDoc, null);

    const [orphanedJobs] = await query(
      `SELECT * FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id = 'test-m163-fail-job-001')`
    );
    assert.strictEqual(orphanedJobs.length, 0);

    const failJobDiskFiles = fs.readdirSync(TEST_UPLOAD_DIR);
    assert(!failJobDiskFiles.some((f) => f.includes('test-m163-fail-job-001')));

    reportTest('SCENARIO 1: Document Rollback on Job Failure', true, 'Document record rolled back when job insertion fails');
    reportTest('SCENARIO 2: Zero Orphaned Records', true, 'Neither document nor job record retained after transaction failure');
    reportTest('SCENARIO 3: Disk File Cleaned on Transaction Failure', true, 'Target file unlinked from disk upon database rollback');

    console.log('\n--- SECTION 8: SCENARIO 4: CONCURRENT DOCUMENT ID ALLOCATION ---');
    const concurrentCount = 5;
    const concurrentPayloads = [];
    for (let i = 0; i < concurrentCount; i++) {
      const buf = Buffer.from(`%PDF-1.4\nConcurrent document content ${i} ${Date.now()}\n%%EOF`);
      concurrentPayloads.push(
        buildMultipartPayload([
          { fieldname: 'file', filename: `concurrent_${i}.pdf`, content: buf }
        ])
      );
    }

    const concurrentResults = await Promise.all(
      concurrentPayloads.map((payload) =>
        makeRequest('/api/v1/documents/upload', {
          method: 'POST',
          headers: { 'Content-Type': payload.contentType },
          body: payload.body
        })
      )
    );

    for (const res of concurrentResults) {
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.status, 'success');
      assert(res.body.data.document_id);
    }

    const allocatedIds = concurrentResults.map((r) => r.body.data.document_id);
    assert.strictEqual(allocatedIds.length, concurrentCount);
    assert.strictEqual(new Set(allocatedIds).size, concurrentCount);

    for (const id of allocatedIds) {
      const doc = await documentRepository.findByDocumentId(id);
      assert(doc !== null);
      assert(fs.existsSync(doc.path));
    }
    reportTest('SCENARIO 4: Concurrent Document ID Allocation', true, `Allocated ${concurrentCount} unique document IDs concurrently without collisions`);

    console.log('\n--- SECTION 9: SCENARIO 5: SIMULTANEOUS IDENTICAL UPLOADS ---');
    const dupContent = Buffer.from(`%PDF-1.4\nSimultaneous identical upload test ${Date.now()}\n%%EOF`);
    const dupPayload = buildMultipartPayload([
      { fieldname: 'file', filename: 'simultaneous_dup.pdf', content: dupContent }
    ]);

    const [dupResA, dupResB] = await Promise.all([
      makeRequest('/api/v1/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': dupPayload.contentType },
        body: dupPayload.body
      }),
      makeRequest('/api/v1/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': dupPayload.contentType },
        body: dupPayload.body
      })
    ]);

    const statuses = [dupResA.status, dupResB.status].sort();
    assert(
      (statuses[0] === 200 && statuses[1] === 201) ||
      (statuses[0] === 200 && statuses[1] === 200) ||
      (statuses[0] === 201 && statuses[1] === 201)
    );

    const docIdA = dupResA.body.data.document_id;
    const docIdB = dupResB.body.data.document_id;
    assert.strictEqual(docIdA, docIdB);

    const sha256Val = crypto.createHash('sha256').update(dupContent).digest('hex');
    const [matchingDocs] = await query('SELECT * FROM documents WHERE sha256 = ?', [sha256Val]);
    assert.strictEqual(matchingDocs.length, 1);

    const [matchingJobs] = await query('SELECT * FROM jobs WHERE doc_id = ?', [matchingDocs[0].id]);
    assert.strictEqual(matchingJobs.length, 1);
    reportTest('SCENARIO 5: Simultaneous Identical Uploads', true, 'Concurrent identical uploads cleanly resolved to exactly 1 document and 1 job');

    console.log('\n--- SECTION 10: SCENARIO 6: DELETION WHILE JOB QUEUED ---');
    const queuedDoc = await documentRepository.createDocument({
      document_id: 'test-m163-del-queued',
      filename: 'del_queued.pdf',
      sha256: 'aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-del-queued_del_queued.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(queuedDoc.path, validPdfBuffer);

    const createdQueuedJob = await jobRepository.createJob({
      doc_id: queuedDoc.id,
      mode: 'flat',
      status: 'queued'
    });

    const delQueuedRes = await makeRequest(`/api/v1/documents/${queuedDoc.document_id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(delQueuedRes.status, 200);
    assert.strictEqual(delQueuedRes.body.data.deleted, true);

    const dbQueuedDoc = await documentRepository.findById(queuedDoc.id, { includeDeleted: true });
    assert(dbQueuedDoc.deleted_at !== null);

    const dbQueuedJob = await jobRepository.findById(createdQueuedJob.id);
    assert.strictEqual(dbQueuedJob.status, 'failed');
    assert.strictEqual(dbQueuedJob.error, 'Document deleted before processing');

    assert(!fs.existsSync(queuedDoc.path));
    reportTest('SCENARIO 6: Deletion While Job Queued', true, 'Job marked failed, document soft-deleted, and file unlinked');

    console.log('\n--- SECTION 11: SCENARIO 7: DELETION WHILE JOB RUNNING ---');
    const runningDoc = await documentRepository.createDocument({
      document_id: 'test-m163-del-running',
      filename: 'del_running.pdf',
      sha256: 'bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-del-running_del_running.pdf'),
      pages_count: 1,
      doc_type: 'user_upload',
      status: 'processing'
    });
    fs.writeFileSync(runningDoc.path, validPdfBuffer);

    const createdRunningJob = await jobRepository.createJob({
      doc_id: runningDoc.id,
      mode: 'flat',
      status: 'running'
    });

    const delRunningRes = await makeRequest(`/api/v1/documents/${runningDoc.document_id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(delRunningRes.status, 409);
    assert.strictEqual(delRunningRes.body.status, 'error');
    assert(delRunningRes.body.message.includes('actively running'));

    const dbRunningDoc = await documentRepository.findById(runningDoc.id);
    assert(dbRunningDoc !== null);
    assert.strictEqual(dbRunningDoc.deleted_at, null);

    const dbRunningJob = await jobRepository.findById(createdRunningJob.id);
    assert.strictEqual(dbRunningJob.status, 'running');

    assert(fs.existsSync(runningDoc.path));
    reportTest('SCENARIO 7: Deletion While Job Running', true, 'Rejected with 409 Conflict, job remains running, file preserved');

    console.log('\n--- SECTION 12: SCENARIO 8: DELETION AFTER JOB COMPLETION ---');
    const doneDoc = await documentRepository.createDocument({
      document_id: 'test-m163-del-done',
      filename: 'del_done.pdf',
      sha256: 'cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-del-done_del_done.pdf'),
      pages_count: 1,
      doc_type: 'user_upload',
      status: 'processed'
    });
    fs.writeFileSync(doneDoc.path, validPdfBuffer);

    const createdDoneJob = await jobRepository.createJob({
      doc_id: doneDoc.id,
      mode: 'flat',
      status: 'done',
      seconds: 2.5
    });

    const delDoneRes = await makeRequest(`/api/v1/documents/${doneDoc.document_id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(delDoneRes.status, 200);
    assert.strictEqual(delDoneRes.body.data.deleted, true);

    const dbDoneDoc = await documentRepository.findById(doneDoc.id, { includeDeleted: true });
    assert(dbDoneDoc.deleted_at !== null);

    const dbDoneJob = await jobRepository.findById(createdDoneJob.id);
    assert.strictEqual(dbDoneJob.status, 'done');

    assert(!fs.existsSync(doneDoc.path));
    reportTest('SCENARIO 8: Deletion After Job Completion', true, 'Document soft-deleted, file removed, job history preserved with status=done');

    console.log('\n--- SECTION 13: SCENARIO 9: CLEANUP RETRY AFTER SIMULATED FAILURE ---');
    const retryDoc = await documentRepository.createDocument({
      document_id: 'test-m163-del-retry',
      filename: 'del_retry.pdf',
      sha256: 'dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-del-retry_del_retry.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(retryDoc.path, validPdfBuffer);

    await documentRepository.softDelete(retryDoc.id);
    assert(fs.existsSync(retryDoc.path));

    const retryDelRes = await makeRequest(`/api/v1/documents/${retryDoc.document_id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(retryDelRes.status, 404);
    assert(retryDelRes.body.message.includes('already deleted'));
    assert(!fs.existsSync(retryDoc.path));
    reportTest('SCENARIO 9: Cleanup Retry on Already-Deleted Document', true, '404 returned for already-deleted document while cleaning up disk file');

    console.log('\n--- SECTION 14: SCENARIO 10: MAXIMUM BATCH FILE COUNT ENFORCEMENT ---');
    const savedMaxBatch = config.maxBatchFiles;
    config.maxBatchFiles = 2;

    const overBatchUpload = buildMultipartPayload([
      { fieldname: 'files', filename: 'batch_file_1.pdf', content: validPdfBuffer },
      { fieldname: 'files', filename: 'batch_file_2.pdf', content: validPdfBuffer },
      { fieldname: 'files', filename: 'batch_file_3.pdf', content: validPdfBuffer }
    ]);

    const overBatchRes = await makeRequest('/api/v1/documents/upload-batch', {
      method: 'POST',
      headers: { 'Content-Type': overBatchUpload.contentType },
      body: overBatchUpload.body
    });
    config.maxBatchFiles = savedMaxBatch;

    assert.strictEqual(overBatchRes.status, 400);
    assert.strictEqual(overBatchRes.body.status, 'error');
    assert(
      overBatchRes.body.message.includes('Batch file count') ||
      overBatchRes.body.message.includes('exceeds maximum allowed limit')
    );
    reportTest('SCENARIO 10: Maximum Batch File Count Enforcement', true, 'Exceeding maxBatchFiles rejected with HTTP 400');

    console.log('\n--- SECTION 15: SCENARIO 11: CONCURRENT UPLOAD LIMIT ENFORCEMENT ---');
    const savedConcurrencyLimit = config.maxConcurrentUploads;
    config.maxConcurrentUploads = 0;

    const rateLimitedRes = await makeRequest('/api/v1/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': singleUpload.contentType },
      body: singleUpload.body
    });
    config.maxConcurrentUploads = savedConcurrencyLimit;

    assert.strictEqual(rateLimitedRes.status, 429);
    assert.strictEqual(rateLimitedRes.body.status, 'error');
    assert(rateLimitedRes.body.message.includes('Upload concurrency limit reached'));
    reportTest('SCENARIO 11: Concurrent Upload Limit Enforcement', true, 'Enforced uploadConcurrencyGuard returning HTTP 429');

    console.log('\n--- SECTION 16: SCENARIO 12: OVERSIZED FILE IN BATCH ---');
    const savedLimitMb = config.maxUploadSizeMb;
    config.maxUploadSizeMb = 0.0005;

    const normalPdf = Buffer.from('%PDF-1.4\nSmall valid pdf content\n%%EOF');
    const largePdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(2000, 66),
      Buffer.from('\n%%EOF')
    ]);

    const mixedBatchPayload = buildMultipartPayload([
      { fieldname: 'files', filename: 'batch_normal.pdf', content: normalPdf },
      { fieldname: 'files', filename: 'batch_oversized.pdf', content: largePdf }
    ]);

    const mixedBatchRes = await makeRequest('/api/v1/documents/upload-batch', {
      method: 'POST',
      headers: {
        'Content-Type': mixedBatchPayload.contentType,
        'X-Batch-Prefix': 'test-m163-oversized-batch'
      },
      body: mixedBatchPayload.body
    });
    config.maxUploadSizeMb = savedLimitMb;

    assert.strictEqual(mixedBatchRes.status, 201);
    assert.strictEqual(mixedBatchRes.body.data.successful_count, 1);
    assert.strictEqual(mixedBatchRes.body.data.failed_count, 1);

    const normalItem = mixedBatchRes.body.data.items.find((it) => it.filename === 'batch_normal.pdf');
    assert.strictEqual(normalItem.status, 'Queued');

    const oversizedItem = mixedBatchRes.body.data.items.find((it) => it.filename === 'batch_oversized.pdf');
    assert.strictEqual(oversizedItem.status, 'Failed');
    assert(oversizedItem.error.includes('exceeds maximum allowed size'));
    reportTest('SCENARIO 12: Oversized File in Batch Partial Failure', true, 'Oversized item marked Failed while valid item queued cleanly');

    console.log('\n--- SECTION 17: SCENARIO 13: TEMPORARY FILE CLEANUP GUARANTEE ---');
    await new Promise((r) => setTimeout(r, 50));
    const tempDir = getTempUploadDir();
    if (fs.existsSync(tempDir)) {
      const remainingTempFiles = fs.readdirSync(tempDir);
      assert.strictEqual(remainingTempFiles.length, 0);
    }
    reportTest('SCENARIO 13: Temporary File Cleanup Guarantee', true, 'Zero temporary files leaked in temporary upload directory');

    console.log('\n--- SECTION 18: SCENARIO 14: ACTIVE JOB INPUT FILE INTEGRITY ---');
    const [activeJobs] = await query(`
      SELECT j.id, j.status, d.document_id, d.path
      FROM jobs j
      JOIN documents d ON j.doc_id = d.id
      WHERE j.status IN ('queued', 'running') AND d.deleted_at IS NULL
    `);

    for (const job of activeJobs) {
      assert(fs.existsSync(job.path), `Job ${job.id} for document ${job.document_id} references missing file: ${job.path}`);
    }

    const [deletedWithActiveJobs] = await query(`
      SELECT j.id, j.status, d.document_id
      FROM jobs j
      JOIN documents d ON j.doc_id = d.id
      WHERE j.status IN ('queued', 'running') AND d.deleted_at IS NOT NULL
    `);
    assert.strictEqual(deletedWithActiveJobs.length, 0);
    reportTest('SCENARIO 14: Active Job Input File Integrity', true, `All ${activeJobs.length} active jobs reference existing files on disk, zero active jobs on deleted docs`);

    console.log('\n--- SECTION 19: DATABASE-BACKED DOCUMENT ID ALLOCATION (INDEPENDENT CONNECTIONS) ---');
    const dedicatedConn1 = await getDedicatedConnection();
    const dedicatedConn2 = await getDedicatedConnection();

    const [allocId1, allocId2] = await Promise.all([
      allocateNextDocumentId(dedicatedConn1),
      allocateNextDocumentId(dedicatedConn2)
    ]);

    await dedicatedConn1.end();
    await dedicatedConn2.end();

    assert(/^doc-\d{3,}$/.test(allocId1));
    assert(/^doc-\d{3,}$/.test(allocId2));
    assert.notStrictEqual(allocId1, allocId2);

    reportTest('SCENARIO 19.1: Database-Backed Document ID Allocation (Independent Connections)', true, `Allocated ${allocId1} and ${allocId2} atomically across independent MySQL connections`);

    const initConn1 = await getDedicatedConnection();
    const initConn2 = await getDedicatedConnection();
    let initRaceCaught = false;
    try {
      await Promise.all([
        ensureSequenceTable(initConn1),
        ensureSequenceTable(initConn2)
      ]);
    } catch {
      initRaceCaught = true;
    }
    await initConn1.end();
    await initConn2.end();
    assert.strictEqual(initRaceCaught, false);
    reportTest('SCENARIO 19.2: Concurrent Sequence Initialization Safety', true, 'Simultaneous initialization across independent connections succeeded with zero error or collision');

    console.log('\n--- SECTION 20: DELETION AND WORKER-CLAIM RACE PROTECTION (DETERMINISTIC BARRIERS) ---');
    const raceDocA = await documentRepository.createDocument({
      document_id: 'test-m163-race-a',
      filename: 'race_a.pdf',
      sha256: 'fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01fa01',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-race-a_race_a.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(raceDocA.path, validPdfBuffer);

    const raceJobA = await jobRepository.createJob({
      doc_id: raceDocA.id,
      mode: 'race_mode_a',
      status: 'queued'
    });

    const workerLockedA = createDeferred();
    const workerContinueA = createDeferred();

    const workerPromiseA = jobTestAdapter.claimJobWithHook('worker-race-a', { mode: 'race_mode_a' }, {
      afterLock: async () => {
        workerLockedA.resolve();
        await workerContinueA.promise;
      }
    });

    await workerLockedA.promise;

    const deletePromiseA = makeRequest(`/api/v1/documents/${raceDocA.document_id}`, {
      method: 'DELETE'
    });

    workerContinueA.resolve();

    const [claimedJobA, deleteResA] = await Promise.all([
      workerPromiseA,
      deletePromiseA
    ]);

    assert(claimedJobA !== null);
    assert.strictEqual(claimedJobA.status, 'running');
    assert.strictEqual(deleteResA.status, 409);
    assert.strictEqual(deleteResA.body.status, 'error');

    const dbCheckDocA = await documentRepository.findById(raceDocA.id);
    assert(dbCheckDocA !== null);
    assert.strictEqual(dbCheckDocA.deleted_at, null);

    const dbCheckJobA = await jobRepository.findById(raceJobA.id);
    assert.strictEqual(dbCheckJobA.status, 'running');
    assert(fs.existsSync(raceDocA.path));

    reportTest('SCENARIO 20.1: Interleaving A (Worker Claims First)', true, 'Worker claimed running job; DELETE rejected with 409; file preserved');

    const raceDocB = await documentRepository.createDocument({
      document_id: 'test-m163-race-b',
      filename: 'race_b.pdf',
      sha256: 'fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02fb02',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-race-b_race_b.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(raceDocB.path, validPdfBuffer);

    const raceJobB = await jobRepository.createJob({
      doc_id: raceDocB.id,
      mode: 'race_mode_b',
      status: 'queued'
    });

    const deleteLockedB = createDeferred();
    const deleteContinueB = createDeferred();

    _setTestDeleteHook({
      afterLock: async () => {
        deleteLockedB.resolve();
        await deleteContinueB.promise;
      }
    });

    const deletePromiseB = makeRequest(`/api/v1/documents/${raceDocB.document_id}`, {
      method: 'DELETE'
    });

    await deleteLockedB.promise;

    const claimedJobB = await jobRepository.claimJob('worker-race-b', { mode: 'race_mode_b' });

    deleteContinueB.resolve();

    const deleteResB = await deletePromiseB;
    _setTestDeleteHook(null);

    assert.strictEqual(claimedJobB, null);
    assert.strictEqual(deleteResB.status, 200);
    assert.strictEqual(deleteResB.body.data.deleted, true);

    const dbCheckDocB = await documentRepository.findById(raceDocB.id, { includeDeleted: true });
    assert(dbCheckDocB !== null);
    assert(dbCheckDocB.deleted_at !== null);

    const dbCheckJobB = await jobRepository.findById(raceJobB.id);
    assert.strictEqual(dbCheckJobB.status, 'failed');
    assert.strictEqual(dbCheckJobB.error, 'Document deleted before processing');
    assert(!fs.existsSync(raceDocB.path));

    reportTest('SCENARIO 20.2: Interleaving B (Deletion Wins First)', true, 'DELETE canceled queued job and soft-deleted doc; Worker got null; file unlinked');

    const raceDocC = await documentRepository.createDocument({
      document_id: 'test-m163-race-c',
      filename: 'race_c.pdf',
      sha256: 'ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05ee05',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-race-c_race_c.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(raceDocC.path, validPdfBuffer);

    const raceJobC = await jobRepository.createJob({
      doc_id: raceDocC.id,
      mode: 'race_mode_c',
      status: 'queued'
    });

    const workerJobLockedC = createDeferred();
    const workerProceedC = createDeferred();

    const workerPromiseC = jobTestAdapter.claimJobWithHook('worker-race-c', { mode: 'race_mode_c' }, {
      afterJobLock: async () => {
        workerJobLockedC.resolve();
        await workerProceedC.promise;
      }
    });

    await workerJobLockedC.promise;

    const deletePromiseC = makeRequest(`/api/v1/documents/${raceDocC.document_id}`, {
      method: 'DELETE'
    });

    workerProceedC.resolve();

    const [claimedJobC, deleteResC] = await Promise.all([
      workerPromiseC,
      deletePromiseC
    ]);

    assert(claimedJobC !== null);
    assert.strictEqual(claimedJobC.status, 'running');
    assert.strictEqual(deleteResC.status, 409);
    assert.strictEqual(deleteResC.body.status, 'error');

    const dbCheckDocC = await documentRepository.findById(raceDocC.id);
    assert(dbCheckDocC !== null);
    assert.strictEqual(dbCheckDocC.deleted_at, null);

    const dbCheckJobC = await jobRepository.findById(raceJobC.id);
    assert.strictEqual(dbCheckJobC.status, 'running');
    assert(fs.existsSync(raceDocC.path));

    reportTest('SCENARIO 20.3: Deterministic Lock-Order Verification (Worker Holds Job Lock, DELETE Waits without Deadlock)', true, 'Worker held job lock first; DELETE waited on job lock without acquiring document lock; worker completed; DELETE returned 409 without deadlock');

    const raceDocD = await documentRepository.createDocument({
      document_id: 'test-m163-race-d',
      filename: 'race_d.pdf',
      sha256: 'ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06ff06',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-race-d_race_d.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(raceDocD.path, validPdfBuffer);

    const raceJobD = await jobRepository.createJob({
      doc_id: raceDocD.id,
      mode: 'race_mode_d',
      status: 'queued'
    });

    const deleteJobLockedD = createDeferred();
    const deleteProceedD = createDeferred();

    _setTestDeleteHook({
      afterJobLock: async () => {
        deleteJobLockedD.resolve();
        await deleteProceedD.promise;
      }
    });

    const deletePromiseD = makeRequest(`/api/v1/documents/${raceDocD.document_id}`, {
      method: 'DELETE'
    });

    await deleteJobLockedD.promise;

    const claimedJobD = await jobRepository.claimJob('worker-race-d', { mode: 'race_mode_d' });

    deleteProceedD.resolve();

    const deleteResD = await deletePromiseD;
    _setTestDeleteHook(null);

    assert.strictEqual(claimedJobD, null);
    assert.strictEqual(deleteResD.status, 200);
    assert.strictEqual(deleteResD.body.data.deleted, true);

    const dbCheckDocD = await documentRepository.findById(raceDocD.id, { includeDeleted: true });
    assert(dbCheckDocD !== null);
    assert(dbCheckDocD.deleted_at !== null);

    const dbCheckJobD = await jobRepository.findById(raceJobD.id);
    assert.strictEqual(dbCheckJobD.status, 'failed');
    assert.strictEqual(dbCheckJobD.error, 'Document deleted before processing');
    assert(!fs.existsSync(raceDocD.path));

    reportTest('SCENARIO 20.4: Deterministic Lock-Order Verification (DELETE Holds Job Lock First, Worker Skips Locked Job)', true, 'DELETE held job lock first; Worker used SKIP LOCKED and returned null; DELETE completed successfully with 200');

    console.log('\n--- SECTION 21: RETRYABLE FILESYSTEM CLEANUP SUITE ---');
    const testPermPath = path.join(TEST_UPLOAD_DIR, 'perm_fail_test.pdf');
    fs.writeFileSync(testPermPath, validPdfBuffer);

    const safeUnlinkRes = await safeUnlinkFile(testPermPath, 'test_perm_failure', {
      simulatedFailure: 'EPERM: operation not permitted'
    });
    assert.strictEqual(safeUnlinkRes.success, false);
    assert(fs.existsSync(testPermPath));

    const [cleanupQueueRows] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ? AND status = 'pending'`,
      [path.resolve(testPermPath)]
    );
    assert.strictEqual(cleanupQueueRows.length, 1);
    assert(cleanupQueueRows[0].last_error.includes('EPERM'));
    reportTest('SCENARIO 21.1: Cleanup Failure Captured Durably Without Masking Error', true, 'EPERM error durably recorded in cleanup_queue table');

    const missingPath = path.join(TEST_UPLOAD_DIR, 'already_missing_doc.pdf');
    const missingRes = await safeUnlinkFile(missingPath, 'test_missing');
    assert.strictEqual(missingRes.success, true);
    assert.strictEqual(missingRes.idempotent, true);
    reportTest('SCENARIO 21.2: Idempotent Missing File Cleanup', true, 'Non-existent file resolved as successful idempotent cleanup');

    const runningJobDoc = await documentRepository.createDocument({
      document_id: 'test-m163-running-cleanup',
      filename: 'running_cleanup.pdf',
      sha256: 'fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03fc03',
      path: path.join(TEST_UPLOAD_DIR, 'test-m163-running-cleanup_doc.pdf'),
      pages_count: 1,
      doc_type: 'user_upload'
    });
    fs.writeFileSync(runningJobDoc.path, validPdfBuffer);
    await jobRepository.createJob({
      doc_id: runningJobDoc.id,
      mode: 'flat',
      status: 'running'
    });

    const runningCleanupRes = await safeUnlinkFile(runningJobDoc.path, 'test_running_cleanup');
    assert.strictEqual(runningCleanupRes.success, false);
    assert.strictEqual(runningCleanupRes.reason, 'referenced_by_running_job');
    assert(fs.existsSync(runningJobDoc.path));
    reportTest('SCENARIO 21.3: Running Job File Protection', true, 'File referenced by running job protected from deletion');

    const benchmarkPath = 'data/sample_documents/benchmark_protected.pdf';
    const benchmarkRes = await safeUnlinkFile(benchmarkPath, 'test_benchmark_cleanup');
    assert.strictEqual(benchmarkRes.success, false);
    assert.strictEqual(benchmarkRes.reason, 'protected_benchmark_asset');
    reportTest('SCENARIO 21.4: Benchmark Asset Protection', true, 'Files within sample_documents protected from deletion');

    const retryResult = await retryFailedCleanups();
    assert(retryResult.succeeded >= 1);
    assert(!fs.existsSync(testPermPath));

    const [updatedQueueRows] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ?`,
      [path.resolve(testPermPath)]
    );
    assert.strictEqual(updatedQueueRows[0].status, 'completed');
    reportTest('SCENARIO 21.5: Retryable Cleanup Processing', true, 'retryFailedCleanups processed queue and purged pending file');

    const secondRetryResult = await retryFailedCleanups();
    assert.strictEqual(secondRetryResult.processed, 0);
    const repeatedUnlinkRes = await safeUnlinkFile(testPermPath, 'repeated_cleanup');
    assert.strictEqual(repeatedUnlinkRes.success, true);
    assert.strictEqual(repeatedUnlinkRes.idempotent, true);
    reportTest('SCENARIO 21.6: Repeated Cleanup Idempotency', true, 'Subsequent cleanups on purged file are 100% idempotent');

    const testEbusyPath = path.join(TEST_UPLOAD_DIR, 'ebusy_fail_test.pdf');
    fs.writeFileSync(testEbusyPath, validPdfBuffer);

    const ebusyRes = await safeUnlinkFile(testEbusyPath, 'test_ebusy_failure', {
      simulatedFailure: 'EBUSY: resource busy or locked'
    });
    assert.strictEqual(ebusyRes.success, false);
    assert(fs.existsSync(testEbusyPath));

    const [ebusyQueueRows] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ? AND status = 'pending'`,
      [path.resolve(testEbusyPath)]
    );
    assert.strictEqual(ebusyQueueRows.length, 1);
    assert(ebusyQueueRows[0].last_error.includes('EBUSY'));
    reportTest('SCENARIO 21.7: EBUSY Error Captured Durably in Cleanup Queue', true, 'EBUSY error captured and recorded without masking');

    const transientRetry1 = await retryFailedCleanups({
      simulatedFailurePath: path.resolve(testEbusyPath)
    });
    assert.strictEqual(transientRetry1.failed, 1);
    const [transientQueue1] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ?`,
      [path.resolve(testEbusyPath)]
    );
    assert.strictEqual(transientQueue1[0].attempts, 1);

    const transientRetry2 = await retryFailedCleanups();
    assert(transientRetry2.succeeded >= 1);
    assert(!fs.existsSync(testEbusyPath));

    const [transientQueue2] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ?`,
      [path.resolve(testEbusyPath)]
    );
    assert.strictEqual(transientQueue2[0].status, 'completed');
    reportTest('SCENARIO 21.8: Transient Failure Recovery', true, 'Transient failure retried and marked completed upon lock clearance');

    const maxAttemptPath = path.join(TEST_UPLOAD_DIR, 'max_attempts_test.pdf');
    fs.writeFileSync(maxAttemptPath, validPdfBuffer);
    await safeUnlinkFile(maxAttemptPath, 'test_max_attempts', {
      simulatedFailure: 'EPERM: persistent lock'
    });
    await query(
      `UPDATE cleanup_queue SET attempts = 5, status = 'failed' WHERE file_path = ?`,
      [path.resolve(maxAttemptPath)]
    );

    const maxRetryResult = await retryFailedCleanups();
    const [maxQueueCheck] = await query(
      `SELECT * FROM cleanup_queue WHERE file_path = ?`,
      [path.resolve(maxAttemptPath)]
    );
    assert.strictEqual(maxQueueCheck[0].status, 'failed');
    assert.strictEqual(maxQueueCheck[0].attempts, 5);
    reportTest('SCENARIO 21.9: Five-Attempt Maximum Ceiling Enforced', true, 'Queue record with attempts >= 5 ignored by retries and remains failed');

    console.log('\n--- TEARDOWN TEST ENVIRONMENT ---');
    await cleanTestData();
    await stopServer();
    await resetPool();

    console.log('\n=================================================================');
    console.log(`    UPLOAD LIFECYCLE TEST SUITE SUMMARY: ${passedTests}/${totalTests} PASSED`);
    console.log('=================================================================\n');

    if (passedTests !== totalTests) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\nUNHANDLED EXCEPTION IN TEST SUITE:', error);
    try {
      await cleanTestData();
      await stopServer();
      await resetPool();
    } catch {}
    process.exit(1);
  }
}

runUploadLifecycleTestSuite();
