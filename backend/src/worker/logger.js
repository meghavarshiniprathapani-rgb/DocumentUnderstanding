import { collectKnownSecrets, sanitizeValue } from './sanitize.js';

export function createWorkerLogger(options = {}) {
  const workerId = options.workerId || null;
  const serviceName = options.serviceName || 'Retrieva AI Worker';
  const secrets = collectKnownSecrets(options.env || process.env, options.extraSecrets);
  const sink =
    options.sink ||
    ((level, line) => {
      if (level === 'ERROR') {
        console.error(line);
      } else if (level === 'WARN') {
        console.warn(line);
      } else {
        console.log(line);
      }
    });

  const emit = (level, event, fields = {}) => {
    const payload = sanitizeValue(
      {
        timestamp: new Date().toISOString(),
        level,
        service: serviceName,
        worker_id: workerId,
        event,
        ...fields,
      },
      secrets
    );
    sink(level, JSON.stringify(payload), payload);
  };

  return {
    info: (event, fields) => emit('INFO', event, fields),
    warn: (event, fields) => emit('WARN', event, fields),
    error: (event, fields) => emit('ERROR', event, fields),
  };
}
