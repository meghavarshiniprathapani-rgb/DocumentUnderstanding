import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { app } from '../app.js';
import { config as appConfig } from '../config.js';
import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepo from '../db/repositories/documentRepository.js';
import * as elementRepo from '../db/repositories/elementRepository.js';
import * as jobRepo from '../db/repositories/jobRepository.js';
import { startServer, stopServer } from '../server.js';
import { createWorker, createWorkerLogger, sanitizeWorkerError } from '../worker/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
dotenv.config({ path: path.resolve(REPO_ROOT, '.env') });

let totalTests = 0;
let passedTests = 0;

function reportTest(name, passed, detail = '') {
  totalTests += 1;
  if (passed) {
    passedTests += 1;
    console.log(`  PASS: [${name}] ${detail}`);
  } else {
    console.error(`  FAIL: [${name}] ${detail}`);
  }
}

async function waitForCondition(predicate, timeoutMs = 90000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function getPythonExecutable() {
  const venvWin = path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvWin)) {
    return venvWin;
  }
  const venvUnix = path.join(REPO_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvUnix)) {
    return venvUnix;
  }
  return null;
}

async function cleanE2eRecords(uploadedDocIds, uploadedFilePaths) {
  for (const filePath of uploadedFilePaths) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
      }
    }
  }
  if (uploadedDocIds.length > 0) {
    await query(`DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id IN (?))`, [
      uploadedDocIds,
    ]);
    await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id IN (?))`, [
      uploadedDocIds,
    ]);
    await query(`DELETE FROM documents WHERE document_id IN (?)`, [uploadedDocIds]);
  }
}

async function runEndToEndUploadToSearch() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — END-TO-END UPLOAD-TO-SEARCH INTEGRATION SUITE   ');
  console.log('=================================================================');

  const pythonExe = getPythonExecutable();
  assert(pythonExe, 'Python virtual environment executable is required');

  const uniqueTag = `e2e-${Date.now()}`;
  const uniquePhrase = `QuantumTelemetryHorizon${Date.now()}`;
  const tempSourcePdf = path.join(os.tmpdir(), `${uniqueTag}.pdf`);
  const uploadedDocIds = [];
  const uploadedFilePaths = [];

  execFileSync(
    pythonExe,
    [
      '-c',
      `import pymupdf as fitz; doc = fitz.open(); p = doc.new_page(width=612, height=792); p.insert_text((72, 72), "End To End Verification Heading", fontsize=18); p.insert_text((72, 120), "Unique searchable payload: ${uniquePhrase} validates upload through FAISS.", fontsize=12); doc.save(r"${tempSourcePdf}"); doc.close()`,
    ],
    { cwd: REPO_ROOT, timeout: 15000 }
  );

  const pythonPort = await getFreePort();
  const expressPort = await getFreePort();
  const pythonBaseUrl = `http://127.0.0.1:${pythonPort}`;
  const expressBaseUrl = `http://127.0.0.1:${expressPort}`;
  const internalSecret = 'e2e-internal-shared-secret-2026';

  const origPythonUrl = appConfig.pythonServiceUrl;
  const origInternalSecretEnv = process.env.INTERNAL_API_SECRET;
  appConfig.pythonServiceUrl = pythonBaseUrl;
  process.env.INTERNAL_API_SECRET = internalSecret;

  let uvicornProc = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', String(pythonPort)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        INTERNAL_API_SECRET: internalSecret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let uvicornLogs = '';
  uvicornProc.stdout.on('data', (d) => {
    uvicornLogs += d.toString('utf8');
  });
  uvicornProc.stderr.on('data', (d) => {
    uvicornLogs += d.toString('utf8');
  });

  let httpServer = null;
  let worker = null;

  try {
    await resetPool();
    try {
      await waitForCondition(async () => {
        if (uvicornProc.exitCode !== null) {
          throw new Error(`Uvicorn exited early (${uvicornProc.exitCode}): ${uvicornLogs.slice(0, 600)}`);
        }
        try {
          const res = await fetch(`${pythonBaseUrl}/api/v1/health`);
          return res.ok;
        } catch {
          return false;
        }
      }, 180000, 500);
    } catch (err) {
      throw new Error(`${err.message} | uvicorn logs tail: ${uvicornLogs.slice(-600)}`);
    }

    httpServer = await startServer(expressPort);

    const readyResp = await fetch(`${expressBaseUrl}/api/v1/ready`);
    assert.strictEqual(readyResp.status, 200);
    const readyBody = await readyResp.json();
    assert.strictEqual(readyBody.data.status, 'ready');
    assert.strictEqual(readyBody.data.checks.mysql.status, 'healthy');
    assert.strictEqual(readyBody.data.checks.python_service.status, 'healthy');

    reportTest(
      'E2E 1: Stack Startup & Readiness',
      true,
      `Express (${expressPort}) and FastAPI (${pythonPort}) healthy and wired to MySQL`
    );

    const form = new FormData();
    const pdfBlob = new Blob([fs.readFileSync(tempSourcePdf)], { type: 'application/pdf' });
    form.append('file', pdfBlob, `${uniqueTag}.pdf`);

    const uploadResp = await fetch(`${expressBaseUrl}/api/v1/documents/upload`, {
      method: 'POST',
      body: form,
    });
    assert.strictEqual(uploadResp.status, 201);
    const uploadJson = await uploadResp.json();
    assert.strictEqual(uploadJson.status, 'success');
    const uploadedDocId = uploadJson.data.document_id;
    assert(uploadedDocId);
    assert.strictEqual(uploadJson.data.status, 'queued');
    uploadedDocIds.push(uploadedDocId);

    const dbDocBefore = await documentRepo.findByDocumentId(uploadedDocId);
    assert(dbDocBefore);
    uploadedFilePaths.push(dbDocBefore.path);
    const queuedJobs = await jobRepo.findByDocument(dbDocBefore.id);
    assert.strictEqual(queuedJobs.length, 1);
    const initialJob = queuedJobs[0];
    assert.strictEqual(initialJob.status, 'queued');

    reportTest(
      'E2E 2: Multipart PDF Upload Queued Document & Job',
      true,
      `Uploaded ${uploadedDocId} (${dbDocBefore.filename}) with queued job ${initialJob.id}`
    );

    worker = createWorker({
      env: {
        ...process.env,
        PYTHON_SERVICE_URL: pythonBaseUrl,
        INTERNAL_API_SECRET: internalSecret,
        PYTHON_EXTRACTION_TIMEOUT_MS: '30000',
      },
      config: {
        workerId: `worker-e2e-${Date.now()}`,
        concurrency: 1,
        pollIntervalMs: 30,
        heartbeatIntervalMs: 500,
        shutdownGraceMs: 3000,
      },
      logger: createWorkerLogger({
        workerId: `worker-e2e-log`,
        env: { ...process.env, INTERNAL_API_SECRET: internalSecret },
        sink: () => {},
      }),
    });

    await worker.start();
    await waitForCondition(async () => {
      const j = await jobRepo.findById(initialJob.id);
      return j && (j.status === 'done' || j.status === 'degraded' || j.status === 'failed');
    }, 30000, 50);

    const workerState = worker.getState();
    assert.strictEqual(workerState.metrics.jobsCompleted, 1);
    assert.strictEqual(workerState.metrics.jobsExtractedClean, 1);
    assert.strictEqual(workerState.lastExtractionOutcomes[0].persisted, true);
    assert.strictEqual(workerState.lastExtractionOutcomes[0].searchVerified, true);

    const dbJobAfter = await jobRepo.findById(initialJob.id);
    assert.strictEqual(dbJobAfter.status, 'done');
    assert.strictEqual(dbJobAfter.locked_by, null);
    assert.strictEqual(dbJobAfter.claim_token, null);
    assert.strictEqual(dbJobAfter.locked_at, null);
    assert.strictEqual(dbJobAfter.heartbeat_at, null);
    assert(dbJobAfter.seconds !== null && dbJobAfter.seconds >= 0);

    const dbDocAfter = await documentRepo.findById(dbDocBefore.id);
    assert.strictEqual(dbDocAfter.status, 'ready');
    assert.strictEqual(dbDocAfter.metadata.search_verified, true);
    assert.strictEqual(dbDocAfter.metadata.indexing_status, 'Indexed');
    assert.strictEqual(dbDocAfter.metadata.indexing_diagnostics.durable_on_disk, false);
    assert(dbDocAfter.metadata.chunk_count >= 1);

    const persistedElements = await elementRepo.findByDocumentAndMode(dbDocBefore.id, initialJob.mode);
    assert(persistedElements.length >= 1);
    assert(persistedElements.some((el) => el.text.includes(uniquePhrase)));

    const recAfter = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
    assert.strictEqual(recAfter.recoveredCount, 0);

    reportTest(
      'E2E 3: Worker Extraction, Indexing, Search Verification & Atomic Persistence',
      true,
      `Job ${initialJob.id} -> done, doc ${uploadedDocId} -> ready, ${persistedElements.length} MySQL elements persisted`
    );

    const docGetResp = await fetch(`${expressBaseUrl}/api/v1/documents/${uploadedDocId}`);
    assert.strictEqual(docGetResp.status, 200);
    const docGetJson = await docGetResp.json();
    assert.strictEqual(docGetJson.data.status, 'ready');
    assert.strictEqual(docGetJson.data.extraction_status, 'Completed');
    assert.strictEqual(docGetJson.data.indexing_status, 'Indexed');
    assert(docGetJson.data.chunk_count >= 1);

    const segGetResp = await fetch(
      `${expressBaseUrl}/api/v1/documents/${uploadedDocId}/pages/1/segments?mode=${initialJob.mode}`
    );
    assert.strictEqual(segGetResp.status, 200);
    const segGetJson = await segGetResp.json();
    assert(Array.isArray(segGetJson.data) && segGetJson.data.length === persistedElements.length);
    assert(segGetJson.data.some((s) => s.text.includes(uniquePhrase)));
    assert(segGetJson.data.every((s) => s.bbox && s.bbox.width > 0 && s.bbox.height > 0));

    const analyticsResp = await fetch(`${expressBaseUrl}/api/v1/documents/analytics/summary`);
    assert.strictEqual(analyticsResp.status, 200);
    const analyticsJson = await analyticsResp.json();
    assert(analyticsJson.data.total_documents >= 1);
    assert(analyticsJson.data.total_chunks >= 1);

    const fileResp = await fetch(`${expressBaseUrl}/api/v1/documents/${uploadedDocId}/file`);
    assert.strictEqual(fileResp.status, 200);
    const fileBuf = Buffer.from(await fileResp.arrayBuffer());
    assert(fileBuf.subarray(0, 5).toString('utf8') === '%PDF-');

    const evalResp = await fetch(`${expressBaseUrl}/api/v1/evaluation/latest`);
    assert.strictEqual(evalResp.status, 200);
    const evalJson = await evalResp.json();
    assert(Array.isArray(evalJson.data.kpi_table) && evalJson.data.kpi_table.length >= 1);

    const pySearchResp = await fetch(`${pythonBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: uniquePhrase,
        document_id: uploadedDocId,
        content_type: 'All',
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(pySearchResp.status, 200);
    const pySearchJson = await pySearchResp.json();
    assert(Array.isArray(pySearchJson.data) && pySearchJson.data.length >= 1);
    assert(pySearchJson.data.some((hit) => hit.document_id === uploadedDocId && hit.query_match_snippet.includes(uniquePhrase)));

    const expSearchResp = await fetch(`${expressBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: uniquePhrase,
        document_id: uploadedDocId,
        content_type: 'All',
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(expSearchResp.status, 200);
    const expSearchJson = await expSearchResp.json();
    assert(Array.isArray(expSearchJson.data) && expSearchJson.data.length >= 1);
    assert(
      expSearchJson.data.some(
        (hit) =>
          hit.document_id === uploadedDocId &&
          hit.provenance?.source_file_hash === dbDocBefore.sha256
      )
    );

    reportTest(
      'E2E 4: Express Document/Segment APIs & Live FAISS Search Verification',
      true,
      `Express GET document/segments and POST /api/v1/search returned latest version matches for ${uniquePhrase}`
    );

    const updatedPhraseV2 = `VersionTwoApolloVectors${Date.now()}`;
    execFileSync(
      pythonExe,
      [
        '-c',
        `import pymupdf as fitz; doc = fitz.open(); p = doc.new_page(width=612, height=792); p.insert_text((72, 72), "Updated Version Heading V2", fontsize=18); p.insert_text((72, 120), "Latest replacement content: ${updatedPhraseV2} replaces prior version.", fontsize=12); doc.save(r"${dbDocBefore.path}"); doc.close()`,
      ],
      { cwd: REPO_ROOT, timeout: 15000 }
    );
    const updatedBytes = fs.readFileSync(dbDocBefore.path);
    const updatedSha = (await import('node:crypto')).createHash('sha256').update(updatedBytes).digest('hex');
    await query(`UPDATE documents SET sha256 = ? WHERE id = ?`, [updatedSha, dbDocBefore.id]);

    const secondJob = await jobRepo.createJob({
      doc_id: dbDocBefore.id,
      mode: initialJob.mode,
      status: 'queued',
    });
    await waitForCondition(async () => {
      const j2 = await jobRepo.findById(secondJob.id);
      return j2 && j2.status === 'done';
    }, 30000, 50);

    const elementsAfterReprocess = await elementRepo.findByDocumentAndMode(dbDocBefore.id, initialJob.mode);
    assert.strictEqual(elementsAfterReprocess.length, persistedElements.length);
    assert(elementsAfterReprocess.some((el) => el.text.includes(updatedPhraseV2)));
    assert(!elementsAfterReprocess.some((el) => el.text.includes(uniquePhrase)));

    const v2SearchResp = await fetch(`${expressBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: updatedPhraseV2,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(v2SearchResp.status, 200);
    const v2SearchJson = await v2SearchResp.json();
    assert(
      v2SearchJson.data.some(
        (hit) =>
          hit.document_id === uploadedDocId &&
          hit.query_match_snippet.includes(updatedPhraseV2) &&
          hit.provenance?.source_file_hash === updatedSha
      )
    );

    const staleSearchResp = await fetch(`${expressBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: uniquePhrase,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(staleSearchResp.status, 200);
    const staleSearchJson = await staleSearchResp.json();
    assert(!staleSearchJson.data.some((hit) => hit.query_match_snippet.includes(uniquePhrase)));

    reportTest(
      'E2E 5: Idempotent Re-Extraction & Latest-Version Index Replacement (Zero Stale Chunks)',
      true,
      `Reprocessing replaced MySQL elements (${elementsAfterReprocess.length}) cleanly and FAISS search served ${updatedPhraseV2} with zero stale V1 hits`
    );

    await worker.stop({ reason: 'e2e_complete' });
    worker = null;
    await resetPool();

    const preRestartHealthResp = await fetch(`${pythonBaseUrl}/api/v1/health`);
    assert.strictEqual(preRestartHealthResp.status, 200);
    const preRestartHealth = await preRestartHealthResp.json();
    const preRestartInstanceId = preRestartHealth.data.instance_id;
    assert(preRestartInstanceId);

    const badRecoveryResp = await fetch(`${expressBaseUrl}/api/v1/internal/recovery/documents`, {
      headers: { 'X-Internal-Secret': 'wrong-recovery-secret' },
    });
    assert.strictEqual(badRecoveryResp.status, 401);

    if (uvicornProc.exitCode === null) {
      uvicornProc.kill();
      await new Promise((resolve) => uvicornProc.once('exit', resolve));
    }

    const dbElementsAfterPythonStop = await elementRepo.findByDocumentAndMode(dbDocBefore.id, initialJob.mode);
    assert.strictEqual(dbElementsAfterPythonStop.length, elementsAfterReprocess.length);
    assert(dbElementsAfterPythonStop.some((el) => el.text.includes(updatedPhraseV2)));

    const pythonPortRestarted = await getFreePort();
    const pythonBaseUrlRestarted = `http://127.0.0.1:${pythonPortRestarted}`;
    appConfig.pythonServiceUrl = pythonBaseUrlRestarted;

    uvicornProc = spawn(
      pythonExe,
      ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', String(pythonPortRestarted)],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          INTERNAL_API_SECRET: internalSecret,
          EXPRESS_SERVICE_URL: expressBaseUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    uvicornProc.stdout.on('data', (d) => {
      uvicornLogs += d.toString('utf8');
    });
    uvicornProc.stderr.on('data', (d) => {
      uvicornLogs += d.toString('utf8');
    });

    await waitForCondition(async () => {
      if (uvicornProc.exitCode !== null) {
        throw new Error(`Restarted Uvicorn exited early (${uvicornProc.exitCode}): ${uvicornLogs.slice(-500)}`);
      }
      try {
        const res = await fetch(`${pythonBaseUrlRestarted}/api/v1/health`);
        return res.ok;
      } catch {
        return false;
      }
    }, 180000, 500);

    const postRestartHealthResp = await fetch(`${pythonBaseUrlRestarted}/api/v1/health`);
    assert.strictEqual(postRestartHealthResp.status, 200);
    const postRestartHealth = await postRestartHealthResp.json();
    assert.notStrictEqual(postRestartHealth.data.instance_id, preRestartInstanceId);

    const directPostRestartSearchResp = await fetch(`${pythonBaseUrlRestarted}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: updatedPhraseV2,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(directPostRestartSearchResp.status, 200);
    const directPostRestartSearchJson = await directPostRestartSearchResp.json();
    assert.strictEqual(directPostRestartSearchJson.data.length, 1);
    assert(directPostRestartSearchJson.data[0].query_match_snippet.includes(updatedPhraseV2));
    assert.strictEqual(directPostRestartSearchJson.data[0].provenance?.source_file_hash, updatedSha);

    const directPostRestartStaleResp = await fetch(`${pythonBaseUrlRestarted}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: uniquePhrase,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(directPostRestartStaleResp.status, 200);
    const directPostRestartStaleJson = await directPostRestartStaleResp.json();
    assert(!directPostRestartStaleJson.data.some((hit) => hit.query_match_snippet.includes(uniquePhrase)));

    const expressPostRestartSearchResp = await fetch(`${expressBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: updatedPhraseV2,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(expressPostRestartSearchResp.status, 200);
    const expressPostRestartSearchJson = await expressPostRestartSearchResp.json();
    assert.strictEqual(expressPostRestartSearchJson.data.length, 1);
    assert.strictEqual(expressPostRestartSearchJson.data[0].provenance?.source_file_hash, updatedSha);

    reportTest(
      'E2E 6: Python Restart Recovery From Persisted MySQL Elements (Zero Duplicates/Stale Chunks)',
      true,
      `Restarted Python (${preRestartInstanceId.slice(0, 8)} -> ${postRestartHealth.data.instance_id.slice(0, 8)}), rebuilt FAISS from MySQL elements, confirmed V2 match and 0 V1 stale hits`
    );

    const delResp = await fetch(`${expressBaseUrl}/api/v1/documents/${uploadedDocId}`, {
      method: 'DELETE',
    });
    assert.strictEqual(delResp.status, 200);
    const searchAfterDelResp = await fetch(`${expressBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: updatedPhraseV2,
        document_id: uploadedDocId,
        min_score: 0.0,
        top_k: 5,
      }),
    });
    assert.strictEqual(searchAfterDelResp.status, 200);
    const searchAfterDelJson = await searchAfterDelResp.json();
    assert.strictEqual(searchAfterDelJson.data.length, 0);

    reportTest(
      'E2E 7: Soft-Delete Filtering in Express Search',
      true,
      'Soft-deleted document excluded cleanly from Express /api/v1/search results'
    );
  } finally {
    if (worker && worker.getState().status !== 'stopped') {
      await worker.stop({ reason: 'cleanup' }).catch(() => {});
    }
    if (httpServer) {
      await stopServer().catch(() => {});
    }
    if (uvicornProc && uvicornProc.exitCode === null) {
      uvicornProc.kill();
      await new Promise((resolve) => uvicornProc.once('exit', resolve));
    }
    appConfig.pythonServiceUrl = origPythonUrl;
    if (origInternalSecretEnv === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = origInternalSecretEnv;
    }
    await resetPool().catch(() => {});
    await cleanE2eRecords(uploadedDocIds, uploadedFilePaths).catch(() => {});
    await closePool().catch(() => {});
    if (fs.existsSync(tempSourcePdf)) {
      fs.unlinkSync(tempSourcePdf);
    }
  }

  console.log('\n=================================================================');
  console.log(`   END-TO-END UPLOAD-TO-SEARCH SUMMARY: ${passedTests}/${totalTests} PASSED`);
  console.log('=================================================================');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runEndToEndUploadToSearch().catch((err) => {
  const sanitized = sanitizeWorkerError(err);
  console.error('\nCRITICAL FAILURE in E2E upload-to-search suite:', sanitized);
  process.exit(1);
});
