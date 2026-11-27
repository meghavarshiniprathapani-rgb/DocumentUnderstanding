import { Router } from 'express';
import { config } from '../config.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { healthCheck as dbHealthCheck, query } from '../db/pool.js';
import { ensurePythonRecovered } from '../services/recoveryService.js';

export const healthRouter = Router();

async function fetchPythonTelemetry(timeoutMs = 700) {
  if (!config.pythonServiceUrl) {
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${config.pythonServiceUrl.replace(/\/+$/, '')}/api/v1/health`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      return null;
    }
    const body = await resp.json();
    return body?.data || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

healthRouter.get('/health', async (req, res) => {
  let documentsCount = 0;
  try {
    const [rows] = await query(`SELECT COUNT(*) AS cnt FROM documents WHERE deleted_at IS NULL`);
    documentsCount = Number(rows[0]?.cnt || 0);
  } catch {
    documentsCount = 0;
  }

  const pyDetails = await fetchPythonTelemetry(600);
  const memMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

  return sendSuccess(
    res,
    {
      service: config.appName,
      status: 'healthy',
      environment: config.environment,
      config_version: config.configVersion,
      config_id: pyDetails?.config_id || 'O3-v1.0.0',
      documents_count: documentsCount,
      index_size: pyDetails?.index_size ?? 0,
      model_versions: pyDetails?.model_versions || {
        extractor: 'PyMuPDF+pdfplumber',
        embedding: 'DenseDeterministicEmbedding:128d:seed42',
        layout_engine: 'LayoutOrderRecovery:v1.0.0',
        provenance_subsystem: 'O3:O3-v1.0.0',
      },
      degraded_mode_active: Boolean(pyDetails?.degraded_mode_active),
      last_error: pyDetails?.last_error ?? null,
      uptime_seconds: process.uptime(),
      memory_usage_mb: pyDetails?.memory_usage_mb ?? memMb,
      python_instance_id: pyDetails?.instance_id ?? null,
      timestamp: new Date().toISOString(),
    },
    'Service is operational',
    200
  );
});

healthRouter.post('/health/reload', async (req, res, next) => {
  try {
    if (!config.pythonServiceUrl) {
      return sendError(res, 'Python service URL is not configured.', 503);
    }
    const baseUrl = config.pythonServiceUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let reloadPayload = null;
    try {
      const resp = await fetch(`${baseUrl}/api/v1/health/reload`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!resp.ok) {
        return sendError(res, `Python reload returned HTTP ${resp.status}`, 502);
      }
      reloadPayload = await resp.json();
    } finally {
      clearTimeout(timeoutId);
    }

    const syncResult = await ensurePythonRecovered({ force: true }).catch(() => ({ synced: false }));
    return sendSuccess(
      res,
      {
        ...(reloadPayload?.data || {}),
        mysql_recovery: syncResult,
      },
      reloadPayload?.message || 'Accepted model/config bundle reloaded and persisted documents recovered.',
      200
    );
  } catch (err) {
    return next(err);
  }
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
  if (isMysqlReady && pythonCheck?.status === 'healthy' && process.env.NODE_ENV !== 'test') {
    await ensurePythonRecovered().catch(() => {});
  }
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
