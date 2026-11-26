import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseCorsOrigins(rawOrigins) {
  if (!rawOrigins) {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
  }
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const config = {
  appName: process.env.APP_NAME || 'Retrieva AI Orchestrator',
  environment: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || process.env.EXPRESS_PORT) || 3001,
  host: process.env.HOST || '0.0.0.0',
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  configVersion: '1.0.0',
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB) || 50,
  maxBatchFiles: Number(process.env.MAX_BATCH_FILES) || 20,
  maxConcurrentUploads: Number(process.env.MAX_CONCURRENT_UPLOADS) || 5,
  uploadTempDir: process.env.UPLOAD_TEMP_DIR || '',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000',
  pythonServiceRequired: process.env.PYTHON_SERVICE_REQUIRED === 'true'
};

export default config;
