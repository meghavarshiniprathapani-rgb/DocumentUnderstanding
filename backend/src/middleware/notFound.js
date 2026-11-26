import { sendError } from '../utils/response.js';

export function notFoundHandler(req, res) {
  return sendError(res, `Route ${req.method} ${req.originalUrl || req.url} not found`, 404);
}
