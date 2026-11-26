import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router } from 'express';
import * as documentRepository from '../db/repositories/documentRepository.js';
import * as elementRepository from '../db/repositories/elementRepository.js';
import * as jobRepository from '../db/repositories/jobRepository.js';
import { VALID_MODES } from '../db/repositories/elementRepository.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { serializeDocument, serializeElement } from '../utils/serializers.js';
import { uploadSingle, uploadBatch, uploadConcurrencyGuard } from '../middleware/upload.js';
import { config } from '../config.js';
import { getConnection } from '../db/pool.js';
import {
  getUploadDir,
  getTempUploadDir,
  sanitizeFilename,
  validatePdfFileContent,
  streamFileSha256,
  estimatePdfFilePageCount,
  formatFileSize,
  allocateNextDocumentId,
  releaseAllocatedDocumentId,
  safeUnlinkFile
} from '../utils/uploadHelpers.js';

let _testDeleteHook = null;

export function _setTestDeleteHook(hook) {
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'testing') {
    throw new Error('Disabled outside test environment');
  }
  _testDeleteHook = hook;
}

export const documentsRouter = Router();

documentsRouter.get('/', async (req, res, next) => {
  try {
    let limit = 50;
    if (req.query.limit !== undefined) {
      const limitNum = Number(req.query.limit);
      if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 500) {
        return sendError(res, 'Invalid limit parameter. Must be an integer between 1 and 500.', 400);
      }
      limit = limitNum;
    }

    let offset = 0;
    if (req.query.offset !== undefined) {
      const offsetNum = Number(req.query.offset);
      if (!Number.isInteger(offsetNum) || offsetNum < 0) {
        return sendError(res, 'Invalid offset parameter. Must be a non-negative integer.', 400);
      }
      offset = offsetNum;
    }

    if (req.query.page !== undefined) {
      const pageNum = Number(req.query.page);
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        return sendError(res, 'Invalid page parameter. Must be an integer >= 1.', 400);
      }
      if (req.query.offset === undefined) {
        offset = (pageNum - 1) * limit;
      }
    }

    let split = undefined;
    if (req.query.split !== undefined) {
      const splitVal = String(req.query.split).trim();
      if (!['dev', 'ac3', 'none'].includes(splitVal)) {
        return sendError(res, 'Invalid split parameter. Allowed values: dev, ac3, none.', 400);
      }
      split = splitVal;
    }

    let status = undefined;
    if (req.query.status !== undefined) {
      const statusVal = String(req.query.status).trim();
      if (statusVal) {
        status = statusVal;
      }
    }

    let docType = undefined;
    if (req.query.doc_type !== undefined) {
      const docTypeVal = String(req.query.doc_type).trim();
      if (docTypeVal) {
        docType = docTypeVal;
      }
    } else if (req.query.category !== undefined) {
      const categoryVal = String(req.query.category).trim();
      if (categoryVal) {
        docType = categoryVal;
      }
    }

    const listResult = await documentRepository.listDocuments({
      limit,
      offset,
      split,
      status,
      doc_type: docType
    });

    res.setHeader('X-Total-Count', String(listResult.total));
    res.setHeader('X-Pagination-Limit', String(listResult.limit));
    res.setHeader('X-Pagination-Offset', String(listResult.offset));

    const serialized = listResult.documents.map(serializeDocument);
    return sendSuccess(res, serialized, `Retrieved ${serialized.length} repository documents`, 200);
  } catch (err) {
    return next(err);
  }
});

