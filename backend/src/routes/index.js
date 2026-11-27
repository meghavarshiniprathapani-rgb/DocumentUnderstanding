import { Router } from 'express';
import { healthRouter } from './health.js';
import { documentsRouter } from './documents.js';
import { searchRouter } from './search.js';
import { evaluationRouter } from './evaluation.js';
import { internalRecoveryRouter } from './internalRecovery.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/evaluation', evaluationRouter);
apiRouter.use('/internal', internalRecoveryRouter);
