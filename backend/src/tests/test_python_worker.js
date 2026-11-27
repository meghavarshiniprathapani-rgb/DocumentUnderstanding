import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepo from '../db/repositories/documentRepository.js';
import * as elementRepo from '../db/repositories/elementRepository.js';
import * as jobRepo from '../db/repositories/jobRepository.js';
import {
  PythonAbortError,
  PythonAuthenticationError,
  PythonHttpError,
  PythonNetworkError,
  PythonResponseValidationError,
  PythonSearchVerificationError,
  PythonTimeoutError,
  WorkerConfigError,
  createPythonExtractionClient,
  createWorker,
  createWorkerLogger,
  loadWorkerConfig,
  sanitizeWorkerError,
} from '../worker/index.js';
import { runStandaloneWorker } from '../worker.js';

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

async function waitForCondition(predicate, timeoutMs = 10000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

function buildValidEnvelope({
  documentId = 'test-py-doc-1',
  mode = 'reference',
  status = 'processed',
  pageCount = 2,
  processingTimeMs = 42.5,
  indexingStatus = 'Indexed',
  latestVersionIndexed = true,
  previousVersionSearchable = false,
  searchable = true,
  chunkCount = 2,
  fallbackOccurred = false,
  fallbackReason = null,
  extractorName = 'PyMuPDF',
  extractorVersion = '1.25.0',
  elements = null,
  indexingDiagnosticsOverride = null,
} = {}) {
  const defaultElements = elements || [
    {
      element_id: `${documentId}_el_0`,
      page: 1,
      type: 'heading',
      reading_order: 0,
      text: 'Sample Document Title',
      bbox: { x0: 72, y0: 72, x1: 500, y1: 96, x: 72, y: 72, width: 428, height: 24 },
      table_data: null,
      formula_latex: null,
      raw_confidence: 0.98,
      calibrated_confidence: mode === 'candidate' || mode === 'candidate_ft' ? 0.99 : null,
      provenance: null,
      flags: { is_degraded: status === 'degraded', degraded_reasons: status === 'degraded' ? ['mock_degraded'] : [] },
      model_version: extractorVersion,
    },
    {
      element_id: `${documentId}_el_1`,
      page: 2,
      type: 'text',
      reading_order: 1,
      text: 'Body content for verification.',
      bbox: { x0: 72, y0: 120, x1: 540, y1: 180, x: 72, y: 120, width: 468, height: 60 },
      table_data: null,
      formula_latex: null,
      raw_confidence: 0.96,
      calibrated_confidence: mode === 'candidate' || mode === 'candidate_ft' ? 0.97 : null,
      provenance: null,
      flags: { is_degraded: status === 'degraded', degraded_reasons: status === 'degraded' ? ['mock_degraded'] : [] },
      model_version: extractorVersion,
    },
  ];

  const indexingDiagnostics = indexingDiagnosticsOverride || {
    vector_store: 'FAISS',
    latest_version_indexed: latestVersionIndexed,
    previous_version_searchable: previousVersionSearchable,
    searchable,
    ...(indexingStatus === 'Failed'
      ? { error: 'Simulated FAISS error', error_type: 'RuntimeError' }
      : { chunk_count: chunkCount }),
  };

  return {
    config_version: '1.0.0',
    status: 'success',
    message:
      status === 'degraded'
        ? 'Document extraction completed with degraded status'
        : 'Document extraction completed successfully',
    data: {
      document_id: documentId,
      mode,
      status,
      page_count: pageCount,
      elements: defaultElements,
      processing_time_ms: processingTimeMs,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        fallback_occurred: fallbackOccurred,
        fallback_reason: fallbackReason,
      },
      model_versions: {
        extractor: `${extractorName}:${extractorVersion}`,
        embedding: 'HashEmbedder:128d:seed42',
        layout_engine: mode === 'flat' ? 'None:NaiveOrder' : 'LayoutOrderRecovery:v1.0.0',
        provenance_subsystem: mode === 'candidate' || mode === 'candidate_ft' ? 'O3:baseline' : 'None:Uncalibrated',
      },
      extraction_warnings: status === 'degraded' ? ['Simulated degraded extraction warning'] : [],
      indexing_status: indexingStatus,
      indexing_diagnostics: indexingDiagnostics,
      fallback:
        fallbackOccurred || mode === 'candidate_ft'
          ? {
              fallback_occurred: fallbackOccurred,
              requested_mode: mode,
              actual_extractor: extractorName,
              reason: fallbackReason,
            }
          : null,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildSearchEnvelope({
  documentId = 'test-py-doc-1',
  sourceFileHash = null,
  status = 'success',
  isDegraded = false,
  snippet = 'Sample Document Title',
  score = 0.91,
  matches = null,
} = {}) {
  const data =
    matches ||
    [
      {
        id: `res-${documentId}_chunk_0`,
        document_id: documentId,
        document_title: `${documentId}.pdf`,
        category: 'User Upload',
        page_number: 1,
        result_title: `Heading match in ${documentId}.pdf (Page 1)`,
        content_type: 'Heading',
        relevance_score: score,
        query_match_snippet: snippet,
        bounding_region: { x: 72, y: 72, width: 428, height: 24 },
        table_data: null,
        highlights: ['sample'],
        reading_order: 1,
        provenance: sourceFileHash
          ? {
              source_file_hash: sourceFileHash,
              page_number: 1,
              extractor_name: 'PyMuPDF+pdfplumber',
              config_id: 'O3-v1.0.0',
            }
          : null,
        confidence: 0.98,
        calibrated_confidence: null,
        is_degraded: isDegraded,
        degraded_reasons: isDegraded ? ['Simulated degraded extraction warning'] : [],
        fallback_strategy: isDegraded ? 'RAW_SLICE_FALLBACK' : null,
      },
    ];

  return {
    config_version: '1.0.0',
    status,
    message: `Query executed with ${data.length} matches`,
    data,
    timestamp: new Date().toISOString(),
  };
}

function buildIndexEnvelope({
  documentId = 'test-py-doc-1',
  mode = 'reference',
  indexingStatus = 'Indexed',
  latestVersionIndexed = true,
  previousVersionSearchable = false,
  searchable = true,
  chunkCount = 2,
  persistedElementsIndexed = 2,
} = {}) {
  return {
    config_version: '1.0.0',
    status: 'success',
    message: 'Persisted extraction indexed and replacement FAISS index built',
    data: {
      document_id: documentId,
      mode,
      indexing_status: indexingStatus,
      indexing_diagnostics: {
        vector_store: 'FAISS',
        durable_on_disk: false,
        latest_version_indexed: latestVersionIndexed,
        previous_version_searchable: previousVersionSearchable,
        searchable,
        chunk_count: chunkCount,
        persisted_elements_indexed: persistedElementsIndexed,
      },
      chunk_count: chunkCount,
      searchable,
      processing_time_ms: 12.4,
    },
    timestamp: new Date().toISOString(),
  };
}

async function startMockPythonServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    let bodyCompleted = false;
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
      bodyCompleted = true;
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
        bodyCompleted,
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

async function cleanPythonWorkerTestData() {
  await query(`DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-py-%')`);
  await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-py-%')`);
  await query(`DELETE FROM documents WHERE document_id LIKE 'test-py-%'`);
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

async function runPythonWorkerTests() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.6.4.4.2 PYTHON INTEGRATION TEST SUITE        ');
  console.log('=================================================================');

  const testSecret = 'test-internal-api-secret-m16442-xyz';
  const baseEnv = {
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DB_PORT: process.env.DB_PORT || '3306',
    DB_USER: process.env.DB_USER || 'docuretrieve_user',
    DB_PASSWORD: 'test-db-secret-m16442',
    DB_NAME: process.env.DB_NAME || 'docuretrieve',
    INTERNAL_API_SECRET: testSecret,
    PYTHON_SERVICE_URL: 'http://127.0.0.1:18000',
    PYTHON_EXTRACTION_TIMEOUT_MS: '15000',
  };

  try {
    await resetPool();
    await cleanPythonWorkerTestData();

    console.log('\n--- SECTION 1: CONFIGURATION, VALIDATION & SECRET REDACTION ---');

    const cfg = loadWorkerConfig({}, baseEnv);
    assert.strictEqual(cfg.pythonServiceUrl, 'http://127.0.0.1:18000');
    assert.strictEqual(cfg.pythonExtractionTimeoutMs, 15000);
    assert.strictEqual(cfg.internalApiSecretConfigured, true);
    assert.strictEqual(cfg.internalApiSecret, testSecret);
    assert.strictEqual(Object.prototype.propertyIsEnumerable.call(cfg, 'internalApiSecret'), false);
    assert(!JSON.stringify(cfg).includes(testSecret));

    assert.throws(
      () => loadWorkerConfig({}, { ...baseEnv, INTERNAL_API_SECRET: undefined }),
      (err) => err instanceof WorkerConfigError
    );

    const invalidConfigs = [
      { PYTHON_SERVICE_URL: '' },
      { PYTHON_SERVICE_URL: 'ftp://127.0.0.1:8000' },
      { PYTHON_SERVICE_URL: 'http://user:pass@127.0.0.1:8000' },
      { PYTHON_SERVICE_URL: 'http://127.0.0.1:8000?foo=bar' },
      { PYTHON_SERVICE_URL: 'not-a-valid-url' },
      { INTERNAL_API_SECRET: '   ' },
      { INTERNAL_API_SECRET: 'line1\nline2' },
      { PYTHON_EXTRACTION_TIMEOUT_MS: '0' },
      { PYTHON_EXTRACTION_TIMEOUT_MS: '-10' },
      { PYTHON_EXTRACTION_TIMEOUT_MS: '50' },
      { PYTHON_EXTRACTION_TIMEOUT_MS: '600001' },
      { PYTHON_EXTRACTION_TIMEOUT_MS: 'abc' },
    ];
    for (const bad of invalidConfigs) {
      assert.throws(
        () => loadWorkerConfig({}, { ...baseEnv, ...bad }),
        (err) => err instanceof WorkerConfigError
      );
    }

    let cliMissingSecretRejected = false;
    try {
      const cliEnv = { ...process.env };
      delete cliEnv.INTERNAL_API_SECRET;
      cliEnv.DB_PASSWORD = 'cli-db-secret-probe';
      execFileSync(process.execPath, [path.join(BACKEND_ROOT, 'src/worker.js')], {
        env: cliEnv,
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch (err) {
      cliMissingSecretRejected = err.status === 1;
      const out = `${err.stdout || ''}${err.stderr || ''}`;
      assert(out.includes('ERR_WORKER_CONFIG'));
      assert(!out.includes('cli-db-secret-probe'));
    }
    assert.strictEqual(cliMissingSecretRejected, true);

    const leakedTextErr = sanitizeWorkerError(
      new Error(`Header X-Internal-Secret: ${testSecret} failed Authorization: Bearer ${testSecret}`),
      [testSecret]
    );
    assert(!leakedTextErr.message.includes(testSecret));
    assert(leakedTextErr.message.includes('******'));

    reportTest(
      'TEST 11: Configuration Validation & Secret Redaction',
      true,
      'Validated PYTHON_SERVICE_URL, INTERNAL_API_SECRET, PYTHON_EXTRACTION_TIMEOUT_MS, rejected missing/invalid config, and redacted secrets from state and errors'
    );

    console.log('\n--- SECTION 2: PYTHON CLIENT CONTRACT & RESPONSE VALIDATION ---');

    const badJsonMock = await startMockPythonServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{ "status": "success", "data": ');
    });
    const emptyJsonMock = await startMockPythonServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('   ');
    });
    try {
      const clientBadJson = createPythonExtractionClient({
        baseUrl: badJsonMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => clientBadJson.extract({ documentId: 'doc-j1', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
        (err) => err instanceof PythonResponseValidationError && err.reason === 'malformed_json' && err.retryable === false
      );

      const clientEmptyJson = createPythonExtractionClient({
        baseUrl: emptyJsonMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => clientEmptyJson.extract({ documentId: 'doc-j2', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
        (err) => err instanceof PythonResponseValidationError && err.reason === 'malformed_json'
      );
    } finally {
      await badJsonMock.close();
      await emptyJsonMock.close();
    }
    reportTest(
      'TEST 7: Malformed JSON & Empty Body Handling',
      true,
      'Classified invalid and empty HTTP 200 JSON responses as PythonResponseValidationError (malformed_json)'
    );

    const invalidSchemaPayloads = [
      () => ({ status: 'error', config_version: '1.0.0', data: null }),
      () => {
        const p = buildValidEnvelope({ documentId: 'doc-schema-1', mode: 'flat' });
        p.data.status = 'done';
        return p;
      },
      () => {
        const p = buildValidEnvelope({ documentId: 'doc-schema-1', mode: 'flat' });
        p.data.page_count = 0;
        return p;
      },
      () => {
        const p = buildValidEnvelope({ documentId: 'doc-schema-1', mode: 'flat' });
        p.data.elements = [];
        return p;
      },
      () => {
        const p = buildValidEnvelope({ documentId: 'doc-schema-1', mode: 'flat' });
        p.data.processing_time_ms = -5;
        return p;
      },
      () => {
        const p = buildValidEnvelope({ documentId: 'doc-schema-1', mode: 'flat' });
        delete p.data.indexing_diagnostics;
        return p;
      },
      () =>
        buildValidEnvelope({
          documentId: 'doc-schema-1',
          mode: 'flat',
          indexingStatus: 'Indexed',
          latestVersionIndexed: false,
        }),
    ];
    let schemaCaseIdx = 0;
    const schemaMock = await startMockPythonServer((_req, res) => {
      const payload = invalidSchemaPayloads[schemaCaseIdx]();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });
    try {
      const clientSchema = createPythonExtractionClient({
        baseUrl: schemaMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 2000,
      });
      for (schemaCaseIdx = 0; schemaCaseIdx < invalidSchemaPayloads.length; schemaCaseIdx += 1) {
        await assert.rejects(
          () => clientSchema.extract({ documentId: 'doc-schema-1', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
          (err) => err instanceof PythonResponseValidationError
        );
      }
    } finally {
      await schemaMock.close();
    }
    reportTest(
      'TEST 8: Invalid Response Schema & Diagnostics Consistency',
      true,
      `Rejected all ${invalidSchemaPayloads.length} invalid response envelopes, status values, page/element/timing anomalies, and inconsistent indexing diagnostics`
    );

    const mismatchMock = await startMockPythonServer((_req, res, rec) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      if (rec.body.document_id === 'doc-expect-id') {
        res.end(JSON.stringify(buildValidEnvelope({ documentId: 'doc-other-id', mode: rec.body.mode })));
        return;
      }
      res.end(JSON.stringify(buildValidEnvelope({ documentId: rec.body.document_id, mode: 'flat' })));
    });
    try {
      const clientMismatch = createPythonExtractionClient({
        baseUrl: mismatchMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => clientMismatch.extract({ documentId: 'doc-expect-id', filePath: 'data/uploads/a.pdf', mode: 'reference' }),
        (err) => err instanceof PythonResponseValidationError && err.reason === 'document_id_mismatch'
      );
      reportTest(
        'TEST 9: Document ID Mismatch Rejection',
        true,
        'Rejected response whose data.document_id differed from claimed job document'
      );

      await assert.rejects(
        () => clientMismatch.extract({ documentId: 'doc-expect-mode', filePath: 'data/uploads/a.pdf', mode: 'candidate' }),
        (err) => err instanceof PythonResponseValidationError && err.reason === 'mode_mismatch'
      );
      reportTest(
        'TEST 10: Extraction Mode Mismatch Rejection',
        true,
        'Rejected response whose data.mode differed from claimed job mode'
      );
    } finally {
      await mismatchMock.close();
    }

    const unavailablePort = await getFreePort();
    const unavailableClient = createPythonExtractionClient({
      baseUrl: `http://127.0.0.1:${unavailablePort}`,
      internalApiSecret: testSecret,
      timeoutMs: 2000,
    });
    await assert.rejects(
      () => unavailableClient.extract({ documentId: 'doc-down', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
      (err) => err instanceof PythonNetworkError && err.retryable === true && !err.message.includes(testSecret)
    );
    reportTest(
      'TEST 3: Python Service Unavailable Error Classification',
      true,
      'Classified closed-port connection refusal as retryable PythonNetworkError without secret leakage'
    );

    const authMock = await startMockPythonServer((req, res) => {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ detail: `Unauthorized secret ${req.headers['x-internal-secret']}` }));
    });
    try {
      const authClient = createPythonExtractionClient({
        baseUrl: authMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => authClient.extract({ documentId: 'doc-auth', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
        (err) =>
          err instanceof PythonAuthenticationError &&
          err.statusCode === 401 &&
          err.retryable === false &&
          !err.message.includes(testSecret) &&
          err.message.includes('******')
      );
      reportTest(
        'TEST 4: HTTP Authentication Failure & Redaction',
        true,
        'Classified 401 as non-retryable PythonAuthenticationError and redacted echoed secret in detail'
      );
    } finally {
      await authMock.close();
    }

    let slowReqSocketClosed = false;
    const timeoutMock = await startMockPythonServer((req, res) => {
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.statusCode = 200;
          res.end(JSON.stringify(buildValidEnvelope({ documentId: 'doc-to', mode: 'flat' })));
        }
      }, 1500);
      req.on('close', () => {
        slowReqSocketClosed = true;
        clearTimeout(timer);
      });
    });
    try {
      const timeoutClient = createPythonExtractionClient({
        baseUrl: timeoutMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 120,
      });
      await assert.rejects(
        () => timeoutClient.extract({ documentId: 'doc-to', filePath: 'data/uploads/a.pdf', mode: 'flat' }),
        (err) => err instanceof PythonTimeoutError && err.retryable === true && err.timeoutMs === 120
      );
      await waitForCondition(() => slowReqSocketClosed, 2000);
      reportTest(
        'TEST 5: Request Timeout Classification & Socket Cancellation',
        true,
        'Aborted timed-out HTTP request at 120ms and classified as retryable PythonTimeoutError'
      );
    } finally {
      await timeoutMock.close();
    }

    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error('pre-aborted'));
    const abortEntered = createBarrier();
    let serverObservedAbort = false;
    const abortMock = await startMockPythonServer((req, res) => {
      abortEntered.resolve();
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.statusCode = 200;
          res.end(JSON.stringify(buildValidEnvelope({ documentId: 'doc-abort', mode: 'flat' })));
        }
      }, 2000);
      req.on('close', () => {
        serverObservedAbort = true;
        clearTimeout(timer);
      });
    });
    try {
      const abortClient = createPythonExtractionClient({
        baseUrl: abortMock.baseUrl,
        internalApiSecret: testSecret,
        timeoutMs: 5000,
      });
      await assert.rejects(
        () =>
          abortClient.extract({
            documentId: 'doc-abort-pre',
            filePath: 'data/uploads/a.pdf',
            mode: 'flat',
            signal: preAbortedController.signal,
          }),
        (err) => err instanceof PythonAbortError && err.retryable === false
      );
      assert.strictEqual(abortMock.requests.length, 0);

      const midFlightController = new AbortController();
      const pendingAbortCall = abortClient.extract({
        documentId: 'doc-abort',
        filePath: 'data/uploads/a.pdf',
        mode: 'flat',
        signal: midFlightController.signal,
      });
      await abortEntered.promise;
      midFlightController.abort(new Error('cancel-mid-flight'));
      await assert.rejects(
        () => pendingAbortCall,
        (err) => err instanceof PythonAbortError && err.retryable === false
      );
      await waitForCondition(() => serverObservedAbort, 2000);
      reportTest(
        'TEST 6: AbortSignal Pre-Dispatch & In-Flight Cancellation',
        true,
        'Avoided HTTP dispatch when pre-aborted and terminated in-flight HTTP request cleanly upon AbortSignal'
      );
    } finally {
      await abortMock.close();
    }

    console.log('\n--- SECTION 3: END-TO-END EXTRACTION, SEARCH VERIFICATION, PERSISTENCE & FENCING ---');

    const cleanDoc = await documentRepo.createDocument({
      document_id: 'test-py-clean-doc',
      filename: 'clean.pdf',
      sha256: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
      path: 'data/uploads/clean.pdf',
      pages_count: 2,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const cleanJob = await jobRepo.createJob({
      doc_id: cleanDoc.id,
      mode: 'reference',
      status: 'queued',
    });

    let cleanExtractTitle = 'Sample Document Title V1';
    const cleanCallOrder = [];
    const cleanMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        cleanCallOrder.push('extract');
        assert.strictEqual(rec.headers['x-internal-secret'], testSecret);
        assert.deepStrictEqual(rec.body, {
          document_id: cleanDoc.document_id,
          file_path: cleanDoc.path,
          mode: 'reference',
          skip_indexing: true,
        });
        const envPayload = buildValidEnvelope({
          documentId: cleanDoc.document_id,
          mode: 'reference',
          status: 'processed',
          pageCount: 2,
          indexingStatus: 'Skipped',
          latestVersionIndexed: false,
          searchable: false,
          chunkCount: 0,
        });
        envPayload.data.elements[0].text = cleanExtractTitle;
        res.statusCode = 200;
        res.end(JSON.stringify(envPayload));
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        cleanCallOrder.push('index');
        assert.strictEqual(rec.headers['x-internal-secret'], testSecret);
        assert.strictEqual(rec.body.document_id, cleanDoc.document_id);
        assert.strictEqual(rec.body.file_hash, cleanDoc.sha256);
        assert.strictEqual(rec.body.mode, 'reference');
        assert(Array.isArray(rec.body.elements) && rec.body.elements.length === 2);
        assert.strictEqual(rec.body.elements[0].text, cleanExtractTitle);
        setTimeout(() => {
          if (!res.writableEnded) {
            res.statusCode = 200;
            res.end(
              JSON.stringify(
                buildIndexEnvelope({
                  documentId: cleanDoc.document_id,
                  mode: 'reference',
                  chunkCount: 2,
                  persistedElementsIndexed: rec.body.elements.length,
                })
              )
            );
          }
        }, 70);
        return;
      }
      if (rec.url === '/api/v1/search') {
        cleanCallOrder.push('search');
        assert.strictEqual(rec.body.document_id, cleanDoc.document_id);
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: cleanDoc.document_id,
              sourceFileHash: cleanDoc.sha256,
              snippet: cleanExtractTitle,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const cleanLogs = [];
    let cleanHeartbeatCalls = 0;
    const cleanJobRepoSpy = {
      ...jobRepo,
      heartbeatJob: async (...args) => {
        cleanHeartbeatCalls += 1;
        return jobRepo.heartbeatJob(...args);
      },
      completeJob: async (...args) => {
        cleanCallOrder.push('complete');
        return jobRepo.completeJob(...args);
      },
    };
    const cleanElementRepoSpy = {
      ...elementRepo,
      replacePersistedElementsFenced: async (...args) => {
        cleanCallOrder.push('persist');
        return elementRepo.replacePersistedElementsFenced(...args);
      },
    };
    const cleanWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: cleanMock.baseUrl },
      config: {
        workerId: 'worker-py-clean',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 30,
        shutdownGraceMs: 1000,
      },
      repository: cleanJobRepoSpy,
      elementRepository: cleanElementRepoSpy,
      logger: createWorkerLogger({
        workerId: 'worker-py-clean',
        env: baseEnv,
        sink: (level, line, obj) => cleanLogs.push({ level, line, obj }),
      }),
    });
    try {
      await cleanWorker.start();
      await waitForCondition(() => cleanWorker.getState().metrics.jobsCompleted === 1);

      const dbCleanJob = await jobRepo.findById(cleanJob.id);
      const dbCleanDoc = await documentRepo.findById(cleanDoc.id);
      const cleanElementsFirst = await elementRepo.findByDocumentAndMode(cleanDoc.id, 'reference');
      assert.strictEqual(dbCleanJob.status, 'done');
      assert.strictEqual(dbCleanJob.locked_by, null);
      assert.strictEqual(dbCleanJob.claim_token, null);
      assert.strictEqual(dbCleanJob.locked_at, null);
      assert.strictEqual(dbCleanJob.heartbeat_at, null);
      assert.strictEqual(dbCleanDoc.status, 'ready');
      assert.strictEqual(dbCleanDoc.metadata.search_verified, true);
      assert.strictEqual(dbCleanDoc.metadata.indexing_status, 'Indexed');
      assert.strictEqual(dbCleanDoc.metadata.indexing_diagnostics.durable_on_disk, false);
      assert.strictEqual(cleanElementsFirst.length, 2);
      assert.strictEqual(cleanElementsFirst[0].text, 'Sample Document Title V1');
      assert.deepStrictEqual(cleanCallOrder, ['extract', 'persist', 'index', 'search', 'complete']);
      assert(cleanHeartbeatCalls >= 1, 'Expected heartbeat ticks to remain active through extraction, persistence, and indexing');

      cleanExtractTitle = 'Sample Document Title V2';
      const reprocessJob = await jobRepo.createJob({
        doc_id: cleanDoc.id,
        mode: 'reference',
        status: 'queued',
      });
      await waitForCondition(() => cleanWorker.getState().metrics.jobsCompleted === 2);

      const stopSummary = await cleanWorker.stop({ reason: 'manual' });
      await resetPool();

      assert(!JSON.stringify(stopSummary).includes(testSecret));
      assert(!cleanLogs.some((l) => l.line.includes(testSecret)));
      assert.strictEqual(stopSummary.metrics.jobsCompleted, 2);
      assert.strictEqual(stopSummary.metrics.jobsExtracted, 2);
      assert.strictEqual(stopSummary.metrics.jobsExtractedClean, 2);
      assert.strictEqual(stopSummary.metrics.jobsExtractedDegraded, 0);
      assert(stopSummary.metrics.heartbeatsSent >= 2);
      assert.strictEqual(stopSummary.lastExtractionOutcomes[0].persisted, true);
      assert.strictEqual(stopSummary.lastExtractionOutcomes[0].searchVerified, true);
      assert.deepStrictEqual(cleanCallOrder, [
        'extract',
        'persist',
        'index',
        'search',
        'complete',
        'extract',
        'persist',
        'index',
        'search',
        'complete',
      ]);
      assert(cleanLogs.some((l) => l.obj.event === 'job_completed' && l.obj.search_verified === true));

      const dbReprocessJob = await jobRepo.findById(reprocessJob.id);
      const cleanElementsSecond = await elementRepo.findByDocumentAndMode(cleanDoc.id, 'reference');
      const recCheck = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
      assert.strictEqual(dbReprocessJob.status, 'done');
      assert.strictEqual(cleanElementsSecond.length, 2);
      assert.strictEqual(cleanElementsSecond[0].text, 'Sample Document Title V2');
      assert.strictEqual(recCheck.recoveredCount, 0);
    } finally {
      await cleanMock.close();
    }
    reportTest(
      'TEST 1: End-to-End Pipeline Sequence, Active Heartbeats, Idempotent Persistence & Fenced Done',
      true,
      'Verified extract (skip_indexing) -> persist -> index -> search -> complete order, live heartbeats across stages, and zero-duplicate reprocess'
    );

    const degradedDoc = await documentRepo.createDocument({
      document_id: 'test-py-degraded-doc',
      filename: 'degraded.pdf',
      sha256: 'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
      path: 'data/uploads/degraded.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const degradedJob = await jobRepo.createJob({
      doc_id: degradedDoc.id,
      mode: 'candidate_ft',
      status: 'queued',
    });

    const degradedMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        assert.strictEqual(rec.body.skip_indexing, true);
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: degradedDoc.document_id,
              mode: 'candidate_ft',
              status: 'degraded',
              pageCount: 1,
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
              fallbackOccurred: true,
              fallbackReason: 'Docling unavailable in test environment',
              extractorName: 'PyMuPDF',
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        assert.strictEqual(rec.body.document_id, degradedDoc.document_id);
        assert.strictEqual(rec.body.is_degraded, true);
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildIndexEnvelope({
              documentId: degradedDoc.document_id,
              mode: 'candidate_ft',
              chunkCount: 2,
              persistedElementsIndexed: rec.body.elements.length,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: degradedDoc.document_id,
              sourceFileHash: degradedDoc.sha256,
              status: 'degraded',
              isDegraded: true,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const degradedLogs = [];
    const degradedWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: degradedMock.baseUrl },
      config: {
        workerId: 'worker-py-degraded',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 1000,
      },
      logger: createWorkerLogger({
        workerId: 'worker-py-degraded',
        env: baseEnv,
        sink: (level, line, obj) => degradedLogs.push({ level, line, obj }),
      }),
    });
    try {
      await degradedWorker.start();
      await waitForCondition(() => degradedWorker.getState().metrics.jobsCompleted === 1);
      const degradedStop = await degradedWorker.stop({ reason: 'manual' });
      await resetPool();

      assert.strictEqual(degradedStop.metrics.jobsCompleted, 1);
      assert.strictEqual(degradedStop.metrics.jobsExtracted, 1);
      assert.strictEqual(degradedStop.metrics.jobsExtractedClean, 0);
      assert.strictEqual(degradedStop.metrics.jobsExtractedDegraded, 1);
      assert.strictEqual(degradedStop.lastExtractionOutcomes[0].isDegraded, true);
      assert.strictEqual(degradedStop.lastExtractionOutcomes[0].persisted, true);
      assert(degradedLogs.some((l) => l.obj.event === 'job_extracted_degraded' && l.obj.is_degraded === true));

      const dbDegJob = await jobRepo.findById(degradedJob.id);
      const dbDegDoc = await documentRepo.findById(degradedDoc.id);
      const degElements = await elementRepo.findByDocumentAndMode(degradedDoc.id, 'candidate_ft');
      assert.strictEqual(dbDegJob.status, 'degraded');
      assert.notStrictEqual(dbDegJob.status, 'done');
      assert.strictEqual(dbDegDoc.status, 'degraded');
      assert.strictEqual(degElements.length, 2);
    } finally {
      await degradedMock.close();
    }
    reportTest(
      'TEST 2: Degraded Extraction Persistence & Degraded Completion Distinction',
      true,
      'Verified degraded/fallback extract -> persist -> index -> search persists elements, sets document & job status=degraded, and logs job_extracted_degraded'
    );

    const retryDoc = await documentRepo.createDocument({
      document_id: 'test-py-retry-doc',
      filename: 'retry.pdf',
      sha256: 'e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3',
      path: 'data/uploads/retry.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const retryJob = await jobRepo.createJob({
      doc_id: retryDoc.id,
      mode: 'candidate',
      status: 'queued',
    });

    let retryExtractCalls = 0;
    const retryMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        retryExtractCalls += 1;
        if (retryExtractCalls === 1) {
          res.statusCode = 503;
          res.end(JSON.stringify({ detail: `Transient overload with secret=${testSecret}` }));
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: retryDoc.document_id,
              mode: 'candidate',
              status: 'processed',
              pageCount: 1,
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildIndexEnvelope({
              documentId: retryDoc.document_id,
              mode: 'candidate',
              chunkCount: 2,
              persistedElementsIndexed: rec.body.elements.length,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: retryDoc.document_id,
              sourceFileHash: retryDoc.sha256,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const retryWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: retryMock.baseUrl },
      config: {
        workerId: 'worker-py-retry',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 1000,
        maxAttempts: 3,
      },
      logger: createWorkerLogger({ workerId: 'worker-py-retry', env: baseEnv, sink: () => {} }),
    });
    try {
      await retryWorker.start();
      await waitForCondition(() => retryWorker.getState().metrics.jobsCompleted === 1);
      const retryStop = await retryWorker.stop({ reason: 'manual' });
      await resetPool();

      assert.strictEqual(retryExtractCalls, 2);
      assert.strictEqual(retryStop.metrics.jobsFailed, 1);
      assert.strictEqual(retryStop.metrics.jobsCompleted, 1);
      assert.strictEqual(retryStop.lastExtractionOutcomes[0].attempts, 2);
      const dbRetryJob = await jobRepo.findById(retryJob.id);
      const retryElements = await elementRepo.findByDocumentAndMode(retryDoc.id, 'candidate');
      assert.strictEqual(dbRetryJob.attempts, 2);
      assert.strictEqual(dbRetryJob.status, 'done');
      assert.strictEqual(retryElements.length, 2);
      assert(!String(dbRetryJob.error || '').includes(testSecret));
    } finally {
      await retryMock.close();
    }
    reportTest(
      'TEST 12: Worker Retry Policy After Extraction Failure (No Client Silent Retry)',
      true,
      'Verified 503 triggered 1 worker failJob retry (attempt 1 -> attempt 2) with zero hidden client retries before atomic persistence and indexing'
    );

    const lossDoc = await documentRepo.createDocument({
      document_id: 'test-py-leaseloss-doc',
      filename: 'leaseloss.pdf',
      sha256: 'f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4',
      path: 'data/uploads/leaseloss.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const lossJob = await jobRepo.createJob({
      doc_id: lossDoc.id,
      mode: 'candidate',
      status: 'queued',
      lease_timeout_seconds: 15,
    });

    const lossHttpEntered = createBarrier();
    let lossServerClosed = false;
    const lossMock = await startMockPythonServer((req, res) => {
      lossHttpEntered.resolve();
      const t = setTimeout(() => {
        if (!res.writableEnded) {
          res.statusCode = 200;
          res.end(JSON.stringify(buildValidEnvelope({ documentId: lossDoc.document_id, mode: 'candidate' })));
        }
      }, 3000);
      req.on('close', () => {
        lossServerClosed = true;
        clearTimeout(t);
      });
    });

    let lossPersistCalls = 0;
    let lossCompleteCalls = 0;
    let lossFailCalls = 0;
    const lossRepoSpy = {
      ...jobRepo,
      completeJob: async (...args) => {
        lossCompleteCalls += 1;
        return jobRepo.completeJob(...args);
      },
      failJob: async (...args) => {
        lossFailCalls += 1;
        return jobRepo.failJob(...args);
      },
    };
    const lossElementRepoSpy = {
      ...elementRepo,
      replacePersistedElementsFenced: async (...args) => {
        lossPersistCalls += 1;
        return elementRepo.replacePersistedElementsFenced(...args);
      },
    };
    const lossWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: lossMock.baseUrl },
      config: {
        workerId: 'worker-py-loss-1',
        concurrency: 1,
        pollIntervalMs: 30,
        heartbeatIntervalMs: 30,
        shutdownGraceMs: 500,
      },
      repository: lossRepoSpy,
      elementRepository: lossElementRepoSpy,
      logger: createWorkerLogger({ workerId: 'worker-py-loss-1', env: baseEnv, sink: () => {} }),
    });
    try {
      await lossWorker.start();
      await lossHttpEntered.promise;

      await query(
        `UPDATE jobs
         SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
         WHERE id = ?`,
        [lossJob.id]
      );
      await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
      const stolen = await jobRepo.claimJob('worker-py-thief', { mode: 'candidate' });
      assert.strictEqual(stolen.lease_generation, 2);

      await waitForCondition(() => lossWorker.getState().activeJobCount === 0, 5000);
      await waitForCondition(() => lossServerClosed, 2000);
      const lossStop = await lossWorker.stop({ reason: 'manual' });
      await resetPool();

      assert(lossStop.metrics.leaseLosses >= 1);
      assert.strictEqual(lossStop.metrics.jobsCompleted, 0);
      assert.strictEqual(lossPersistCalls, 0);
      assert.strictEqual(lossCompleteCalls, 0);
      assert.strictEqual(lossFailCalls, 0);
      assert.strictEqual((await elementRepo.findByDocumentAndMode(lossDoc.id, 'candidate')).length, 0);
      const dbAfterSteal = await jobRepo.findById(lossJob.id);
      assert.strictEqual(dbAfterSteal.locked_by, 'worker-py-thief');
      assert.strictEqual(dbAfterSteal.claim_token, stolen.claim_token);
      assert.strictEqual(dbAfterSteal.lease_generation, 2);

      await jobRepo.completeJob(lossJob.id, 'worker-py-thief', {
        claimToken: stolen.claim_token,
        status: 'done',
        seconds: 0.1,
      });
    } finally {
      await lossMock.close();
    }

    const fenceDoc = await documentRepo.createDocument({
      document_id: 'test-py-fence-doc',
      filename: 'fence.pdf',
      sha256: 'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5',
      path: 'data/uploads/fence.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const fenceJob = await jobRepo.createJob({
      doc_id: fenceDoc.id,
      mode: 'flat',
      status: 'queued',
      lease_timeout_seconds: 15,
    });
    const fenceRelease = createBarrier();
    const fenceEntered = createBarrier();
    const fenceMock = await startMockPythonServer(async (_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        fenceEntered.resolve();
        await fenceRelease.promise;
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: fenceDoc.document_id,
              mode: 'flat',
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        res.statusCode = 200;
        res.end(JSON.stringify(buildIndexEnvelope({ documentId: fenceDoc.document_id, mode: 'flat' })));
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: fenceDoc.document_id,
              sourceFileHash: fenceDoc.sha256,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const fenceWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: fenceMock.baseUrl },
      config: {
        workerId: 'worker-py-fence-old',
        concurrency: 1,
        pollIntervalMs: 30,
        heartbeatIntervalMs: 2500,
        shutdownGraceMs: 500,
      },
      logger: createWorkerLogger({ workerId: 'worker-py-fence-old', env: baseEnv, sink: () => {} }),
    });
    try {
      await fenceWorker.start();
      await fenceEntered.promise;

      await query(
        `UPDATE jobs
         SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
             heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
         WHERE id = ?`,
        [fenceJob.id]
      );
      await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
      const newOwnerClaim = await jobRepo.claimJob('worker-py-fence-new', { mode: 'flat' });
      assert.strictEqual(newOwnerClaim.lease_generation, 2);

      fenceRelease.resolve();
      await waitForCondition(() => fenceWorker.getState().activeJobCount === 0, 5000);
      const fenceStop = await fenceWorker.stop({ reason: 'manual' });
      await resetPool();

      assert(fenceStop.metrics.leaseLosses >= 1);
      assert.strictEqual(fenceStop.metrics.jobsCompleted, 0);
      assert(!fenceMock.requests.some((r) => r.url === '/api/v1/internal/index'));
      assert.strictEqual((await elementRepo.findByDocumentAndMode(fenceDoc.id, 'flat')).length, 0);
      assert.strictEqual((await documentRepo.findById(fenceDoc.id)).status, 'queued');
      assert.strictEqual((await jobRepo.findById(fenceJob.id)).claim_token, newOwnerClaim.claim_token);
    } finally {
      await fenceMock.close();
    }
    reportTest(
      'TEST 13: Lease Loss During Extraction & Persistence (Mid-Flight Abort & Fenced Element Write Rejection)',
      true,
      'Aborted HTTP fetch upon heartbeat lease loss and blocked stale MySQL element persistence, indexing, and completion via lease fencing'
    );

    const graceOkDoc = await documentRepo.createDocument({
      document_id: 'test-py-graceok-doc',
      filename: 'graceok.pdf',
      sha256: 'a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8',
      path: 'data/uploads/graceok.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const graceOkJob = await jobRepo.createJob({
      doc_id: graceOkDoc.id,
      mode: 'reference',
      status: 'queued',
    });
    const graceOkEntered = createBarrier();
    const graceOkMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        graceOkEntered.resolve();
        setTimeout(() => {
          if (!res.writableEnded) {
            res.statusCode = 200;
            res.end(
              JSON.stringify(
                buildValidEnvelope({
                  documentId: graceOkDoc.document_id,
                  mode: 'reference',
                  indexingStatus: 'Skipped',
                  latestVersionIndexed: false,
                  searchable: false,
                  chunkCount: 0,
                })
              )
            );
          }
        }, 80);
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        res.statusCode = 200;
        res.end(JSON.stringify(buildIndexEnvelope({ documentId: graceOkDoc.document_id, mode: 'reference' })));
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: graceOkDoc.document_id,
              sourceFileHash: graceOkDoc.sha256,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const graceOkWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: graceOkMock.baseUrl },
      config: {
        workerId: 'worker-py-grace-ok',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 500,
        shutdownGraceMs: 2500,
      },
      logger: createWorkerLogger({ workerId: 'worker-py-grace-ok', env: baseEnv, sink: () => {} }),
    });
    try {
      await graceOkWorker.start();
      await graceOkEntered.promise;
      const graceOkStop = await graceOkWorker.stop({ reason: 'SIGTERM' });
      await resetPool();
      assert.strictEqual(graceOkStop.shutdownReason, 'SIGTERM');
      assert.strictEqual(graceOkStop.metrics.jobsCompleted, 1);
      assert.strictEqual(graceOkStop.databaseClosed, true);
      assert.strictEqual((await jobRepo.findById(graceOkJob.id)).status, 'done');
      assert.strictEqual((await elementRepo.findByDocumentAndMode(graceOkDoc.id, 'reference')).length, 2);
    } finally {
      await graceOkMock.close();
    }

    const shutDoc = await documentRepo.createDocument({
      document_id: 'test-py-shutdown-doc',
      filename: 'shutdown.pdf',
      sha256: 'b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9',
      path: 'data/uploads/shutdown.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const shutJob = await jobRepo.createJob({
      doc_id: shutDoc.id,
      mode: 'candidate',
      status: 'queued',
      lease_timeout_seconds: 15,
    });
    const shutEntered = createBarrier();
    let shutServerAborted = false;
    const shutMock = await startMockPythonServer((req, res) => {
      shutEntered.resolve();
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.statusCode = 200;
          res.end(
            JSON.stringify(
              buildValidEnvelope({
                documentId: shutDoc.document_id,
                mode: 'candidate',
                indexingStatus: 'Skipped',
                latestVersionIndexed: false,
                searchable: false,
                chunkCount: 0,
              })
            )
          );
        }
      }, 4000);
      req.on('close', () => {
        shutServerAborted = true;
        clearTimeout(timer);
      });
    });
    let shutCompleteCalls = 0;
    let shutFailCalls = 0;
    const shutRepoSpy = {
      ...jobRepo,
      completeJob: async (...args) => {
        shutCompleteCalls += 1;
        return jobRepo.completeJob(...args);
      },
      failJob: async (...args) => {
        shutFailCalls += 1;
        return jobRepo.failJob(...args);
      },
    };
    const shutWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: shutMock.baseUrl },
      config: {
        workerId: 'worker-py-shut-timeout',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 2500,
        shutdownGraceMs: 120,
      },
      repository: shutRepoSpy,
      logger: createWorkerLogger({ workerId: 'worker-py-shut-timeout', env: baseEnv, sink: () => {} }),
    });
    try {
      await shutWorker.start();
      await shutEntered.promise;
      const shutStop = await shutWorker.stop({ reason: 'SIGTERM' });
      await waitForCondition(() => shutServerAborted, 2000);
      await resetPool();

      assert.strictEqual(shutStop.shutdownReason, 'grace_timeout');
      assert.strictEqual(shutStop.metrics.graceTimeouts, 1);
      assert.strictEqual(shutStop.metrics.jobsCompleted, 0);
      assert.strictEqual(shutStop.metrics.jobsFailed, 0);
      assert.strictEqual(shutCompleteCalls, 0);
      assert.strictEqual(shutFailCalls, 0);
      assert.strictEqual(shutStop.databaseClosed, true);
      assert.strictEqual((await elementRepo.findByDocumentAndMode(shutDoc.id, 'candidate')).length, 0);

      const dbShutJob = await jobRepo.findById(shutJob.id);
      assert.strictEqual(dbShutJob.status, 'running');
      assert.notStrictEqual(dbShutJob.status, 'done');
    } finally {
      await shutMock.close();
    }

    const shutPersistDoc = await documentRepo.createDocument({
      document_id: 'test-py-shutdown-persist-doc',
      filename: 'shutdown_persist.pdf',
      sha256: 'c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2',
      path: 'data/uploads/shutdown_persist.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const shutPersistJob = await jobRepo.createJob({
      doc_id: shutPersistDoc.id,
      mode: 'flat',
      status: 'queued',
      lease_timeout_seconds: 15,
    });
    const shutPersistEntered = createBarrier();
    let shutPersistMock;
    shutPersistMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: shutPersistDoc.document_id,
              mode: 'flat',
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    let shutPersistCompleteCalls = 0;
    let shutPersistHandlerSettled = false;
    const shutPersistRepoSpy = {
      ...jobRepo,
      completeJob: async (...args) => {
        shutPersistCompleteCalls += 1;
        return jobRepo.completeJob(...args);
      },
    };
    const shutPersistElementRepo = {
      ...elementRepo,
      replacePersistedElementsFenced: async (...args) => {
        shutPersistEntered.resolve();
        try {
          await new Promise((resolve) => setTimeout(resolve, 260));
          return await elementRepo.replacePersistedElementsFenced(...args);
        } finally {
          shutPersistHandlerSettled = true;
        }
      },
    };
    const shutPersistWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: shutPersistMock.baseUrl },
      config: {
        workerId: 'worker-py-shut-persist',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 2500,
        shutdownGraceMs: 80,
      },
      repository: shutPersistRepoSpy,
      elementRepository: shutPersistElementRepo,
      logger: createWorkerLogger({ workerId: 'worker-py-shut-persist', env: baseEnv, sink: () => {} }),
    });
    try {
      await shutPersistWorker.start();
      await shutPersistEntered.promise;
      const shutPersistStop = await shutPersistWorker.stop({ reason: 'SIGTERM' });
      await waitForCondition(() => shutPersistHandlerSettled, 2000);
      await resetPool();

      assert.strictEqual(shutPersistStop.shutdownReason, 'grace_timeout');
      assert.strictEqual(shutPersistStop.metrics.graceTimeouts, 1);
      assert.strictEqual(shutPersistStop.metrics.jobsCompleted, 0);
      assert.strictEqual(shutPersistCompleteCalls, 0);
      assert.strictEqual((await elementRepo.findByDocumentAndMode(shutPersistDoc.id, 'flat')).length, 0);
      assert.strictEqual((await documentRepo.findById(shutPersistDoc.id)).status, 'queued');
      assert.strictEqual((await jobRepo.findById(shutPersistJob.id)).status, 'running');
    } finally {
      await shutPersistMock.close();
    }
    reportTest(
      'TEST 14: Shutdown During Extraction & Persistence (Graceful Drain & Timeout Abort)',
      true,
      'Graceful stop drained full pipeline before pool close; grace timeout aborted extraction or blocked stalled persistence with 0 partial elements and 0 completions'
    );

    const noFalseDoc = await documentRepo.createDocument({
      document_id: 'test-py-nofalse-doc',
      filename: 'nofalse.pdf',
      sha256: 'c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7',
      path: 'data/uploads/nofalse.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const noFalseIndexingJob = await jobRepo.createJob({
      doc_id: noFalseDoc.id,
      mode: 'flat',
      status: 'queued',
    });
    const noFalseSearchJob = await jobRepo.createJob({
      doc_id: noFalseDoc.id,
      mode: 'reference',
      status: 'queued',
    });
    const noFalseTimeoutJob = await jobRepo.createJob({
      doc_id: noFalseDoc.id,
      mode: 'candidate',
      status: 'queued',
    });
    const noFalseMock = await startMockPythonServer((req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        if (rec.body.mode === 'flat') {
          res.statusCode = 200;
          res.end(
            JSON.stringify(
              buildValidEnvelope({
                documentId: noFalseDoc.document_id,
                mode: 'flat',
                status: 'degraded',
                indexingStatus: 'Skipped',
                latestVersionIndexed: false,
                searchable: false,
                chunkCount: 0,
              })
            )
          );
          return;
        }
        if (rec.body.mode === 'reference') {
          res.statusCode = 200;
          res.end(
            JSON.stringify(
              buildValidEnvelope({
                documentId: noFalseDoc.document_id,
                mode: 'reference',
                status: 'processed',
                indexingStatus: 'Skipped',
                latestVersionIndexed: false,
                searchable: false,
                chunkCount: 0,
              })
            )
          );
          return;
        }
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            res.statusCode = 200;
            res.end(
              JSON.stringify(
                buildValidEnvelope({
                  documentId: noFalseDoc.document_id,
                  mode: 'candidate',
                  indexingStatus: 'Skipped',
                  latestVersionIndexed: false,
                  searchable: false,
                  chunkCount: 0,
                })
              )
            );
          }
        }, 2000);
        req.on('close', () => clearTimeout(timer));
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        if (rec.body.mode === 'flat') {
          res.statusCode = 200;
          res.end(
            JSON.stringify(
              buildIndexEnvelope({
                documentId: noFalseDoc.document_id,
                mode: 'flat',
                indexingStatus: 'Failed',
                latestVersionIndexed: false,
                searchable: false,
                chunkCount: 0,
                persistedElementsIndexed: rec.body.elements.length,
              })
            )
          );
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildIndexEnvelope({
              documentId: noFalseDoc.document_id,
              mode: rec.body.mode,
              chunkCount: 2,
              persistedElementsIndexed: rec.body.elements.length,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: noFalseDoc.document_id,
              matches: [],
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    let noFalseCompleteCalls = 0;
    const noFalseRepoSpy = {
      ...jobRepo,
      completeJob: async (...args) => {
        noFalseCompleteCalls += 1;
        return jobRepo.completeJob(...args);
      },
    };
    const noFalseWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: noFalseMock.baseUrl, PYTHON_EXTRACTION_TIMEOUT_MS: '120' },
      config: {
        workerId: 'worker-py-nofalse',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 500,
        shutdownGraceMs: 500,
        maxAttempts: 1,
      },
      repository: noFalseRepoSpy,
      logger: createWorkerLogger({ workerId: 'worker-py-nofalse', env: baseEnv, sink: () => {} }),
    });
    try {
      await noFalseWorker.start();
      await waitForCondition(() => noFalseWorker.getState().metrics.jobsFailed === 3, 5000);
      const noFalseStop = await noFalseWorker.stop({ reason: 'manual' });
      await resetPool();

      assert.strictEqual(noFalseCompleteCalls, 0);
      assert.strictEqual(noFalseStop.metrics.jobsCompleted, 0);
      assert.strictEqual(noFalseStop.metrics.jobsExtracted, 0);
      assert.strictEqual((await elementRepo.findByDocumentAndMode(noFalseDoc.id, 'candidate')).length, 0);
      assert.strictEqual((await jobRepo.findById(noFalseIndexingJob.id)).status, 'failed');
      assert.strictEqual((await jobRepo.findById(noFalseSearchJob.id)).status, 'failed');
      assert.strictEqual((await jobRepo.findById(noFalseTimeoutJob.id)).status, 'failed');
      assert.strictEqual((await documentRepo.findById(noFalseDoc.id)).status, 'queued');
    } finally {
      await noFalseMock.close();
    }
    reportTest(
      'TEST 15: Indexing, Search Verification & Timeout Failure Blocking Premature Completion',
      true,
      'Confirmed failed indexing, 0-hit FAISS search verification, and timeout each keep document queued and fail job without calling completeJob'
    );

    const persistFailDoc = await documentRepo.createDocument({
      document_id: 'test-py-persist-fail-doc',
      filename: 'persist_fail.pdf',
      sha256: 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
      path: 'data/uploads/persist_fail.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    await elementRepo.replaceByDocumentAndMode(persistFailDoc.id, 'reference', [
      {
        type: 'heading',
        page: 1,
        reading_order: 1,
        text: 'Prior V0 Element',
        bbox: { x: 10, y: 10, width: 100, height: 20 },
        confidence: 0.9,
      },
    ]);
    const persistFailJob = await jobRepo.createJob({
      doc_id: persistFailDoc.id,
      mode: 'reference',
      status: 'queued',
    });
    const persistFailMock = await startMockPythonServer((_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: persistFailDoc.document_id,
              mode: 'reference',
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildIndexEnvelope({
              documentId: persistFailDoc.document_id,
              mode: 'reference',
              chunkCount: 2,
              persistedElementsIndexed: rec.body.elements.length,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: persistFailDoc.document_id,
              sourceFileHash: persistFailDoc.sha256,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    let persistFailAttempts = 0;
    let persistFailMidTxVerified = false;
    let afterAttempt1ElementsSnapshot = null;
    const persistAttempt2Gate = createBarrier();
    const persistFailElementRepo = {
      ...elementRepo,
      replacePersistedElementsFenced: async (jobId, workerId, details) => {
        persistFailAttempts += 1;
        if (persistFailAttempts === 1) {
          const badElements = [
            details.elements[0],
            {
              ...details.elements[1],
              type: 'INVALID_ENUM_FOR_ROLLBACK_TEST',
            },
          ];
          try {
            await elementRepo.replacePersistedElementsFenced(jobId, workerId, {
              ...details,
              elements: badElements,
            });
          } catch (err) {
            afterAttempt1ElementsSnapshot = await elementRepo.findByDocumentAndMode(persistFailDoc.id, 'reference');
            throw err;
          }
        }
        await persistAttempt2Gate.promise;
        return elementRepo.replacePersistedElementsFenced(jobId, workerId, details);
      },
      findByDocumentAndMode: async (...args) => elementRepo.findByDocumentAndMode(...args),
    };
    const persistFailWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: persistFailMock.baseUrl },
      config: {
        workerId: 'worker-py-persist-fail',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 1000,
        maxAttempts: 3,
      },
      elementRepository: persistFailElementRepo,
      logger: createWorkerLogger({ workerId: 'worker-py-persist-fail', env: baseEnv, sink: () => {} }),
    });
    try {
      await persistFailWorker.start();
      await waitForCondition(() => persistFailAttempts >= 1);
      await waitForCondition(() => persistFailWorker.getState().metrics.jobsFailed === 1);
      assert(Array.isArray(afterAttempt1ElementsSnapshot));
      assert.strictEqual(afterAttempt1ElementsSnapshot.length, 1);
      assert.strictEqual(afterAttempt1ElementsSnapshot[0].text, 'Prior V0 Element');
      assert.strictEqual((await documentRepo.findById(persistFailDoc.id)).status, 'queued');
      persistFailMidTxVerified = true;
      persistAttempt2Gate.resolve();

      await waitForCondition(() => persistFailWorker.getState().metrics.jobsCompleted === 1);
      await persistFailWorker.stop({ reason: 'manual' });
      await resetPool();

      assert.strictEqual(persistFailMidTxVerified, true);
      assert.strictEqual(persistFailAttempts, 2);
      const recoveredElements = await elementRepo.findByDocumentAndMode(persistFailDoc.id, 'reference');
      const dbPersistFailJob = await jobRepo.findById(persistFailJob.id);
      const dbPersistFailDoc = await documentRepo.findById(persistFailDoc.id);
      assert.strictEqual(recoveredElements.length, 2);
      assert.strictEqual(recoveredElements[0].text, 'Sample Document Title');
      assert.strictEqual(dbPersistFailJob.status, 'done');
      assert.strictEqual(dbPersistFailJob.attempts, 2);
      assert.strictEqual(dbPersistFailDoc.status, 'ready');
    } finally {
      persistAttempt2Gate.resolve();
      await persistFailMock.close();
    }
    reportTest(
      'TEST 16: Persistence Transaction Rollback on Failure & Zero-Duplicate Retry',
      true,
      'Verified failed bulk element write rolled back cleanly (preserving prior V0 row) and retry produced exact 2 new elements with zero duplicates'
    );

    const idxFailDoc = await documentRepo.createDocument({
      document_id: 'test-py-index-fail-doc',
      filename: 'index_fail.pdf',
      sha256: 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
      path: 'data/uploads/index_fail.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const idxFailJob = await jobRepo.createJob({
      doc_id: idxFailDoc.id,
      mode: 'reference',
      status: 'queued',
    });
    let idxFailIndexCalls = 0;
    const idxFailAttempt2Gate = createBarrier();
    const idxFailMock = await startMockPythonServer(async (_req, res, rec) => {
      res.setHeader('Content-Type', 'application/json');
      if (rec.url === '/api/v1/internal/extract') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildValidEnvelope({
              documentId: idxFailDoc.document_id,
              mode: 'reference',
              indexingStatus: 'Skipped',
              latestVersionIndexed: false,
              searchable: false,
              chunkCount: 0,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/internal/index') {
        idxFailIndexCalls += 1;
        if (idxFailIndexCalls === 1) {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: 'Simulated FAISS rebuild failure' }));
          return;
        }
        await idxFailAttempt2Gate.promise;
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildIndexEnvelope({
              documentId: idxFailDoc.document_id,
              mode: 'reference',
              chunkCount: 2,
              persistedElementsIndexed: rec.body.elements.length,
            })
          )
        );
        return;
      }
      if (rec.url === '/api/v1/search') {
        res.statusCode = 200;
        res.end(
          JSON.stringify(
            buildSearchEnvelope({
              documentId: idxFailDoc.document_id,
              sourceFileHash: idxFailDoc.sha256,
            })
          )
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: 'Not found' }));
    });
    const idxFailWorker = createWorker({
      env: { ...baseEnv, PYTHON_SERVICE_URL: idxFailMock.baseUrl },
      config: {
        workerId: 'worker-py-index-fail',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 1000,
        maxAttempts: 3,
      },
      logger: createWorkerLogger({ workerId: 'worker-py-index-fail', env: baseEnv, sink: () => {} }),
    });
    try {
      await idxFailWorker.start();
      await waitForCondition(() => idxFailWorker.getState().metrics.jobsFailed === 1);
      assert.strictEqual((await documentRepo.findById(idxFailDoc.id)).status, 'queued');
      idxFailAttempt2Gate.resolve();

      await waitForCondition(() => idxFailWorker.getState().metrics.jobsCompleted === 1);
      const idxFailStop = await idxFailWorker.stop({ reason: 'manual' });
      await resetPool();

      assert.strictEqual(idxFailIndexCalls, 2);
      assert.strictEqual(idxFailStop.metrics.jobsFailed, 1);
      assert.strictEqual(idxFailStop.metrics.jobsCompleted, 1);
      const dbIdxFailJob = await jobRepo.findById(idxFailJob.id);
      const dbIdxFailDoc = await documentRepo.findById(idxFailDoc.id);
      assert.strictEqual(dbIdxFailJob.status, 'done');
      assert.strictEqual(dbIdxFailJob.attempts, 2);
      assert.strictEqual(dbIdxFailDoc.status, 'ready');
    } finally {
      idxFailAttempt2Gate.resolve();
      await idxFailMock.close();
    }
    reportTest(
      'TEST 17: Indexing Failure Handling & Retry Recovery Without Premature Completion',
      true,
      'Verified HTTP 500 during /internal/index left document queued, triggered retry, and succeeded without duplicate state on attempt 2'
    );

    console.log('\n--- SECTION 4: LIVE FASTAPI PYTHON INTEGRATION TEST ---');
    const pythonExe = getPythonExecutable();
    assert(pythonExe, 'Expected local Python venv executable for FastAPI integration test');

    const uploadDir = path.join(REPO_ROOT, 'data', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const tempPdfFilename = `test_py_worker_live_${Date.now()}.pdf`;
    const tempPdfPath = path.join(uploadDir, tempPdfFilename);

    execFileSync(
      pythonExe,
      [
        '-c',
        `import pymupdf as fitz; doc = fitz.open(); p = doc.new_page(width=612, height=792); p.insert_text((72, 72), "Live Node Python Worker Heading", fontsize=18); p.insert_text((72, 120), "Integration test paragraph extracted via internal endpoint.", fontsize=12); doc.save(r"${tempPdfPath}"); doc.close()`,
      ],
      { cwd: REPO_ROOT, timeout: 15000 }
    );

    const pdfBytes = fs.readFileSync(tempPdfPath);
    const pdfSha = crypto.createHash('sha256').update(pdfBytes).digest('hex');
    const livePort = await getFreePort();
    const liveBaseUrl = `http://127.0.0.1:${livePort}`;

    const uvicornProc = spawn(
      pythonExe,
      ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', String(livePort)],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          INTERNAL_API_SECRET: testSecret,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let uvicornOutput = '';
    uvicornProc.stdout.on('data', (d) => {
      uvicornOutput += d.toString('utf8');
    });
    uvicornProc.stderr.on('data', (d) => {
      uvicornOutput += d.toString('utf8');
    });

    try {
      try {
        await waitForCondition(async () => {
          if (uvicornProc.exitCode !== null) {
            throw new Error(`Uvicorn exited early (${uvicornProc.exitCode}): ${uvicornOutput.slice(0, 500)}`);
          }
          try {
            const resp = await fetch(`${liveBaseUrl}/api/v1/health`);
            return resp.ok;
          } catch {
            return false;
          }
        }, 180000, 500);
      } catch (err) {
        throw new Error(`${err.message} | uvicorn output tail: ${uvicornOutput.slice(-600)}`);
      }

      const liveDoc = await documentRepo.createDocument({
        document_id: `test-py-live-${Date.now()}`,
        filename: tempPdfFilename,
        sha256: pdfSha,
        path: `data/uploads/${tempPdfFilename}`,
        pages_count: 1,
        doc_type: 'user_upload',
        split: 'none',
        status: 'queued',
      });
      const liveJob = await jobRepo.createJob({
        doc_id: liveDoc.id,
        mode: 'reference',
        status: 'queued',
      });

      const badSecretLiveClient = createPythonExtractionClient({
        baseUrl: liveBaseUrl,
        internalApiSecret: 'wrong-secret-live-probe',
        timeoutMs: 10000,
      });
      await assert.rejects(
        () =>
          badSecretLiveClient.extract({
            documentId: liveDoc.document_id,
            filePath: liveDoc.path,
            mode: 'reference',
          }),
        (err) => err instanceof PythonAuthenticationError && err.statusCode === 401
      );

      let observedSummary = null;
      let observedResult = null;
      const liveWorker = createWorker({
        env: {
          ...baseEnv,
          PYTHON_SERVICE_URL: liveBaseUrl,
          PYTHON_EXTRACTION_TIMEOUT_MS: '30000',
        },
        config: {
          workerId: 'worker-py-live-fastapi',
          concurrency: 1,
          pollIntervalMs: 30,
          heartbeatIntervalMs: 500,
          shutdownGraceMs: 2000,
        },
        onExtractionOutcome: (summary, result) => {
          observedSummary = summary;
          observedResult = result;
        },
        logger: createWorkerLogger({ workerId: 'worker-py-live-fastapi', env: baseEnv, sink: () => {} }),
      });

      await liveWorker.start();
      await waitForCondition(() => liveWorker.getState().metrics.jobsCompleted === 1, 15000);
      const liveStop = await liveWorker.stop({ reason: 'manual' });
      await resetPool();

      assert(observedResult !== null);
      assert(observedSummary !== null);
      assert.strictEqual(observedResult.documentId, liveDoc.document_id);
      assert.strictEqual(observedResult.mode, 'reference');
      assert.strictEqual(observedResult.status, 'processed');
      assert.strictEqual(observedResult.pageCount, 1);
      assert(observedResult.elementCount >= 1);
      assert.strictEqual(observedResult.indexingStatus, 'Skipped');
      assert.strictEqual(observedSummary.indexingStatus, 'Indexed');
      assert.strictEqual(observedSummary.latestVersionIndexed, true);
      assert.strictEqual(observedSummary.searchable, true);
      assert.strictEqual(liveStop.metrics.jobsCompleted, 1);
      assert.strictEqual(liveStop.metrics.jobsExtractedClean, 1);
      assert.strictEqual(liveStop.lastExtractionOutcomes[0].indexingStatus, 'Indexed');
      assert.strictEqual(liveStop.lastExtractionOutcomes[0].searchVerified, true);
      assert.strictEqual(liveStop.lastExtractionOutcomes[0].persisted, true);

      const dbLiveJob = await jobRepo.findById(liveJob.id);
      const dbLiveDoc = await documentRepo.findById(liveDoc.id);
      const dbLiveElements = await elementRepo.findByDocumentAndMode(liveDoc.id, 'reference');
      assert.strictEqual(dbLiveJob.status, 'done');
      assert.strictEqual(dbLiveJob.locked_by, null);
      assert.strictEqual(dbLiveJob.claim_token, null);
      assert.strictEqual(dbLiveDoc.status, 'ready');
      assert.strictEqual(dbLiveDoc.metadata.search_verified, true);
      assert.strictEqual(dbLiveDoc.metadata.indexing_status, 'Indexed');
      assert.strictEqual(dbLiveDoc.metadata.indexing_diagnostics.vector_store, 'FAISS');
      assert.strictEqual(dbLiveDoc.metadata.indexing_diagnostics.durable_on_disk, false);
      assert.strictEqual(dbLiveDoc.metadata.indexing_diagnostics.latest_version_indexed, true);
      assert.strictEqual(dbLiveElements.length, observedResult.elementCount);

      const liveSearchResp = await fetch(`${liveBaseUrl}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'Live Node Python Worker Heading',
          document_id: liveDoc.document_id,
          top_k: 5,
        }),
      });
      assert.strictEqual(liveSearchResp.status, 200);
      const liveSearchPayload = await liveSearchResp.json();
      assert(Array.isArray(liveSearchPayload.data) && liveSearchPayload.data.length >= 1);
      assert.strictEqual(liveSearchPayload.data[0].document_id, liveDoc.document_id);
      assert.strictEqual(liveSearchPayload.data[0].provenance.source_file_hash, pdfSha);

      reportTest(
        'TEST 18: Live FastAPI Uvicorn Integration (Auth, Extract, Persist, Index, FAISS Search Verify & Fenced Done)',
        true,
        `Verified live HTTP 401 auth rejection, extracted & persisted ${observedResult.elementCount} elements, rebuilt FAISS from persisted rows, verified live search hash match, marked document ready and job done`
      );
    } finally {
      if (uvicornProc.exitCode === null) {
        uvicornProc.kill();
        await new Promise((resolve) => uvicornProc.once('exit', resolve));
      }
      if (fs.existsSync(tempPdfPath)) {
        fs.unlinkSync(tempPdfPath);
      }
    }
  } finally {
    await resetPool().catch(() => {});
    await cleanPythonWorkerTestData().catch(() => {});
    await closePool().catch(() => {});
  }

  console.log('\n=================================================================');
  console.log(`   SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('=================================================================');
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runPythonWorkerTests().catch((err) => {
  const sanitized = sanitizeWorkerError(err);
  console.error('\nCRITICAL FAILURE in Python worker test suite:', sanitized);
  process.exit(1);
});
