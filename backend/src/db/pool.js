/**
 * Retrieva AI — Centralized MySQL Connection Pool (AIML-59 / M1.4 & M1.4.1)
 * 
 * Features & Invariants:
 * 1. Managed connection pool using mysql2/promise with strict limits:
 *    - connectionLimit: 5
 *    - waitForConnections: true
 *    - queueLimit: 20
 *    - connectTimeout: 10000ms (10s connection establishment timeout)
 *    - acquireTimeout: 10000ms (pool acquisition timeout preventing indefinite queuing)
 *    - enableKeepAlive: true, keepAliveInitialDelay: 0
 * 2. Leak-proof pool acquisition timeout handling:
 *    - Distinguishes connectTimeout (TCP/handshake) from acquireTimeout (pool queue wait).
 *    - If acquisition times out, resolution of the pending queue checkout immediately
 *      releases the connection back to the pool, preventing connection leaks.
 * 3. Deep credential sanitization (zero credential leakage):
 *    - Recursively sanitizes error messages, stack traces, and nested `err.cause`.
 *    - Strips raw passwords, credential URIs, and sensitive connection configuration.
 *    - Preserves safe diagnostic codes (err.code, err.errno, err.sqlState).
 *    - SQL query parameter values are strictly never logged.
 * 4. Idempotent pool lifecycle:
 *    - Atomic singleton initialization.
 *    - Concurrent shutdown and query operations behave predictably.
 *    - Safe reinitialization after failed attempts or shutdown.
 * 5. Standalone dedicated connections for migrations and advisory locks:
 *    - Dedicated connections strictly isolated from pooled connections.
 *    - Advisory locks (`GET_LOCK` / `RELEASE_LOCK`) maintain session-level semantics.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Diagnostic error thrown when connection pool acquisition exceeds timeout.
 */
export class PoolAcquisitionTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoolAcquisitionTimeoutError';
    this.code = 'ERR_POOL_ACQUISITION_TIMEOUT';
  }
}

/**
 * Returns default database configuration object from environment variables.
 */
export function getDefaultDbConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'docuretrieve_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'docuretrieve',
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 20,
    connectTimeout: Number(process.env.DB_TIMEOUT_MS) || 10000,
    acquireTimeout: Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: 'utf8mb4',
  };
}

// Module-level singleton state
let poolInstance = null;
let isPoolClosed = false;
let isPoolClosing = false;
let closingPromise = null;

/**
 * Sanitizes errors, messages, stack traces, and nested causes to ensure database
 * credentials and passwords are never leaked in logs, metrics, or API responses.
 * 
 * Preserves safe diagnostic metadata (err.code, err.errno, err.sqlState).
 * 
 * @param {Error|any} err
 * @param {string} [customSecret] - Optional extra secret to sanitize
 * @returns {Error}
 */
export function sanitizeError(err, customSecret = null) {
  if (!err) return new Error('Unknown database error');

  const errorObj = err instanceof Error ? err : new Error(String(err));
  const secrets = [];

  if (process.env.DB_PASSWORD) secrets.push(process.env.DB_PASSWORD);
  if (customSecret) secrets.push(customSecret);

  // Helper to strip secrets from text
  const scrubText = (text) => {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const secret of secrets) {
      if (secret && typeof secret === 'string' && secret.length > 0) {
        result = result.split(secret).join('******');
      }
    }
    // Mask password=xxx, password: xxx, pwd=xxx
    result = result.replace(/(password|pwd)\s*[:=]\s*[^\s,;&]+/gi, '$1=******');
    // Mask URIs with credentials ://user:password@
    result = result.replace(/(:\/\/[^:]+:)[^@]+(@)/gi, '$1******$2');
    return result;
  };

  const sanitized = new Error(scrubText(errorObj.message));
  sanitized.name = errorObj.name || 'DatabaseError';

  // Preserve safe operational codes
  if (errorObj.code) sanitized.code = errorObj.code;
  if (errorObj.errno) sanitized.errno = errorObj.errno;
  if (errorObj.sqlState) sanitized.sqlState = errorObj.sqlState;

  // Clean stack trace
  if (errorObj.stack) {
    sanitized.stack = scrubText(errorObj.stack);
  }

  // Recursively sanitize nested error causes (Node.js 16.9+)
  if (errorObj.cause) {
    sanitized.cause = sanitizeError(errorObj.cause, customSecret);
  }

  // Ensure raw connection configs with passwords are never retained
  if (errorObj.config) {
    sanitized.config = {
      host: errorObj.config.host,
      port: errorObj.config.port,
      user: errorObj.config.user,
      database: errorObj.config.database,
      password: '******',
    };
  }

  return sanitized;
}

