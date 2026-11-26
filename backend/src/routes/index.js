import { Router } from 'express';
import { healthRouter } from './health.js';
import { documentsRouter } from './documents.js';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/documents', documentsRouter);