documentsRouter.post('/upload', uploadConcurrencyGuard, uploadSingle, async (req, res, next) => {
  const tempPath = req.file?.path || null;
  let allocatedDocId = null;
  let writtenPath = null;
  try {
    if (!req.file) {
      return sendError(res, 'No file provided in upload request.', 400);
    }

    const originalName = req.file.originalname || 'uploaded_document.pdf';
    if (!originalName.toLowerCase().endsWith('.pdf')) {
      return sendError(
        res,
        `Invalid file extension for '${originalName}'. Only PDF files are supported.`,
        400
      );
    }

    if (
      originalName.includes('\0') ||
      originalName.includes('..') ||
      originalName.includes('/') ||
      originalName.includes('\\')
    ) {
      return sendError(res, 'Invalid or unsafe filename.', 400);
    }

    const isPdfContent = await validatePdfFileContent(tempPath);
    if (!isPdfContent) {
      return sendError(
        res,
        "Invalid PDF binary header. Stream does not begin with '%PDF-'.",
        400
      );
    }

    const fileStats = await fs.promises.stat(tempPath);
    const maxSizeBytes = Math.floor(config.maxUploadSizeMb * 1024 * 1024);
    if (fileStats.size > maxSizeBytes) {
      return sendError(
        res,
        `File exceeds maximum allowed size of ${config.maxUploadSizeMb}MB.`,
        413
      );
    }

    const sha256 = await streamFileSha256(tempPath);

    const existingDoc = await documentRepository.findBySha256(sha256);
    if (existingDoc) {
      return sendSuccess(
        res,
        serializeDocument(existingDoc),
        'Document already exists in repository (duplicate SHA-256)',
        200
      );
    }

    const customDocId =
      process.env.NODE_ENV === 'test' && req.headers['x-document-id']
        ? String(req.headers['x-document-id']).trim()
        : null;

    allocatedDocId = customDocId || (await allocateNextDocumentId());
    const documentId = allocatedDocId;

    const sanitizedFilename = sanitizeFilename(originalName);
    const uploadDir = getUploadDir();
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const targetFilename = `${documentId}_${sanitizedFilename}`;
    const targetPath = path.resolve(uploadDir, targetFilename);

    if (!targetPath.startsWith(path.resolve(uploadDir))) {
      return sendError(res, 'Path traversal detected in upload filename.', 400);
    }

    await fs.promises.copyFile(tempPath, targetPath);
    writtenPath = targetPath;

    const pagesCount = await estimatePdfFilePageCount(targetPath);
    const fileSizeStr = formatFileSize(fileStats.size);

    const conn = await getConnection();
    let doc = null;
    try {
      await conn.beginTransaction();

      doc = await documentRepository.createDocument(
        {
          document_id: documentId,
          filename: sanitizedFilename,
          sha256,
          path: targetPath,
          pages_count: pagesCount,
          doc_type: 'user_upload',
          split: 'none',
          status: 'queued',
          metadata: {
            category: 'User Upload',
            file_size: fileSizeStr,
            parsing_accuracy: 0.0,
            is_degraded: false,
            extraction_status: 'Queued',
            indexing_status: 'Pending',
            chunk_count: 0
          }
        },
        { connection: conn }
      );

      await jobRepository.createJob(
        {
          doc_id: doc.id,
          mode: 'flat',
          status: 'queued'
        },
        { connection: conn }
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      if (writtenPath) {
        await safeUnlinkFile(writtenPath, 'upload_transaction_failed');
      }
      const isDupSha =
        (txErr.name === 'DuplicateDocumentError' && txErr.field === 'sha256') ||
        (txErr.code === 'ER_DUP_ENTRY' && String(txErr.message).includes('sha256')) ||
        String(txErr.message).includes('SHA-256');
      if (isDupSha) {
        const raceDoc = await documentRepository.findBySha256(sha256);
        if (raceDoc) {
          releaseAllocatedDocumentId(allocatedDocId);
          allocatedDocId = null;
          return sendSuccess(
            res,
            serializeDocument(raceDoc),
            'Document already exists in repository (duplicate SHA-256)',
            200
          );
        }
      }
      throw txErr;
    } finally {
      conn.release();
    }

    releaseAllocatedDocumentId(allocatedDocId);
    allocatedDocId = null;

    return sendSuccess(
      res,
      serializeDocument(doc),
      'Document uploaded and queued for processing',
      201
    );
  } catch (err) {
    if (allocatedDocId) {
      releaseAllocatedDocumentId(allocatedDocId);
    }
    if (writtenPath) {
      await safeUnlinkFile(writtenPath, 'upload_failed');
    }
    return next(err);
  } finally {
    if (tempPath) {
      await safeUnlinkFile(tempPath, 'upload_temp_cleanup');
    }
  }
});

documentsRouter.post('/upload-batch', uploadConcurrencyGuard, uploadBatch, async (req, res, next) => {
  const tempFiles = req.files || [];
  const createdDocIds = [];
  const writtenPaths = [];
  try {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return sendError(res, 'No files provided in batch upload.', 400);
    }

    if (req.files.length > config.maxBatchFiles) {
      return sendError(
        res,
        `Batch file count (${req.files.length}) exceeds maximum limit of ${config.maxBatchFiles} files.`,
        400
      );
    }

    const batchId = `batch_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const items = [];
    let successfulCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;

    const uploadDir = getUploadDir();
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const seenHashesInBatch = new Map();

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const tempPath = file.path;
      const originalName = file.originalname || `uploaded_${i + 1}.pdf`;

      let fileSizeStr = '0 B';
      let fileSizeBytes = 0;
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          const st = await fs.promises.stat(tempPath);
          fileSizeBytes = st.size;
          fileSizeStr = formatFileSize(st.size);
        } catch {}
      }

      if (!originalName.toLowerCase().endsWith('.pdf')) {
        failedCount++;
        items.push({
          filename: originalName,
          document_id: null,
          file_hash: null,
          file_size: fileSizeStr,
          status: 'Failed',
          progress_percent: 0,
          error: `Invalid file extension for '${originalName}'. Only PDF files are supported.`,
          summary: null
        });
        continue;
      }

      if (
        originalName.includes('\0') ||
        originalName.includes('..') ||
        originalName.includes('/') ||
        originalName.includes('\\')
      ) {
        failedCount++;
        items.push({
          filename: originalName,
          document_id: null,
          file_hash: null,
          file_size: fileSizeStr,
          status: 'Failed',
          progress_percent: 0,
          error: 'Invalid or unsafe filename.',
          summary: null
        });
        continue;
      }

      const isPdfContent = await validatePdfFileContent(tempPath);
      if (!isPdfContent) {
        failedCount++;
        items.push({
          filename: originalName,
          document_id: null,
          file_hash: null,
          file_size: fileSizeStr,
          status: 'Failed',
          progress_percent: 0,
          error: "Invalid PDF binary header. Stream does not begin with '%PDF-'.",
          summary: null
        });
        continue;
      }

      const maxSizeBytes = Math.floor(config.maxUploadSizeMb * 1024 * 1024);
      if (fileSizeBytes > maxSizeBytes) {
        failedCount++;
        items.push({
          filename: originalName,
          document_id: null,
          file_hash: null,
          file_size: fileSizeStr,
          status: 'Failed',
          progress_percent: 0,
          error: `File exceeds maximum allowed size of ${config.maxUploadSizeMb}MB.`,
          summary: null
        });
        continue;
      }

      const sha256 = await streamFileSha256(tempPath);

      if (seenHashesInBatch.has(sha256)) {
        duplicateCount++;
        const prevDoc = seenHashesInBatch.get(sha256);
        items.push({
          filename: originalName,
          document_id: prevDoc.document_id,
          file_hash: sha256,
          file_size: fileSizeStr,
          status: 'Duplicate',
          progress_percent: 100,
          error: null,
          summary: prevDoc
        });
        continue;
      }

      const existingDoc = await documentRepository.findBySha256(sha256);
      if (existingDoc) {
        duplicateCount++;
        const serializedExisting = serializeDocument(existingDoc);
        seenHashesInBatch.set(sha256, serializedExisting);
        items.push({
          filename: originalName,
          document_id: existingDoc.document_id,
          file_hash: sha256,
          file_size: existingDoc.metadata?.file_size || fileSizeStr,
          status: 'Duplicate',
          progress_percent: 100,
          error: null,
          summary: serializedExisting
        });
        continue;
      }

      let filePath = null;
      let allocatedDocId = null;
      try {
        const customBatchPrefix =
          process.env.NODE_ENV === 'test' && req.headers['x-batch-prefix']
            ? String(req.headers['x-batch-prefix']).trim()
            : null;

        allocatedDocId = customBatchPrefix
          ? `${customBatchPrefix}-${i + 1}`
          : await allocateNextDocumentId();
        createdDocIds.push(allocatedDocId);
        const documentId = allocatedDocId;

        const sanitizedFilename = sanitizeFilename(originalName);
        const targetFilename = `${documentId}_${sanitizedFilename}`;
        const targetPath = path.resolve(uploadDir, targetFilename);

        if (!targetPath.startsWith(path.resolve(uploadDir))) {
          throw new Error('Path traversal detected');
        }

        await fs.promises.copyFile(tempPath, targetPath);
        filePath = targetPath;
        writtenPaths.push(targetPath);

        const pagesCount = await estimatePdfFilePageCount(targetPath);

        const conn = await getConnection();
        let doc = null;
        try {
          await conn.beginTransaction();

          doc = await documentRepository.createDocument(
            {
              document_id: documentId,
              filename: sanitizedFilename,
              sha256,
              path: targetPath,
              pages_count: pagesCount,
              doc_type: 'user_upload',
              split: 'none',
              status: 'queued',
              metadata: {
                category: 'User Upload',
                file_size: fileSizeStr,
                parsing_accuracy: 0.0,
                is_degraded: false,
                extraction_status: 'Queued',
                indexing_status: 'Pending',
                chunk_count: 0
              }
            },
            { connection: conn }
          );

          await jobRepository.createJob(
            {
              doc_id: doc.id,
              mode: 'flat',
              status: 'queued'
            },
            { connection: conn }
          );

          await conn.commit();
        } catch (dbTxErr) {
          await conn.rollback().catch(() => {});
          if (filePath) {
            await fs.promises.unlink(filePath).catch(() => {});
          }
          const isDupSha =
            (dbTxErr.name === 'DuplicateDocumentError' && dbTxErr.field === 'sha256') ||
            (dbTxErr.code === 'ER_DUP_ENTRY' && String(dbTxErr.message).includes('sha256')) ||
            String(dbTxErr.message).includes('SHA-256');
          if (isDupSha) {
            const raceDoc = await documentRepository.findBySha256(sha256);
            if (raceDoc) {
              duplicateCount++;
              const serializedRace = serializeDocument(raceDoc);
              seenHashesInBatch.set(sha256, serializedRace);
              items.push({
                filename: originalName,
                document_id: raceDoc.document_id,
                file_hash: sha256,
                file_size: raceDoc.metadata?.file_size || fileSizeStr,
                status: 'Duplicate',
                progress_percent: 100,
                error: null,
                summary: serializedRace
              });
              continue;
            }
          }
          throw dbTxErr;
        } finally {
          conn.release();
        }

        releaseAllocatedDocumentId(allocatedDocId);

        successfulCount++;
        const serialized = serializeDocument(doc);
        seenHashesInBatch.set(sha256, serialized);
        items.push({
          filename: originalName,
          document_id: documentId,
          file_hash: sha256,
          file_size: fileSizeStr,
          status: 'Queued',
          progress_percent: 50,
          error: null,
          summary: serialized
        });
      } catch (fileErr) {
        if (allocatedDocId) {
          releaseAllocatedDocumentId(allocatedDocId);
        }
        if (filePath) {
          await safeUnlinkFile(filePath, 'batch_item_failed');
        }
        failedCount++;
        items.push({
          filename: originalName,
          document_id: null,
          file_hash: sha256,
          file_size: fileSizeStr,
          status: 'Failed',
          progress_percent: 0,
          error: fileErr.message || 'Error processing file',
          summary: null
        });
      }
    }

    const batchData = {
      batch_id: batchId,
      total_files: req.files.length,
      successful_count: successfulCount,
      failed_count: failedCount,
      duplicate_count: duplicateCount,
      items
    };

    return sendSuccess(
      res,
      batchData,
      `Batch processed: ${successfulCount} queued, ${failedCount} failed, ${duplicateCount} duplicate`,
      201
    );
  } catch (err) {
    return next(err);
  } finally {
    for (const f of tempFiles) {
      if (f.path) {
        await safeUnlinkFile(f.path, 'batch_temp_cleanup');
      }
    }
    for (const id of createdDocIds) {
      releaseAllocatedDocumentId(id);
    }
  }
});

documentsRouter.get('/:id', async (req, res, next) => {
  try {
    const documentId = req.params.id;
    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      return sendError(res, 'Invalid document ID parameter', 400);
    }

    const doc = await documentRepository.findByDocumentId(documentId.trim());
    if (!doc) {
      return sendError(res, `Document with ID '${documentId}' not found`, 404);
    }

    return sendSuccess(res, serializeDocument(doc), 'Document retrieved successfully', 200);
  } catch (err) {
    return next(err);
  }
});

documentsRouter.delete('/:id', async (req, res, next) => {
  let conn = null;
  let doc = null;
  try {
    const documentId = req.params.id;
    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      return sendError(res, 'Invalid document ID parameter', 400);
    }

    const trimmedId = documentId.trim();

    const preliminaryDoc = await documentRepository.findByDocumentId(trimmedId, { includeDeleted: true });
    if (!preliminaryDoc) {
      return sendError(res, `Document with ID '${documentId}' not found`, 404);
    }

    if (preliminaryDoc.deleted_at !== null) {
      if (preliminaryDoc.path) {
        await safeUnlinkFile(preliminaryDoc.path, 'document_already_deleted_retry', { docId: preliminaryDoc.id });
      }
      return sendError(res, `Document with ID '${documentId}' is already deleted`, 404);
    }

    conn = await getConnection();
    await conn.beginTransaction();

    const [jobIdRows] = await conn.query(
      `SELECT id FROM jobs WHERE doc_id = ? ORDER BY id ASC`,
      [preliminaryDoc.id]
    );
    const jobIds = jobIdRows.map((row) => row.id);
    let jobRows = [];
    if (jobIds.length > 0) {
      const [lockedJobRows] = await conn.query(
        `SELECT * FROM jobs WHERE id IN (?) ORDER BY id ASC FOR UPDATE`,
        [jobIds]
      );
      jobRows = lockedJobRows;
    }

    if (typeof _testDeleteHook?.afterJobLock === 'function' && process.env.NODE_ENV === 'test') {
      await _testDeleteHook.afterJobLock(preliminaryDoc, conn);
    }

    const hasRunningJob = jobRows.some((j) => j.status === 'running');
    if (hasRunningJob) {
      await conn.rollback();
      return sendError(
        res,
        `Cannot delete document '${preliminaryDoc.document_id}' while an ingestion job is actively running.`,
        409
      );
    }

    const [docRows] = await conn.query(
      `SELECT * FROM documents WHERE id = ? FOR UPDATE`,
      [preliminaryDoc.id]
    );

    if (!docRows || docRows.length === 0) {
      await conn.rollback();
      return sendError(res, `Document with ID '${documentId}' not found`, 404);
    }

    doc = docRows[0];

    if (doc.deleted_at !== null) {
      await conn.rollback();
      if (doc.path) {
        await safeUnlinkFile(doc.path, 'document_already_deleted_retry', { docId: doc.id });
      }
      return sendError(res, `Document with ID '${documentId}' is already deleted`, 404);
    }

    if (jobIds.length > 0) {
      await conn.query(
        `UPDATE jobs
         SET status = 'failed',
             error = 'Document deleted before processing',
             locked_by = NULL,
             locked_at = NULL,
             heartbeat_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id IN (?) AND status = 'queued'`,
        [jobIds]
      );
    }

    await conn.query(
      `UPDATE documents
       SET deleted_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [doc.id]
    );

    if (typeof _testDeleteHook?.afterLock === 'function' && process.env.NODE_ENV === 'test') {
      await _testDeleteHook.afterLock(doc, conn);
    }

    await conn.commit();
  } catch (err) {
    if (conn) {
      await conn.rollback().catch(() => {});
    }
    return next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }

  if (doc?.path) {
    await safeUnlinkFile(doc.path, 'document_deleted', { docId: doc.id });
  }

  return sendSuccess(
    res,
    {
      document_id: doc.document_id,
      deleted: true
    },
    `Document '${doc.document_id}' deleted and purged from vector index.`,
    200
  );
});

