import fs from 'node:fs';
import { sendError } from '../utils/response.js';
import { sanitizeError } from '../db/pool.js';
import { config } from '../config.js';

export function errorHandler(err, req, res, next) {
  if (req.file?.path && fs.existsSync(req.file.path)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
  }
  if (Array.isArray(req.files)) {
    for (const f of req.files) {
      if (f.path && fs.existsSync(f.path)) {
        try {
          fs.unlinkSync(f.path);
        } catch {}
      }
    }
  }

  if (res.headersSent) {
    return next(err);
  }

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return sendError(
      res,
      `File exceeds maximum allowed size of ${config.maxUploadSizeMb}MB.`,
      413
    );
  }

  if (
    err &&
    (err.code === 'LIMIT_FILE_COUNT' ||
      (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'files'))
  ) {
    return sendError(
      res,
      `Batch file count exceeds maximum allowed limit of ${config.maxBatchFiles} files.`,
      400
    );
  }

  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return sendError(res, 'Unexpected multipart form field.', 400);
  }

  if (err && (err.message === 'Malformed part header' || err.message?.includes('Boundary not found'))) {
    return sendError(res, 'Invalid or unsafe filename or multipart headers.', 400);
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 'Malformed JSON payload in request body', 400);
  }

  if (err.message && err.message.includes('not allowed by CORS')) {
    return sendError(res, 'Cross-Origin Resource Sharing (CORS) origin not allowed', 403);
  }

  const sanitized = sanitizeError(err);
  const statusCode = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;

  return sendError(res, sanitized.message || 'Internal server error', statusCode);
}