/**
 * Gets or initializes the singleton database pool.
 * 
 * @param {Object} [customConfig] - Optional custom configuration
 * @param {Object} [options]
 * @param {boolean} [options.reinitialize=false] - Reset closed state and recreate pool
 * @returns {import('mysql2/promise').Pool}
 */
export function getPool(customConfig = null, options = {}) {
  if (options.reinitialize || options.forceNew) {
    if (poolInstance) {
      try {
        poolInstance.end().catch(() => {});
      } catch {
        // ignore sync throw
      }
      poolInstance = null;
    }
    isPoolClosed = false;
    isPoolClosing = false;
    closingPromise = null;
  }

  if (isPoolClosed || isPoolClosing) {
    throw new Error('Database pool is closed.');
  }

  if (!poolInstance || customConfig) {
    const config = customConfig
      ? { ...getDefaultDbConfig(), ...customConfig }
      : getDefaultDbConfig();

    try {
      poolInstance = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: config.connectionLimit,
        waitForConnections: config.waitForConnections,
        queueLimit: config.queueLimit,
        connectTimeout: config.connectTimeout,
        enableKeepAlive: config.enableKeepAlive,
        keepAliveInitialDelay: config.keepAliveInitialDelay,
        charset: config.charset,
      });
    } catch (err) {
      throw sanitizeError(err, customConfig?.password);
    }
  }

  return poolInstance;
}

/**
 * Acquires a connection from the pool with an explicit acquisition timeout.
 * 
 * CRITICAL LEAK-PREVENTION INVARIANT:
 * If the acquisition timer fires while waiting in the pool queue, the request is rejected
 * with PoolAcquisitionTimeoutError. When mysql2 later resolves the pending acquire promise,
 * the connection is immediately released back to the pool, preventing connection leaks.
 * 
 * Caller MUST release the acquired connection via `conn.release()` inside a `finally` block.
 * 
 * @param {Object} [options]
 * @param {number} [options.acquireTimeout] - Maximum ms to wait for connection from pool
 * @returns {Promise<import('mysql2/promise').PoolConnection>}
 */
export async function getConnection(options = {}) {
  if (isPoolClosed || isPoolClosing) {
    throw new Error('Database pool is closed.');
  }

  const pool = getPool();
  const timeoutMs = options.acquireTimeout !== undefined
    ? options.acquireTimeout
    : (Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 10000);

  let timedOut = false;
  let timer = null;

  const acquirePromise = pool.getConnection();

  // Attach resolution handler so that if timedOut is true when acquirePromise resolves,
  // the acquired connection is returned to the pool immediately without leaking!
  acquirePromise.then((conn) => {
    if (timedOut) {
      try {
        conn.release();
      } catch {
        // ignore cleanup error
      }
    }
  }).catch(() => {
    // ignore rejection if already timed out to prevent unhandled promise rejection
  });

  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    try {
      return await acquirePromise;
    } catch (err) {
      throw sanitizeError(err);
    }
  }

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new PoolAcquisitionTimeoutError(
        `Connection pool acquisition timed out after ${timeoutMs}ms.`
      ));
    }, timeoutMs);
  });

  try {
    const conn = await Promise.race([acquirePromise, timeoutPromise]);
    clearTimeout(timer);
    return conn;
  } catch (err) {
    clearTimeout(timer);
    throw sanitizeError(err);
  }
}

