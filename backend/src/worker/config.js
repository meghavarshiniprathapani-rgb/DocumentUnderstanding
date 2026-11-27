import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getDefaultDbConfig } from '../db/pool.js';
import { DEFAULT_MAX_RETRY_ATTEMPTS, MAX_WORKER_ID_LENGTH } from '../db/repositories/jobRepository.js';
import { collectKnownSecrets, scrubText } from './sanitize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const DEFAULT_WORKER_CONFIG = Object.freeze({
  concurrency: 1,
  pollIntervalMs: 2000,
  heartbeatIntervalMs: 15000,
  shutdownGraceMs: 30000,
  maxAttempts: DEFAULT_MAX_RETRY_ATTEMPTS,
  leaseRecoveryIntervalMs: 30000,
  leaseRecoveryBatchSize: 25,
  pollErrorBackoffMs: 500,
  maxPollErrorBackoffMs: 30000,
  mode: undefined,
  pythonServiceUrl: 'http://127.0.0.1:8000',
  pythonExtractionTimeoutMs: 60000,
});

const MAX_WORKER_CONCURRENCY = 64;
const MIN_POLL_INTERVAL_MS = 10;
const MAX_POLL_INTERVAL_MS = 300000;
const MIN_HEARTBEAT_INTERVAL_MS = 10;
const MAX_HEARTBEAT_INTERVAL_MS = 300000;
const MAX_SHUTDOWN_GRACE_MS = 600000;
const MAX_RETRY_ATTEMPTS_LIMIT = 20;
const MIN_LEASE_RECOVERY_INTERVAL_MS = 20;
const MAX_LEASE_RECOVERY_INTERVAL_MS = 3600000;
const MIN_LEASE_RECOVERY_BATCH_SIZE = 1;
const MAX_LEASE_RECOVERY_BATCH_SIZE = 100;
const MIN_BACKOFF_MS = 10;
const MAX_BACKOFF_LIMIT_MS = 300000;
const MIN_PYTHON_EXTRACTION_TIMEOUT_MS = 100;
const MAX_PYTHON_EXTRACTION_TIMEOUT_MS = 600000;

export class WorkerConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkerConfigError';
    this.code = 'ERR_WORKER_CONFIG';
  }
}

export function generateWorkerId(hostname = os.hostname()) {
  const rawHost = typeof hostname === 'string' && hostname.trim() ? hostname.trim() : 'host';
  const safeHost = rawHost.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || 'host';
  const suffix = crypto.randomBytes(2).toString('hex');
  return `worker_${safeHost}_${process.pid}_${suffix}`.slice(0, MAX_WORKER_ID_LENGTH);
}

