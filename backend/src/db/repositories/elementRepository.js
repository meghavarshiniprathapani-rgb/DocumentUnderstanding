/**
 * Retrieva AI — Element Repository (AIML-59 / M1.5)
 * 
 * Provides persistence and querying for extracted document elements:
 * - Preserves reading_order, page, bounding boxes, structured content, confidence, and flags.
 * - Supports all 4 experimental modes: 'flat', 'reference', 'candidate', 'candidate_ft'.
 * - Transactional bulk insertion with validation before DDL/DML.
 * - Enforces check constraints (confidence [0, 1], page >= 1, reading_order >= 0).
 */

import { getConnection, query, sanitizeError } from '../pool.js';

export const VALID_MODES = new Set(['flat', 'reference', 'candidate', 'candidate_ft']);
export const VALID_TYPES = new Set(['text', 'heading', 'table', 'formula', 'figure', 'caption']);

/**
 * Thrown when an element violates structural bounds or validation constraints.
 */
export class ElementValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ElementValidationError';
    this.code = 'ERR_ELEMENT_VALIDATION';
  }
}

/**
 * Normalizes an element row from MySQL into a structured entity.
 */
function mapElementRow(row) {
  if (!row) return null;

  const parseJson = (val) => {
    if (!val) return null;
    return typeof val === 'string' ? JSON.parse(val) : val;
  };

  return {
    id: Number(row.id),
    doc_id: Number(row.doc_id),
    mode: row.mode,
    type: row.type,
    page: Number(row.page),
    reading_order: Number(row.reading_order),
    text: row.text || '',
    bbox: parseJson(row.bbox),
    structured: parseJson(row.structured),
    confidence: Number(row.confidence),
    provenance: parseJson(row.provenance),
    flags: parseJson(row.flags),
    model_version: row.model_version || null,
    created_at: row.created_at,
  };
}

/**
 * Resolves a numeric doc_id from either a numeric ID or a string document_id.
 */
async function resolveNumericDocId(docIdOrDocumentId, conn = null) {
  if (docIdOrDocumentId === null || docIdOrDocumentId === undefined) {
    return null;
  }

  const num = Number(docIdOrDocumentId);
  if (Number.isInteger(num) && num > 0) {
    return num;
  }

  if (typeof docIdOrDocumentId === 'string') {
    const sql = `SELECT id FROM documents WHERE document_id = ? LIMIT 1`;
    const [rows] = conn
      ? await conn.query(sql, [docIdOrDocumentId])
      : await query(sql, [docIdOrDocumentId]);

    if (rows && rows.length > 0) {
      return Number(rows[0].id);
    }
  }

  return null;
}

/**
 * Validates element data before insertion.
 */
function validateElement(elem, index) {
  const prefix = `Element[${index}]:`;

  if (!elem.doc_id || Number(elem.doc_id) <= 0) {
    throw new ElementValidationError(`${prefix} Valid numeric doc_id is required.`);
  }
  if (!elem.mode || !VALID_MODES.has(elem.mode)) {
    throw new ElementValidationError(
      `${prefix} Invalid mode '${elem.mode}'. Allowed modes: ${Array.from(VALID_MODES).join(', ')}`
    );
  }
  if (!elem.type || !VALID_TYPES.has(elem.type)) {
    throw new ElementValidationError(
      `${prefix} Invalid element type '${elem.type}'. Allowed types: ${Array.from(VALID_TYPES).join(', ')}`
    );
  }

  const page = Number(elem.page);
  if (!Number.isInteger(page) || page < 1) {
    throw new ElementValidationError(`${prefix} page must be an integer >= 1 (got ${elem.page}).`);
  }

  const readingOrder = Number(elem.reading_order);
  if (!Number.isInteger(readingOrder) || readingOrder < 0) {
    throw new ElementValidationError(
      `${prefix} reading_order must be an integer >= 0 (got ${elem.reading_order}).`
    );
  }

  const confidence = Number(elem.confidence !== undefined ? elem.confidence : 1.0);
  if (Number.isNaN(confidence) || confidence < 0.0 || confidence > 1.0) {
    throw new ElementValidationError(
      `${prefix} confidence must be between 0.0 and 1.0 (got ${elem.confidence}).`
    );
  }
}