/**
 * Executes a query using a pooled connection with guaranteed release in `finally`.
 * SQL query parameters are strictly NOT logged.
 * 
 * @param {string} sql - SQL query string
 * @param {Array<any>} [params=[]] - Query parameters
 * @param {Object} [options]
 * @param {number} [options.acquireTimeout] - Connection acquisition timeout
 * @returns {Promise<[any, any]>} - [rows, fields]
 */
export async function query(sql, params = [], options = {}) {
  if (isPoolClosed || isPoolClosing) {
    throw new Error('Database pool is closed.');
  }

  const conn = await getConnection(options);
  try {
    const [rows, fields] = await conn.query(sql, params);
    return [rows, fields];
  } catch (err) {
    throw sanitizeError(err);
  } finally {
    conn.release();
  }
}

/**
 * Performs a health check probe against MySQL.
 * Credentials and sensitive database parameters are never exposed in the response.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.throwOnError=false]
 * @param {number} [options.acquireTimeout=3000]
 * @returns {Promise<{status: string, latencyMs?: number, timestamp: string, error?: string, details?: Object}>}
 */
export async function healthCheck(options = {}) {
  const startTime = Date.now();
  let conn;

  try {
    if (isPoolClosed || isPoolClosing) {
      throw new Error('Database pool is closed.');
    }

    const acquireTimeout = options.acquireTimeout || 3000;
    conn = await getConnection({ acquireTimeout });
    const [rows] = await conn.query('SELECT 1 AS healthy');
    const latencyMs = Date.now() - startTime;

    return {
      status: 'healthy',
      latencyMs,
      timestamp: new Date().toISOString(),
      details: {
        database: process.env.DB_NAME || 'docuretrieve',
        healthy: Boolean(rows && rows[0] && rows[0].healthy === 1),
      },
    };
  } catch (err) {
    const sanitized = sanitizeError(err);
    if (options.throwOnError) {
      throw sanitized;
    }
    return {
      status: 'unhealthy',
      error: sanitized.message,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch {
        // ignore release errors in cleanup
      }
    }
  }
}

/**
 * Gracefully and idempotently shuts down the connection pool.
 * Subsequent queries are strictly rejected.
 */
export async function closePool() {
  isPoolClosed = true;
  isPoolClosing = true;

  if (closingPromise) {
    return closingPromise;
  }

  if (!poolInstance) {
    isPoolClosing = false;
    return;
  }

  const poolToClose = poolInstance;
  poolInstance = null;

  closingPromise = (async () => {
    try {
      await poolToClose.end();
    } catch (err) {
      throw sanitizeError(err);
    } finally {
      isPoolClosing = false;
      closingPromise = null;
    }
  })();

  return closingPromise;
}

/**
 * Resets the pool lifecycle state (primarily used in testing).
 */
export async function resetPool() {
  await closePool();
  isPoolClosed = false;
  isPoolClosing = false;
  poolInstance = null;
  closingPromise = null;
}

/**
 * Returns a dedicated, standalone MySQL connection (NOT borrowed from the pool).
 * 
 * CRITICAL (AIML-59 Requirement 9):
 * Migration execution and session-level advisory locks (`GET_LOCK` / `RELEASE_LOCK`)
 * MUST run on a dedicated single connection. Pooled connections MUST NEVER be used
 * for lock acquisition and DDL across distinct connections.
 * 
 * @param {Object} [customConfig]
 * @returns {Promise<import('mysql2/promise').Connection>}
 */
export async function getDedicatedConnection(customConfig = null) {
  const baseConfig = getDefaultDbConfig();
  const config = customConfig
    ? { ...baseConfig, ...customConfig }
    : {
        host: baseConfig.host,
        port: baseConfig.port,
        user: baseConfig.user,
        password: baseConfig.password,
        database: baseConfig.database,
        connectTimeout: baseConfig.connectTimeout,
        multipleStatements: true,
      };

  try {
    return await mysql.createConnection(config);
  } catch (err) {
    throw sanitizeError(err, customConfig?.password);
  }
}
