import { config } from '../config.js';

export function structuredLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number((Number(end - start) / 1e6).toFixed(2));
    const level = res.statusCode >= 500 ? 'ERROR' : (res.statusCode >= 400 ? 'WARN' : 'INFO');

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      method: req.method,
      path: req.originalUrl || req.url,
      status_code: res.statusCode,
      duration_ms: durationMs,
      request_id: req.id || null,
      config_version: config.configVersion
    };

    const serialized = JSON.stringify(logEntry);
    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  });

  next();
}
