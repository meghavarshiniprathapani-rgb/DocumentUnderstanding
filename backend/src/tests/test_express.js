import assert from 'node:assert';
import http from 'node:http';
import { app } from '../app.js';
import { config } from '../config.js';
import { startServer, stopServer } from '../server.js';
import { closePool, resetPool } from '../db/pool.js';

process.env.NODE_ENV = 'test';

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

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

async function makeRequest(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body;

  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
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
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runExpressTestSuite() {
  console.log('=================================================================');
  console.log('    RETRIEVA AI — M1.6.1 EXPRESS FOUNDATION TEST SUITE           ');
  console.log('=================================================================\n');

  try {
    await resetPool();

    console.log('--- SECTION 1: SERVER LIFECYCLE & STARTUP ---');
    await startServer(TEST_PORT, '127.0.0.1');
    reportTest('TEST 1.1: Server Startup', true, `Express listening on 127.0.0.1:${TEST_PORT}`);

    console.log('\n--- SECTION 2: ROOT DISCOVERY & HEADERS ---');
    const rootRes = await makeRequest('/');
    assert.strictEqual(rootRes.status, 200);
    assert.strictEqual(rootRes.body.config_version, '1.0.0');
    assert.strictEqual(rootRes.body.status, 'success');
    assert.strictEqual(rootRes.body.data.service, config.appName);
    assert.strictEqual(rootRes.body.data.api_v1, '/api/v1');
    assert(typeof rootRes.body.timestamp === 'string');
    assert.strictEqual(rootRes.headers['x-config-version'], '1.0.0');
    assert(rootRes.headers['x-process-time-ms'] !== undefined);
    assert(rootRes.headers['x-request-id'] !== undefined);
    reportTest('TEST 2.1: Root Envelope & Required Headers', true, 'Root returned 200, valid envelope, and required X-Config-Version / X-Process-Time-Ms / X-Request-Id headers');

    console.log('\n--- SECTION 3: LIVENESS ENDPOINT ---');
    const healthRes = await makeRequest('/api/v1/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.body.config_version, '1.0.0');
    assert.strictEqual(healthRes.body.status, 'success');
    assert.strictEqual(healthRes.body.data.status, 'healthy');
    assert.strictEqual(healthRes.body.data.service, config.appName);
    assert(typeof healthRes.body.data.uptime_seconds === 'number');
    reportTest('TEST 3.1: Liveness /api/v1/health', true, 'Liveness returned 200 with service metadata and uptime');

    console.log('\n--- SECTION 4: READINESS ENDPOINT (HEALTHY & DEGRADED) ---');
    const readyHealthyRes = await makeRequest('/api/v1/ready');
    assert.strictEqual(readyHealthyRes.status, 200);
    assert.strictEqual(readyHealthyRes.body.config_version, '1.0.0');
    assert.strictEqual(readyHealthyRes.body.status, 'success');
    assert.strictEqual(readyHealthyRes.body.data.status, 'ready');
    assert.strictEqual(readyHealthyRes.body.data.checks.mysql.status, 'healthy');
    assert(readyHealthyRes.body.data.checks.python_service !== undefined);
    assert(['healthy', 'unavailable', 'not_configured'].includes(readyHealthyRes.body.data.checks.python_service.status));
    reportTest('TEST 4.1: Readiness (Healthy MySQL)', true, 'Readiness returned 200 with MySQL healthy and Python status accurately recorded');

    await closePool();
    const readyDegradedRes = await makeRequest('/api/v1/ready');
    assert.strictEqual(readyDegradedRes.status, 503);
    assert.strictEqual(readyDegradedRes.body.config_version, '1.0.0');
    assert.strictEqual(readyDegradedRes.body.status, 'degraded');
    assert.strictEqual(readyDegradedRes.body.data.status, 'degraded');
    assert.strictEqual(readyDegradedRes.body.data.checks.mysql.status, 'unhealthy');
    reportTest('TEST 4.2: Readiness (Degraded MySQL)', true, 'Readiness returned 503 and status degraded when MySQL pool was closed');

    await resetPool();

    console.log('\n--- SECTION 5: NOT FOUND & ERROR HANDLING ---');
    const notFoundRes = await makeRequest('/api/v1/nonexistent-endpoint-xyz');
    assert.strictEqual(notFoundRes.status, 404);
    assert.strictEqual(notFoundRes.body.config_version, '1.0.0');
    assert.strictEqual(notFoundRes.body.status, 'error');
    assert(notFoundRes.body.message.includes('not found'));
    reportTest('TEST 5.1: 404 Not Found Handler', true, 'Unknown route returned 404 with standardized error envelope');

    const malformedJsonRes = await makeRequest('/api/v1/health', {
      method: 'POST',
      body: '{"invalid": json missing closing brace',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(malformedJsonRes.status, 400);
    assert.strictEqual(malformedJsonRes.body.config_version, '1.0.0');
    assert.strictEqual(malformedJsonRes.body.status, 'error');
    assert.strictEqual(malformedJsonRes.body.message, 'Malformed JSON payload in request body');
    reportTest('TEST 5.2: Malformed JSON Handler', true, 'Invalid JSON body rejected with 400 and sanitized message');

    console.log('\n--- SECTION 6: REQUEST ID PROPAGATION ---');
    const customTraceId = 'trace-uuid-11223344-5566-7788';
    const traceRes = await makeRequest('/api/v1/health', {
      headers: { 'X-Request-Id': customTraceId }
    });
    assert.strictEqual(traceRes.headers['x-request-id'], customTraceId);
    reportTest('TEST 6.1: Client Request ID Propagation', true, `Client X-Request-Id echoed back: ${customTraceId}`);

    const autoTraceRes = await makeRequest('/api/v1/health');
    const generatedId = autoTraceRes.headers['x-request-id'];
    assert(typeof generatedId === 'string' && generatedId.length >= 32);
    reportTest('TEST 6.2: Automatic UUID Generation', true, `Generated Request ID: ${generatedId}`);

    console.log('\n--- SECTION 7: CORS CONFIGURATION ---');
    const allowedOrigin = 'http://localhost:5173';
    const corsAllowedRes = await makeRequest('/api/v1/health', {
      headers: { Origin: allowedOrigin }
    });
    assert.strictEqual(corsAllowedRes.headers['access-control-allow-origin'], allowedOrigin);
    assert.strictEqual(corsAllowedRes.headers['access-control-allow-credentials'], 'true');
    reportTest('TEST 7.1: Allowed CORS Origin', true, `Allowed origin ${allowedOrigin} received correct CORS headers`);

    const disallowedOrigin = 'http://unauthorized-attacker.example.com';
    const corsBlockedRes = await makeRequest('/api/v1/health', {
      headers: { Origin: disallowedOrigin }
    });
    assert.strictEqual(corsBlockedRes.status, 403);
    assert.strictEqual(corsBlockedRes.body.status, 'error');
    assert(corsBlockedRes.body.message.includes('CORS'));
    reportTest('TEST 7.2: Disallowed CORS Origin Rejection', true, `Disallowed origin ${disallowedOrigin} rejected with 403`);

    console.log('\n--- SECTION 8: GRACEFUL SHUTDOWN ---');
    await stopServer();
    let connectionRefused = false;
    try {
      await makeRequest('/');
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        connectionRefused = true;
      }
    }
    assert(connectionRefused, 'Server should refuse connections after shutdown');
    reportTest('TEST 8.1: Server Listener Teardown', true, 'Server successfully closed HTTP listener');

    let poolClosedAfterShutdown = false;
    try {
      const { getConnection } = await import('../db/pool.js');
      await getConnection();
    } catch (err) {
      if (err.message && err.message.includes('closed')) {
        poolClosedAfterShutdown = true;
      }
    }
    assert(poolClosedAfterShutdown, 'Pool must be closed following stopServer()');
    reportTest('TEST 8.2: Database Pool Cleanup on Shutdown', true, 'Database pool closed and subsequent queries rejected');

    await resetPool();
    reportTest('TEST 8.3: Clean Pool Reset for Subsequent Suites', true, 'Database pool re-initialized cleanly');

    console.log('\n=================================================================');
    console.log(`    EXPRESS TEST SUITE SUMMARY: ${passedTests}/${totalTests} PASSED`);
    console.log('=================================================================\n');

    if (passedTests !== totalTests) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\nUNHANDLED EXCEPTION IN TEST SUITE:', error);
    try {
      await stopServer();
      await resetPool();
    } catch {}
    process.exit(1);
  }
}

runExpressTestSuite();