/**
 * Inserts multiple elements atomically within a single database transaction.
 * 
 * @param {Array<Object>} elements - List of element objects to insert
 * @param {Object} [options]
 * @param {number|string} [options.docId] - Optional docId to override across all elements
 * @returns {Promise<{insertedCount: number, affectedRows: number}>}
 */
async function _insertElementsWithConnection(conn, resolvedDocId, elements) {
  const sql = `
    INSERT INTO elements (
      doc_id, mode, type, page, reading_order, text, bbox, structured, confidence, provenance, flags, model_version
    ) VALUES ?
  `;

  const serializeJson = (val) => (val !== undefined && val !== null ? JSON.stringify(val) : null);

  const values = elements.map((elem) => [
    resolvedDocId || Number(elem.doc_id),
    elem.mode,
    elem.type,
    Number(elem.page),
    Number(elem.reading_order),
    elem.text !== undefined ? String(elem.text) : '',
    serializeJson(elem.bbox),
    serializeJson(elem.structured),
    Number(elem.confidence !== undefined ? elem.confidence : 1.0),
    serializeJson(elem.provenance),
    serializeJson(elem.flags),
    elem.model_version ? String(elem.model_version).slice(0, 64) : null,
  ]);

  const [result] = await conn.query(sql, [values]);
  return {
    insertedCount: elements.length,
    affectedRows: result.affectedRows,
  };
}

