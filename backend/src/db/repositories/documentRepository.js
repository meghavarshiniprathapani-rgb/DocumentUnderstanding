/**
 * Retrieva AI — Document Repository (AIML-59 / M1.5)
 * 
 * Provides persistence and querying for the `documents` table:
 * - Numeric primary key (`id`) and external canonical string identity (`document_id`).
 * - Duplicate SHA-256 detection and graceful error handling.
 * - Soft-deletion audit pattern (`deleted_at` column) with filtering by default.
 * - Strict parameterized queries and connection release in finally blocks.
 */

import { query, getConnection, sanitizeError } from '../pool.js';

/**
 * Thrown when attempting to insert a document with a duplicate SHA-256 or document_id.
 */
export class DuplicateDocumentError extends Error {
  constructor(message, conflictField = 'sha256') {
    super(message);
    this.name = 'DuplicateDocumentError';
    this.code = 'ERR_DUPLICATE_DOCUMENT';
    this.conflictField = conflictField;
  }
}

/**
 * Normalizes document record from MySQL rows into structured domain entity.
 */
function mapDocumentRow(row) {
  if (!row) return null;

  let metadata = null;
  if (row.metadata) {
    metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  }

  return {
    id: Number(row.id),
    document_id: row.document_id,
    filename: row.filename,
    sha256: row.sha256,
    path: row.path,
    pages_count: Number(row.pages_count),
    doc_type: row.doc_type,
    split: row.split,
    status: row.status,
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

/**
 * Creates a new document record.
 * 
 * @param {Object} docData
 * @param {string} docData.document_id - Canonical string ID (e.g. 'doc-001')
 * @param {string} docData.filename - Original filename
 * @param {string} docData.sha256 - SHA-256 digest of original file
 * @param {string} docData.path - Storage path
 * @param {number} [docData.pages_count=0] - Number of pages
 * @param {string} [docData.doc_type='unclassified'] - Document classification
 * @param {'dev'|'ac3'|'none'} [docData.split='none'] - Dataset split
 * @param {string} [docData.status='ready'] - Document status
 * @param {Object} [docData.metadata=null] - Optional arbitrary metadata
 * @returns {Promise<Object>} Created document entity
 */
export async function createDocument(docData, options = {}) {
  if (!docData.document_id || typeof docData.document_id !== 'string') {
    throw new Error('document_id is required and must be a non-empty string.');
  }
  if (!docData.filename) throw new Error('filename is required.');
  if (!docData.sha256) throw new Error('sha256 is required.');
  if (!docData.path) throw new Error('path is required.');

  const sql = `
    INSERT INTO documents (
      document_id, filename, sha256, path, pages_count, doc_type, split, status, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const metadataJson = docData.metadata ? JSON.stringify(docData.metadata) : null;
  const params = [
    docData.document_id,
    docData.filename,
    docData.sha256.toLowerCase(),
    docData.path,
    Number(docData.pages_count) || 0,
    docData.doc_type || 'unclassified',
    docData.split || 'none',
    docData.status || 'ready',
    metadataJson,
  ];

  const runner = options?.connection || { query };
  try {
    const [result] = await runner.query(sql, params);
    return await findById(result.insertId, { includeDeleted: true, connection: options?.connection });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = err.message || '';
      if (msg.includes('uq_documents_sha256') || msg.includes('sha256')) {
        throw new DuplicateDocumentError(
          `Document with SHA-256 hash '${docData.sha256}' already exists.`,
          'sha256'
        );
      }
      if (msg.includes('uq_documents_document_id') || msg.includes('document_id')) {
        throw new DuplicateDocumentError(
          `Document with external ID '${docData.document_id}' already exists.`,
          'document_id'
        );
      }
      throw new DuplicateDocumentError(`Duplicate document entry: ${msg}`);
    }
    throw sanitizeError(err);
  }
}

/**
 * Finds a document by numeric primary key.
 * 
 * @param {number|string} id - Numeric primary key
 * @param {Object} [options]
 * @param {boolean} [options.includeDeleted=false] - If true, includes soft-deleted records
 * @returns {Promise<Object|null>}
 */
export async function findById(id, options = {}) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const includeDeleted = Boolean(options.includeDeleted);
  const sql = includeDeleted
    ? `SELECT * FROM documents WHERE id = ? LIMIT 1`
    : `SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL LIMIT 1`;

  const runner = options?.connection || { query };
  const [rows] = await runner.query(sql, [numericId]);
  return rows.length > 0 ? mapDocumentRow(rows[0]) : null;
}

export async function findByDocumentId(documentId, options = {}) {
  if (!documentId || typeof documentId !== 'string') return null;

  const includeDeleted = Boolean(options.includeDeleted);
  const sql = includeDeleted
    ? `SELECT * FROM documents WHERE document_id = ? LIMIT 1`
    : `SELECT * FROM documents WHERE document_id = ? AND deleted_at IS NULL LIMIT 1`;

  const runner = options?.connection || { query };
  const [rows] = await runner.query(sql, [documentId]);
  return rows.length > 0 ? mapDocumentRow(rows[0]) : null;
}

/**
 * Finds a document by its SHA-256 hash.
 * 
 * @param {string} sha256 - SHA-256 hash
 * @param {Object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {Promise<Object|null>}
 */
export async function findBySha256(sha256, options = {}) {
  if (!sha256 || typeof sha256 !== 'string') return null;

  const includeDeleted = Boolean(options.includeDeleted);
  const sql = includeDeleted
    ? `SELECT * FROM documents WHERE sha256 = ? LIMIT 1`
    : `SELECT * FROM documents WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1`;

  const [rows] = await query(sql, [sha256.toLowerCase()]);
  return rows.length > 0 ? mapDocumentRow(rows[0]) : null;
}

/**
 * Lists documents with filtering, pagination, and deterministic ordering.
 * 
 * @param {Object} [options]
 * @param {number} [options.limit=50] - Page size
 * @param {number} [options.offset=0] - Page offset
 * @param {string} [options.split] - Filter by split ('dev', 'ac3', 'none')
 * @param {string} [options.status] - Filter by status
 * @param {string} [options.doc_type] - Filter by document type
 * @param {boolean} [options.includeDeleted=false] - Whether to include soft-deleted records
 * @param {'ASC'|'DESC'} [options.orderDirection='ASC']
 * @returns {Promise<{documents: Array<Object>, total: number, limit: number, offset: number}>}
 */
export async function listDocuments(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 500));
  const offset = Math.max(0, Number(options.offset) || 0);
  const includeDeleted = Boolean(options.includeDeleted);
  const orderDirection = options.orderDirection?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  const whereClauses = [];
  const params = [];

  if (!includeDeleted) {
    whereClauses.push('deleted_at IS NULL');
  }

  if (options.split) {
    whereClauses.push('split = ?');
    params.push(options.split);
  }

  if (options.status) {
    whereClauses.push('status = ?');
    params.push(options.status);
  }

  if (options.doc_type) {
    whereClauses.push('doc_type = ?');
    params.push(options.doc_type);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countSql = `SELECT COUNT(*) AS total FROM documents ${whereSql}`;
  const [countRows] = await query(countSql, params);
  const total = Number(countRows[0]?.total || 0);

  // Get paginated rows
  const selectSql = `
    SELECT * FROM documents
    ${whereSql}
    ORDER BY id ${orderDirection}
    LIMIT ? OFFSET ?
  `;
  const [rows] = await query(selectSql, [...params, limit, offset]);

  return {
    documents: rows.map(mapDocumentRow),
    total,
    limit,
    offset,
  };
}

/**
 * Updates document status.
 * 
 * @param {number|string} idOrDocId - Numeric id or string document_id
 * @param {string} newStatus - New status value
 * @returns {Promise<Object|null>} Updated document or null if not found
 */
export async function updateStatus(idOrDocId, newStatus) {
  if (!idOrDocId) throw new Error('idOrDocId is required.');
  if (!newStatus || typeof newStatus !== 'string') throw new Error('newStatus is required.');

  const isNumeric = Number.isInteger(Number(idOrDocId)) && Number(idOrDocId) > 0;
  const whereSql = isNumeric ? 'id = ?' : 'document_id = ?';

  const sql = `UPDATE documents SET status = ? WHERE ${whereSql} AND deleted_at IS NULL`;
  const [result] = await query(sql, [newStatus, idOrDocId]);

  if (result.affectedRows === 0) {
    return null;
  }

  return isNumeric
    ? await findById(idOrDocId, { includeDeleted: true })
    : await findByDocumentId(idOrDocId, { includeDeleted: true });
}

/**
 * Soft deletes a document by setting `deleted_at = CURRENT_TIMESTAMP`.
 * Does NOT delete associated job audit history.
 * 
 * @param {number|string} idOrDocId - Numeric id or string document_id
 * @returns {Promise<boolean>} True if record was soft-deleted, false if not found or already deleted
 */
export async function softDelete(idOrDocId, options = {}) {
  if (!idOrDocId) throw new Error('idOrDocId is required.');

  const isNumeric = Number.isInteger(Number(idOrDocId)) && Number(idOrDocId) > 0;
  const whereSql = isNumeric ? 'id = ?' : 'document_id = ?';

  const sql = `UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE ${whereSql} AND deleted_at IS NULL`;
  const runner = options?.connection || { query };
  const [result] = await runner.query(sql, [idOrDocId]);

  return result.affectedRows > 0;
}

/**
 * Restores a soft-deleted document by resetting `deleted_at = NULL`.
 * 
 * @param {number|string} idOrDocId - Numeric id or string document_id
 * @returns {Promise<boolean>} True if record was restored, false if not found or not deleted
 */
export async function restore(idOrDocId) {
  if (!idOrDocId) throw new Error('idOrDocId is required.');

  const isNumeric = Number.isInteger(Number(idOrDocId)) && Number(idOrDocId) > 0;
  const whereSql = isNumeric ? 'id = ?' : 'document_id = ?';

  const sql = `UPDATE documents SET deleted_at = NULL WHERE ${whereSql} AND deleted_at IS NOT NULL`;
  const [result] = await query(sql, [idOrDocId]);

  return result.affectedRows > 0;
}
