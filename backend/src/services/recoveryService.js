import { config } from '../config.js';
import { query } from '../db/pool.js';
import * as elementRepository from '../db/repositories/elementRepository.js';

let lastSyncedPythonInstanceId = null;
let inFlightSync = null;
let pendingForceSync = null;

function resolveSharedSecret() {
  return (process.env.INTERNAL_API_SECRET || config.internalApiSecret || '').trim();
}

function resolveCanonicalMode(jobModeRows, fallbackModeRows) {
  if (Array.isArray(jobModeRows) && jobModeRows.length > 0 && jobModeRows[0].mode) {
    return String(jobModeRows[0].mode);
  }
  if (Array.isArray(fallbackModeRows) && fallbackModeRows.length > 0 && fallbackModeRows[0].mode) {
    return String(fallbackModeRows[0].mode);
  }
  return 'flat';
}

function serializeRecoveryElement(el) {
  return {
    page: Number(el.page),
    type: String(el.type || 'text'),
    reading_order: Number(el.reading_order),
    text: typeof el.text === 'string' ? el.text : '',
    bbox: el.bbox ?? null,
    structured: el.structured ?? null,
    confidence: Number(el.confidence !== undefined ? el.confidence : 1.0),
    provenance: el.provenance ?? null,
    flags: el.flags ?? null,
    model_version: el.model_version ?? null,
  };
}