export async function bulkInsert(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return { insertedCount: 0, affectedRows: 0 };
  }

  const externalConn = options?.connection || null;
  let resolvedDocId = null;
  if (options.docId) {
    resolvedDocId = await resolveNumericDocId(options.docId, externalConn);
    if (!resolvedDocId) {
      throw new ElementValidationError(`Could not resolve document id '${options.docId}'.`);
    }
  }

  for (let i = 0; i < elements.length; i++) {
    const elem = { ...elements[i] };
    if (resolvedDocId) elem.doc_id = resolvedDocId;
    validateElement(elem, i);
  }

  if (externalConn) {
    return await _insertElementsWithConnection(externalConn, resolvedDocId, elements);
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const res = await _insertElementsWithConnection(conn, resolvedDocId, elements);
    await conn.commit();
    return res;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function replacePersistedElementsFenced(jobId, workerId, details = {}) {
  const numericJobId = Number(jobId);
  if (!Number.isInteger(numericJobId) || numericJobId <= 0) {
    throw new ElementValidationError('Valid positive jobId is required.');
  }
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new ElementValidationError('Valid workerId is required.');
  }
  const normalizedWorkerId = workerId.trim();
  const claimToken =
    typeof details.claimToken === 'string'
      ? details.claimToken.trim()
      : typeof details.claim_token === 'string'
        ? details.claim_token.trim()
        : '';
  if (!claimToken) {
    const err = new Error('Valid claimToken is required for fenced element persistence.');
    err.name = 'LeaseOwnershipError';
    err.code = 'ERR_LEASE_OWNERSHIP';
    throw err;
  }
  const leaseGeneration =
    details.leaseGeneration !== undefined
      ? Number(details.leaseGeneration)
      : details.lease_generation !== undefined
        ? Number(details.lease_generation)
        : undefined;
  if (leaseGeneration !== undefined && (!Number.isInteger(leaseGeneration) || leaseGeneration < 1)) {
    const err = new Error('leaseGeneration must be a positive integer.');
    err.name = 'LeaseOwnershipError';
    err.code = 'ERR_LEASE_OWNERSHIP';
    throw err;
  }

  const mode = details.mode;
  if (!mode || !VALID_MODES.has(mode)) {
    throw new ElementValidationError(
      `Invalid mode '${mode}'. Allowed modes: ${Array.from(VALID_MODES).join(', ')}`
    );
  }
  if (!Array.isArray(details.elements) || details.elements.length === 0) {
    throw new ElementValidationError('elements must be a non-empty array.');
  }

  const conn = await getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();

    const [jobRows] = await conn.query(`SELECT * FROM jobs WHERE id = ? LIMIT 1 FOR UPDATE`, [
      numericJobId,
    ]);
    if (!jobRows || jobRows.length === 0) {
      const err = new Error(`Job ${numericJobId} not found.`);
      err.name = 'LeaseOwnershipError';
      err.code = 'ERR_LEASE_OWNERSHIP';
      throw err;
    }
    const currentJob = jobRows[0];
    if (currentJob.status !== 'running') {
      const err = new Error(
        `Cannot persist elements for job ${numericJobId}: status is '${currentJob.status}', expected 'running'.`
      );
      err.name = 'InvalidJobTransitionError';
      err.code = 'ERR_INVALID_JOB_TRANSITION';
      throw err;
    }
    if (currentJob.locked_by !== normalizedWorkerId) {
      const err = new Error(
        `Worker '${normalizedWorkerId}' does not own job ${numericJobId} (locked_by='${currentJob.locked_by || 'none'}').`
      );
      err.name = 'LeaseOwnershipError';
      err.code = 'ERR_LEASE_OWNERSHIP';
      throw err;
    }
    if (!currentJob.claim_token || currentJob.claim_token !== claimToken) {
      const err = new Error(
        `Worker '${normalizedWorkerId}' presented stale or mismatched claim token for job ${numericJobId}.`
      );
      err.name = 'LeaseOwnershipError';
      err.code = 'ERR_LEASE_OWNERSHIP';
      throw err;
    }
    if (leaseGeneration !== undefined && Number(currentJob.lease_generation) !== leaseGeneration) {
      const err = new Error(
        `Worker '${normalizedWorkerId}' presented stale lease generation ${leaseGeneration} for job ${numericJobId} (current=${currentJob.lease_generation}).`
      );
      err.name = 'LeaseOwnershipError';
      err.code = 'ERR_LEASE_OWNERSHIP';
      throw err;
    }
    if (currentJob.mode !== mode) {
      throw new ElementValidationError(
        `Mode mismatch: job ${numericJobId} has mode '${currentJob.mode}', got '${mode}'.`
      );
    }

    const [docRows] = await conn.query(`SELECT id, deleted_at FROM documents WHERE id = ? LIMIT 1 FOR UPDATE`, [
      currentJob.doc_id,
    ]);
    if (!docRows || docRows.length === 0 || docRows[0].deleted_at !== null) {
      const err = new Error(`Parent document ${currentJob.doc_id} does not exist or is soft-deleted.`);
      err.name = 'InvalidJobTransitionError';
      err.code = 'ERR_INVALID_JOB_TRANSITION';
      err.retryable = false;
      throw err;
    }

    const replaceResult = await replaceByDocumentAndMode(
      currentJob.doc_id,
      mode,
      details.elements,
      { connection: conn }
    );

    await conn.commit();
    return {
      jobId: numericJobId,
      docId: Number(currentJob.doc_id),
      mode,
      ...replaceResult,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (
      err?.name === 'LeaseOwnershipError' ||
      err?.name === 'InvalidJobTransitionError' ||
      err instanceof ElementValidationError
    ) {
      throw err;
    }
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

export async function replaceByDocumentAndMode(docIdOrDocumentId, mode, elements, options = {}) {
  if (!mode || !VALID_MODES.has(mode)) {
    throw new ElementValidationError(
      `Invalid mode '${mode}'. Allowed modes: ${Array.from(VALID_MODES).join(', ')}`
    );
  }
  if (!Array.isArray(elements)) {
    throw new ElementValidationError('elements must be an array.');
  }

  const externalConn = options?.connection || null;
  const resolvedDocId = await resolveNumericDocId(docIdOrDocumentId, externalConn);
  if (!resolvedDocId) {
    throw new ElementValidationError(`Could not resolve document id '${docIdOrDocumentId}'.`);
  }

  for (let i = 0; i < elements.length; i++) {
    const elem = { ...elements[i], doc_id: resolvedDocId, mode };
    validateElement(elem, i);
  }

  const runReplace = async (conn) => {
    const [delResult] = await conn.query(
      `DELETE FROM elements WHERE doc_id = ? AND mode = ?`,
      [resolvedDocId, mode]
    );
    const insertRes =
      elements.length > 0
        ? await _insertElementsWithConnection(
            conn,
            resolvedDocId,
            elements.map((elem) => ({ ...elem, doc_id: resolvedDocId, mode }))
          )
        : { insertedCount: 0, affectedRows: 0 };
    return {
      deletedCount: Number(delResult.affectedRows || 0),
      insertedCount: insertRes.insertedCount,
      affectedRows: insertRes.affectedRows,
    };
  };

  if (externalConn) {
    return await runReplace(externalConn);
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const res = await runReplace(conn);
    await conn.commit();
    return res;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

/**
 * Finds all elements for a document, ordered deterministically by page, reading_order, and id.
 * 
 * @param {number|string} docIdOrDocumentId - Numeric DB id or string document_id
 * @param {Object} [options]
 * @param {string} [options.mode] - Filter by experimental mode
 * @returns {Promise<Array<Object>>}
 */
export async function findByDocument(docIdOrDocumentId, options = {}) {
  const numericId = await resolveNumericDocId(docIdOrDocumentId);
  if (!numericId) return [];

  const whereClauses = ['doc_id = ?'];
  const params = [numericId];

  if (options.mode) {
    whereClauses.push('mode = ?');
    params.push(options.mode);
  }

  const sql = `
    SELECT * FROM elements
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY page ASC, reading_order ASC, id ASC
  `;

  const [rows] = await query(sql, params);
  return rows.map(mapElementRow);
}

/**
 * Finds elements for a document on a specific page.
 * 
 * @param {number|string} docIdOrDocumentId
 * @param {number} page
 * @param {Object} [options]
 * @param {string} [options.mode]
 * @returns {Promise<Array<Object>>}
 */
export async function findByPage(docIdOrDocumentId, page, options = {}) {
  const numericId = await resolveNumericDocId(docIdOrDocumentId);
  const pageNum = Number(page);
  if (!numericId || !Number.isInteger(pageNum) || pageNum < 1) return [];

  const whereClauses = ['doc_id = ?', 'page = ?'];
  const params = [numericId, pageNum];

  if (options.mode) {
    whereClauses.push('mode = ?');
    params.push(options.mode);
  }

  const sql = `
    SELECT * FROM elements
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY reading_order ASC, id ASC
  `;

  const [rows] = await query(sql, params);
  return rows.map(mapElementRow);
}

/**
 * Finds elements for a specific document and mode.
 * 
 * @param {number|string} docIdOrDocumentId
 * @param {'flat'|'reference'|'candidate'|'candidate_ft'} mode
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
export async function findByDocumentAndMode(docIdOrDocumentId, mode, options = {}) {
  return await findByDocument(docIdOrDocumentId, { ...options, mode });
}

/**
 * Deletes all elements for a document under a specific mode.
 * Useful when re-running extraction for one arm without affecting other arms.
 * 
 * @param {number|string} docIdOrDocumentId
 * @param {'flat'|'reference'|'candidate'|'candidate_ft'} mode
 * @returns {Promise<number>} Number of deleted elements
 */
export async function deleteByDocumentAndMode(docIdOrDocumentId, mode) {
  const numericId = await resolveNumericDocId(docIdOrDocumentId);
  if (!numericId || !mode) return 0;

  const sql = `DELETE FROM elements WHERE doc_id = ? AND mode = ?`;
  const [result] = await query(sql, [numericId, mode]);
  return result.affectedRows;
}

/**
 * Counts elements for a document, optionally filtered by mode.
 * 
 * @param {number|string} docIdOrDocumentId
 * @param {Object} [options]
 * @param {string} [options.mode]
 * @returns {Promise<number>}
 */
export async function countByDocument(docIdOrDocumentId, options = {}) {
  const numericId = await resolveNumericDocId(docIdOrDocumentId);
  if (!numericId) return 0;

  const whereClauses = ['doc_id = ?'];
  const params = [numericId];

  if (options.mode) {
    whereClauses.push('mode = ?');
    params.push(options.mode);
  }

  const sql = `SELECT COUNT(*) AS total FROM elements WHERE ${whereClauses.join(' AND ')}`;
  const [rows] = await query(sql, params);
  return Number(rows[0]?.total || 0);
}