function parseIntegerSetting(name, rawValue, defaultValue, min, max, secrets) {
  if (rawValue === undefined) {
    return defaultValue;
  }
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed || !/^-?\d+$/.test(trimmed)) {
      throw new WorkerConfigError(`Invalid ${name}: expected integer between ${min} and ${max}.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new WorkerConfigError(
        scrubText(`Invalid ${name}: must be between ${min} and ${max}.`, secrets)
      );
    }
    return parsed;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < min || rawValue > max) {
    throw new WorkerConfigError(`Invalid ${name}: must be an integer between ${min} and ${max}.`);
  }
  return rawValue;
}

function resolveWorkerId(rawOverride, envWorkerId, secrets) {
  const candidate = rawOverride !== undefined ? rawOverride : envWorkerId;
  if (candidate === undefined) {
    return generateWorkerId();
  }
  if (typeof candidate !== 'string') {
    throw new WorkerConfigError('Invalid WORKER_ID: must be a non-empty string.');
  }
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_WORKER_ID_LENGTH || /[\r\n\0]/.test(trimmed)) {
    throw new WorkerConfigError(
      scrubText(
        `Invalid WORKER_ID: must be between 1 and ${MAX_WORKER_ID_LENGTH} printable characters.`,
        secrets
      )
    );
  }
  return trimmed;
}

function resolveModeFilter(rawMode) {
  if (rawMode === undefined || rawMode === null || rawMode === '') {
    return undefined;
  }
  if (typeof rawMode !== 'string') {
    throw new WorkerConfigError('Invalid WORKER_MODE: must be a string when specified.');
  }
  const trimmed = rawMode.trim();
  const validModes = new Set(['flat', 'reference', 'candidate', 'candidate_ft']);
  if (!validModes.has(trimmed)) {
    throw new WorkerConfigError(
      `Invalid WORKER_MODE '${trimmed}': expected one of flat, reference, candidate, candidate_ft.`
    );
  }
  return trimmed;
}

function resolvePythonServiceUrl(rawUrl, defaultUrl, secrets) {
  const candidate = rawUrl !== undefined ? rawUrl : defaultUrl;
  if (typeof candidate !== 'string') {
    throw new WorkerConfigError('Invalid PYTHON_SERVICE_URL: must be a non-empty http or https URL.');
  }
  const trimmed = candidate.trim();
  if (!trimmed || /[\s\r\n\0]/.test(trimmed)) {
    throw new WorkerConfigError(
      scrubText('Invalid PYTHON_SERVICE_URL: must be a valid single-line URL without whitespace.', secrets)
    );
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WorkerConfigError(
      scrubText(`Invalid PYTHON_SERVICE_URL '${trimmed}': expected valid http or https URL.`, secrets)
    );
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new WorkerConfigError('Invalid PYTHON_SERVICE_URL: must use http or https protocol with a host.');
  }
  if (parsed.username || parsed.password) {
    throw new WorkerConfigError('Invalid PYTHON_SERVICE_URL: embedded credentials are not allowed.');
  }
  if (parsed.search || parsed.hash) {
    throw new WorkerConfigError('Invalid PYTHON_SERVICE_URL: query strings and fragments are not allowed.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function resolveInternalApiSecret(rawOverride, envSecret, required, secrets) {
  const candidate = rawOverride !== undefined ? rawOverride : envSecret;
  if (candidate === undefined || candidate === null) {
    if (required) {
      throw new WorkerConfigError('Invalid INTERNAL_API_SECRET: must be configured and non-empty.');
    }
    return undefined;
  }
  if (typeof candidate !== 'string') {
    throw new WorkerConfigError('Invalid INTERNAL_API_SECRET: must be a non-empty string.');
  }
  const trimmed = candidate.trim();
  if (!trimmed || /[\r\n\0]/.test(candidate)) {
    throw new WorkerConfigError(
      scrubText('Invalid INTERNAL_API_SECRET: must be a non-empty single-line string.', secrets)
    );
  }
  return trimmed;
}

export function loadWorkerConfig(overrides = {}, env = process.env, options = {}) {
  const safeOverrides = overrides && typeof overrides === 'object' ? overrides : {};
  const safeEnv = env && typeof env === 'object' ? env : {};
  const safeOptions = options && typeof options === 'object' ? options : {};
  const requireInternalApiSecret =
    safeOptions.requireInternalApiSecret !== undefined ? Boolean(safeOptions.requireInternalApiSecret) : true;
  const secrets = collectKnownSecrets(
    safeEnv,
    typeof safeOverrides.internalApiSecret === 'string' && safeOverrides.internalApiSecret.length > 0
      ? [safeOverrides.internalApiSecret]
      : []
  );

  const workerId = resolveWorkerId(safeOverrides.workerId, safeEnv.WORKER_ID, secrets);
  const concurrency = parseIntegerSetting(
    'WORKER_CONCURRENCY',
    safeOverrides.concurrency !== undefined ? safeOverrides.concurrency : safeEnv.WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONFIG.concurrency,
    1,
    MAX_WORKER_CONCURRENCY,
    secrets
  );
  const pollIntervalMs = parseIntegerSetting(
    'WORKER_POLL_INTERVAL_MS',
    safeOverrides.pollIntervalMs !== undefined
      ? safeOverrides.pollIntervalMs
      : safeEnv.WORKER_POLL_INTERVAL_MS,
    DEFAULT_WORKER_CONFIG.pollIntervalMs,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
    secrets
  );
  const heartbeatIntervalMs = parseIntegerSetting(
    'WORKER_HEARTBEAT_INTERVAL_MS',
    safeOverrides.heartbeatIntervalMs !== undefined
      ? safeOverrides.heartbeatIntervalMs
      : safeEnv.WORKER_HEARTBEAT_INTERVAL_MS,
    DEFAULT_WORKER_CONFIG.heartbeatIntervalMs,
    MIN_HEARTBEAT_INTERVAL_MS,
    MAX_HEARTBEAT_INTERVAL_MS,
    secrets
  );
  const shutdownGraceMs = parseIntegerSetting(
    'WORKER_SHUTDOWN_GRACE_MS',
    safeOverrides.shutdownGraceMs !== undefined
      ? safeOverrides.shutdownGraceMs
      : safeEnv.WORKER_SHUTDOWN_GRACE_MS,
    DEFAULT_WORKER_CONFIG.shutdownGraceMs,
    0,
    MAX_SHUTDOWN_GRACE_MS,
    secrets
  );
  const maxAttempts = parseIntegerSetting(
    'WORKER_MAX_ATTEMPTS',
    safeOverrides.maxAttempts !== undefined ? safeOverrides.maxAttempts : safeEnv.WORKER_MAX_ATTEMPTS,
    DEFAULT_WORKER_CONFIG.maxAttempts,
    1,
    MAX_RETRY_ATTEMPTS_LIMIT,
    secrets
  );
  const pollErrorBackoffMs = parseIntegerSetting(
    'WORKER_POLL_BACKOFF_INITIAL_MS',
    safeOverrides.pollErrorBackoffMs !== undefined
      ? safeOverrides.pollErrorBackoffMs
      : safeEnv.WORKER_POLL_BACKOFF_INITIAL_MS,
    DEFAULT_WORKER_CONFIG.pollErrorBackoffMs,
    MIN_BACKOFF_MS,
    MAX_BACKOFF_LIMIT_MS,
    secrets
  );
  const maxPollErrorBackoffMs = parseIntegerSetting(
    'WORKER_POLL_BACKOFF_MAX_MS',
    safeOverrides.maxPollErrorBackoffMs !== undefined
      ? safeOverrides.maxPollErrorBackoffMs
      : safeEnv.WORKER_POLL_BACKOFF_MAX_MS,
    DEFAULT_WORKER_CONFIG.maxPollErrorBackoffMs,
    MIN_BACKOFF_MS,
    MAX_BACKOFF_LIMIT_MS,
    secrets
  );

  if (maxPollErrorBackoffMs < pollErrorBackoffMs) {
    throw new WorkerConfigError(
      'Invalid WORKER_POLL_BACKOFF_MAX_MS: must be greater than or equal to WORKER_POLL_BACKOFF_INITIAL_MS.'
    );
  }

  const mode = resolveModeFilter(safeOverrides.mode !== undefined ? safeOverrides.mode : safeEnv.WORKER_MODE);
  const pythonServiceUrl = resolvePythonServiceUrl(
    safeOverrides.pythonServiceUrl !== undefined
      ? safeOverrides.pythonServiceUrl
      : safeEnv.PYTHON_SERVICE_URL,
    DEFAULT_WORKER_CONFIG.pythonServiceUrl,
    secrets
  );
  const pythonExtractionTimeoutMs = parseIntegerSetting(
    'PYTHON_EXTRACTION_TIMEOUT_MS',
    safeOverrides.pythonExtractionTimeoutMs !== undefined
      ? safeOverrides.pythonExtractionTimeoutMs
      : safeEnv.PYTHON_EXTRACTION_TIMEOUT_MS,
    DEFAULT_WORKER_CONFIG.pythonExtractionTimeoutMs,
    MIN_PYTHON_EXTRACTION_TIMEOUT_MS,
    MAX_PYTHON_EXTRACTION_TIMEOUT_MS,
    secrets
  );
  const leaseRecoveryIntervalMs = parseIntegerSetting(
    'WORKER_LEASE_RECOVERY_INTERVAL_MS',
    safeOverrides.leaseRecoveryIntervalMs !== undefined
      ? safeOverrides.leaseRecoveryIntervalMs
      : safeEnv.WORKER_LEASE_RECOVERY_INTERVAL_MS,
    DEFAULT_WORKER_CONFIG.leaseRecoveryIntervalMs,
    MIN_LEASE_RECOVERY_INTERVAL_MS,
    MAX_LEASE_RECOVERY_INTERVAL_MS,
    secrets
  );
  const leaseRecoveryBatchSize = parseIntegerSetting(
    'WORKER_LEASE_RECOVERY_BATCH_SIZE',
    safeOverrides.leaseRecoveryBatchSize !== undefined
      ? safeOverrides.leaseRecoveryBatchSize
      : safeEnv.WORKER_LEASE_RECOVERY_BATCH_SIZE,
    DEFAULT_WORKER_CONFIG.leaseRecoveryBatchSize,
    MIN_LEASE_RECOVERY_BATCH_SIZE,
    MAX_LEASE_RECOVERY_BATCH_SIZE,
    secrets
  );
  const internalApiSecret = resolveInternalApiSecret(
    safeOverrides.internalApiSecret,
    safeEnv.INTERNAL_API_SECRET,
    requireInternalApiSecret,
    secrets
  );

  const defaultDb = getDefaultDbConfig();
  const dbHost =
    safeEnv.DB_HOST !== undefined ? String(safeEnv.DB_HOST).trim() : String(defaultDb.host || '').trim();
  const dbUser =
    safeEnv.DB_USER !== undefined ? String(safeEnv.DB_USER).trim() : String(defaultDb.user || '').trim();
  const dbName =
    safeEnv.DB_NAME !== undefined ? String(safeEnv.DB_NAME).trim() : String(defaultDb.database || '').trim();
  const dbPort = parseIntegerSetting(
    'DB_PORT',
    safeEnv.DB_PORT !== undefined ? safeEnv.DB_PORT : defaultDb.port,
    3306,
    1,
    65535,
    secrets
  );

  if (!dbHost) {
    throw new WorkerConfigError('Invalid DB_HOST: database host must not be empty.');
  }
  if (!dbUser) {
    throw new WorkerConfigError('Invalid DB_USER: database user must not be empty.');
  }
  if (!dbName) {
    throw new WorkerConfigError('Invalid DB_NAME: database name must not be empty.');
  }

  const configObj = {
    workerId,
    concurrency,
    pollIntervalMs,
    heartbeatIntervalMs,
    shutdownGraceMs,
    maxAttempts,
    pollErrorBackoffMs,
    maxPollErrorBackoffMs,
    mode,
    pythonServiceUrl,
    pythonExtractionTimeoutMs,
    leaseRecoveryIntervalMs,
    leaseRecoveryBatchSize,
    internalApiSecretConfigured: Boolean(internalApiSecret),
    dbHost,
    dbPort,
    dbName,
  };
  Object.defineProperty(configObj, 'internalApiSecret', {
    value: internalApiSecret,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(configObj);
}