export async function collectPersistedDocumentsForRecovery() {
  const [activeDocs] = await query(
    `SELECT * FROM documents
     WHERE deleted_at IS NULL AND status IN ('ready', 'degraded')
     ORDER BY id ASC`
  );
  const [deletedRows] = await query(
    `SELECT document_id FROM documents
     WHERE deleted_at IS NOT NULL
     ORDER BY id ASC`
  );
  const [ineligibleRows] = await query(
    `SELECT document_id FROM documents
     WHERE deleted_at IS NOT NULL OR status NOT IN ('ready', 'degraded')
     ORDER BY id ASC`
  );

  const documents = [];
  for (const doc of activeDocs) {
    const [jobModeRows] = await query(
      `SELECT id, mode, status, lease_generation FROM jobs
       WHERE doc_id = ? AND status IN ('done', 'degraded')
       ORDER BY id DESC
       LIMIT 1`,
      [doc.id]
    );
    const [fallbackModeRows] =
      jobModeRows.length === 0
        ? await query(
            `SELECT mode FROM elements
             WHERE doc_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [doc.id]
          )
        : [[]];

    const mode = resolveCanonicalMode(jobModeRows, fallbackModeRows);
    const elements = await elementRepository.findByDocumentAndMode(doc.id, mode);
    if (!elements || elements.length === 0) {
      continue;
    }

    let metadata = {};
    if (doc.metadata) {
      metadata = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
    }

    const jobRow = jobModeRows[0] || null;
    const isDegraded =
      doc.status === 'degraded' ||
      Boolean(metadata?.is_degraded) ||
      jobRow?.status === 'degraded';
    const extractionWarnings = Array.isArray(metadata?.extraction_warnings)
      ? metadata.extraction_warnings.map((w) => String(w))
      : metadata?.error_details
        ? [String(metadata.error_details)]
        : [];

    documents.push({
      document_id: doc.document_id,
      file_hash: doc.sha256,
      filename: doc.filename,
      mode,
      is_degraded: isDegraded,
      page_count: Number(doc.pages_count) > 0 ? Number(doc.pages_count) : 1,
      job_id: jobRow ? Number(jobRow.id) : null,
      lease_generation: jobRow && jobRow.lease_generation !== undefined ? Number(jobRow.lease_generation) : 0,
      is_recovery: true,
      extraction_warnings: extractionWarnings,
      elements: elements.map(serializeRecoveryElement),
    });
  }

  return {
    documents,
    deleted_document_ids: deletedRows.map((row) => row.document_id).filter(Boolean),
    ineligible_document_ids: ineligibleRows.map((row) => row.document_id).filter(Boolean),
  };
}

async function probePythonHealth(pythonUrl, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${pythonUrl}/api/v1/health`, { signal: controller.signal });
    if (!resp.ok) {
      return null;
    }
    const body = await resp.json();
    return body?.data || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonInternal(url, secret, payloadBody, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(payloadBody),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} during recovery sync`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function deleteBestEffort(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: 'DELETE', signal: controller.signal });
  } catch {
  } finally {
    clearTimeout(timer);
  }
}

async function runPythonRecoverySync(options = {}) {
  const force = Boolean(options.force);
  const baseUrl = config.pythonServiceUrl ? config.pythonServiceUrl.replace(/\/+$/, '') : '';
  if (!baseUrl) {
    return { synced: false, reachable: false, reason: 'python_url_unconfigured' };
  }

  const health = await probePythonHealth(baseUrl, 1500);
  if (!health) {
    return { synced: false, reachable: false, reason: 'python_unreachable' };
  }

  const instanceId = typeof health.instance_id === 'string' && health.instance_id ? health.instance_id : null;
  if (!force && instanceId && instanceId === lastSyncedPythonInstanceId) {
    return { synced: false, reachable: true, alreadyCurrent: true, instanceId, recoveredCount: 0 };
  }

  const secret = resolveSharedSecret();
  if (!secret) {
    return { synced: false, reachable: true, reason: 'missing_internal_secret' };
  }

  const {
    documents,
    deleted_document_ids: deletedIds,
    ineligible_document_ids: ineligibleIds,
  } = await collectPersistedDocumentsForRecovery();
  const deletedSet = new Set(deletedIds);
  for (const delId of deletedIds) {
    await deleteBestEffort(`${baseUrl}/api/v1/documents/${encodeURIComponent(delId)}`, 800);
  }
  const memoryOnlyPurgeIds = (ineligibleIds || []).filter((id) => id && !deletedSet.has(id));
  if (memoryOnlyPurgeIds.length > 0) {
    await postJsonInternal(
      `${baseUrl}/api/v1/internal/recovery/purge`,
      secret,
      { document_ids: memoryOnlyPurgeIds },
      3000
    ).catch(() => {});
  }

  let recoveredCount = 0;
  let allSucceeded = true;
  for (const docPayload of documents) {
    try {
      await postJsonInternal(`${baseUrl}/api/v1/internal/index`, secret, docPayload, 15000);
      recoveredCount += 1;
    } catch {
      allSucceeded = false;
    }
  }

  if (allSucceeded && instanceId) {
    lastSyncedPythonInstanceId = instanceId;
  }

  return {
    synced: true,
    reachable: true,
    instanceId,
    recoveredCount,
    totalPersistedDocuments: documents.length,
    allSucceeded,
  };
}

export async function ensurePythonRecovered(options = {}) {
  const force = Boolean(options.force);
  if (inFlightSync) {
    if (!force) {
      return inFlightSync;
    }
    if (pendingForceSync) {
      return pendingForceSync;
    }
    const basePromise = inFlightSync;
    const followUp = basePromise
      .catch(() => {})
      .then(() => runPythonRecoverySync({ force: true }))
      .finally(() => {
        if (pendingForceSync === followUp) {
          pendingForceSync = null;
        }
        if (inFlightSync === followUp) {
          inFlightSync = null;
        }
      });
    pendingForceSync = followUp;
    inFlightSync = followUp;
    return followUp;
  }

  const syncPromise = runPythonRecoverySync({ force }).finally(() => {
    if (inFlightSync === syncPromise) {
      inFlightSync = null;
    }
  });
  inFlightSync = syncPromise;
  return syncPromise;
}

export async function purgeDocumentFromPython(documentId) {
  if (!documentId || !config.pythonServiceUrl) {
    return;
  }
  const baseUrl = config.pythonServiceUrl.replace(/\/+$/, '');
  await deleteBestEffort(`${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}`, 800);
}

export function resetRecoveryState() {
  lastSyncedPythonInstanceId = null;
  inFlightSync = null;
  pendingForceSync = null;
}
