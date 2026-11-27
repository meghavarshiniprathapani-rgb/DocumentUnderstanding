import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { config as appConfig } from '../config.js';
import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepo from '../db/repositories/documentRepository.js';
import * as elementRepo from '../db/repositories/elementRepository.js';
import * as jobRepo from '../db/repositories/jobRepository.js';
import { startServer, stopServer } from '../server.js';
import { ensurePythonRecovered, resetRecoveryState } from '../services/recoveryService.js';
import { createExtractionJobHandler } from '../worker/extractionHandler.js';
import { createPythonExtractionClient } from '../worker/pythonClient.js';

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

async function waitForCondition(predicate, timeoutMs = 90000, intervalMs = 200) {
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

function buildPdf(pythonExe, destPath, heading, body) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  execFileSync(
    pythonExe,
    [
      '-c',
      `import pymupdf as fitz; d = fitz.open(); p = d.new_page(width=612, height=792); p.insert_text((72,72), ${JSON.stringify(heading)}, fontsize=18); p.insert_text((72,120), ${JSON.stringify(body)}, fontsize=12); d.save(${JSON.stringify(destPath)}); d.close()`,
    ],
    { cwd: REPO_ROOT, timeout: 15000 }
  );
  return fs.readFileSync(destPath);
}

function spawnUvicorn(pythonExe, port, envOverrides) {
  const logs = { text: '' };
  const proc = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  proc.stdout.on('data', (d) => {
    logs.text += d.toString('utf8');
  });
  proc.stderr.on('data', (d) => {
    logs.text += d.toString('utf8');
  });
  return { proc, logs };
}

async function stopUvicorn(proc) {
  if (!proc || proc.exitCode !== null) {
    return;
  }
  try {
    proc.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    if (proc.exitCode === null) {
      proc.kill('SIGKILL');
    }
  } catch {
  }
}

