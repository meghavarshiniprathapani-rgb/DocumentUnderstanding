import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepo from '../db/repositories/documentRepository.js';
import * as jobRepo from '../db/repositories/jobRepository.js';
import {
  DEFAULT_WORKER_CONFIG,
  WorkerConfigError,
  createWorker,
  createWorkerLogger,
  loadWorkerConfig,
  sanitizeWorkerError,
} from '../worker/index.js';
import { runStandaloneWorker } from '../worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.resolve(BACKEND_ROOT, '../.env') });

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

async function waitForCondition(predicate, timeoutMs = 5000, intervalMs = 15) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function cleanWorkerTestData() {
  await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-worker-%')`);
  await query(`DELETE FROM documents WHERE document_id LIKE 'test-worker-%'`);
}

async function runWorkerTestSuite() {
  console.log('=================================================================');
  console.log('    RETRIEVA AI — M1.6.4.4.1 WORKER FOUNDATION TEST SUITE        ');
  console.log('=================================================================');

  try {
    await resetPool();
    await cleanWorkerTestData();

    console.log('\n--- SECTION 1: CONFIGURATION, IDENTITY & SECRET SANITIZATION ---');

    const baseEnv = {
      DB_HOST: process.env.DB_HOST || '127.0.0.1',
      DB_PORT: process.env.DB_PORT || '3306',
      DB_USER: process.env.DB_USER || 'docuretrieve_user',
      DB_PASSWORD: 'test-db-password-secret',
      DB_NAME: process.env.DB_NAME || 'docuretrieve',
      INTERNAL_API_SECRET: 'test-internal-api-secret-xyz',
    };

    const defaultCfg = loadWorkerConfig({}, baseEnv);
    assert.strictEqual(defaultCfg.concurrency, 1);
    assert.strictEqual(defaultCfg.pollIntervalMs, 2000);
    assert.strictEqual(defaultCfg.heartbeatIntervalMs, 15000);
    assert.strictEqual(defaultCfg.shutdownGraceMs, 30000);
    assert.strictEqual(defaultCfg.maxAttempts, 3);
    assert(defaultCfg.workerId.startsWith('worker_'));
    assert(defaultCfg.workerId.includes(`_${process.pid}_`));
    assert(defaultCfg.workerId.length <= 128);
    assert.strictEqual(defaultCfg.concurrency, DEFAULT_WORKER_CONFIG.concurrency);
    assert.strictEqual(defaultCfg.heartbeatIntervalMs, DEFAULT_WORKER_CONFIG.heartbeatIntervalMs);

    const explicitCfg = loadWorkerConfig(
      {},
      {
        ...baseEnv,
        WORKER_ID: 'worker-custom-node-01',
        WORKER_CONCURRENCY: '4',
        WORKER_POLL_INTERVAL_MS: '250',
        WORKER_HEARTBEAT_INTERVAL_MS: '5000',
        WORKER_SHUTDOWN_GRACE_MS: '12000',
        WORKER_MAX_ATTEMPTS: '5',
      }
    );
    assert.strictEqual(explicitCfg.workerId, 'worker-custom-node-01');
    assert.strictEqual(explicitCfg.concurrency, 4);
    assert.strictEqual(explicitCfg.pollIntervalMs, 250);
    assert.strictEqual(explicitCfg.heartbeatIntervalMs, 5000);
    assert.strictEqual(explicitCfg.shutdownGraceMs, 12000);
    assert.strictEqual(explicitCfg.maxAttempts, 5);

    const invalidCases = [
      { WORKER_CONCURRENCY: '0' },
      { WORKER_CONCURRENCY: '-2' },
      { WORKER_CONCURRENCY: 'abc' },
      { WORKER_CONCURRENCY: '1.5' },
      { WORKER_POLL_INTERVAL_MS: '5' },
      { WORKER_POLL_INTERVAL_MS: 'invalid' },
      { WORKER_HEARTBEAT_INTERVAL_MS: '0' },
      { WORKER_HEARTBEAT_INTERVAL_MS: 'NaN' },
      { WORKER_SHUTDOWN_GRACE_MS: '-1' },
      { WORKER_SHUTDOWN_GRACE_MS: 'bad' },
      { WORKER_MAX_ATTEMPTS: '0' },
      { WORKER_MAX_ATTEMPTS: '99' },
      { WORKER_ID: '   ' },
      { WORKER_ID: 'x'.repeat(129) },
      { DB_HOST: '   ' },
      { DB_NAME: '' },
      { DB_PORT: 'not-a-port' },
    ];
    for (const badEnv of invalidCases) {
      assert.throws(
        () => loadWorkerConfig({}, { ...baseEnv, ...badEnv }),
        (err) => err instanceof WorkerConfigError
      );
    }

    const secretErr = sanitizeWorkerError(
      new Error(
        'Connection mysql://user:test-db-password-secret@127.0.0.1 failed with INTERNAL_API_SECRET=test-internal-api-secret-xyz'
      ),
      [baseEnv.DB_PASSWORD, baseEnv.INTERNAL_API_SECRET]
    );
    assert(!secretErr.message.includes(baseEnv.DB_PASSWORD));
    assert(!secretErr.message.includes(baseEnv.INTERNAL_API_SECRET));
    assert(secretErr.message.includes('******'));

    const capturedLogs = [];
    const testLogger = createWorkerLogger({
      workerId: 'worker-secret-check',
      env: baseEnv,
      sink: (level, line) => capturedLogs.push({ level, line }),
    });
    testLogger.error('secret_probe', {
      password: baseEnv.DB_PASSWORD,
      internal_api_secret: baseEnv.INTERNAL_API_SECRET,
      nested: { msg: `failed ${baseEnv.DB_PASSWORD} ${baseEnv.INTERNAL_API_SECRET}` },
    });
    assert.strictEqual(capturedLogs.length, 1);
    assert(!capturedLogs[0].line.includes(baseEnv.DB_PASSWORD));
    assert(!capturedLogs[0].line.includes(baseEnv.INTERNAL_API_SECRET));

    reportTest(
      'TEST 1: Configuration Validation, Defaults & Secret Sanitization',
      true,
      'Validated defaults, rejected invalid config with WorkerConfigError, and scrubbed DB/internal API secrets'
    );

    let spawnInvalidFailed = false;
    try {
      execFileSync(process.execPath, [path.join(BACKEND_ROOT, 'src/worker.js')], {
        env: {
          ...process.env,
          WORKER_CONCURRENCY: 'invalid-concurrency',
          DB_PASSWORD: 'cli-secret-db-password-001',
          INTERNAL_API_SECRET: 'cli-secret-internal-002',
        },
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch (err) {
      spawnInvalidFailed = err.status === 1;
      const combinedOut = `${err.stdout || ''}${err.stderr || ''}`;
      assert(!combinedOut.includes('cli-secret-db-password-001'));
      assert(!combinedOut.includes('cli-secret-internal-002'));
      assert(combinedOut.includes('ERR_WORKER_CONFIG'));
    }
    assert.strictEqual(spawnInvalidFailed, true);

    reportTest(
      'TEST 2: Standalone Worker CLI Startup Rejection on Invalid Config',
      true,
      'worker.js exited cleanly with code 1 and sanitized startup_error without leaking secrets'
    );

    console.log('\n--- SECTION 2: EMPTY QUEUE POLLING & BACKOFF RESILIENCE ---');

    const emptyWorker = createWorker({
      config: {
        pollIntervalMs: 60,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 500,
        concurrency: 1,
      },
      logger: createWorkerLogger({ workerId: 'worker-empty-test', sink: () => {} }),
      jobHandler: async () => ({ status: 'done' }),
    });
    const stableIdAtStart = emptyWorker.workerId;
    await emptyWorker.start();
    assert.strictEqual(emptyWorker.getState().status, 'running');
    assert.strictEqual(emptyWorker.getState().workerId, stableIdAtStart);

    await new Promise((r) => setTimeout(r, 190));
    const emptyState = emptyWorker.getState();
    assert(emptyState.metrics.emptyPolls >= 2 && emptyState.metrics.emptyPolls <= 5);
    assert.strictEqual(emptyState.metrics.jobsClaimed, 0);
    assert.strictEqual(emptyState.activeJobCount, 0);

    const emptyStop = await emptyWorker.stop({ reason: 'manual' });
    assert.strictEqual(emptyStop.status, 'stopped');
    assert.strictEqual(emptyStop.shutdownReason, 'grace_completed');
    assert.strictEqual(emptyStop.databaseClosed, true);
    assert.strictEqual(emptyWorker.getState().workerId, stableIdAtStart);
    await assert.rejects(() => query('SELECT 1'), /Database pool is closed/);
    await resetPool();

    reportTest(
      'TEST 3: Empty Queue Polling & Clean DB Resource Teardown',
      true,
      `Bounded empty polls (${emptyState.metrics.emptyPolls}), zero busy-looping, stable worker ID, and clean closePool`
    );

    const backoffDoc = await documentRepo.createDocument({
      document_id: 'test-worker-backoff-doc',
      filename: 'backoff.pdf',
      sha256: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      path: '/data/backoff.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const backoffJob = await jobRepo.createJob({
      doc_id: backoffDoc.id,
      mode: 'candidate',
      status: 'queued',
    });

    const pollAttemptsTs = [];
    const pollLogs = [];
    const recoveredBarrier = createBarrier();
    let simulatedErrors = 0;

    const flakyRepository = {
      ...jobRepo,
      claimJob: async (workerId, opts) => {
        pollAttemptsTs.push(Date.now());
        if (simulatedErrors < 3) {
          simulatedErrors += 1;
          const dbErr = new Error('connect ECONNREFUSED mysql://u:secret-backoff-pw@127.0.0.1:3306');
          dbErr.code = 'ECONNREFUSED';
          throw dbErr;
        }
        return jobRepo.claimJob(workerId, opts);
      },
    };

    const backoffWorker = createWorker({
      config: {
        workerId: 'worker-backoff-1',
        concurrency: 1,
        pollIntervalMs: 30,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 500,
        pollErrorBackoffMs: 40,
        maxPollErrorBackoffMs: 100,
      },
      extraSecrets: ['secret-backoff-pw'],
      repository: flakyRepository,
      logger: createWorkerLogger({
        workerId: 'worker-backoff-1',
        extraSecrets: ['secret-backoff-pw'],
        sink: (level, line) => pollLogs.push({ level, line }),
      }),
      jobHandler: async (ctx) => {
        if (ctx.jobId === backoffJob.id) {
          recoveredBarrier.resolve(ctx);
        }
        return { status: 'done', seconds: 0.05 };
      },
    });

    await backoffWorker.start();
    await recoveredBarrier.promise;
    await waitForCondition(async () => (await jobRepo.findById(backoffJob.id))?.status === 'done');

    const backoffState = backoffWorker.getState();
    assert.strictEqual(backoffState.metrics.pollErrors, 3);
    assert.strictEqual(backoffState.metrics.consecutivePollErrors, 0);
    assert.strictEqual(backoffState.lastPollError, null);
    assert(pollAttemptsTs.length >= 4);
    assert(pollAttemptsTs[1] - pollAttemptsTs[0] >= 25);
    assert(pollAttemptsTs[2] - pollAttemptsTs[1] >= 55);
    assert(pollAttemptsTs[3] - pollAttemptsTs[2] >= 75);
    assert(pollLogs.every((l) => !l.line.includes('secret-backoff-pw')));

    await backoffWorker.stop();
    await resetPool();

    reportTest(
      'TEST 4: Polling Error Exponential Backoff & Automatic Recovery',
      true,
      'Recovered cleanly after 3 simulated DB connection failures with bounded backoff (40ms -> 80ms -> 100ms cap) and scrubbed secrets'
    );

    console.log('\n--- SECTION 3: CONCURRENCY, FENCING & LIFECYCLE EXECUTION ---');

    const concDoc = await documentRepo.createDocument({
      document_id: 'test-worker-conc-doc',
      filename: 'concurrency.pdf',
      sha256: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      path: '/data/concurrency.pdf',
      pages_count: 2,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const concJob1 = await jobRepo.createJob({ doc_id: concDoc.id, mode: 'flat', status: 'queued' });
    const concJob2 = await jobRepo.createJob({ doc_id: concDoc.id, mode: 'candidate', status: 'queued' });
    const concJob3 = await jobRepo.createJob({ doc_id: concDoc.id, mode: 'reference', status: 'queued' });

    const twoActiveBarrier = createBarrier();
    const releaseFirstTwo = createBarrier();
    let currentRunning = 0;
    let maxConcurrent = 0;
    const seenContexts = [];

    const concWorker = createWorker({
      config: {
        workerId: 'worker-conc-2',
        concurrency: 2,
        pollIntervalMs: 20,
        heartbeatIntervalMs: 500,
        shutdownGraceMs: 1000,
      },
      logger: createWorkerLogger({ workerId: 'worker-conc-2', sink: () => {} }),
      jobHandler: async (ctx) => {
        seenContexts.push(ctx);
        currentRunning += 1;
        if (currentRunning > maxConcurrent) {
          maxConcurrent = currentRunning;
        }
        try {
          if (seenContexts.length === 2) {
            twoActiveBarrier.resolve();
          }
          if (ctx.jobId === concJob1.id || ctx.jobId === concJob2.id) {
            await releaseFirstTwo.promise;
          }
          return { status: 'done', seconds: 0.1 };
        } finally {
          currentRunning -= 1;
        }
      },
    });

    await concWorker.start();
    await twoActiveBarrier.promise;
    const midConcState = concWorker.getState();
    assert.strictEqual(midConcState.activeJobCount, 2);
    const thirdBeforeRelease = await jobRepo.findById(concJob3.id);
    assert.strictEqual(thirdBeforeRelease.status, 'queued');

    releaseFirstTwo.resolve();
    await waitForCondition(async () => {
      const j3 = await jobRepo.findById(concJob3.id);
      const j2 = await jobRepo.findById(concJob2.id);
      const j1 = await jobRepo.findById(concJob1.id);
      return j1?.status === 'done' && j2?.status === 'done' && j3?.status === 'done';
    });

    assert.strictEqual(maxConcurrent, 2);
    assert.strictEqual(new Set(seenContexts.map((c) => c.claimToken)).size, 3);
    assert(seenContexts.every((c) => c.leaseGeneration === 1 && c.workerId === 'worker-conc-2'));

    await concWorker.stop();
    await resetPool();

    reportTest(
      'TEST 5: Configured Concurrency Enforcement (concurrency=2)',
      true,
      'Held 2 active jobs at max capacity without claiming 3rd job early, used distinct claim tokens, and drained all 3 jobs'
    );

    const fenceDoc = await documentRepo.createDocument({
      document_id: 'test-worker-fence-doc',
      filename: 'fence.pdf',
      sha256: 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
      path: '/data/fence.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const fenceJob = await jobRepo.createJob({
      doc_id: fenceDoc.id,
      mode: 'candidate',
      status: 'queued',
      lease_timeout_seconds: 15,
    });
    const priorSameWorkerClaim = await jobRepo.claimJob('worker-same-id', { mode: 'candidate' });
    await query(
      `UPDATE jobs
       SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
           heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
       WHERE id = ?`,
      [fenceJob.id]
    );
    const recoveredFence = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
    assert.strictEqual(recoveredFence.recoveredCount, 1);

    const reclaimedEntered = createBarrier();
    const reclaimedRelease = createBarrier();
    const fenceWorker = createWorker({
      config: {
        workerId: 'worker-same-id',
        concurrency: 1,
        pollIntervalMs: 20,
        heartbeatIntervalMs: 200,
        shutdownGraceMs: 1000,
      },
      logger: createWorkerLogger({ workerId: 'worker-same-id', sink: () => {} }),
      jobHandler: async (ctx) => {
        reclaimedEntered.resolve(ctx);
        await reclaimedRelease.promise;
        return { status: 'done', seconds: 0.15 };
      },
    });

    await fenceWorker.start();
    const activeCtx = await reclaimedEntered.promise;
    assert.strictEqual(activeCtx.workerId, 'worker-same-id');
    assert.strictEqual(activeCtx.leaseGeneration, 2);
    assert(activeCtx.claimToken);
    assert.notStrictEqual(activeCtx.claimToken, priorSameWorkerClaim.claim_token);

    await assert.rejects(
      async () =>
        jobRepo.heartbeatJob(fenceJob.id, 'worker-same-id', {
          claimToken: priorSameWorkerClaim.claim_token,
        }),
      (err) => err instanceof jobRepo.LeaseOwnershipError
    );

    reclaimedRelease.resolve();
    await waitForCondition(async () => (await jobRepo.findById(fenceJob.id))?.status === 'done');
    const postFenceDb = await jobRepo.findById(fenceJob.id);
    assert.strictEqual(postFenceDb.lease_generation, 2);
    assert.strictEqual(postFenceDb.claim_token, null);
    assert.strictEqual(postFenceDb.locked_by, null);

    await fenceWorker.stop();
    await resetPool();

    reportTest(
      'TEST 6: Claim Token & Lease Generation Propagation on Same-Worker Reclaim',
      true,
      'Worker propagated generation=2 and unique claim_token while fencing stale token from earlier claim of same worker ID'
    );

    console.log('\n--- SECTION 4: SHUTDOWN SEMANTICS & HEARTBEAT CONTINUATION ---');

    const stopDoc = await documentRepo.createDocument({
      document_id: 'test-worker-stop-doc',
      filename: 'shutdown.pdf',
      sha256: 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
      path: '/data/shutdown.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const stopJob1 = await jobRepo.createJob({ doc_id: stopDoc.id, mode: 'flat', status: 'queued' });
    const stopJob2 = await jobRepo.createJob({ doc_id: stopDoc.id, mode: 'candidate', status: 'queued' });

    const job1Entered = createBarrier();
    const job1Release = createBarrier();
    const stopWorker = createWorker({
      config: {
        workerId: 'worker-stop-claims',
        concurrency: 1,
        pollIntervalMs: 20,
        heartbeatIntervalMs: 35,
        shutdownGraceMs: 2000,
      },
      logger: createWorkerLogger({ workerId: 'worker-stop-claims', sink: () => {} }),
      jobHandler: async (ctx) => {
        job1Entered.resolve(ctx);
        await job1Release.promise;
        return { status: 'done', seconds: 0.25 };
      },
    });

    await stopWorker.start();
    const enteredCtx = await job1Entered.promise;
    await query(
      `UPDATE jobs SET heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 SECOND) WHERE id = ?`,
      [enteredCtx.jobId]
    );

    const stopGracePromise = stopWorker.stop({ reason: 'SIGINT' });
    await waitForCondition(() => stopWorker.getState().metrics.heartbeatsSent >= 2);
    const duringShutdownHb = await jobRepo.findById(stopJob1.id);
    assert.strictEqual(duringShutdownHb.status, 'running');
    assert(stopWorker.getState().shuttingDown === true);
    assert(stopWorker.getState().metrics.heartbeatsSent >= 2);

    job1Release.resolve();
    const stopSummary = await stopGracePromise;
    assert.strictEqual(stopSummary.shutdownReason, 'SIGINT');
    assert.strictEqual(stopSummary.databaseClosed, true);

    await resetPool();
    const finalStopJob1 = await jobRepo.findById(stopJob1.id);
    const untouchedStopJob2 = await jobRepo.findById(stopJob2.id);
    assert.strictEqual(finalStopJob1.status, 'done');
    assert.strictEqual(finalStopJob1.claim_token, null);
    assert.strictEqual(untouchedStopJob2.status, 'queued');
    assert.strictEqual(untouchedStopJob2.attempts, 0);
    assert.strictEqual(untouchedStopJob2.lease_generation, 0);
    await jobRepo.updateStatus(stopJob2.id, 'done', { seconds: 0 });

    reportTest(
      'TEST 7 & TEST 8: Shutdown Stops New Claims & Continues Heartbeats During Graceful Drain',
      true,
      `Continued ${stopSummary.metrics.heartbeatsSent} heartbeats during SIGINT grace, completed job 1, left job 2 queued`
    );

    const hangDoc = await documentRepo.createDocument({
      document_id: 'test-worker-hang-doc',
      filename: 'hang.pdf',
      sha256: 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
      path: '/data/hang.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const hangJob = await jobRepo.createJob({
      doc_id: hangDoc.id,
      mode: 'candidate',
      status: 'queued',
      lease_timeout_seconds: 15,
    });

    const hangEntered = createBarrier();
    const hangHold = createBarrier();
    const hangWorker = createWorker({
      config: {
        workerId: 'worker-hang-grace',
        concurrency: 1,
        pollIntervalMs: 20,
        heartbeatIntervalMs: 25,
        shutdownGraceMs: 90,
      },
      logger: createWorkerLogger({ workerId: 'worker-hang-grace', sink: () => {} }),
      jobHandler: async (ctx) => {
        hangEntered.resolve(ctx);
        await hangHold.promise;
        return { status: 'done', seconds: 10.0 };
      },
    });

    await hangWorker.start();
    const hangCtx = await hangEntered.promise;

    const hangStopSummary = await hangWorker.stop({ reason: 'SIGTERM' });
    assert.strictEqual(hangStopSummary.shutdownReason, 'grace_timeout');
    assert.deepStrictEqual(hangStopSummary.timedOutJobIds, [hangJob.id]);
    assert.strictEqual(hangStopSummary.metrics.graceTimeouts, 1);
    assert.strictEqual(hangStopSummary.databaseClosed, true);
    assert.strictEqual(hangCtx.signal.aborted, true);
    assert(hangStopSummary.metrics.heartbeatsSent >= 1);

    await resetPool();
    const hangDbAfterTimeout = await jobRepo.findById(hangJob.id);
    assert.strictEqual(hangDbAfterTimeout.status, 'running');
    assert.strictEqual(hangDbAfterTimeout.locked_by, 'worker-hang-grace');
    assert.strictEqual(hangDbAfterTimeout.claim_token, hangCtx.claimToken);
    assert.strictEqual(hangDbAfterTimeout.lease_generation, 1);

    hangHold.resolve();
    await new Promise((r) => setTimeout(r, 30));
    const hangDbAfterLateFinish = await jobRepo.findById(hangJob.id);
    assert.strictEqual(hangDbAfterLateFinish.status, 'running');

    await query(
      `UPDATE jobs
       SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
           heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
       WHERE id = ?`,
      [hangJob.id]
    );
    const hangRec = await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
    assert.strictEqual(hangRec.recoveredCount, 1);
    assert.strictEqual(hangRec.jobs[0].job.status, 'queued');
    await jobRepo.updateStatus(hangJob.id, 'done', { seconds: 0.1 });

    reportTest(
      'TEST 9: Shutdown Grace Timeout & No False Completion or Premature Release',
      true,
      'Grace expired safely with abort signal, no false done status, no premature requeue, clean closePool, and later lease recovery succeeded'
    );

    const failJobDoc = await documentRepo.createDocument({
      document_id: 'test-worker-fail-doc',
      filename: 'fail_handler.pdf',
      sha256: 'f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6',
      path: '/data/fail_handler.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const handlerFailJob = await jobRepo.createJob({
      doc_id: failJobDoc.id,
      mode: 'candidate',
      status: 'queued',
    });
    const firstFailRecorded = createBarrier();
    const secondAttemptEntered = createBarrier();
    const secondAttemptRelease = createBarrier();
    let capturedFirstFail = null;

    const failWorker = createWorker({
      config: {
        workerId: 'worker-fail-scrub',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        shutdownGraceMs: 500,
        maxAttempts: 3,
      },
      extraSecrets: ['handler-secret-pw-777'],
      repository: {
        ...jobRepo,
        failJob: async (...args) => {
          const out = await jobRepo.failJob(...args);
          if (!capturedFirstFail) {
            capturedFirstFail = out;
            firstFailRecorded.resolve(out);
          }
          return out;
        },
      },
      logger: createWorkerLogger({
        workerId: 'worker-fail-scrub',
        extraSecrets: ['handler-secret-pw-777'],
        sink: () => {},
      }),
      jobHandler: async (ctx) => {
        if (ctx.attempt === 1) {
          throw new Error('Upstream crash with password=handler-secret-pw-777');
        }
        secondAttemptEntered.resolve(ctx);
        await secondAttemptRelease.promise;
        return { status: 'degraded', seconds: 0.2, error: 'Degraded completion test' };
      },
    });

    await failWorker.start();
    const firstFailResult = await firstFailRecorded.promise;
    assert.strictEqual(firstFailResult.status, 'queued');
    assert.strictEqual(firstFailResult.retryable, true);
    assert.strictEqual(firstFailResult.claim_token, null);
    assert.strictEqual(firstFailResult.lease_generation, 1);
    assert(!firstFailResult.error.includes('handler-secret-pw-777'));
    assert(firstFailResult.error.includes('******'));

    const retryCtx = await secondAttemptEntered.promise;
    assert.strictEqual(retryCtx.attempt, 2);
    assert.strictEqual(retryCtx.leaseGeneration, 2);
    secondAttemptRelease.resolve();
    await waitForCondition(async () => (await jobRepo.findById(handlerFailJob.id))?.status === 'degraded');
    await failWorker.stop();
    await resetPool();

    const finalDegradedDb = await jobRepo.findById(handlerFailJob.id);
    assert.strictEqual(finalDegradedDb.status, 'degraded');
    assert.strictEqual(finalDegradedDb.lease_generation, 2);
    assert.strictEqual(finalDegradedDb.claim_token, null);

    reportTest(
      'TEST 10: Handler Failure Safe Requeue, Secret Redaction & Degraded Completion',
      true,
      'Failed handler safely called failJob with claimToken, scrubbed secret from DB error, and retried into degraded completion'
    );

    const sigDoc = await documentRepo.createDocument({
      document_id: 'test-worker-sig-doc',
      filename: 'sig.pdf',
      sha256: 'a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7',
      path: '/data/sig.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const sigJob = await jobRepo.createJob({
      doc_id: sigDoc.id,
      mode: 'flat',
      status: 'queued',
    });

    const sigEntered = createBarrier();
    const sigRelease = createBarrier();
    const standaloneHandle = await runStandaloneWorker({
      exitOnSignal: false,
      config: {
        workerId: 'worker-signal-standalone',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 40,
        shutdownGraceMs: 1000,
      },
      logger: createWorkerLogger({ workerId: 'worker-signal-standalone', sink: () => {} }),
      jobHandler: async (ctx) => {
        sigEntered.resolve(ctx);
        await sigRelease.promise;
        return { status: 'done', seconds: 0.1 };
      },
    });

    await sigEntered.promise;
    process.emit('SIGTERM');
    sigRelease.resolve();
    await waitForCondition(() => standaloneHandle.worker.getState().status === 'stopped');
    assert.strictEqual(standaloneHandle.worker.getState().shutdownReason, 'SIGTERM');
    assert.strictEqual(standaloneHandle.worker.getState().databaseClosed, true);
    await resetPool();
    assert.strictEqual((await jobRepo.findById(sigJob.id)).status, 'done');

    const sigintHandle = await runStandaloneWorker({
      exitOnSignal: false,
      env: {
        ...process.env,
        INTERNAL_API_SECRET: 'test-signal-smoke-secret',
      },
      config: {
        workerId: 'worker-signal-sigint',
        concurrency: 1,
        pollIntervalMs: 50,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 500,
      },
      logger: createWorkerLogger({ workerId: 'worker-signal-sigint', sink: () => {} }),
    });
    process.emit('SIGINT');
    await waitForCondition(() => sigintHandle.worker.getState().status === 'stopped');
    assert.strictEqual(sigintHandle.worker.getState().shutdownReason, 'SIGINT');
    assert.strictEqual(sigintHandle.worker.getState().databaseClosed, true);
    await resetPool();

    const childStarted = createBarrier();
    const childProc = spawn(process.execPath, [path.join(BACKEND_ROOT, 'src/worker.js')], {
      env: {
        ...process.env,
        WORKER_ID: 'worker-cli-smoke',
        WORKER_POLL_INTERVAL_MS: '100',
        WORKER_HEARTBEAT_INTERVAL_MS: '500',
        INTERNAL_API_SECRET: 'test-worker-cli-smoke-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childOut = '';
    childProc.stdout.on('data', (chunk) => {
      childOut += chunk.toString('utf8');
      if (childOut.includes('worker_started')) {
        childStarted.resolve();
      }
    });
    await childStarted.promise;
    childProc.kill();
    await new Promise((resolve) => childProc.once('exit', resolve));
    assert(childOut.includes('"worker_id":"worker-cli-smoke"'));
    assert(childOut.includes('"event":"worker_started"'));

    reportTest(
      'TEST 11: Standalone Entrypoint Signal Handlers (SIGINT/SIGTERM) & Process Spawn',
      true,
      'Verified SIGTERM/SIGINT graceful stop via runStandaloneWorker and clean worker.js standalone process startup'
    );

    const leaseLossDoc = await documentRepo.createDocument({
      document_id: 'test-worker-leaseloss-doc',
      filename: 'leaseloss.pdf',
      sha256: 'b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8',
      path: '/data/leaseloss.pdf',
      pages_count: 1,
      doc_type: 'user_upload',
      split: 'none',
      status: 'queued',
    });
    const leaseLossJob = await jobRepo.createJob({
      doc_id: leaseLossDoc.id,
      mode: 'candidate',
      status: 'queued',
      lease_timeout_seconds: 15,
    });

    const lossEntered = createBarrier();
    const lossAborted = createBarrier();
    const lossWorker = createWorker({
      config: {
        workerId: 'worker-lease-loss',
        concurrency: 1,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 30,
        shutdownGraceMs: 500,
      },
      logger: createWorkerLogger({ workerId: 'worker-lease-loss', sink: () => {} }),
      jobHandler: async (ctx) => {
        lossEntered.resolve(ctx);
        ctx.signal.addEventListener('abort', () => lossAborted.resolve(), { once: true });
        await lossAborted.promise;
        return { status: 'done', seconds: 0.2 };
      },
    });

    await lossWorker.start();
    const lossCtx = await lossEntered.promise;
    await query(
      `UPDATE jobs
       SET locked_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND),
           heartbeat_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)
       WHERE id = ?`,
      [leaseLossJob.id]
    );
    await jobRepo.recoverExpiredLeases({ maxAttempts: 3 });
    const hijackedBySameWorker = await jobRepo.claimJob('worker-lease-loss', { mode: 'candidate' });
    assert.strictEqual(hijackedBySameWorker.lease_generation, 2);

    await lossAborted.promise;
    await waitForCondition(() => lossWorker.getState().activeJobCount === 0);
    assert(lossWorker.getState().metrics.leaseLosses >= 1);
    const dbAfterLoss = await jobRepo.findById(leaseLossJob.id);
    assert.strictEqual(dbAfterLoss.status, 'running');
    assert.strictEqual(dbAfterLoss.claim_token, hijackedBySameWorker.claim_token);
    assert.strictEqual(dbAfterLoss.lease_generation, 2);
    await jobRepo.completeJob(leaseLossJob.id, 'worker-lease-loss', {
      claimToken: hijackedBySameWorker.claim_token,
      status: 'done',
      seconds: 0.1,
    });
    await lossWorker.stop();
    await resetPool();

    let untokenizedHandlerCalled = false;
    const brokenRepoWorker = createWorker({
      config: {
        workerId: 'worker-broken-repo',
        concurrency: 1,
        pollIntervalMs: 30,
        heartbeatIntervalMs: 100,
        shutdownGraceMs: 200,
        pollErrorBackoffMs: 40,
        maxPollErrorBackoffMs: 80,
      },
      logger: createWorkerLogger({ workerId: 'worker-broken-repo', sink: () => {} }),
      repository: {
        claimJob: async () => ({
          id: 999999,
          doc_id: 1,
          mode: 'flat',
          status: 'running',
          locked_by: 'worker-broken-repo',
          claim_token: null,
          lease_generation: 0,
        }),
        heartbeatJob: async () => {},
        completeJob: async () => {},
        failJob: async () => {},
      },
      jobHandler: async () => {
        untokenizedHandlerCalled = true;
        return { status: 'done' };
      },
    });
    await brokenRepoWorker.start();
    await waitForCondition(() => brokenRepoWorker.getState().metrics.pollErrors >= 1);
    assert.strictEqual(untokenizedHandlerCalled, false);
    assert.strictEqual(brokenRepoWorker.getState().activeJobCount, 0);
    await brokenRepoWorker.stop();
    await resetPool();

    reportTest(
      'TEST 12: Mid-Flight Lease Loss Aborts Stale Worker & Rejects Tokenless Claims',
      true,
      'Heartbeat fencing aborted stale claim without touching generation=2 reclaim, and tokenless claim responses never executed handler'
    );

    await cleanWorkerTestData();
    await closePool();

    console.log('\n=================================================================');
    console.log(`   ALL M1.6.4.4.1 WORKER FOUNDATION TESTS PASSED: ${passedTests} / ${totalTests} [PASS] `);
    console.log('=================================================================\n');
  } catch (err) {
    console.error('\nUNHANDLED EXCEPTION IN WORKER TEST SUITE:', err);
    await resetPool().catch(() => {});
    await cleanWorkerTestData().catch(() => {});
    await closePool().catch(() => {});
    process.exit(1);
  }
}

runWorkerTestSuite();
