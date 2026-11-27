import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import * as jobRepository from '../db/repositories/jobRepository.js';
import { collectPersistedDocumentsForRecovery } from '../services/recoveryService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const internalRecoveryRouter = Router();

function verifyInternalSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }
  const a = Buffer.from(provided.trim(), 'utf8');
  const b = Buffer.from(expected.trim(), 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

internalRecoveryRouter.get('/recovery/documents', async (req, res, next) => {
  try {
    const expectedSecret = (process.env.INTERNAL_API_SECRET || config.internalApiSecret || '').trim();
    const providedSecret = req.headers['x-internal-secret'];
    if (!verifyInternalSecret(typeof providedSecret === 'string' ? providedSecret : '', expectedSecret)) {
      return sendError(res, 'Unauthorized internal recovery request.', 401);
    }
    const payload = await collectPersistedDocumentsForRecovery();
    return sendSuccess(
      res,
      payload,
      `Prepared ${payload.documents.length} persisted document(s) for FAISS recovery`,
      200
    );
  } catch (err) {
    return next(err);
  }
});

internalRecoveryRouter.post('/recovery/verify-index-ownership', async (req, res, next) => {
  try {
    const expectedSecret = (process.env.INTERNAL_API_SECRET || config.internalApiSecret || '').trim();
    const providedSecret = req.headers['x-internal-secret'];
    if (!verifyInternalSecret(typeof providedSecret === 'string' ? providedSecret : '', expectedSecret)) {
      return sendError(res, 'Unauthorized internal ownership verification request.', 401);
    }
    const result = await jobRepository.verifyIndexOwnershipForDocument(req.body || {});
    return sendSuccess(
      res,
      result,
      result.authorized ? 'Index ownership verified' : `Index ownership rejected: ${result.reason}`,
      200
    );
  } catch (err) {
    return next(err);
  }
});
