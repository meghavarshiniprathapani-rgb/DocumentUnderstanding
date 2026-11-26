import assert from 'node:assert';
import http from 'node:http';
import { app } from '../app.js';
import { config } from '../config.js';
import { startServer, stopServer } from '../server.js';
import { query, closePool, resetPool } from '../db/pool.js';
import * as documentRepository from '../db/repositories/documentRepository.js';
import * as elementRepository from '../db/repositories/elementRepository.js';

process.env.NODE_ENV = 'test';

const TEST_PORT = 3098;
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

async function cleanTestData() {
  await query(`DELETE FROM elements WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-m162-%')`);
  await query(`DELETE FROM jobs WHERE doc_id IN (SELECT id FROM documents WHERE document_id LIKE 'test-m162-%')`);
  await query(`DELETE FROM documents WHERE document_id LIKE 'test-m162-%'`);
}

async function runDocumentsTestSuite() {
  console.log('=================================================================');
  console.log('    RETRIEVA AI — M1.6.2 EXPRESS DOCUMENT & ELEMENT READ SUITE   ');
  console.log('=================================================================\n');

  try {
    await resetPool();
    await cleanTestData();

    console.log('--- SEEDING ISOLATED TEST DATASET ---');
    const doc1 = await documentRepository.createDocument({
      document_id: 'test-m162-doc-001',
      filename: 'sample_m162_alpha.pdf',
      sha256: 'aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11',
      path: '/data/sample_documents/sample_m162_alpha.pdf',
      pages_count: 2,
      doc_type: 'financial_report',
      split: 'ac3',
      status: 'ready',
      metadata: {
        category: 'Financial Report',
        parsing_accuracy: 99.1,
        file_size: '1.25 MB',
        metrics: { text_blocks: 2, tables: 1, figures: 0, headings: 1 }
      }
    });

    await elementRepository.bulkInsert([
      {
        doc_id: doc1.id,
        mode: 'flat',
        type: 'heading',
        page: 1,
        reading_order: 0,
        text: 'Executive Summary Overview',
        bbox: [50, 700, 500, 740],
        confidence: 0.99,
        provenance: {
          extractor: 'pdfplumber',
          version: '0.11',
          source_file_hash: doc1.sha256,
          calibrated_confidence: 0.985
        },
        flags: ['is_section_header'],
        model_version: 'pdfplumber-0.11.0'
      },
      {
        doc_id: doc1.id,
        mode: 'flat',
        type: 'text',
        page: 1,
        reading_order: 1,
        text: 'Net income increased by 15% across all regional operations.',
        bbox: [50, 650, 500, 690],
        confidence: 0.95,
        provenance: {
          extractor: 'pdfplumber',
          version: '0.11',
          calibrated_confidence: 0.94
        },
        flags: null,
        model_version: 'pdfplumber-0.11.0'
      },
      {
        doc_id: doc1.id,
        mode: 'candidate',
        type: 'table',
        page: 1,
        reading_order: 2,
        text: 'Quarterly Revenue Performance Table',
        bbox: [50, 400, 500, 600],
        structured: {
          headers: ['Quarter', 'Revenue'],
          rows: [['Q1', '$10M'], ['Q2', '$15M']]
        },
        confidence: 0.98,
        provenance: {
          extractor: 'docling',
          version: '2.0.0',
          calibrated_confidence: 0.97
        },
        flags: ['table_grid_detected'],
        model_version: 'docling-2.0.0'
      },
      {
        doc_id: doc1.id,
        mode: 'flat',
        type: 'formula',
        page: 2,
        reading_order: 0,
        text: 'E = mc^2',
        bbox: [100, 300, 400, 350],
        structured: { latex: 'E = mc^2' },
        confidence: 0.96,
        provenance: { extractor: 'docling', version: '2.0.0' },
        flags: ['display_math'],
        model_version: 'docling-2.0.0'
      }
    ]);

    const doc2 = await documentRepository.createDocument({
      document_id: 'test-m162-doc-002',
      filename: 'sample_m162_beta.pdf',
      sha256: 'bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22',
      path: '/data/sample_documents/sample_m162_beta.pdf',
      pages_count: 1,
      doc_type: 'academic_paper',
      split: 'dev',
      status: 'processed',
      metadata: { category: 'Academic Paper' }
    });

    const doc3 = await documentRepository.createDocument({
      document_id: 'test-m162-doc-003',
      filename: 'sample_m162_gamma.pdf',
      sha256: 'cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33cc33',
      path: '/data/sample_documents/sample_m162_gamma.pdf',
      pages_count: 5,
      doc_type: 'compliance_policy',
      split: 'none',
      status: 'failed'
    });

    const docSoftDel = await documentRepository.createDocument({
      document_id: 'test-m162-doc-softdel',
      filename: 'sample_m162_deleted.pdf',
      sha256: 'dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44dd44',
      path: '/data/sample_documents/sample_m162_deleted.pdf',
      pages_count: 1,
      doc_type: 'contract'
    });
    await documentRepository.softDelete(docSoftDel.id);

    console.log('\n--- SECTION 1: SERVER STARTUP ---');
    await startServer(TEST_PORT, '127.0.0.1');
    reportTest('TEST 1.1: Server Startup', true, `Express listening on port ${TEST_PORT}`);

    console.log('\n--- SECTION 2: DOCUMENT LISTING & PAGINATION ---');
    const listRes = await makeRequest('/api/v1/documents?limit=2&offset=0');
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.status, 'success');
    assert.strictEqual(listRes.body.config_version, '1.0.0');
    assert(Array.isArray(listRes.body.data));
    assert(listRes.body.data.length <= 2);
    assert(listRes.headers['x-total-count'] !== undefined);
    assert.strictEqual(listRes.headers['x-pagination-limit'], '2');
    assert.strictEqual(listRes.headers['x-pagination-offset'], '0');
    assert.strictEqual(listRes.headers['x-config-version'], '1.0.0');
    assert(listRes.headers['x-request-id'] !== undefined);
    reportTest('TEST 2.1: Document Listing with Pagination', true, `Returned ${listRes.body.data.length} docs, X-Total-Count: ${listRes.headers['x-total-count']}`);

    const pageRes = await makeRequest('/api/v1/documents?page=2&limit=1');
    assert.strictEqual(pageRes.status, 200);
    assert.strictEqual(pageRes.headers['x-pagination-offset'], '1');
    reportTest('TEST 2.2: Page Parameter to Offset Calculation', true, 'page=2 with limit=1 computed offset=1');

    console.log('\n--- SECTION 3: FILTERING (SPLIT, STATUS, DOC_TYPE) ---');
    const splitRes = await makeRequest('/api/v1/documents?split=ac3');
    assert.strictEqual(splitRes.status, 200);
    assert(splitRes.body.data.every((d) => d.split === 'ac3'));
    assert(splitRes.body.data.some((d) => d.document_id === 'test-m162-doc-001'));
    reportTest('TEST 3.1: Filter by split (ac3)', true, 'All returned documents match split=ac3');

    const statusRes = await makeRequest('/api/v1/documents?status=failed');
    assert.strictEqual(statusRes.status, 200);
    assert(statusRes.body.data.every((d) => d.status === 'failed'));
    assert(statusRes.body.data.some((d) => d.document_id === 'test-m162-doc-003'));
    reportTest('TEST 3.2: Filter by status (failed)', true, 'All returned documents match status=failed');

    const typeRes = await makeRequest('/api/v1/documents?doc_type=academic_paper');
    assert.strictEqual(typeRes.status, 200);
    assert(typeRes.body.data.every((d) => d.doc_type === 'academic_paper'));
    assert(typeRes.body.data.some((d) => d.document_id === 'test-m162-doc-002'));
    reportTest('TEST 3.3: Filter by doc_type (academic_paper)', true, 'All returned documents match doc_type=academic_paper');

    console.log('\n--- SECTION 4: INVALID QUERY VALIDATIONS ---');
    const badLimitRes = await makeRequest('/api/v1/documents?limit=0');
    assert.strictEqual(badLimitRes.status, 400);
    assert.strictEqual(badLimitRes.body.status, 'error');
    assert(badLimitRes.body.message.includes('limit'));
    reportTest('TEST 4.1: Invalid Limit Validation (0)', true, 'Rejected limit=0 with 400');

    const largeLimitRes = await makeRequest('/api/v1/documents?limit=999');
    assert.strictEqual(largeLimitRes.status, 400);
    reportTest('TEST 4.2: Exceeded Limit Validation (999)', true, 'Rejected limit=999 with 400');

    const badOffsetRes = await makeRequest('/api/v1/documents?offset=-5');
    assert.strictEqual(badOffsetRes.status, 400);
    reportTest('TEST 4.3: Negative Offset Validation (-5)', true, 'Rejected offset=-5 with 400');

    const badPageRes = await makeRequest('/api/v1/documents?page=abc');
    assert.strictEqual(badPageRes.status, 400);
    reportTest('TEST 4.4: Non-integer Page Validation', true, 'Rejected page=abc with 400');

    const badSplitRes = await makeRequest('/api/v1/documents?split=invalid_tier');
    assert.strictEqual(badSplitRes.status, 400);
    reportTest('TEST 4.5: Invalid Split Validation', true, 'Rejected split=invalid_tier with 400');

    console.log('\n--- SECTION 5: DOCUMENT LOOKUP BY PUBLIC ID ---');
    const docLookupRes = await makeRequest('/api/v1/documents/test-m162-doc-001');
    assert.strictEqual(docLookupRes.status, 200);
    assert.strictEqual(docLookupRes.body.status, 'success');
    assert.strictEqual(docLookupRes.body.data.document_id, 'test-m162-doc-001');
    assert.strictEqual(docLookupRes.body.data.filename, 'sample_m162_alpha.pdf');
    assert.strictEqual(docLookupRes.body.data.category, 'Financial Report');
    assert.strictEqual(docLookupRes.body.data.parsing_accuracy, 99.1);
    assert.strictEqual(docLookupRes.body.data.file_size, '1.25 MB');
    assert.strictEqual(docLookupRes.body.data.metrics.tables, 1);
    assert.strictEqual(docLookupRes.body.data.config_version, '1.0.0');
    assert.strictEqual(docLookupRes.body.data.id, undefined);
    reportTest('TEST 5.1: Document Lookup by Public ID', true, 'Retrieved doc-001 metadata without exposing internal numeric DB id');

    const missingDocRes = await makeRequest('/api/v1/documents/nonexistent-doc-999');
    assert.strictEqual(missingDocRes.status, 404);
    assert.strictEqual(missingDocRes.body.status, 'error');
    assert(missingDocRes.body.message.includes('not found'));
    reportTest('TEST 5.2: Missing Document 404', true, 'Missing document returned 404 with error envelope');

    const softDelDocRes = await makeRequest('/api/v1/documents/test-m162-doc-softdel');
    assert.strictEqual(softDelDocRes.status, 404);
    assert.strictEqual(softDelDocRes.body.status, 'error');
    reportTest('TEST 5.3: Soft-Deleted Document 404', true, 'Soft-deleted document returned 404');

    console.log('\n--- SECTION 6: PAGE SEGMENT RETRIEVAL & READING ORDER ---');
    const segRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/1/segments');
    assert.strictEqual(segRes.status, 200);
    assert.strictEqual(segRes.body.status, 'success');
    assert(Array.isArray(segRes.body.data));
    assert.strictEqual(segRes.body.data.length, 3);

    for (let i = 0; i < segRes.body.data.length - 1; i++) {
      assert(
        segRes.body.data[i].reading_order <= segRes.body.data[i + 1].reading_order,
        'Segments must be sorted deterministically by reading_order'
      );
    }
    reportTest('TEST 6.1: Page Segments & Reading Order', true, 'Segments retrieved and verified ordered strictly by reading_order');

    console.log('\n--- SECTION 7: MODE FILTERING ---');
    const flatSegRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/1/segments?mode=flat');
    assert.strictEqual(flatSegRes.status, 200);
    assert.strictEqual(flatSegRes.body.data.length, 2);
    assert(flatSegRes.body.data.every((s) => s.mode === 'flat'));
    reportTest('TEST 7.1: Mode Filtering (flat)', true, 'Returned 2 flat mode segments');

    const candSegRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/1/segments?mode=candidate');
    assert.strictEqual(candSegRes.status, 200);
    assert.strictEqual(candSegRes.body.data.length, 1);
    assert.strictEqual(candSegRes.body.data[0].mode, 'candidate');
    assert.strictEqual(candSegRes.body.data[0].type, 'table');
    reportTest('TEST 7.2: Mode Filtering (candidate)', true, 'Returned 1 candidate mode table segment');

    console.log('\n--- SECTION 8: FIELD PRESERVATION (CONFIDENCE, PROVENANCE, BBOX, STRUCTURED) ---');
    const tableSeg = candSegRes.body.data[0];
    assert.strictEqual(tableSeg.confidence, 0.98);
    assert.strictEqual(tableSeg.calibrated_confidence, 0.97);
    assert.deepStrictEqual(tableSeg.table_data.headers, ['Quarter', 'Revenue']);
    assert.strictEqual(tableSeg.table_data.rows.length, 2);
    assert.strictEqual(tableSeg.provenance.extractor, 'docling');
    assert.strictEqual(tableSeg.model_version, 'docling-2.0.0');
    assert.strictEqual(tableSeg.bbox.x, 50);
    assert.strictEqual(tableSeg.bbox.y, 400);
    assert.strictEqual(tableSeg.bbox.width, 450);
    assert.strictEqual(tableSeg.bbox.height, 200);
    assert(tableSeg.flags.includes('table_grid_detected'));
    reportTest('TEST 8.1: Deep Field Preservation', true, 'Confidence, calibrated_confidence, table_data, bbox, provenance, and flags preserved 100%');

    const p2Res = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/2/segments');
    assert.strictEqual(p2Res.status, 200);
    assert.strictEqual(p2Res.body.data.length, 1);
    assert.strictEqual(p2Res.body.data[0].type, 'formula');
    assert.strictEqual(p2Res.body.data[0].formula_latex, 'E = mc^2');
    reportTest('TEST 8.2: Formula LaTeX Preservation', true, 'Page 2 formula segment preserved LaTeX string intact');

    console.log('\n--- SECTION 9: EMPTY PAGE & PATH COMPATIBILITY ---');
    const emptyPageRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/99/segments');
    assert.strictEqual(emptyPageRes.status, 200);
    assert.strictEqual(emptyPageRes.body.status, 'success');
    assert.deepStrictEqual(emptyPageRes.body.data, []);
    reportTest('TEST 9.1: Empty Page Segment Handling', true, 'Page 99 with zero segments returned 200 with empty array');

    const compatPathRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/1');
    assert.strictEqual(compatPathRes.status, 200);
    assert.strictEqual(compatPathRes.body.data.length, 3);
    reportTest('TEST 9.2: Existing API Path Compatibility', true, 'Existing route /documents/:id/pages/:page returned identical segments');

    console.log('\n--- SECTION 10: INVALID SEGMENT PARAMETER VALIDATIONS ---');
    const badPageZeroRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/0/segments');
    assert.strictEqual(badPageZeroRes.status, 400);
    reportTest('TEST 10.1: Page 0 Validation', true, 'Rejected page=0 with 400');

    const badPageNegRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/-3/segments');
    assert.strictEqual(badPageNegRes.status, 400);
    reportTest('TEST 10.2: Negative Page Validation', true, 'Rejected page=-3 with 400');

    const badPageStrRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/first/segments');
    assert.strictEqual(badPageStrRes.status, 400);
    reportTest('TEST 10.3: Non-numeric Page Validation', true, 'Rejected page=first with 400');

    const badModeRes = await makeRequest('/api/v1/documents/test-m162-doc-001/pages/1/segments?mode=unknown_mode_xyz');
    assert.strictEqual(badModeRes.status, 400);
    assert(badModeRes.body.message.includes('Allowed modes'));
    reportTest('TEST 10.4: Invalid Mode Validation', true, 'Rejected mode=unknown_mode_xyz with 400');

    const softDelSegRes = await makeRequest('/api/v1/documents/test-m162-doc-softdel/pages/1/segments');
    assert.strictEqual(softDelSegRes.status, 404);
    reportTest('TEST 10.5: Segments on Soft-Deleted Document', true, 'Segments requested for soft-deleted doc returned 404');

    console.log('\n--- SECTION 11: DATABASE FAILURE RESILIENCE ---');
    await closePool();
    const failRes = await makeRequest('/api/v1/documents');
    assert.strictEqual(failRes.status, 500);
    assert.strictEqual(failRes.body.status, 'error');
    assert(failRes.body.message.includes('closed'));
    assert.strictEqual(failRes.rawBody.includes('password'), false);
    reportTest('TEST 11.1: Database Failure Sanitization', true, 'Repository failure returned 500 without leaking credentials or config');

    await resetPool();
    reportTest('TEST 11.2: Pool Reset Recovery', true, 'Pool cleanly restored');

    console.log('\n--- CLEANING UP TEST FIXTURES ---');
    await cleanTestData();
    await stopServer();
    await resetPool();

    console.log('\n=================================================================');
    console.log(`    DOCUMENT & ELEMENT TEST SUITE SUMMARY: ${passedTests}/${totalTests} PASSED`);
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

runDocumentsTestSuite();
