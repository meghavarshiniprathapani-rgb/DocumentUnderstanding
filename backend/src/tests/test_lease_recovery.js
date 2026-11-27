import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepo from '../db/repositories/documentRepository.js';
import * as elementRepo from '../db/repositories/elementRepository.js';
import * as jobRepo from '../db/repositories/jobRepository.js';
import { LeaseOwnershipError } from '../db/repositories/jobRepository.js';
import { serializeDocument } from '../utils/serializers.js';
import {
  WorkerConfigError,
  createWorker,
  createWorkerLogger,
  loadWorkerConfig,
} from '../worker/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
dotenv.config({ path: path.resolve(REPO_ROOT, '.env') });

let passedTests = 0;
let totalTests = 0;

function reportTest(name, passed, detail = '') {
  totalTests += 1;
  if (passed) {
    passedTests += 1;
    console.log(`  PASS: [${name}] ${detail}`);
  } else {
    console.error(`  FAIL: [${name}] ${detail}`);
  }
}

function createBarrier() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForCondition(predicate, timeoutMs = 15000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function waitForJobLeaseExpiredInDb(jobId, timeoutMs = 10000) {
  await waitForCondition(async () => {
    const [rows] = await query(
      `SELECT id
       FROM jobs
       WHERE id = ?
         AND status = 'running'
         AND COALESCE(heartbeat_at, locked_at) < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL lease_timeout_seconds SECOND)`,
      [jobId]
    );
    return rows.length > 0;
  }, timeoutMs, 100);
}

function buildValidEnvelope({
  documentId = 'test-lease-rec-doc',
  mode = 'reference',
  status = 'processed',
  pageCount = 2,
} = {}) {
  return {
    config_version: '1.0.0',
    status: 'success',
    message: 'Document extraction completed successfully',
    data: {
      document_id: documentId,
      mode,
      status,
      page_count: pageCount,
      elements: [
        {
          element_id: `${documentId}_el_0`,
          page: 1,
          type: 'heading',
          reading_order: 0,
          text: 'Lease Recovery Heading',
          bbox: { x0: 72, y0: 72, x1: 500, y1: 96, x: 72, y: 72, width: 428, height: 24 },
          table_data: null,
          formula_latex: null,
          raw_confidence: 0.98,
          calibrated_confidence: null,
          provenance: null,
          flags: { is_degraded: false, degraded_reasons: [] },
          model_version: '1.25.0',
        },
        {
          element_id: `${documentId}_el_1`,
          page: 2,
          type: 'text',
          reading_order: 1,
          text: 'Lease recovery body verification snippet.',
          bbox: { x0: 72, y0: 120, x1: 540, y1: 180, x: 72, y: 120, width: 468, height: 60 },
          table_data: null,
          formula_latex: null,
          raw_confidence: 0.96,
          calibrated_confidence: null,
          provenance: null,
          flags: { is_degraded: false, degraded_reasons: [] },
          model_version: '1.25.0',
        },
      ],
      processing_time_ms: 15.2,
      extractor: {
        name: 'PyMuPDF',
        version: '1.25.0',
        fallback_occurred: false,
        fallback_reason: null,
      },
      model_versions: {
        extractor: 'PyMuPDF:1.25.0',
        embedding: 'HashEmbedder:128d:seed42',
        layout_engine: 'LayoutOrderRecovery:v1.0.0',
        provenance_subsystem: 'None:Uncalibrated',
      },
      extraction_warnings: [],
      indexing_status: 'Indexed',
      indexing_diagnostics: {
        vector_store: 'FAISS',
        latest_version_indexed: true,
        previous_version_searchable: false,
        searchable: true,
        chunk_count: 2,
      },
      fallback: null,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildIndexEnvelope({ documentId = 'test-lease-rec-doc', mode = 'reference' } = {}) {
  return {
    config_version: '1.0.0',
    status: 'success',
    message: 'Persisted extraction indexed and replacement FAISS index built',
    data: {
      document_id: documentId,
      mode,
      indexing_status: 'Indexed',
      indexing_diagnostics: {
        vector_store: 'FAISS',
        durable_on_disk: false,
        latest_version_indexed: true,
        previous_version_searchable: false,
        searchable: true,
        chunk_count: 2,
        persisted_elements_indexed: 2,
      },
      chunk_count: 2,
      searchable: true,
      processing_time_ms: 8.5,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildSearchEnvelope({
  documentId = 'test-lease-rec-doc',
  sourceFileHash = null,
} = {}) {
  return {
    config_version: '1.0.0',
    status: 'success',
    message: 'Query executed with 1 matches',
    data: [
      {
        id: `res-${documentId}_chunk_0`,
        document_id: documentId,
        document_title: `${documentId}.pdf`,
        category: 'User Upload',
        page_number: 1,
        result_title: `Heading match in ${documentId}.pdf (Page 1)`,
        content_type: 'Heading',
        relevance_score: 0.94,
        query_match_snippet: 'Lease Recovery Heading',
        bounding_region: { x: 72, y: 72, width: 428, height: 24 },
        table_data: null,
        highlights: ['Lease Recovery'],
        reading_order: 1,
        provenance: sourceFileHash
          ? {
              source_file_hash: sourceFileHash,
              page_number: 1,
              extractor_name: 'PyMuPDF',
              config_id: 'O3-v1.0.0',
            }
          : null,
        confidence: 0.98,
        calibrated_confidence: null,
        is_degraded: false,
        degraded_reasons: [],
        fallback_strategy: null,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

async function startMockPythonServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    let reqAborted = false;

    req.on('aborted', () => {
      reqAborted = true;
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        reqAborted = true;
      }
    });

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsedBody = null;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
      } catch {
      }
      const record = {
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        rawBody,
        body: parsedBody,
        isAborted: () => reqAborted || req.destroyed || res.destroyed,
      };
      requests.push(record);
      try {
        await handler(req, res, record);
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: err.message }));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function spawnChildWorker(envOverrides, spawnedChildren) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    WORKER_MODE: 'reference',
    WORKER_CONCURRENCY: '1',
    WORKER_POLL_INTERVAL_MS: '40',
    WORKER_HEARTBEAT_INTERVAL_MS: '5000',
    WORKER_SHUTDOWN_GRACE_MS: '500',
    WORKER_MAX_ATTEMPTS: '3',
    WORKER_LEASE_RECOVERY_INTERVAL_MS: '60000',
    WORKER_LEASE_RECOVERY_BATCH_SIZE: '25',
    PYTHON_EXTRACTION_TIMEOUT_MS: '15000',
    ...envOverrides,
  };

  const child = spawn(process.execPath, ['src/worker.js'], {
    cwd: BACKEND_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        logs.push(JSON.parse(trimmed));
      } catch {
        logs.push({ raw: trimmed });
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) {
      logs.push({ stderr: text });
    }
  });

  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  if (Array.isArray(spawnedChildren)) {
    spawnedChildren.push({ child, exitPromise });
  }

  await waitForCondition(
    () => logs.some((entry) => entry.event === 'worker_started') || child.exitCode !== null,
    10000,
    20
  );

  if (child.exitCode !== null) {
    throw new Error(`Child worker exited unexpectedly with code ${child.exitCode}: ${JSON.stringify(logs)}`);
  }

  return { child, logs, exitPromise };
}

async function killChildHard(childEntry) {
  if (!childEntry || !childEntry.child) return null;
  if (childEntry.child.exitCode === null) {
    childEntry.child.kill('SIGKILL');
  }
  return childEntry.exitPromise;
}

async function createTestDocAndJob(suffix, jobOverrides = {}, docOverrides = {}) {
  const uniqueDocId = `test-lease-rec-${suffix}-${crypto.randomUUID().slice(0, 8)}`;
  const doc = await documentRepo.createDocument({
    document_id: uniqueDocId,
    filename: `${uniqueDocId}.pdf`,
    sha256: crypto.createHash('sha256').update(uniqueDocId).digest('hex'),
    path: `data/uploads/${uniqueDocId}.pdf`,
    pages_count: 2,
    doc_type: 'pdf',
    split: 'none',
    status: 'queued',
    ...docOverrides,
  });

  const job = await jobRepo.createJob({
    doc_id: doc.id,
    mode: 'reference',
    status: 'queued',
    lease_timeout_seconds: 1,
    ...jobOverrides,
  });

  return { doc, job };
}

async function cleanLeaseRecoveryTestData() {
  await query(
    `DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-lease-rec-%')`
  );
  await query(
    `DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-lease-rec-%')`
  );
  await query(`DELETE FROM documents WHERE document_id LIKE 'test-lease-rec-%'`);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function createPipelineHandler(docHashByDocId, hooks = {}) {
  return async (req, res, record) => {
    const parsedUrl = req.url || '';
    if (parsedUrl === '/api/v1/internal/extract' && req.method === 'POST') {
      if (typeof hooks.onExtract === 'function') {
        const cont = await hooks.onExtract(req, res, record);
        if (cont === false) return;
      }
      const docId = record.body?.document_id || 'unknown';
      const mode = record.body?.mode || 'reference';
      sendJson(res, 200, buildValidEnvelope({ documentId: docId, mode }));
      return;
    }

    if (parsedUrl === '/api/v1/internal/index' && req.method === 'POST') {
      if (typeof hooks.onIndex === 'function') {
        const cont = await hooks.onIndex(req, res, record);
        if (cont === false) return;
      }
      const docId = record.body?.document_id || 'unknown';
      const mode = record.body?.mode || 'reference';
      sendJson(res, 200, buildIndexEnvelope({ documentId: docId, mode }));
      return;
    }

    if (parsedUrl === '/api/v1/search' && req.method === 'POST') {
      if (typeof hooks.onSearch === 'function') {
        const cont = await hooks.onSearch(req, res, record);
        if (cont === false) return;
      }
      const docId = record.body?.document_id || 'unknown';
      const sourceFileHash = docHashByDocId.get(docId) || null;
      sendJson(res, 200, buildSearchEnvelope({ documentId: docId, sourceFileHash }));
      return;
    }

    sendJson(res, 404, { detail: `Unhandled route ${req.method} ${parsedUrl}` });
  };
}

async function runLeaseRecoveryTests() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.6.6 AUTOMATIC LEASE RECOVERY TEST SUITE      ');
  console.log('=================================================================');

  const testSecret = 'test-lease-rec-secret-token-xyz';
  const baseEnv = {
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DB_PORT: process.env.DB_PORT || '3306',
    DB_USER: process.env.DB_USER || 'docuretrieve_user',
    DB_PASSWORD: process.env.DB_PASSWORD || 'test-db-secret',
    DB_NAME: process.env.DB_NAME || 'docuretrieve',
    INTERNAL_API_SECRET: testSecret,
    PYTHON_SERVICE_URL: 'http://127.0.0.1:18000',
    PYTHON_EXTRACTION_TIMEOUT_MS: '15000',
  };

  const activeServers = [];
  const activeWorkers = [];
  const spawnedChildren = [];

  try {
    await resetPool();
    await cleanLeaseRecoveryTestData();

    console.log('\n--- SECTION 1: CONFIGURATION, BOUNDS & SECRET SCRUBBING ---');

    const defaultCfg = loadWorkerConfig({}, baseEnv);
    assert.strictEqual(defaultCfg.leaseRecoveryIntervalMs, 30000);
    assert.strictEqual(defaultCfg.leaseRecoveryBatchSize, 25);
    assert.strictEqual(Object.prototype.propertyIsEnumerable.call(defaultCfg, 'internalApiSecret'), false);

    const customCfg = loadWorkerConfig(
      {},
      {
        ...baseEnv,
        WORKER_LEASE_RECOVERY_INTERVAL_MS: '20',
        WORKER_LEASE_RECOVERY_BATCH_SIZE: '1',
      }
    );
    assert.strictEqual(customCfg.leaseRecoveryIntervalMs, 20);
    assert.strictEqual(customCfg.leaseRecoveryBatchSize, 1);

    const upperCfg = loadWorkerConfig(
      {},
      {
        ...baseEnv,
        WORKER_LEASE_RECOVERY_INTERVAL_MS: '3600000',
        WORKER_LEASE_RECOVERY_BATCH_SIZE: '100',
      }
    );
    assert.strictEqual(upperCfg.leaseRecoveryIntervalMs, 3600000);
    assert.strictEqual(upperCfg.leaseRecoveryBatchSize, 100);

    for (const [key, badVal] of [
      ['WORKER_LEASE_RECOVERY_INTERVAL_MS', '19'],
      ['WORKER_LEASE_RECOVERY_INTERVAL_MS', '3600001'],
      ['WORKER_LEASE_RECOVERY_INTERVAL_MS', 'abc'],
      ['WORKER_LEASE_RECOVERY_BATCH_SIZE', '0'],
      ['WORKER_LEASE_RECOVERY_BATCH_SIZE', '101'],
      ['WORKER_LEASE_RECOVERY_BATCH_SIZE', '1.5'],
    ]) {
      assert.throws(
        () => loadWorkerConfig({}, { ...baseEnv, [key]: badVal }),
        WorkerConfigError,
        `Expected WorkerConfigError for ${key}=${badVal}`
      );
    }

    reportTest('CONFIG 1', true, 'Lease recovery interval and batch size validation verified');

    const scrubbedLogs = [];
    const customLogger = createWorkerLogger({
      workerId: 'scrub-worker',
      env: baseEnv,
      extraSecrets: ['super-extra-secret'],
      sink: (level, line, payload) => scrubbedLogs.push({ level, line, payload }),
    });
    const leakRepo = {
      claimJob: async () => null,
      recoverExpiredLeases: async () => {
        throw new Error(`DB connect failed for ${baseEnv.DB_PASSWORD} using ${testSecret} and super-extra-secret`);
      },
    };
    const scrubWorker = createWorker({
      config: { pollIntervalMs: 50, leaseRecoveryIntervalMs: 60000 },
      env: baseEnv,
      extraSecrets: ['super-extra-secret'],
      repository: leakRepo,
      jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
      logger: customLogger,
      closeDbOnStop: false,
    });
    activeWorkers.push(scrubWorker);
    await scrubWorker.start();
    const scrubState = scrubWorker.getState();
    await scrubWorker.stop();

    const errJson = JSON.stringify(scrubbedLogs);
    assert.ok(errJson.includes('lease_recovery_error'), 'Logger must capture lease_recovery_error');
    assert.ok(!errJson.includes(baseEnv.DB_PASSWORD), 'Logs must never contain DB_PASSWORD');
    assert.ok(!errJson.includes(testSecret), 'Logs must never contain INTERNAL_API_SECRET');
    assert.ok(!errJson.includes('super-extra-secret'), 'Logs must never contain extraSecrets');
    assert.strictEqual(scrubState.metrics.leaseRecoveryErrors, 1);
    assert.ok(scrubState.lastRecoveryError && scrubState.lastRecoveryError.message.includes('******'));
    reportTest('CONFIG 2', true, 'Secret redaction on recovery failure verified');

    console.log('\n--- SECTION 2: REAL CHILD PROCESS CRASHES (TESTS 1–4) ---');

    {
      const docHashMap = new Map();
      let holdExtract = true;

      const server = await startMockPythonServer(
        createPipelineHandler(docHashMap, {
          onExtract: async () => {
            if (holdExtract) {
              return false;
            }
            return true;
          },
        })
      );
      activeServers.push(server);

      const { doc, job } = await createTestDocAndJob('t1');
      docHashMap.set(doc.document_id, doc.sha256);

      const crashWorkerId = `crash-claim-${crypto.randomUUID().slice(0, 6)}`;
      const child1 = await spawnChildWorker(
        {
          WORKER_ID: crashWorkerId,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await waitForCondition(async () => {
        const j = await jobRepo.findById(job.id);
        return j && j.status === 'running' && j.locked_by === crashWorkerId;
      }, 10000, 15);

      const preKillJob = await jobRepo.findById(job.id);
      assert.strictEqual(preKillJob.status, 'running');
      assert.strictEqual(preKillJob.attempts, 1);
      assert.strictEqual(preKillJob.lease_generation, 1);
      assert.ok(preKillJob.claim_token);

      await killChildHard(child1);
      await waitForJobLeaseExpiredInDb(job.id);

      holdExtract = false;
      const survivorId = `survivor-t1-${crypto.randomUUID().slice(0, 6)}`;
      const child2 = await spawnChildWorker(
        {
          WORKER_ID: survivorId,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await waitForCondition(async () => {
        const j = await jobRepo.findById(job.id);
        return j && j.status === 'done';
      }, 15000, 30);

      const finalJob = await jobRepo.findById(job.id);
      const finalDoc = await documentRepo.findById(doc.id);
      const finalElements = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      assert.strictEqual(finalJob.status, 'done');
      assert.strictEqual(finalJob.attempts, 2);
      assert.strictEqual(finalJob.lease_generation, 2);
      assert.strictEqual(finalJob.locked_by, null);
      assert.strictEqual(finalJob.claim_token, null);
      assert.strictEqual(finalDoc.status, 'ready');
      assert.strictEqual(finalElements.length, 2);
      assert.ok(
        child2.logs.some((l) => l.event === 'expired_leases_recovered' && l.trigger === 'startup')
      );

      await killChildHard(child2);
      await server.close();
      reportTest('TEST 1', true, 'Child worker SIGKILL right after claim recovered & completed cleanly');
    }

    {
      const docHashMap = new Map();
      const extractStarted = createBarrier();
      let holdFirstExtract = true;
      let firstRecord = null;

      const server = await startMockPythonServer(
        createPipelineHandler(docHashMap, {
          onExtract: async (req, res, record) => {
            if (holdFirstExtract) {
              holdFirstExtract = false;
              firstRecord = record;
              extractStarted.resolve(record);
              return false;
            }
            return true;
          },
        })
      );
      activeServers.push(server);

      const { doc, job } = await createTestDocAndJob('t2');
      docHashMap.set(doc.document_id, doc.sha256);

      const crashWorkerId = `crash-extract-${crypto.randomUUID().slice(0, 6)}`;
      const child1 = await spawnChildWorker(
        {
          WORKER_ID: crashWorkerId,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await extractStarted.promise;
      assert.strictEqual(firstRecord.body.document_id, doc.document_id);
      const elsBeforeKill = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      assert.strictEqual(elsBeforeKill.length, 0);

      await killChildHard(child1);
      await waitForCondition(() => firstRecord.isAborted(), 5000, 20);
      await waitForJobLeaseExpiredInDb(job.id);

      const child2 = await spawnChildWorker(
        {
          WORKER_ID: `survivor-t2-${crypto.randomUUID().slice(0, 6)}`,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await waitForCondition(async () => {
        const j = await jobRepo.findById(job.id);
        return j && j.status === 'done';
      }, 15000, 30);

      const finalJob = await jobRepo.findById(job.id);
      const finalDoc = await documentRepo.findById(doc.id);
      const finalElements = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      assert.strictEqual(finalJob.status, 'done');
      assert.strictEqual(finalJob.attempts, 2);
      assert.strictEqual(finalJob.lease_generation, 2);
      assert.strictEqual(finalDoc.status, 'ready');
      assert.strictEqual(finalElements.length, 2);

      await killChildHard(child2);
      await server.close();
      reportTest('TEST 2', true, 'Child worker SIGKILL during Python extraction recovered & completed cleanly');
    }

    {
      const docHashMap = new Map();
      const indexArrived = createBarrier();
      let holdFirstIndex = true;

      const server = await startMockPythonServer(
        createPipelineHandler(docHashMap, {
          onIndex: async (req, res, record) => {
            if (holdFirstIndex) {
              holdFirstIndex = false;
              indexArrived.resolve(record);
              return false;
            }
            return true;
          },
        })
      );
      activeServers.push(server);

      const { doc, job } = await createTestDocAndJob('t3');
      docHashMap.set(doc.document_id, doc.sha256);

      const crashWorkerId = `crash-persist-${crypto.randomUUID().slice(0, 6)}`;
      const child1 = await spawnChildWorker(
        {
          WORKER_ID: crashWorkerId,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await indexArrived.promise;
      const persistedPreKill = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      const jobPreKill = await jobRepo.findById(job.id);
      assert.strictEqual(persistedPreKill.length, 2);
      assert.strictEqual(jobPreKill.status, 'running');

      await killChildHard(child1);
      await waitForJobLeaseExpiredInDb(job.id);

      const jobStillRunning = await jobRepo.findById(job.id);
      const docStillQueued = await documentRepo.findById(doc.id);
      assert.strictEqual(jobStillRunning.status, 'running');
      assert.strictEqual(docStillQueued.status, 'queued');

      const child2 = await spawnChildWorker(
        {
          WORKER_ID: `survivor-t3-${crypto.randomUUID().slice(0, 6)}`,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await waitForCondition(async () => {
        const j = await jobRepo.findById(job.id);
        return j && j.status === 'done';
      }, 15000, 30);

      const finalJob = await jobRepo.findById(job.id);
      const finalDoc = await documentRepo.findById(doc.id);
      const finalElements = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      assert.strictEqual(finalJob.status, 'done');
      assert.strictEqual(finalJob.attempts, 2);
      assert.strictEqual(finalJob.lease_generation, 2);
      assert.strictEqual(finalDoc.status, 'ready');
      assert.strictEqual(finalElements.length, 2);

      await killChildHard(child2);
      await server.close();
      reportTest('TEST 3', true, 'Child worker SIGKILL after persistence recovered idempotently without duplicates');
    }

    {
      const docHashMap = new Map();
      const searchArrived = createBarrier();
      let holdFirstSearch = true;
      let indexedCompleted = false;

      const server = await startMockPythonServer(
        createPipelineHandler(docHashMap, {
          onIndex: async () => {
            indexedCompleted = true;
            return true;
          },
          onSearch: async (req, res, record) => {
            if (holdFirstSearch) {
              holdFirstSearch = false;
              searchArrived.resolve(record);
              return false;
            }
            return true;
          },
        })
      );
      activeServers.push(server);

      const { doc, job } = await createTestDocAndJob('t4');
      docHashMap.set(doc.document_id, doc.sha256);

      const child1 = await spawnChildWorker(
        {
          WORKER_ID: `crash-index-${crypto.randomUUID().slice(0, 6)}`,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await searchArrived.promise;
      assert.strictEqual(indexedCompleted, true);
      const jobBeforeKill = await jobRepo.findById(job.id);
      assert.strictEqual(jobBeforeKill.status, 'running');

      await killChildHard(child1);
      await waitForJobLeaseExpiredInDb(job.id);

      const child2 = await spawnChildWorker(
        {
          WORKER_ID: `survivor-t4-${crypto.randomUUID().slice(0, 6)}`,
          PYTHON_SERVICE_URL: server.baseUrl,
          INTERNAL_API_SECRET: testSecret,
        },
        spawnedChildren
      );

      await waitForCondition(async () => {
        const j = await jobRepo.findById(job.id);
        return j && j.status === 'done';
      }, 15000, 30);

      const finalJob = await jobRepo.findById(job.id);
      const finalDoc = await documentRepo.findById(doc.id);
      const finalElements = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      assert.strictEqual(finalJob.status, 'done');
      assert.strictEqual(finalJob.attempts, 2);
      assert.strictEqual(finalJob.lease_generation, 2);
      assert.strictEqual(finalDoc.status, 'ready');
      assert.strictEqual(finalElements.length, 2);

      await killChildHard(child2);
      await server.close();
      reportTest('TEST 4', true, 'Child worker SIGKILL after indexing before completion recovered & finished cleanly');
    }

    console.log('\n--- SECTION 3: STARTUP, PERIODIC, CONCURRENCY, LIMITS & FENCING (TESTS 5–12) ---');

    {
      const { doc: docA, job: jobA } = await createTestDocAndJob('t5a');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-startup-worker',
             claim_token = ?,
             lease_generation = 3,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), jobA.id]
      );

      const { doc: docLegacy, job: jobLegacy } = await createTestDocAndJob('t5-legacy');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = NULL,
             claim_token = NULL,
             lease_generation = 0,
             locked_at = NULL,
             heartbeat_at = NULL
         WHERE id = ?`,
        [jobLegacy.id]
      );

      const handledDocs = [];
      const startupWorker = createWorker({
        config: {
          workerId: 't5-startup-worker',
          pollIntervalMs: 50,
          leaseRecoveryIntervalMs: 60000,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async (ctx) => {
          handledDocs.push(ctx.job.doc_id);
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(startupWorker);
      await startupWorker.start();

      await waitForCondition(async () => {
        const a = await jobRepo.findById(jobA.id);
        const l = await jobRepo.findById(jobLegacy.id);
        return a?.status === 'done' && l?.status === 'done';
      }, 10000, 25);

      const doneA = await jobRepo.findById(jobA.id);
      const doneL = await jobRepo.findById(jobLegacy.id);
      assert.strictEqual(doneA.lease_generation, 4);
      assert.strictEqual(doneA.attempts, 2);
      assert.strictEqual(doneL.lease_generation, 1);
      assert.strictEqual(doneL.attempts, 2);
      assert.strictEqual(startupWorker.getState().metrics.jobsRecovered, 2);
      await startupWorker.stop();

      const periodicWorker = createWorker({
        config: {
          workerId: 't5-periodic-worker',
          pollIntervalMs: 10000,
          leaseRecoveryIntervalMs: 50,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
        closeDbOnStop: false,
      });
      activeWorkers.push(periodicWorker);
      await periodicWorker.start();

      await waitForCondition(() => periodicWorker.getState().metrics.leaseRecoveryRuns >= 2, 5000, 20);
      const { doc: docB, job: jobB } = await createTestDocAndJob('t5b');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-periodic-worker',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), jobB.id]
      );

      const wakeStart = Date.now();
      await waitForCondition(async () => {
        const b = await jobRepo.findById(jobB.id);
        return b?.status === 'done';
      }, 5000, 25);
      const wakeElapsedMs = Date.now() - wakeStart;

      assert.ok(wakeElapsedMs < 3000, `Expected periodic recovery + poll wakeup under 3s, got ${wakeElapsedMs}ms`);
      assert.ok(periodicWorker.getState().metrics.jobsRecoveredRequeued >= 1);
      const doneBDoc = await documentRepo.findById(docB.id);
      assert.strictEqual(doneBDoc.status, 'ready');
      await periodicWorker.stop();

      reportTest('TEST 5', true, `Startup & periodic recovery (${wakeElapsedMs}ms poll wakeup) verified`);
    }

    {
      const { doc, job } = await createTestDocAndJob('t6', { lease_timeout_seconds: 2 });
      const activeEntered = createBarrier();
      const releaseActive = createBarrier();

      const workerA = createWorker({
        config: {
          workerId: 't6-active-owner',
          pollIntervalMs: 30,
          heartbeatIntervalMs: 60,
          leaseRecoveryIntervalMs: 60000,
        },
        env: baseEnv,
        jobHandler: async () => {
          activeEntered.resolve();
          await releaseActive.promise;
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(workerA);
      await workerA.start();
      await activeEntered.promise;

      const workerB = createWorker({
        config: {
          workerId: 't6-recovery-observer',
          pollIntervalMs: 40,
          heartbeatIntervalMs: 5000,
          leaseRecoveryIntervalMs: 40,
        },
        env: baseEnv,
        jobHandler: async () => {
          throw new Error('Observer must never steal active job');
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(workerB);
      await workerB.start();

      await waitForCondition(
        () =>
          workerA.getState().metrics.heartbeatsSent >= 3 &&
          workerB.getState().metrics.leaseRecoveryRuns >= 4,
        5000,
        25
      );

      const duringJob = await jobRepo.findById(job.id);
      assert.strictEqual(duringJob.status, 'running');
      assert.strictEqual(duringJob.locked_by, 't6-active-owner');
      assert.strictEqual(duringJob.lease_generation, 1);
      assert.strictEqual(workerB.getState().metrics.jobsRecovered, 0);
      assert.strictEqual(workerB.getState().metrics.jobsClaimed, 0);

      releaseActive.resolve();
      await waitForCondition(async () => (await jobRepo.findById(job.id)).status === 'done', 5000, 20);
      const docDone = await documentRepo.findById(doc.id);
      assert.strictEqual(docDone.status, 'ready');

      await workerB.stop();
      await workerA.stop();
      reportTest('TEST 6', true, 'Active worker lease protected from recovery across multiple passes');
    }

    {
      let singleFlightActive = 0;
      let singleFlightMaxActive = 0;
      let repoCalls = 0;
      const singleFlightGate = createBarrier();
      const singleFlightWorker = createWorker({
        config: { pollIntervalMs: 5000, leaseRecoveryIntervalMs: 60000 },
        env: baseEnv,
        repository: {
          claimJob: async () => null,
          recoverExpiredLeases: async () => {
            repoCalls += 1;
            singleFlightActive += 1;
            singleFlightMaxActive = Math.max(singleFlightMaxActive, singleFlightActive);
            await singleFlightGate.promise;
            singleFlightActive -= 1;
            return { recoveredCount: 0, requeuedCount: 0, failedCount: 0, jobs: [] };
          },
        },
        jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
        closeDbOnStop: false,
      });
      activeWorkers.push(singleFlightWorker);
      const startP = singleFlightWorker.start();
      await waitForCondition(() => repoCalls === 1, 2000, 10);
      const concurrentA = singleFlightWorker._runLeaseRecoveryPass({ trigger: 'periodic' });
      const concurrentB = singleFlightWorker._runLeaseRecoveryPass({ trigger: 'periodic' });
      singleFlightGate.resolve();
      await Promise.all([startP, concurrentA, concurrentB]);
      assert.strictEqual(singleFlightMaxActive, 1);
      assert.strictEqual(repoCalls, 1);
      await singleFlightWorker.stop();

      const { doc, job } = await createTestDocAndJob('t7');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-race-owner',
             claim_token = ?,
             lease_generation = 2,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), job.id]
      );

      let executionCount = 0;
      const raceWorkers = ['t7-w1', 't7-w2', 't7-w3'].map((id) =>
        createWorker({
          config: {
            workerId: id,
            pollIntervalMs: 25,
            leaseRecoveryIntervalMs: 35,
            maxAttempts: 3,
          },
          env: baseEnv,
          jobHandler: async () => {
            executionCount += 1;
            await new Promise((r) => setTimeout(r, 80));
            return { status: 'done', documentUpdate: { status: 'ready' } };
          },
          closeDbOnStop: false,
        })
      );
      activeWorkers.push(...raceWorkers);
      await Promise.all(raceWorkers.map((w) => w.start()));

      await waitForCondition(async () => (await jobRepo.findById(job.id)).status === 'done', 10000, 25);
      await new Promise((r) => setTimeout(r, 120));

      const finalJob = await jobRepo.findById(job.id);
      const finalDoc = await documentRepo.findById(doc.id);
      const totalRecoveredAcrossWorkers = raceWorkers.reduce(
        (acc, w) => acc + w.getState().metrics.jobsRecovered,
        0
      );
      assert.strictEqual(executionCount, 1);
      assert.strictEqual(totalRecoveredAcrossWorkers, 1);
      assert.strictEqual(finalJob.attempts, 2);
      assert.strictEqual(finalJob.lease_generation, 3);
      assert.strictEqual(finalDoc.status, 'ready');

      await Promise.all(raceWorkers.map((w) => w.stop()));
      reportTest('TEST 7', true, 'Single-flight recovery guard & 3-worker race produced zero duplicate claims');
    }

    {
      const { doc: docExhausted, job: jobExhausted } = await createTestDocAndJob('t8-exhausted');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 3,
             locked_by = 'dead-max-attempts',
             claim_token = ?,
             lease_generation = 2,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), jobExhausted.id]
      );

      const { doc: docDeleted, job: jobDeleted } = await createTestDocAndJob('t8-deleted');
      await documentRepo.softDelete(docDeleted.id);
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-soft-del',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), jobDeleted.id]
      );

      const { doc: docRetryable, job: jobRetryable } = await createTestDocAndJob('t8-retryable');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-retryable',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), jobRetryable.id]
      );

      const maxAttemptWorker = createWorker({
        config: {
          workerId: 't8-max-attempts-worker',
          pollIntervalMs: 30,
          leaseRecoveryIntervalMs: 60000,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async (ctx) => {
          assert.strictEqual(ctx.job.id, jobRetryable.id);
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(maxAttemptWorker);
      await maxAttemptWorker.start();

      await waitForCondition(async () => {
        const retryRow = await jobRepo.findById(jobRetryable.id);
        return retryRow?.status === 'done';
      }, 10000, 25);

      const failedExhausted = await jobRepo.findById(jobExhausted.id);
      const exhaustedDocAfter = await documentRepo.findById(docExhausted.id);
      const failedDeleted = await jobRepo.findById(jobDeleted.id);
      const retryDone = await jobRepo.findById(jobRetryable.id);
      const retryDocAfter = await documentRepo.findById(docRetryable.id);
      const state = maxAttemptWorker.getState();

      assert.strictEqual(failedExhausted.status, 'failed');
      assert.strictEqual(failedExhausted.attempts, 3);
      assert.strictEqual(failedExhausted.locked_by, null);
      assert.strictEqual(failedExhausted.claim_token, null);
      assert.strictEqual(failedExhausted.locked_at, null);
      assert.strictEqual(failedExhausted.heartbeat_at, null);
      assert.strictEqual(failedExhausted.lease_generation, 2);
      assert.ok(failedExhausted.error.includes('max retry attempts (3) exhausted'));
      assert.strictEqual(exhaustedDocAfter.status, 'failed');
      assert.strictEqual(exhaustedDocAfter.metadata?.extraction_status, 'Failed');
      assert.ok(exhaustedDocAfter.metadata?.error_details?.includes('max retry attempts (3) exhausted'));

      assert.strictEqual(failedDeleted.status, 'failed');
      assert.strictEqual(failedDeleted.error, 'Document deleted before processing');
      assert.strictEqual(failedDeleted.locked_by, null);

      assert.strictEqual(retryDone.status, 'done');
      assert.strictEqual(retryDocAfter.status, 'ready');
      assert.strictEqual(state.metrics.jobsRecoveredFailed, 2);
      assert.strictEqual(state.metrics.jobsRecoveredRequeued, 1);

      await maxAttemptWorker.stop();
      reportTest('TEST 8', true, 'Max attempts exhaustion, soft-delete failure, & doc state consistency verified');
    }

    {
      const { doc, job } = await createTestDocAndJob('t9', { lease_timeout_seconds: 2 });
      const w1Claimed = createBarrier();
      const w1Release = createBarrier();
      const w2Claimed = createBarrier();
      const w2Release = createBarrier();
      let staleContext = null;

      const staleWorker = createWorker({
        config: {
          workerId: 't9-stale-worker',
          pollIntervalMs: 30,
          heartbeatIntervalMs: 60000,
          leaseRecoveryIntervalMs: 60000,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async (ctx) => {
          staleContext = ctx;
          w1Claimed.resolve(ctx);
          await w1Release.promise;
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(staleWorker);
      await staleWorker.start();
      await w1Claimed.promise;

      await query(
        `UPDATE jobs
         SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [job.id]
      );

      const newOwnerWorker = createWorker({
        config: {
          workerId: 't9-new-owner',
          pollIntervalMs: 30,
          heartbeatIntervalMs: 100,
          leaseRecoveryIntervalMs: 60000,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async (ctx) => {
          await elementRepo.replacePersistedElementsFenced(ctx.job.id, ctx.workerId, {
            claimToken: ctx.claimToken,
            leaseGeneration: ctx.leaseGeneration,
            mode: ctx.job.mode,
            elements: [
              {
                doc_id: doc.id,
                mode: 'reference',
                type: 'text',
                page: 1,
                reading_order: 0,
                text: 'Owner-2 legitimate element',
                bbox: { x0: 10, y0: 10, x1: 100, y1: 30 },
              },
            ],
          });
          w2Claimed.resolve(ctx);
          await w2Release.promise;
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(newOwnerWorker);
      await newOwnerWorker.start();
      const newContext = await w2Claimed.promise;

      assert.strictEqual(newContext.leaseGeneration, 2);
      assert.notStrictEqual(newContext.claimToken, staleContext.claimToken);

      await assert.rejects(
        () =>
          elementRepo.replacePersistedElementsFenced(job.id, staleWorker.workerId, {
            claimToken: staleContext.claimToken,
            leaseGeneration: staleContext.leaseGeneration,
            mode: 'reference',
            elements: [
              {
                doc_id: doc.id,
                mode: 'reference',
                type: 'text',
                page: 1,
                reading_order: 0,
                text: 'STALE WORKER OVERWRITE ATTEMPT',
                bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
              },
            ],
          }),
        (err) => err?.name === 'LeaseOwnershipError' && err?.code === 'ERR_LEASE_OWNERSHIP'
      );

      await assert.rejects(
        () =>
          jobRepo.completeJob(job.id, staleWorker.workerId, {
            claimToken: staleContext.claimToken,
            leaseGeneration: staleContext.leaseGeneration,
            status: 'done',
          }),
        LeaseOwnershipError
      );

      await assert.rejects(
        () =>
          jobRepo.failJob(job.id, staleWorker.workerId, {
            claimToken: staleContext.claimToken,
            leaseGeneration: staleContext.leaseGeneration,
            error: 'stale failure attempt',
          }),
        LeaseOwnershipError
      );

      w1Release.resolve();
      await waitForCondition(() => staleWorker.getState().metrics.leaseLosses >= 1, 5000, 20);

      const jobStillOwnedByW2 = await jobRepo.findById(job.id);
      assert.strictEqual(jobStillOwnedByW2.status, 'running');
      assert.strictEqual(jobStillOwnedByW2.locked_by, 't9-new-owner');
      assert.strictEqual(jobStillOwnedByW2.lease_generation, 2);

      w2Release.resolve();
      await waitForCondition(async () => (await jobRepo.findById(job.id)).status === 'done', 5000, 20);

      const persistedEls = await elementRepo.findByDocumentAndMode(doc.id, 'reference');
      const finalDoc = await documentRepo.findById(doc.id);
      assert.strictEqual(persistedEls.length, 1);
      assert.strictEqual(persistedEls[0].text, 'Owner-2 legitimate element');
      assert.strictEqual(finalDoc.status, 'ready');

      await staleWorker.stop();
      await newOwnerWorker.stop();
      reportTest('TEST 9', true, 'Stale worker fenced from element persistence, completion, and failure after reassignment');
    }

    {
      const stopScheduleWorker = createWorker({
        config: {
          workerId: 't10a-shutdown-timer',
          pollIntervalMs: 5000,
          leaseRecoveryIntervalMs: 35,
        },
        env: baseEnv,
        jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
        closeDbOnStop: false,
      });
      activeWorkers.push(stopScheduleWorker);
      await stopScheduleWorker.start();
      await waitForCondition(() => stopScheduleWorker.getState().metrics.leaseRecoveryRuns >= 2, 3000, 15);

      const summary = await stopScheduleWorker.stop();
      const runsAtStop = summary.metrics.leaseRecoveryRuns;
      assert.strictEqual(summary.status, 'stopped');
      assert.strictEqual(stopScheduleWorker._recoveryTimer, null);

      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(stopScheduleWorker.getState().metrics.leaseRecoveryRuns, runsAtStop);

      let recoveryStarted = createBarrier();
      let recoveryRelease = createBarrier();
      let recoveryCompletedBeforeDbClose = false;
      let dbClosed = false;
      let recoveryCallsAfterDbClose = 0;

      const inFlightStopWorker = createWorker({
        config: {
          workerId: 't10b-inflight-shutdown',
          pollIntervalMs: 5000,
          leaseRecoveryIntervalMs: 25,
          shutdownGraceMs: 1000,
        },
        env: baseEnv,
        repository: {
          claimJob: async () => null,
          recoverExpiredLeases: async () => {
            if (dbClosed) {
              recoveryCallsAfterDbClose += 1;
            }
            if (inFlightStopWorker.getState().metrics.leaseRecoveryRuns >= 2) {
              recoveryStarted.resolve();
              await recoveryRelease.promise;
              recoveryCompletedBeforeDbClose = !dbClosed;
            }
            return { recoveredCount: 0, requeuedCount: 0, failedCount: 0, jobs: [] };
          },
        },
        db: {
          closePool: async () => {
            dbClosed = true;
          },
        },
        jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
        closeDbOnStop: true,
      });
      activeWorkers.push(inFlightStopWorker);
      await inFlightStopWorker.start();
      await recoveryStarted.promise;

      const stopPromise = inFlightStopWorker.stop();
      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(dbClosed, false, 'DB pool must not close before in-flight recovery finishes');

      recoveryRelease.resolve();
      const inFlightSummary = await stopPromise;
      await new Promise((r) => setTimeout(r, 120));

      assert.strictEqual(inFlightSummary.status, 'stopped');
      assert.strictEqual(inFlightSummary.databaseClosed, true);
      assert.strictEqual(recoveryCompletedBeforeDbClose, true);
      assert.strictEqual(recoveryCallsAfterDbClose, 0);
      assert.strictEqual(inFlightStopWorker._recoveryTimer, null);

      reportTest('TEST 10', true, 'Graceful shutdown stopped recovery scheduling & drained in-flight recovery before DB close');
    }

    {
      const { doc, job } = await createTestDocAndJob('t11');
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-transient-db',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), job.id]
      );

      let recoveryAttempt = 0;
      const resilientRepo = {
        ...jobRepo,
        recoverExpiredLeases: async (opts) => {
          recoveryAttempt += 1;
          if (recoveryAttempt <= 2) {
            const err = new Error(`ECONNRESET temporary MySQL failure password=${baseEnv.DB_PASSWORD}`);
            err.code = 'ECONNRESET';
            throw err;
          }
          return jobRepo.recoverExpiredLeases(opts);
        },
      };

      const resilientLogs = [];
      const resilientWorker = createWorker({
        config: {
          workerId: 't11-resilient-worker',
          pollIntervalMs: 30,
          leaseRecoveryIntervalMs: 40,
          maxAttempts: 3,
        },
        env: baseEnv,
        repository: resilientRepo,
        logger: createWorkerLogger({
          workerId: 't11-resilient-worker',
          env: baseEnv,
          sink: (level, line, payload) => resilientLogs.push({ level, line, payload }),
        }),
        jobHandler: async () => ({ status: 'done', documentUpdate: { status: 'ready' } }),
        closeDbOnStop: false,
      });
      activeWorkers.push(resilientWorker);
      await resilientWorker.start();

      assert.strictEqual(resilientWorker.getState().status, 'running');
      assert.strictEqual(resilientWorker.getState().metrics.leaseRecoveryErrors, 1);

      await waitForCondition(async () => (await jobRepo.findById(job.id)).status === 'done', 10000, 25);

      const postRecoveryState = resilientWorker.getState();
      const doneDoc = await documentRepo.findById(doc.id);
      assert.strictEqual(postRecoveryState.metrics.leaseRecoveryErrors, 2);
      assert.strictEqual(postRecoveryState.lastRecoveryError, null);
      assert.ok(postRecoveryState.metrics.jobsRecovered >= 1);
      assert.strictEqual(doneDoc.status, 'ready');
      assert.ok(!JSON.stringify(resilientLogs).includes(baseEnv.DB_PASSWORD));

      await resilientWorker.stop();
      reportTest('TEST 11', true, 'Temporary DB failure logged safely and self-healed on subsequent recovery tick');
    }

    {
      const { doc: validDoc, job: validJob } = await createTestDocAndJob('t12-valid', {
        lease_timeout_seconds: 30,
      });
      const validClaimed = createBarrier();
      const validRelease = createBarrier();

      const activeWorker = createWorker({
        config: {
          workerId: 't12-valid-owner',
          pollIntervalMs: 30,
          heartbeatIntervalMs: 100,
          leaseRecoveryIntervalMs: 60000,
        },
        env: baseEnv,
        jobHandler: async () => {
          validClaimed.resolve();
          await validRelease.promise;
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(activeWorker);
      await activeWorker.start();
      await validClaimed.promise;

      const expiredJobs = [];
      for (let i = 0; i < 4; i += 1) {
        const pair = await createTestDocAndJob(`t12-expired-${i}`);
        await query(
          `UPDATE jobs
           SET status = 'running',
               attempts = 1,
               locked_by = ?,
               claim_token = ?,
               lease_generation = 1,
               lease_timeout_seconds = 2,
               locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 20 SECOND),
               heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 20 SECOND)
           WHERE id = ?`,
          [`dead-batch-${i}`, crypto.randomUUID(), pair.job.id]
        );
        expiredJobs.push(pair);
      }

      const startupRecoveryWorker = createWorker({
        config: {
          workerId: 't12-startup-batch-worker',
          pollIntervalMs: 30,
          leaseRecoveryIntervalMs: 60000,
          leaseRecoveryBatchSize: 2,
          maxAttempts: 3,
        },
        env: baseEnv,
        jobHandler: async (ctx) => {
          assert.notStrictEqual(ctx.job.id, validJob.id);
          return { status: 'done', documentUpdate: { status: 'ready' } };
        },
        closeDbOnStop: false,
      });
      activeWorkers.push(startupRecoveryWorker);
      await startupRecoveryWorker.start();

      const immediateState = startupRecoveryWorker.getState();
      const validJobDuring = await jobRepo.findById(validJob.id);
      assert.strictEqual(immediateState.metrics.jobsRecovered, 4);
      assert.strictEqual(immediateState.metrics.jobsRecoveredRequeued, 4);
      assert.strictEqual(validJobDuring.status, 'running');
      assert.strictEqual(validJobDuring.locked_by, 't12-valid-owner');
      assert.strictEqual(validJobDuring.lease_generation, 1);

      await waitForCondition(async () => {
        for (const pair of expiredJobs) {
          const j = await jobRepo.findById(pair.job.id);
          if (j?.status !== 'done') return false;
        }
        return true;
      }, 10000, 25);

      const validJobBeforeRelease = await jobRepo.findById(validJob.id);
      assert.strictEqual(validJobBeforeRelease.status, 'running');
      assert.strictEqual(validJobBeforeRelease.locked_by, 't12-valid-owner');

      validRelease.resolve();
      await waitForCondition(async () => (await jobRepo.findById(validJob.id)).status === 'done', 5000, 20);
      const validDocDone = await documentRepo.findById(validDoc.id);
      assert.strictEqual(validDocDone.status, 'ready');

      await startupRecoveryWorker.stop();
      await activeWorker.stop();
      reportTest('TEST 12', true, 'Startup multi-batch recovery left valid running job completely untouched');
    }

    {
      const { doc: singleExhDoc, job: singleExhJob } = await createTestDocAndJob(
        't13-single-exh',
        {},
        {
          status: 'queued',
          metadata: {
            extraction_status: 'Queued',
            indexing_status: 'Pending',
            preserved_key: 'keep-me',
          },
        }
      );
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 3,
             locked_by = 'dead-t13-single',
             claim_token = ?,
             lease_generation = 2,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), singleExhJob.id]
      );

      const { doc: reqDoc, job: reqJob } = await createTestDocAndJob(
        't13-requeue',
        {},
        {
          status: 'queued',
          metadata: { extraction_status: 'Queued', indexing_status: 'Pending' },
        }
      );
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 1,
             locked_by = 'dead-t13-requeue',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), reqJob.id]
      );

      const { doc: multiDoc, job: multiExhJob } = await createTestDocAndJob(
        't13-multi',
        { mode: 'candidate' },
        {
          status: 'queued',
          metadata: { extraction_status: 'Queued', indexing_status: 'Pending' },
        }
      );
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 3,
             locked_by = 'dead-t13-multi-cand',
             claim_token = ?,
             lease_generation = 2,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), multiExhJob.id]
      );
      const multiActiveJob = await jobRepo.createJob({
        doc_id: multiDoc.id,
        mode: 'reference',
        status: 'queued',
        lease_timeout_seconds: 30,
      });
      const claimedMultiActive = await jobRepo.claimJob('t13-valid-sibling-owner', {
        mode: 'reference',
      });
      assert.strictEqual(claimedMultiActive.id, multiActiveJob.id);

      const { doc: readyDoc, job: readyExhJob } = await createTestDocAndJob(
        't13-ready',
        { mode: 'candidate' },
        {
          status: 'ready',
          metadata: { extraction_status: 'Completed', indexing_status: 'Indexed' },
        }
      );
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 3,
             locked_by = 'dead-t13-ready',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), readyExhJob.id]
      );

      const { doc: deletedDoc, job: deletedJob } = await createTestDocAndJob('t13-softdel');
      await documentRepo.softDelete(deletedDoc.id);
      await query(
        `UPDATE jobs
         SET status = 'running',
             attempts = 3,
             locked_by = 'dead-t13-del',
             claim_token = ?,
             lease_generation = 1,
             lease_timeout_seconds = 2,
             locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 SECOND)
         WHERE id = ?`,
        [crypto.randomUUID(), deletedJob.id]
      );

      const recSummary = await jobRepo.recoverExpiredLeases({ limit: 20, maxAttempts: 3 });
      assert.strictEqual(recSummary.recoveredCount, 5);
      assert.strictEqual(recSummary.requeuedCount, 1);
      assert.strictEqual(recSummary.failedCount, 4);

      const singleDocAfter = await documentRepo.findById(singleExhDoc.id);
      const serializedSingle = serializeDocument(singleDocAfter);
      assert.strictEqual((await jobRepo.findById(singleExhJob.id)).status, 'failed');
      assert.strictEqual(singleDocAfter.status, 'failed');
      assert.strictEqual(singleDocAfter.metadata.preserved_key, 'keep-me');
      assert.strictEqual(singleDocAfter.metadata.extraction_status, 'Failed');
      assert.strictEqual(singleDocAfter.metadata.indexing_status, 'Failed');
      assert.strictEqual(serializedSingle.status, 'failed');
      assert.strictEqual(serializedSingle.extraction_status, 'Failed');
      assert.ok(serializedSingle.error_details.includes('max retry attempts (3) exhausted'));

      const reqDocAfter = await documentRepo.findById(reqDoc.id);
      assert.strictEqual((await jobRepo.findById(reqJob.id)).status, 'queued');
      assert.strictEqual(reqDocAfter.status, 'queued');
      assert.strictEqual(reqDocAfter.metadata.extraction_status, 'Queued');

      const multiDocMid = await documentRepo.findById(multiDoc.id);
      const multiActiveMid = await jobRepo.findById(multiActiveJob.id);
      assert.strictEqual((await jobRepo.findById(multiExhJob.id)).status, 'failed');
      assert.strictEqual(multiActiveMid.status, 'running');
      assert.strictEqual(multiActiveMid.locked_by, 't13-valid-sibling-owner');
      assert.strictEqual(multiDocMid.status, 'queued');

      await jobRepo.completeJob(multiActiveJob.id, 't13-valid-sibling-owner', {
        claimToken: claimedMultiActive.claim_token,
        leaseGeneration: claimedMultiActive.lease_generation,
        status: 'done',
        documentUpdate: { status: 'ready' },
      });
      const multiDocDone = await documentRepo.findById(multiDoc.id);
      assert.strictEqual(multiDocDone.status, 'ready');

      const readyDocAfter = await documentRepo.findById(readyDoc.id);
      assert.strictEqual((await jobRepo.findById(readyExhJob.id)).status, 'failed');
      assert.strictEqual(readyDocAfter.status, 'ready');
      assert.strictEqual(readyDocAfter.metadata.extraction_status, 'Completed');

      const deletedDocActiveLookup = await documentRepo.findByDocumentId(deletedDoc.document_id);
      const deletedDocRaw = await documentRepo.findById(deletedDoc.id, { includeDeleted: true });
      assert.strictEqual((await jobRepo.findById(deletedJob.id)).status, 'failed');
      assert.strictEqual(deletedDocActiveLookup, null);
      assert.ok(deletedDocRaw.deleted_at !== null);
      assert.strictEqual(deletedDocRaw.status, 'queued');

      reportTest(
        'TEST 13',
        true,
        'Exhausted lease recovery synchronized failed document status while preserving requeues, active siblings, ready docs & soft-delete exclusions'
      );
    }

    console.log('\n=================================================================');
    console.log(`   LEASE RECOVERY TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
    console.log('=================================================================');
    if (passedTests !== totalTests) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled(spawnedChildren.map((entry) => killChildHard(entry)));
    await Promise.allSettled(
      activeWorkers.map(async (w) => {
        if (w.getState().status !== 'stopped') {
          await w.stop();
        }
      })
    );
    await Promise.allSettled(activeServers.map((s) => s.close()));
    await cleanLeaseRecoveryTestData().catch(() => {});
    await closePool().catch(() => {});
  }
}

runLeaseRecoveryTests().catch(async (err) => {
  console.error('Unhandled error in M1.6.6 lease recovery test suite:', err);
  await closePool().catch(() => {});
  process.exit(1);
});
