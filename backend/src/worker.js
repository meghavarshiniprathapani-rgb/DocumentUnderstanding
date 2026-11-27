import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkerConfigError,
  collectKnownSecrets,
  createWorker,
  createWorkerLogger,
  loadWorkerConfig,
  sanitizeWorkerError,
} from './worker/index.js';

const __filename = fileURLToPath(import.meta.url);

export async function runStandaloneWorker(options = {}) {
  const env = options.env || process.env;
  const hasCustomHandler = typeof options.jobHandler === 'function';
  const requireInternalApiSecret =
    options.requireInternalApiSecret !== undefined
      ? Boolean(options.requireInternalApiSecret)
      : !hasCustomHandler;

  const extraSecrets = Array.isArray(options.extraSecrets)
    ? [...options.extraSecrets]
    : options.extraSecrets
      ? [options.extraSecrets]
      : [];
  if (typeof options.config?.internalApiSecret === 'string' && options.config.internalApiSecret.length > 0) {
    extraSecrets.push(options.config.internalApiSecret);
  }
  const knownSecrets = collectKnownSecrets(env, extraSecrets);

  let config;
  try {
    config = loadWorkerConfig(options.config || {}, env, {
      requireInternalApiSecret,
    });
  } catch (err) {
    const ErrorCls = err instanceof WorkerConfigError ? WorkerConfigError : null;
    const sanitized = sanitizeWorkerError(err, knownSecrets, ErrorCls);
    const startupLogger = createWorkerLogger({ workerId: null, env, extraSecrets: knownSecrets });
    startupLogger.error('worker_startup_error', {
      error: sanitized.message,
      code: sanitized.code || 'ERR_WORKER_CONFIG',
    });
    throw sanitized;
  }

  const worker = createWorker({
    config,
    env,
    extraSecrets: knownSecrets,
    jobHandler: options.jobHandler,
    repository: options.repository,
    documentRepository: options.documentRepository,
    elementRepository: options.elementRepository,
    pythonClient: options.pythonClient,
    fetchImpl: options.fetchImpl,
    onExtractionOutcome: options.onExtractionOutcome,
    requireInternalApiSecret,
    db: options.db,
    logger: options.logger,
    closeDbOnStop: options.closeDbOnStop,
  });

  let shutdownPromise = null;
  const triggerSignalShutdown = (signal) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      const summary = await worker.stop({ reason: signal });
      process.removeListener('SIGINT', onSigInt);
      process.removeListener('SIGTERM', onSigTerm);
      if (options.exitOnSignal !== false) {
        process.exit(summary.shutdownReason === 'grace_timeout' ? 1 : 0);
      }
      return summary;
    })();
    return shutdownPromise;
  };

  const onSigInt = () => {
    void triggerSignalShutdown('SIGINT');
  };
  const onSigTerm = () => {
    void triggerSignalShutdown('SIGTERM');
  };

  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  try {
    await worker.start();
    return {
      worker,
      stop: async (reason = 'manual') => {
        process.removeListener('SIGINT', onSigInt);
        process.removeListener('SIGTERM', onSigTerm);
        return worker.stop({ reason });
      },
    };
  } catch (err) {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    throw sanitizeWorkerError(err, knownSecrets);
  }
}

export { createWorker, loadWorkerConfig };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runStandaloneWorker().catch(() => {
    process.exit(1);
  });
}