async function handleGetPageSegments(req, res, next) {
  try {
    const documentId = req.params.id;
    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      return sendError(res, 'Invalid document ID parameter', 400);
    }

    const pageParam = Number(req.params.page);
    if (!Number.isInteger(pageParam) || pageParam < 1) {
      return sendError(res, 'Invalid page parameter. Must be an integer >= 1.', 400);
    }

    let mode = undefined;
    if (req.query.mode !== undefined) {
      const modeVal = String(req.query.mode).trim();
      if (!VALID_MODES.has(modeVal)) {
        return sendError(
          res,
          `Invalid mode '${modeVal}'. Allowed modes: ${Array.from(VALID_MODES).join(', ')}`,
          400
        );
      }
      mode = modeVal;
    }

    const doc = await documentRepository.findByDocumentId(documentId.trim());
    if (!doc) {
      return sendError(res, `Document with ID '${documentId}' not found`, 404);
    }

    const elements = await elementRepository.findByPage(
      doc.id,
      pageParam,
      mode ? { mode } : {}
    );

    const serialized = elements.map(serializeElement);
    return sendSuccess(
      res,
      serialized,
      `Retrieved ${serialized.length} layout segments for page ${pageParam}`,
      200
    );
  } catch (err) {
    return next(err);
  }
}

documentsRouter.get('/:id/pages/:page/segments', handleGetPageSegments);
documentsRouter.get('/:id/pages/:page', handleGetPageSegments);
