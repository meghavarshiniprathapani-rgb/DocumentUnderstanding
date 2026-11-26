import { config } from '../config.js';

export function timingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.setHeader('X-Config-Version', config.configVersion);

  const originalSend = res.send;
  res.send = function(...args) {
    if (!res.headersSent) {
      const end = process.hrtime.bigint();
      const durationMs = (Number(end - start) / 1e6).toFixed(2);
      res.setHeader('X-Process-Time-Ms', durationMs);
    }
    return originalSend.apply(this, args);
  };

  next();
}
