import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getUploadDir() {
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }
  return path.resolve(__dirname, '../../../data/uploads');
}

export function getTempUploadDir() {
  if (config.uploadTempDir) {
    return path.resolve(config.uploadTempDir);
  }
  if (process.env.UPLOAD_TEMP_DIR) {
    return path.resolve(process.env.UPLOAD_TEMP_DIR);
  }
  return path.resolve(getUploadDir(), 'tmp');
}

export function sanitizeFilename(rawFilename) {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return 'uploaded_document.pdf';
  }
  const base = path.basename(rawFilename).replace(/\0/g, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'uploaded_document.pdf';
  }
  return cleaned;
}

export function validatePdfContent(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 5) {
    return false;
  }
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export async function validatePdfFileContent(filePath) {
  let fd = null;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fd.read(buf, 0, 5, 0);
    if (bytesRead < 5) {
      return false;
    }
    return buf.toString('ascii') === '%PDF-';
  } catch {
    return false;
  } finally {
    if (fd) {
      await fd.close().catch(() => {});
    }
  }
}

export async function streamFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

export async function estimatePdfFilePageCount(filePath) {
  return new Promise((resolve) => {
    let count = 0;
    const stream = fs.createReadStream(filePath, { encoding: 'latin1' });
    stream.on('data', (chunk) => {
      const matches = chunk.match(/\/Type\s*\/Page\b/g);
      if (matches) {
        count += matches.length;
      }
    });
    stream.on('end', () => {
      resolve(count > 0 ? count : 1);
    });
    stream.on('error', () => {
      resolve(1);
    });
  });
}

export function estimatePdfPageCount(buffer) {
  try {
    const text = buffer.toString('binary');
    const matches = text.match(/\/Type\s*\/Page\b/g);
    if (matches && matches.length > 0) {
      return matches.length;
    }
  } catch {}
  return 1;
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

import {
  allocateNextDocumentId as dbAllocateNextDocumentId,
  releaseAllocatedDocumentId as dbReleaseAllocatedDocumentId,
  resetSequenceForTest,
  ensureSequenceTable
} from './sequenceAllocator.js';
import { safeUnlinkFile } from './cleanupQueue.js';

export { safeUnlinkFile, ensureSequenceTable, resetSequenceForTest };

export async function allocateNextDocumentId(connection = null) {
  return await dbAllocateNextDocumentId(connection);
}

export function releaseAllocatedDocumentId(documentId) {
  return dbReleaseAllocatedDocumentId(documentId);
}

export function resetAllocatedDocumentIds() {}

export async function generateNextDocumentId(connection = null) {
  return allocateNextDocumentId(connection);
}
