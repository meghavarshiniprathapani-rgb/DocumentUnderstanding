import { sanitizeError as sanitizePoolError } from '../db/pool.js';

const SECRET_ENV_KEYS = [
  'DB_PASSWORD',
  'INTERNAL_API_SECRET',
  'PYTHON_INTERNAL_API_SECRET',
  'API_SECRET',
  'JWT_SECRET',
];

export function collectKnownSecrets(env = process.env, extraSecrets = []) {
  const secrets = new Set();
  if (env && typeof env === 'object') {
    for (const key of SECRET_ENV_KEYS) {
      const val = env[key];
      if (typeof val === 'string' && val.length > 0) {
        secrets.add(val);
      }
    }
  }
  if (Array.isArray(extraSecrets)) {
    for (const val of extraSecrets) {
      if (typeof val === 'string' && val.length > 0) {
        secrets.add(val);
      }
    }
  }
  return Array.from(secrets);
}

export function scrubText(text, secrets = []) {
  if (typeof text !== 'string' || text.length === 0) return '';
  let result = text;
  for (const secret of secrets) {
    if (secret && typeof secret === 'string' && secret.length > 0) {
      result = result.split(secret).join('******');
    }
  }
  result = result.replace(
    /(password|pwd|secret|api_secret|internal_api_secret|internal_secret|x-internal-secret|token|authorization)\s*[:=]\s*[^\s,;'"&}]+/gi,
    '$1=******'
  );
  result = result.replace(/(bearer\s+)[^\s,;'"&}]+/gi, '$1******');
  result = result.replace(/(:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1******$2');
  return result;
}

export function sanitizeValue(value, secrets = [], seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value, secrets);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeWorkerError(value, secrets).message;
  if (typeof value !== 'object') return scrubText(String(value), secrets);

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets, seen));
  }

  const sanitizedObj = {};
  for (const [k, v] of Object.entries(value)) {
    if (/^(password|pwd|secret|api_?secret|internal_?api_?secret|x[-_]?internal[-_]?secret|token|authorization)$/i.test(k)) {
      sanitizedObj[k] = '******';
    } else {
      sanitizedObj[k] = sanitizeValue(v, secrets, seen);
    }
  }
  return sanitizedObj;
}

export function sanitizeWorkerError(err, extraSecrets = [], ErrorClass = null) {
  const secrets = collectKnownSecrets(process.env, extraSecrets);
  const pooled = sanitizePoolError(err, secrets[0] || null);
  const message = scrubText(pooled.message, secrets);

  const TargetError = ErrorClass || Error;
  const sanitized = new TargetError(message);
  if (!ErrorClass) {
    sanitized.name = err instanceof Error && err.name ? err.name : 'WorkerError';
  }
  if (pooled.code) sanitized.code = pooled.code;
  if (pooled.errno) sanitized.errno = pooled.errno;
  if (pooled.sqlState) sanitized.sqlState = pooled.sqlState;
  if (pooled.stack) sanitized.stack = scrubText(pooled.stack, secrets);
  if (pooled.cause) sanitized.cause = sanitizeWorkerError(pooled.cause, secrets);
  return sanitized;
}
