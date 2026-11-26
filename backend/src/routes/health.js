import { Router } from 'express';
import { config } from '../config.js';
import { sendSuccess } from '../utils/response.js';
import { healthCheck as dbHealthCheck } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  return sendSuccess(res, {
    service: config.appName,
    status: 'healthy',
    environment: config.environment,
    uptime_seconds: process.uptime(),
    timestamp: new Date().toISOString()
  }, 'Service is operational', 200);
});

healthRouter.get('/ready', async (req, res) => {
  let mysqlCheck;
  try {
    mysqlCheck = await dbHealthCheck({ acquireTimeout: 3000 });
  } catch (err) {
    mysqlCheck = {
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }

  let pythonCheck;
  if (!config.pythonServiceUrl) {
    pythonCheck = {
      status: 'not_configured',
      timestamp: new Date().toISOString()
    };
  } else {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const pythonResponse = await fetch(`${config.pythonServiceUrl}/api/v1/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (pythonResponse.ok) {
        const body = await pythonResponse.json();
        pythonCheck = {
          status: 'healthy',
          details: body.data || null,
          timestamp: new Date().toISOString()
        };
      } else {
        pythonCheck = {
          status: 'unhealthy',
          statusCode: pythonResponse.status,
          timestamp: new Date().toISOString()
        };
      }
    } catch (fetchErr) {
      pythonCheck = {
        status: 'unavailable',
        error: fetchErr.name === 'AbortError' ? 'Probe timed out after 1500ms' : 'Service unreachable',
        timestamp: new Date().toISOString()
      };
    }
  }

  const isMysqlReady = Boolean(mysqlCheck && mysqlCheck.status === 'healthy');
  const isPythonReady = !config.pythonServiceRequired || Boolean(pythonCheck && pythonCheck.status === 'healthy');
  const isOverallReady = isMysqlReady && isPythonReady;

  const payload = {
    service: config.appName,
    status: isOverallReady ? 'ready' : 'degraded',
    checks: {
      mysql: mysqlCheck,
      python_service: pythonCheck
    },
    timestamp: new Date().toISOString()
  };

  if (!isOverallReady) {
    return res.status(503).json({
      config_version: config.configVersion,
      status: 'degraded',
      message: isMysqlReady ? 'Python service dependency unready' : 'Database dependency unready',
      data: payload,
      timestamp: new Date().toISOString()
    });
  }

  return sendSuccess(res, payload, 'All dependencies ready', 200);
});
