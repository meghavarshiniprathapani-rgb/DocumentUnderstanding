import express from 'express';
import { config } from './config.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { timingMiddleware } from './middleware/timing.js';
import { structuredLoggerMiddleware } from './middleware/logger.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { notFoundHandler } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes/index.js';
import { sendSuccess } from './utils/response.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true);

  app.use(requestIdMiddleware);
  app.use(timingMiddleware);
  app.use(structuredLoggerMiddleware);
  app.use(createCorsMiddleware());

  const uploadLimit = `${config.maxUploadSizeMb}mb`;
  app.use(express.json({ limit: uploadLimit }));
  app.use(express.urlencoded({ extended: true, limit: uploadLimit }));

  app.get('/', (req, res) => {
    return sendSuccess(res, {
      service: config.appName,
      config_version: config.configVersion,
      api_v1: config.apiPrefix,
      health: `${config.apiPrefix}/health`,
      ready: `${config.apiPrefix}/ready`,
      documents: `${config.apiPrefix}/documents`
    }, 'Welcome to Retrieva AI Express Orchestrator');
  });

  app.use(config.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;
