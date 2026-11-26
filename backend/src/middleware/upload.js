import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { getTempUploadDir } from '../utils/uploadHelpers.js';
import { sendError } from '../utils/response.js';

let activeUploadCount = 0;

export function uploadConcurrencyGuard(req, res, next) {
  if (activeUploadCount >= config.maxConcurrentUploads) {
    return sendError(
      res,
      `Upload concurrency limit reached (${config.maxConcurrentUploads} active uploads). Please retry later.`,
      429
    );
  }

  activeUploadCount++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeUploadCount = Math.max(0, activeUploadCount - 1);
    }
  };

  res.on('finish', release);
  res.on('close', release);
  next();
}

export function getActiveUploadCount() {
  return activeUploadCount;
}

export function resetActiveUploadCount() {
  activeUploadCount = 0;
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = getTempUploadDir();
    fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const randomHex = crypto.randomBytes(8).toString('hex');
    cb(null, `upload_${Date.now()}_${randomHex}.tmp`);
  }
});

export const uploadSingle = (req, res, next) => {
  const upload = multer({
    storage: diskStorage,
    limits: {
      fileSize: Math.floor(config.maxUploadSizeMb * 1024 * 1024),
      files: 1
    },
    preservePath: true
  });
  return upload.single('file')(req, res, next);
};

export const uploadBatch = (req, res, next) => {
  const upload = multer({
    storage: diskStorage,
    limits: {
      fileSize: Math.floor(config.maxUploadSizeMb * 1024 * 1024 * config.maxBatchFiles),
      files: config.maxBatchFiles
    },
    preservePath: true
  });
  return upload.array('files', config.maxBatchFiles)(req, res, next);
};