async function cleanRecords(docIds, filePaths) {
  for (const fp of filePaths) {
    if (fp && fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch {
      }
    }
  }
  if (docIds.length > 0) {
    await query(`DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id IN (?))`, [
      docIds,
    ]);
    await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id IN (?))`, [
      docIds,
    ]);
    await query(`DELETE FROM documents WHERE document_id IN (?)`, [docIds]);
  }
}

async function runRecoveryHardeningSuite() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.6.7 RECOVERY HARDENING INTEGRATION SUITE     ');
  console.log('=================================================================');

  const pythonExe = getPythonExecutable();
  assert(pythonExe, 'Python virtual environment executable is required');

  const tag = Date.now();
  const readyDocId = `doc-m167-ready-${tag}`;
  const degradedDocId = `doc-m167-deg-${tag}`;
  const queuedDocId = `doc-m167-queued-${tag}`;
  const failedDocId = `doc-m167-failed-${tag}`;
  const deletedDocId = `doc-m167-del-${tag}`;
  const orphanDocId = `doc-m167-orphan-${tag}`;

  const readyToken = `M167ReadyToken${tag}`;
  const degradedToken = `M167DegradedToken${tag}`;
  const queuedToken = `M167QueuedToken${tag}`;
  const failedToken = `M167FailedToken${tag}`;
  const deletedToken = `M167DeletedToken${tag}`;
  const orphanToken = `M167OrphanToken${tag}`;

  const uploadDir = path.join(REPO_ROOT, 'data', 'uploads');
  const readyPdf = path.join(uploadDir, `${readyDocId}.pdf`);
  const degradedPdf = path.join(uploadDir, `${degradedDocId}.pdf`);
  const queuedPdf = path.join(uploadDir, `${queuedDocId}.pdf`);
  const failedPdf = path.join(uploadDir, `${failedDocId}.pdf`);
  const deletedPdf = path.join(uploadDir, `${deletedDocId}.pdf`);
  const orphanPdf = path.join(uploadDir, `${orphanDocId}.pdf`);

  const docIds = [readyDocId, degradedDocId, queuedDocId, failedDocId, deletedDocId];
  const filePaths = [readyPdf, degradedPdf, queuedPdf, failedPdf, deletedPdf, orphanPdf];

  const internalSecret = 'm167-hardening-secret-2026';
  const origPythonUrl = appConfig.pythonServiceUrl;
  const origSecretEnv = process.env.INTERNAL_API_SECRET;
  const origExpressEnv = process.env.EXPRESS_SERVICE_URL;

  let expressServer = null;
  let py1 = null;
  let py2 = null;

  try {
    await resetPool();
    resetRecoveryState();
    await cleanRecords(docIds, filePaths);

    const readyBytes = buildPdf(pythonExe, readyPdf, 'Ready Heading', readyToken);
    const degradedBytes = buildPdf(pythonExe, degradedPdf, 'Degraded Heading', degradedToken);
    const queuedBytes = buildPdf(pythonExe, queuedPdf, 'Queued Heading', queuedToken);
    const failedBytes = buildPdf(pythonExe, failedPdf, 'Failed Heading', failedToken);
    const deletedBytes = buildPdf(pythonExe, deletedPdf, 'Deleted Heading', deletedToken);
    buildPdf(pythonExe, orphanPdf, 'Orphan Heading', orphanToken);

    const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

    const readyDoc = await documentRepo.createDocument({
      document_id: readyDocId,
      filename: `${readyDocId}.pdf`,
      sha256: sha(readyBytes),
      path: `data/uploads/${readyDocId}.pdf`,
      pages_count: 1,
      status: 'ready',
      metadata: { is_degraded: false, extraction_status: 'Completed', indexing_status: 'Indexed' },
    });
    const readyJob = await jobRepo.createJob({ doc_id: readyDoc.id, mode: 'flat', status: 'queued' });
    const claimedReady = await jobRepo.claimJob('seed-worker', { leaseTimeoutSeconds: 60 });
    assert.strictEqual(claimedReady.id, readyJob.id);
    await elementRepo.replaceByDocumentAndMode(readyDoc.id, 'flat', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${readyToken} persisted ready content for FAISS verification`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.97,
        provenance: { element_id: `${readyDocId}_el_0`, source_file_hash: readyDoc.sha256 },
        flags: { is_degraded: false, degraded_reasons: [] },
        model_version: '1.0.0',
      },
    ]);
    await jobRepo.completeJob(readyJob.id, 'seed-worker', {
      status: 'done',
      claimToken: claimedReady.claim_token,
      leaseGeneration: claimedReady.lease_generation,
    });

    const degReason = 'Low confidence (0.38 < threshold 0.75)';
    const degDoc = await documentRepo.createDocument({
      document_id: degradedDocId,
      filename: `${degradedDocId}.pdf`,
      sha256: sha(degradedBytes),
      path: `data/uploads/${degradedDocId}.pdf`,
      pages_count: 1,
      status: 'degraded',
      metadata: {
        is_degraded: true,
        extraction_status: 'Completed',
        indexing_status: 'Indexed',
        extraction_warnings: [degReason],
      },
    });
    const degJob = await jobRepo.createJob({ doc_id: degDoc.id, mode: 'candidate', status: 'queued' });
    const claimedDeg = await jobRepo.claimJob('seed-worker', { leaseTimeoutSeconds: 60 });
    assert.strictEqual(claimedDeg.id, degJob.id);
    await elementRepo.replaceByDocumentAndMode(degDoc.id, 'candidate', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${degradedToken} degraded recovery content`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.38,
        provenance: {
          element_id: `${degradedDocId}_el_0`,
          source_file_hash: degDoc.sha256,
          calibrated_confidence: 0.38,
          is_degraded: true,
          degraded_reasons: [degReason],
        },
        flags: { is_degraded: true, degraded_reasons: [degReason] },
        model_version: '1.0.0',
      },
    ]);
    await jobRepo.completeJob(degJob.id, 'seed-worker', {
      status: 'degraded',
      claimToken: claimedDeg.claim_token,
      leaseGeneration: claimedDeg.lease_generation,
    });

    const queuedDoc = await documentRepo.createDocument({
      document_id: queuedDocId,
      filename: `${queuedDocId}.pdf`,
      sha256: sha(queuedBytes),
      path: `data/uploads/${queuedDocId}.pdf`,
      pages_count: 1,
      status: 'queued',
    });
    await elementRepo.replaceByDocumentAndMode(queuedDoc.id, 'flat', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${queuedToken} uncommitted queued content`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.9,
        provenance: { element_id: `${queuedDocId}_el_0`, source_file_hash: queuedDoc.sha256 },
        flags: { is_degraded: false, degraded_reasons: [] },
        model_version: '1.0.0',
      },
    ]);

    const failedDoc = await documentRepo.createDocument({
      document_id: failedDocId,
      filename: `${failedDocId}.pdf`,
      sha256: sha(failedBytes),
      path: `data/uploads/${failedDocId}.pdf`,
      pages_count: 1,
      status: 'failed',
    });
    await elementRepo.replaceByDocumentAndMode(failedDoc.id, 'flat', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${failedToken} failed document content`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.9,
        provenance: { element_id: `${failedDocId}_el_0`, source_file_hash: failedDoc.sha256 },
        flags: { is_degraded: false, degraded_reasons: [] },
        model_version: '1.0.0',
      },
    ]);

    const delDoc = await documentRepo.createDocument({
      document_id: deletedDocId,
      filename: `${deletedDocId}.pdf`,
      sha256: sha(deletedBytes),
      path: `data/uploads/${deletedDocId}.pdf`,
      pages_count: 1,
      status: 'ready',
    });
    await elementRepo.replaceByDocumentAndMode(delDoc.id, 'flat', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${deletedToken} soft deleted document content`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.9,
        provenance: { element_id: `${deletedDocId}_el_0`, source_file_hash: delDoc.sha256 },
        flags: { is_degraded: false, degraded_reasons: [] },
        model_version: '1.0.0',
      },
    ]);
    await documentRepo.softDelete(delDoc.id);

    const expressPort = await getFreePort();
    const expressBaseUrl = `http://127.0.0.1:${expressPort}`;
    const pythonPort1 = await getFreePort();
    const pythonBaseUrl1 = `http://127.0.0.1:${pythonPort1}`;

    appConfig.pythonServiceUrl = pythonBaseUrl1;
    process.env.INTERNAL_API_SECRET = internalSecret;

    expressServer = await startServer(expressPort);

    py1 = spawnUvicorn(pythonExe, pythonPort1, {
      INTERNAL_API_SECRET: internalSecret,
      EXPRESS_SERVICE_URL: expressBaseUrl,
    });
    await waitForCondition(async () => {
      if (py1.proc.exitCode !== null) {
        throw new Error(`py1 exited (${py1.proc.exitCode}): ${py1.logs.text.slice(-500)}`);
      }
      try {
        const res = await fetch(`${pythonBaseUrl1}/api/v1/health`);
        return res.ok;
      } catch {
        return false;
      }
    }, 180000, 400);

    const listResp = await fetch(`${pythonBaseUrl1}/api/v1/documents`);
    assert.strictEqual(listResp.status, 200);
    const listIds = new Set((await listResp.json()).data.map((d) => d.document_id));
    assert(listIds.has(readyDocId), 'Ready document must be present after startup recovery');
    assert(listIds.has(degradedDocId), 'Degraded document must be present after startup recovery');
    assert(!listIds.has(queuedDocId), 'Queued document must be excluded');
    assert(!listIds.has(failedDocId), 'Failed document must be excluded');
    assert(!listIds.has(deletedDocId), 'Soft-deleted document must be excluded');
    assert(!listIds.has(orphanDocId), 'Orphan disk PDF must be excluded');
    assert(fs.existsSync(queuedPdf), 'Queued disk PDF must not be unlinked by recovery');
    assert(fs.existsSync(failedPdf), 'Failed disk PDF must not be unlinked by recovery');

    const readySearch = await fetch(`${pythonBaseUrl1}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: readyToken, min_score: 0.0, top_k: 5 }),
    });
    const readyHits = (await readySearch.json()).data;
    assert.strictEqual(readyHits.filter((h) => h.document_id === readyDocId).length, 1);

    for (const [label, tok] of [
      ['queued', queuedToken],
      ['failed', failedToken],
      ['deleted', deletedToken],
      ['orphan', orphanToken],
    ]) {
      const r = await fetch(`${pythonBaseUrl1}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: tok, min_score: 0.0, top_k: 5 }),
      });
      const hits = (await r.json()).data;
      assert(!hits.some((h) => h.query_match_snippet.includes(tok)), `${label} document leaked in search`);
    }

    reportTest(
      'Test 1: Authoritative Startup Eligibility',
      true,
      'Ready & degraded recovered; queued, failed, soft-deleted, and orphan PDFs excluded'
    );

    const health1 = await (await fetch(`${pythonBaseUrl1}/api/v1/health`)).json();
    assert.strictEqual(health1.data.degraded_mode_active, true);
    assert.strictEqual(health1.data.status, 'degraded');
    const degSearch = await fetch(`${pythonBaseUrl1}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: degradedToken, document_id: degradedDocId, min_score: 0.0, top_k: 5 }),
    });
    const degHits = (await degSearch.json()).data;
    assert.strictEqual(degHits.length, 1);
    assert.strictEqual(degHits[0].is_degraded, true);
    assert(degHits[0].degraded_reasons.includes(degReason));
    assert(degHits[0].query_match_snippet.startsWith('[DEGRADED EXTRACTION:'));
    reportTest(
      'Test 2: Degraded Mode Restoration',
      true,
      'Restored degraded_mode_active=true, chunk signal, and actual degraded_reasons'
    );

    const initialIndexSize = health1.data.index_size;
    await ensurePythonRecovered({ force: true });
    await ensurePythonRecovered({ force: true });
    const reloadResp = await fetch(`${expressBaseUrl}/api/v1/health/reload`, { method: 'POST' });
    assert.strictEqual(reloadResp.status, 200);
    const healthAfterRepeat = await (await fetch(`${pythonBaseUrl1}/api/v1/health`)).json();
    assert.strictEqual(healthAfterRepeat.data.index_size, initialIndexSize);
    const repeatHits = (
      await (
        await fetch(`${expressBaseUrl}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: readyToken, document_id: readyDocId, min_score: 0.0, top_k: 10 }),
        })
      ).json()
    ).data;
    assert.strictEqual(repeatHits.length, 1);
    reportTest(
      'Test 3: Repeated Recovery Idempotence',
      true,
      `Index size stayed ${initialIndexSize} with zero duplicate chunks`
    );

    const concurrentRecs = await Promise.all([
      ensurePythonRecovered({ force: false }),
      ensurePythonRecovered({ force: true }),
      ensurePythonRecovered({ force: false }),
      ensurePythonRecovered({ force: true }),
    ]);
    assert(concurrentRecs.every((r) => r.reachable === true));
    const healthAfterConc = await (await fetch(`${pythonBaseUrl1}/api/v1/health`)).json();
    assert.strictEqual(healthAfterConc.data.index_size, initialIndexSize);
    reportTest(
      'Test 4: Concurrent Force Recovery Coalescing',
      true,
      'Concurrent ensurePythonRecovered calls coalesced cleanly without duplicate chunks'
    );

    const v2Job = await jobRepo.createJob({ doc_id: readyDoc.id, mode: 'candidate', status: 'queued' });
    const claimW1 = await jobRepo.claimJob('worker-stale-1', { leaseTimeoutSeconds: 1 });
    assert.strictEqual(claimW1.id, v2Job.id);

    await query(
      `UPDATE jobs SET heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 600 SECOND), locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 600 SECOND) WHERE id = ?`,
      [v2Job.id]
    );
    const recResult = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
    assert.strictEqual(recResult.requeuedCount, 1);

    const claimW2 = await jobRepo.claimJob('worker-fresh-2', { leaseTimeoutSeconds: 60 });
    assert.strictEqual(claimW2.id, v2Job.id);
    assert.strictEqual(Number(claimW2.lease_generation), 2);

    const v2Token = `Worker2AuthoritativeV2Token${tag}`;
    const v1StaleToken = `Worker1StaleV1Token${tag}`;

    await elementRepo.replaceByDocumentAndMode(readyDoc.id, 'candidate', [
      {
        type: 'text',
        page: 1,
        reading_order: 0,
        text: `${v2Token} winning worker V2 extraction`,
        bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
        confidence: 0.99,
        provenance: { element_id: `${readyDocId}_v2_0`, source_file_hash: readyDoc.sha256 },
        flags: { is_degraded: false, degraded_reasons: [] },
        model_version: '1.0.0',
      },
    ]);

    const w2IndexResp = await fetch(`${pythonBaseUrl1}/api/v1/internal/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        document_id: readyDocId,
        file_hash: readyDoc.sha256,
        filename: `${readyDocId}.pdf`,
        mode: 'candidate',
        is_degraded: false,
        page_count: 1,
        job_id: claimW2.id,
        worker_id: 'worker-fresh-2',
        claim_token: claimW2.claim_token,
        lease_generation: claimW2.lease_generation,
        elements: [
          {
            page: 1,
            type: 'text',
            reading_order: 0,
            text: `${v2Token} winning worker V2 extraction`,
            bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
            confidence: 0.99,
            provenance: { element_id: `${readyDocId}_v2_0`, source_file_hash: readyDoc.sha256 },
            flags: { is_degraded: false, degraded_reasons: [] },
          },
        ],
      }),
    });
    assert.strictEqual(w2IndexResp.status, 200);

    await jobRepo.completeJob(claimW2.id, 'worker-fresh-2', {
      status: 'done',
      claimToken: claimW2.claim_token,
      leaseGeneration: claimW2.lease_generation,
    });

    const staleHttpResp = await fetch(`${pythonBaseUrl1}/api/v1/internal/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        document_id: readyDocId,
        file_hash: readyDoc.sha256,
        filename: `${readyDocId}.pdf`,
        mode: 'candidate',
        is_degraded: false,
        page_count: 1,
        job_id: claimW1.id,
        worker_id: 'worker-stale-1',
        claim_token: claimW1.claim_token,
        lease_generation: claimW1.lease_generation,
        elements: [
          {
            page: 1,
            type: 'text',
            reading_order: 0,
            text: `${v1StaleToken} stale overwrite attempt`,
            bbox: { x0: 72, y0: 100, x1: 420, y1: 130 },
            confidence: 0.95,
            provenance: { element_id: `${readyDocId}_v1_stale`, source_file_hash: readyDoc.sha256 },
            flags: { is_degraded: false, degraded_reasons: [] },
          },
        ],
      }),
    });
    assert.strictEqual(staleHttpResp.status, 409, `Expected 409 for stale worker, got ${staleHttpResp.status}`);

    let preIndexCalled = false;
    const pyClient = createPythonExtractionClient({
      baseUrl: pythonBaseUrl1,
      internalApiSecret: internalSecret,
      fetchImpl: async (url, init) => {
        if (String(url).includes('/api/v1/internal/index')) {
          preIndexCalled = true;
        }
        return fetch(url, init);
      },
    });
    let capturedElements = [];
    const handler = createExtractionJobHandler({
      pythonClient: pyClient,
      elementRepository: {
        replacePersistedElementsFenced: async (_jobId, _workerId, details) => {
          capturedElements = details.elements;
          return { insertedCount: capturedElements.length };
        },
        findByDocumentAndMode: async () => capturedElements,
      },
      jobRepository: {
        verifyLeaseOwnership: async (jId, wId, opts) => jobRepo.verifyLeaseOwnership(jId, wId, opts),
      },
    });
    await assert.rejects(
      async () => {
        await handler({
          job: {
            id: claimW1.id,
            doc_id: readyDoc.id,
            mode: 'candidate',
          },
          workerId: 'worker-stale-1',
          claimToken: claimW1.claim_token,
          leaseGeneration: claimW1.lease_generation,
          startedAt: Date.now(),
        });
      },
      (err) => err.name === 'LeaseOwnershipError' || err.name === 'InvalidJobTransitionError'
    );
    assert.strictEqual(preIndexCalled, false, 'Pre-index verifyLeaseOwnership must stop stale worker before HTTP index');

    const v2Hits = (
      await (
        await fetch(`${pythonBaseUrl1}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: v2Token, document_id: readyDocId, min_score: 0.0, top_k: 5 }),
        })
      ).json()
    ).data;
    assert.strictEqual(v2Hits.length, 1);
    const staleSearchHits = (
      await (
        await fetch(`${pythonBaseUrl1}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: v1StaleToken, document_id: readyDocId, min_score: 0.0, top_k: 5 }),
        })
      ).json()
    ).data;
    assert(!staleSearchHits.some((h) => h.query_match_snippet.includes(v1StaleToken)));
    reportTest(
      'Test 5: Stale Worker HTTP 409 & Pre-Index Fencing',
      true,
      'Stale claim_token/lease_generation rejected cleanly; V2 intact in FAISS'
    );

    const searchPromises = [];
    for (let i = 0; i < 12; i += 1) {
      searchPromises.push(
        fetch(`${expressBaseUrl}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: v2Token, min_score: 0.0, top_k: 5 }),
        })
      );
      if (i % 4 === 0) {
        searchPromises.push(ensurePythonRecovered({ force: true }));
      }
    }
    const concResponses = await Promise.all(searchPromises);
    for (const item of concResponses) {
      if (item instanceof Response) {
        assert.strictEqual(item.status, 200);
      }
    }
    reportTest(
      'Test 6: Concurrent Search + Recovery Under Load',
      true,
      '12 concurrent search & forced recovery operations succeeded without error'
    );

    await documentRepo.updateStatus(readyDoc.id, 'failed');
    await ensurePythonRecovered({ force: true });
    const postIneligibleDocs = new Set(
      (await (await fetch(`${pythonBaseUrl1}/api/v1/documents`)).json()).data.map((d) => d.document_id)
    );
    assert(!postIneligibleDocs.has(readyDocId), 'Transitioned-to-failed doc must be purged from Python memory');
    assert(fs.existsSync(readyPdf), 'Ineligible purge must preserve disk PDF');
    await documentRepo.updateStatus(readyDoc.id, 'ready');
    await ensurePythonRecovered({ force: true });
    const postRestoreDocs = new Set(
      (await (await fetch(`${pythonBaseUrl1}/api/v1/documents`)).json()).data.map((d) => d.document_id)
    );
    assert(postRestoreDocs.has(readyDocId), 'Restored-to-ready doc must be recovered again');
    reportTest(
      'Test 7: Live Ineligible Purge Without Disk Deletion',
      true,
      'Marked failed doc purged from Python memory with disk PDF intact, then restored when ready'
    );

    const pythonPort2 = await getFreePort();
    const deadExpressPort = await getFreePort();
    const pythonBaseUrl2 = `http://127.0.0.1:${pythonPort2}`;
    py2 = spawnUvicorn(pythonExe, pythonPort2, {
      INTERNAL_API_SECRET: internalSecret,
      EXPRESS_SERVICE_URL: `http://127.0.0.1:${deadExpressPort}`,
    });
    await waitForCondition(async () => {
      if (py2.proc.exitCode !== null) {
        throw new Error(`py2 exited (${py2.proc.exitCode}): ${py2.logs.text.slice(-500)}`);
      }
      try {
        const res = await fetch(`${pythonBaseUrl2}/api/v1/health`);
        return res.ok;
      } catch {
        return false;
      }
    }, 180000, 400);

    const py2Docs = (await (await fetch(`${pythonBaseUrl2}/api/v1/documents`)).json()).data;
    const py2Uploads = py2Docs.filter((d) => d.category === 'User Upload');
    assert.strictEqual(py2Uploads.length, 0, 'FastAPI startup with Express down must expose 0 upload documents');
    reportTest(
      'Test 8: FastAPI Startup With Express Unavailable',
      true,
      '0 uploaded/orphan documents exposed when MySQL recovery source is unreachable'
    );
  } finally {
    if (py2) await stopUvicorn(py2.proc);
    if (py1) await stopUvicorn(py1.proc);
    await cleanRecords(docIds, filePaths).catch((e) => console.error('Cleanup error:', e));
    await stopServer().catch(() => {});
    if (expressServer && expressServer.listening) {
      expressServer.close();
    }
    appConfig.pythonServiceUrl = origPythonUrl;
    if (origSecretEnv === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = origSecretEnv;
    }
    if (origExpressEnv === undefined) {
      delete process.env.EXPRESS_SERVICE_URL;
    } else {
      process.env.EXPRESS_SERVICE_URL = origExpressEnv;
    }
    resetRecoveryState();
    await closePool().catch(() => {});
  }

  console.log(`\nSUMMARY: ${passedTests}/${totalTests} passed`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runRecoveryHardeningSuite().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
