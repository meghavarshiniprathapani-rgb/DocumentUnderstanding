import { config } from '../config.js';

export function formatEnvelope(status, message, data, configVersion = config.configVersion) {
  return {
    config_version: configVersion,
    status,
    message: message !== undefined ? message : null,
    data: data !== undefined ? data : null,
    timestamp: new Date().toISOString()
  };
}

export function sendSuccess(res, data = null, message = null, statusCode = 200) {
  const envelope = formatEnvelope('success', message, data);
  return res.status(statusCode).json(envelope);
}

export function sendError(res, message = 'Internal server error', statusCode = 500, data = null) {
  const envelope = formatEnvelope('error', message, data);
  return res.status(statusCode).json(envelope);
}
