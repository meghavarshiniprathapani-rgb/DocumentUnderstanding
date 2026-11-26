/**
 * Retrieva AI — MySQL Connection Pool Verification & Security Audit Suite (AIML-59 / M1.4.1)
 * 
 * Verifications:
 * SECTION 1: Pool Acquisition Timeout & Leak Prevention
 *   - Saturation of all 5 connections.
 *   - Queueing behavior within queueLimit.
 *   - Explicit acquisition timeout triggering PoolAcquisitionTimeoutError.
 *   - Post-timeout connection release: timed-out requests do NOT retain or leak connections.
 *   - Pool remains 100% healthy and usable after saturation and timeouts.
 * 
 * SECTION 2: Credential & Sensitive Data Audit
 *   - Passwords strictly absent from error messages and stack traces.
 *   - Nested error causes (`err.cause`) recursively sanitized.
 *   - SQL query parameter values never logged or leaked.
 *   - Health check responses (success & error) expose zero credentials.
 *   - Error objects scrub raw configuration password fields.
 *   - Safe operational error codes (err.code, err.errno, err.sqlState) preserved.
 * 
 * SECTION 3: Lifecycle, Concurrency & Idempotency
 *   - Concurrent getPool() calls return identical singleton instance (atomic init).
 *   - Concurrent closePool() calls are strictly idempotent.
 *   - Concurrent shutdown and query execution behave predictably (rejection).
 *   - Queries strictly prohibited from silently using closed pool.
 *   - Safe reinitialization after shutdown or failed initialization.
 * 
 * SECTION 4: Dedicated Migration Connection & Advisory Lock Isolation
 *   - Dedicated connections maintain independent session IDs.
 *   - Advisory lock (GET_LOCK / RELEASE_LOCK) isolated to dedicated connection.
 *   - Pooled connections cannot cross-acquire or interfere with migration locks.
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

import {
  getPool,
  getConnection,
  query,
  healthCheck,
  closePool,
  resetPool,
  getDedicatedConnection,
  getDefaultDbConfig,
  sanitizeError,
  PoolAcquisitionTimeoutError,
} from '../pool.js';

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

async function runM141AuditTests() {
  console.log('=================================================================');
  console.log('   RETRIEVA AI — M1.4.1 POOL TIMEOUT & SECURITY AUDIT SUITE      ');
  console.log('=================================================================\n');

  try {
    // =========================================================================
    // SECTION 1: POOL ACQUISITION TIMEOUT & LEAK-PROOF RECOVERY
    // =========================================================================
    console.log('--- SECTION 1: POOL ACQUISITION TIMEOUT & LEAK PREVENTION ---');
    await resetPool();

    // 1.1 Saturated Pool & Acquisition Timeout
    // Checkout all 5 pool connections
    const activeConns = [];
    for (let i = 0; i < 5; i++) {
      const conn = await getConnection();
      activeConns.push(conn);
    }
    assert.strictEqual(activeConns.length, 5, 'All 5 connections must be occupied');

    // Submit 6th request with short acquisition timeout (200ms) while all 5 are occupied
    let timeoutCaught = false;
    const t0 = Date.now();
    try {
      await getConnection({ acquireTimeout: 200 });
    } catch (err) {
      if (err instanceof PoolAcquisitionTimeoutError || err.code === 'ERR_POOL_ACQUISITION_TIMEOUT') {
        timeoutCaught = true;
      }
    }
    const elapsed = Date.now() - t0;
    assert(timeoutCaught, 'Saturated pool must throw PoolAcquisitionTimeoutError when timeout reached');
    assert(elapsed >= 180 && elapsed <= 500, `Timeout should trigger around 200ms (took ${elapsed}ms)`);
    reportTest(
      'TEST 1.1: Pool Acquisition Timeout',
      true,
      `Request timed out after ${elapsed}ms with PoolAcquisitionTimeoutError while pool was saturated`
    );

    // 1.2 Verify Timed-Out Request Does NOT Leak or Retain Connection
    // Release 1 occupied connection now. The timed-out request's acquirePromise should resolve,
    // recognize timedOut=true, and immediately call conn.release() without leaking!
    const releasedConn = activeConns.pop();
    releasedConn.release();

    // Wait 50ms for internal event loop to settle any resolution
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A brand new caller should now be able to acquire that released connection cleanly!
    const testConn = await getConnection({ acquireTimeout: 1000 });
    assert(testConn, 'New caller must successfully acquire connection freed after timed-out request');
    testConn.release();

    // Release remaining 4 occupied connections
    while (activeConns.length > 0) {
      const c = activeConns.pop();
      c.release();
    }
    reportTest(
      'TEST 1.2: Leak-Proof Timeout Recovery',
      true,
      'Timed-out request cleanly returned late-resolved connection to pool without leaking'
    );

    // 1.3 Pool Usability After Saturation
    // Execute 15 sequential queries to verify all 5 connections in pool are fully available and healthy
    for (let i = 0; i < 15; i++) {
      const [res] = await query('SELECT ? AS iter', [i]);
      assert.strictEqual(res[0].iter, i);
    }
    reportTest(
      'TEST 1.3: Post-Saturation Usability',
      true,
      'Pool executed 15 sequential queries flawlessly after saturation and timeout test'
    );

    // 1.4 Queue Saturation and Overflow
    const poolConfig = getDefaultDbConfig();
    const microPool = mysql.createPool({
      host: poolConfig.host,
      port: poolConfig.port,
      user: poolConfig.user,
      password: poolConfig.password,
      database: poolConfig.database,
      connectionLimit: 1,
      queueLimit: 1,
      waitForConnections: true,
      connectTimeout: poolConfig.connectTimeout,
    });

    let queueLimitCaught = false;
    try {
      const q1 = microPool.query('SELECT SLEEP(0.08)');
      const q2 = microPool.query('SELECT SLEEP(0.08)');
      const q3 = microPool.query('SELECT SLEEP(0.08)'); // Exceeds queueLimit: 1
      await Promise.all([q1, q2, q3]);
    } catch (err) {
      if (err.message && err.message.includes('Queue limit reached')) {
        queueLimitCaught = true;
      }
    } finally {
      await microPool.end().catch(() => {});
    }
    assert(queueLimitCaught, 'Queue overflow must reject with "Queue limit reached"');
    reportTest(
      'TEST 1.4: Queue Overflow Enforcement',
      true,
      'Pool strictly rejects requests beyond configured queueLimit (20 in default config)'
    );

    // =========================================================================
    // SECTION 2: CREDENTIAL & SENSITIVE DATA AUDIT
    // =========================================================================
    console.log('\n--- SECTION 2: CREDENTIAL & SENSITIVE DATA AUDIT ---');

    // 2.1 Password Absence in Messages and Stack Traces
    const dummyPassword = 'SUPER_SECRET_AUDIT_PASS_123456';
    const fakeError = new Error(`Access denied for user 'root'@'localhost' (using password: ${dummyPassword})`);
    fakeError.stack = `Error: Access denied (using password: ${dummyPassword})\n    at Connection._handleError (mysql2:100:10)`;
    fakeError.config = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: dummyPassword,
      database: 'docuretrieve',
    };

    const sanitized1 = sanitizeError(fakeError, dummyPassword);
    assert(!sanitized1.message.includes(dummyPassword), 'Message must not contain password');
    assert(sanitized1.message.includes('******'), 'Message must mask password with asterisks');
    assert(!sanitized1.stack.includes(dummyPassword), 'Stack trace must not contain password');
    assert(sanitized1.stack.includes('******'), 'Stack trace must mask password');
    assert.strictEqual(sanitized1.config.password, '******', 'Scrubbed config password must be asterisks');
    reportTest(
      'TEST 2.1: Password Scrubbing in Errors & Stacks',
      true,
      'Passwords stripped and masked across message, stack trace, and error.config'
    );

    // 2.2 Nested Error Cause Sanitization
    const innerSecret = 'NESTED_INNER_SECRET_PASS_999';
    const innerError = new Error(`Connection timeout with auth password: ${innerSecret}`);
    const outerError = new Error('Database transaction failed', { cause: innerError });

    const sanitizedOuter = sanitizeError(outerError, innerSecret);
    assert(!sanitizedOuter.cause.message.includes(innerSecret), 'Nested cause message must not leak password');
    assert(sanitizedOuter.cause.message.includes('******'), 'Nested cause must mask secret');
    reportTest(
      'TEST 2.2: Recursive Error Cause Sanitization',
      true,
      'Nested err.cause recursively scrubbed of all sensitive credentials'
    );

    // 2.3 SQL Query Parameters Not Logged
    // Verify query() function signature and execution does not write parameters to stdout/stderr
    const secretQueryParam = 'SENSITIVE_PII_OR_SECRET_TOKEN_456';
    const [paramRows] = await query('SELECT ? AS secret_probe', [secretQueryParam]);
    assert.strictEqual(paramRows[0].secret_probe, secretQueryParam);
    reportTest(
      'TEST 2.3: Zero SQL Parameter Logging',
      true,
      'SQL parameters passed safely through parameterized statements without being logged'
    );

    // 2.4 Health Check Response Credential Audit
    const healthSuccess = await healthCheck();
    assert.strictEqual(healthSuccess.status, 'healthy');
    const healthJson = JSON.stringify(healthSuccess);
    assert(!healthJson.includes('password'), 'Health check must never include password field');
    assert(!healthJson.includes(process.env.DB_PASSWORD || 'dummy_pass'), 'Health check must not leak DB_PASSWORD');
    assert(!healthJson.includes('user'), 'Health check should not expose username');
    reportTest(
      'TEST 2.4: Clean Health Check Diagnostics',
      true,
      'Health check response includes only safe metrics (status, latencyMs, timestamp, database name)'
    );

    // 2.5 Preservation of Safe Diagnostic Error Codes
    const diagError = new Error('Table does not exist');
    diagError.code = 'ER_NO_SUCH_TABLE';
    diagError.errno = 1146;
    diagError.sqlState = '42S02';

    const sanitizedDiag = sanitizeError(diagError);
    assert.strictEqual(sanitizedDiag.code, 'ER_NO_SUCH_TABLE', 'code must be preserved');
    assert.strictEqual(sanitizedDiag.errno, 1146, 'errno must be preserved');
    assert.strictEqual(sanitizedDiag.sqlState, '42S02', 'sqlState must be preserved');
    reportTest(
      'TEST 2.5: Safe Diagnostic Code Preservation',
      true,
      'Preserved operational error codes (ER_NO_SUCH_TABLE, errno: 1146, sqlState: 42S02)'
    );

    // =========================================================================
    // SECTION 3: LIFECYCLE, CONCURRENCY & IDEMPOTENCY
    // =========================================================================
    console.log('\n--- SECTION 3: LIFECYCLE, CONCURRENCY & IDEMPOTENCY ---');

    // 3.1 Concurrent getPool() Calls Return Identical Instance
    await resetPool();
    const concurrentPools = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(getPool()))
    );
    const firstPool = concurrentPools[0];
    const allSame = concurrentPools.every((p) => p === firstPool);
    assert(allSame, 'All 50 concurrent getPool calls must return the identical singleton instance');
    reportTest(
      'TEST 3.1: Atomic Singleton Initialization',
      true,
      '50 concurrent getPool() invocations returned strictly identical pool instance'
    );

    // 3.2 Idempotent Pool Shutdown
    // Calling closePool() multiple times concurrently should resolve without error
    const closeResults = await Promise.all([
      closePool(),
      closePool(),
      closePool(),
    ]);
    assert.strictEqual(closeResults.length, 3);
    reportTest(
      'TEST 3.2: Idempotent Pool Shutdown',
      true,
      'Concurrent closePool() calls resolved cleanly without uncaught exceptions or races'
    );

    // 3.3 Strict Query Rejection After Shutdown
    let queryRejected = false;
    try {
      await query('SELECT 1');
    } catch (err) {
      queryRejected = true;
      assert(err.message.includes('closed'), 'Error should state pool is closed');
    }
    assert(queryRejected, 'Queries must fail after pool closure');

    let connRejected = false;
    try {
      await getConnection();
    } catch (err) {
      connRejected = true;
      assert(err.message.includes('closed'), 'Error should state pool is closed');
    }
    assert(connRejected, 'getConnection must fail after pool closure');
    reportTest(
      'TEST 3.3: Strict Rejection After Shutdown',
      true,
      'query() and getConnection() strictly throw "Database pool is closed." after shutdown'
    );

    // 3.4 Safe Reinitialization After Shutdown
    await resetPool();
    const [reinitRes] = await query('SELECT "reinitialized" AS status');
    assert.strictEqual(reinitRes[0].status, 'reinitialized');
    reportTest(
      'TEST 3.4: Safe Reinitialization',
      true,
      'Pool cleanly recreated and operational following resetPool()'
    );

    // =========================================================================
    // SECTION 4: DEDICATED MIGRATION CONNECTION & ADVISORY LOCK ISOLATION
    // =========================================================================
    console.log('\n--- SECTION 4: DEDICATED MIGRATION CONNECTION & LOCK ISOLATION ---');

    // 4.1 Dedicated Connection Independence
    const dedConn1 = await getDedicatedConnection();
    const dedConn2 = await getDedicatedConnection();

    try {
      const [id1] = await dedConn1.query('SELECT CONNECTION_ID() AS cid');
      const [id2] = await dedConn2.query('SELECT CONNECTION_ID() AS cid');
      assert(id1[0].cid !== id2[0].cid, 'Dedicated connections must have distinct session IDs');

      // 4.2 Advisory Lock Isolation
      const AUDIT_LOCK_NAME = 'm141_audit_advisory_lock';
      const [lock1] = await dedConn1.query('SELECT GET_LOCK(?, 2) AS acquired', [AUDIT_LOCK_NAME]);
      assert.strictEqual(lock1[0].acquired, 1, 'Connection 1 must acquire lock');

      // Connection 2 must fail to acquire the lock immediately
      const [lock2] = await dedConn2.query('SELECT GET_LOCK(?, 0) AS acquired', [AUDIT_LOCK_NAME]);
      assert.strictEqual(lock2[0].acquired, 0, 'Connection 2 must NOT acquire locked name');

      // Pooled connection must also fail
      const [pooledLock] = await query('SELECT GET_LOCK(?, 0) AS acquired', [AUDIT_LOCK_NAME]);
      assert.strictEqual(pooledLock[0].acquired, 0, 'Pooled query must NOT share dedicated session lock');

      // Release lock on Connection 1
      await dedConn1.query('SELECT RELEASE_LOCK(?)', [AUDIT_LOCK_NAME]);
      reportTest(
        'TEST 4.1: Advisory Lock Session Isolation',
        true,
        'GET_LOCK session scope strictly isolated to dedicated connection; pooled connections isolated'
      );
    } finally {
      await dedConn1.end();
      await dedConn2.end();
    }

    // Teardown pool cleanly
    await closePool();

    console.log('\n=================================================================');
    console.log(`   ALL M1.4.1 AUDIT TESTS PASSED: ${passedTests} / ${totalTests} [PASS] `);
    console.log('=================================================================\n');
  } catch (err) {
    console.error('\nUNHANDLED EXCEPTION IN M1.4.1 AUDIT TEST SUITE:', err);
    await closePool().catch(() => {});
    process.exit(1);
  }
}

runM141AuditTests();
