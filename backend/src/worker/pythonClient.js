import { collectKnownSecrets, scrubText, sanitizeWorkerError } from './sanitize.js';

export const VALID_EXTRACTION_MODES = new Set(['flat', 'reference', 'candidate', 'candidate_ft']);
export const VALID_EXTRACTION_STATUSES = new Set(['processed', 'degraded']);
export const VALID_INDEXING_STATUSES = new Set(['Indexed', 'Skipped', 'Failed']);

const INTERNAL_EXTRACT_PATH = '/api/v1/internal/extract';
const INTERNAL_INDEX_PATH = '/api/v1/internal/index';
const SEARCH_PATH = '/api/v1/search';
const MAX_ERROR_BODY_CHARS = 4096;

export class PythonClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || 'PythonClientError';
    this.code = options.code || 'ERR_PYTHON_CLIENT';
    this.category = options.category || 'client';
    this.retryable = options.retryable !== undefined ? Boolean(options.retryable) : false;
    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
    if (options.reason !== undefined) {
      this.reason = options.reason;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class PythonConfigurationError extends PythonClientError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: 'PythonConfigurationError',
      code: options.code || 'ERR_PYTHON_CONFIG',
      category: 'configuration',
      retryable: false,
    });
  }
}

export class PythonNetworkError extends PythonClientError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: 'PythonNetworkError',
      code: options.code || 'ERR_PYTHON_NETWORK',
      category: 'network',
      retryable: options.retryable !== undefined ? Boolean(options.retryable) : true,
    });
  }
}

export class PythonTimeoutError extends PythonClientError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: 'PythonTimeoutError',
      code: options.code || 'ERR_PYTHON_TIMEOUT',
      category: 'timeout',
      retryable: options.retryable !== undefined ? Boolean(options.retryable) : true,
    });
    if (options.timeoutMs !== undefined) {
      this.timeoutMs = options.timeoutMs;
    }
  }
}

export class PythonAbortError extends PythonClientError {
  constructor(message = 'Python extraction request was aborted.', options = {}) {
    super(message, {
      ...options,
      name: 'PythonAbortError',
      code: options.code || 'ERR_PYTHON_ABORTED',
      category: 'aborted',
      retryable: false,
    });
  }
}

export class PythonHttpError extends PythonClientError {
  constructor(message, statusCode, options = {}) {
    const isRetryable =
      options.retryable !== undefined
        ? Boolean(options.retryable)
        : statusCode === 408 || statusCode === 429 || statusCode >= 500;
    super(message, {
      ...options,
      name: options.name || 'PythonHttpError',
      code: options.code || 'ERR_PYTHON_HTTP',
      category: options.category || (statusCode >= 500 ? 'http_server' : 'http_client'),
      statusCode,
      retryable: isRetryable,
    });
  }
}

export class PythonAuthenticationError extends PythonHttpError {
  constructor(message, statusCode = 401, options = {}) {
    super(message, statusCode, {
      ...options,
      name: 'PythonAuthenticationError',
      code: options.code || 'ERR_PYTHON_AUTH',
      category: 'auth',
      retryable: false,
    });
  }
}

export class PythonResponseValidationError extends PythonClientError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: 'PythonResponseValidationError',
      code: options.code || 'ERR_PYTHON_RESPONSE_INVALID',
      category: 'invalid_response',
      retryable: options.retryable !== undefined ? Boolean(options.retryable) : false,
    });
  }
}

export class PythonSearchVerificationError extends PythonClientError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      name: 'PythonSearchVerificationError',
      code: options.code || 'ERR_PYTHON_SEARCH_UNVERIFIED',
      category: 'search_verification',
      retryable: options.retryable !== undefined ? Boolean(options.retryable) : true,
    });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertFiniteNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PythonResponseValidationError(`Invalid ${fieldName}: expected a finite number.`, {
      reason: 'invalid_schema',
    });
  }
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new PythonResponseValidationError(`Invalid ${fieldName}: expected a positive integer.`, {
      reason: 'invalid_schema',
    });
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PythonResponseValidationError(`Invalid ${fieldName}: expected a non-empty string.`, {
      reason: 'invalid_schema',
    });
  }
}

function normalizeBaseUrl(rawUrl, secrets = []) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new PythonConfigurationError('Python service base URL must be a non-empty string.');
  }
  const trimmed = rawUrl.trim();
  if (/[\s\r\n\0]/.test(trimmed)) {
    throw new PythonConfigurationError('Python service base URL contains invalid characters.');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PythonConfigurationError(
      scrubText(`Invalid Python service URL '${trimmed}'.`, secrets)
    );
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new PythonConfigurationError('Python service URL must use http or https protocol with a valid host.');
  }
  if (parsed.username || parsed.password) {
    throw new PythonConfigurationError('Python service URL must not contain embedded credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new PythonConfigurationError('Python service URL must not contain query parameters or fragments.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function validateElementSchema(element, index) {
  const prefix = `data.elements[${index}]`;
  if (!isPlainObject(element)) {
    throw new PythonResponseValidationError(`Invalid ${prefix}: expected an object.`, {
      reason: 'invalid_schema',
    });
  }
  if (element.element_id !== null && element.element_id !== undefined) {
    assertNonEmptyString(element.element_id, `${prefix}.element_id`);
  }
  assertPositiveInteger(element.page, `${prefix}.page`);
  assertNonEmptyString(element.type, `${prefix}.type`);
  if (!Number.isInteger(element.reading_order) || element.reading_order < 0) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.reading_order: expected a non-negative integer.`, {
      reason: 'invalid_schema',
    });
  }
  if (typeof element.text !== 'string') {
    throw new PythonResponseValidationError(`Invalid ${prefix}.text: expected a string.`, {
      reason: 'invalid_schema',
    });
  }
  if (!isPlainObject(element.bbox)) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.bbox: expected an object.`, {
      reason: 'invalid_schema',
    });
  }
  const bboxKeys = Object.keys(element.bbox);
  if (bboxKeys.length === 0) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.bbox: must not be empty.`, {
      reason: 'invalid_schema',
    });
  }
  for (const key of bboxKeys) {
    assertFiniteNumber(element.bbox[key], `${prefix}.bbox.${key}`);
  }
  if (element.table_data !== null && element.table_data !== undefined && !isPlainObject(element.table_data)) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.table_data: expected an object or null.`, {
      reason: 'invalid_schema',
    });
  }
  if (element.formula_latex !== null && element.formula_latex !== undefined && typeof element.formula_latex !== 'string') {
    throw new PythonResponseValidationError(`Invalid ${prefix}.formula_latex: expected a string or null.`, {
      reason: 'invalid_schema',
    });
  }
  assertFiniteNumber(element.raw_confidence, `${prefix}.raw_confidence`);
  if (element.raw_confidence < 0 || element.raw_confidence > 1) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.raw_confidence: must be within [0, 1].`, {
      reason: 'invalid_schema',
    });
  }
  if (element.calibrated_confidence !== null && element.calibrated_confidence !== undefined) {
    assertFiniteNumber(element.calibrated_confidence, `${prefix}.calibrated_confidence`);
    if (element.calibrated_confidence < 0 || element.calibrated_confidence > 1) {
      throw new PythonResponseValidationError(
        `Invalid ${prefix}.calibrated_confidence: must be within [0, 1].`,
        { reason: 'invalid_schema' }
      );
    }
  }
  if (element.provenance !== null && element.provenance !== undefined && !isPlainObject(element.provenance)) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.provenance: expected an object or null.`, {
      reason: 'invalid_schema',
    });
  }
  if (element.flags !== undefined && element.flags !== null && !isPlainObject(element.flags)) {
    throw new PythonResponseValidationError(`Invalid ${prefix}.flags: expected an object.`, {
      reason: 'invalid_schema',
    });
  }
  if (element.model_version !== null && element.model_version !== undefined && typeof element.model_version !== 'string') {
    throw new PythonResponseValidationError(`Invalid ${prefix}.model_version: expected a string or null.`, {
      reason: 'invalid_schema',
    });
  }
}

export function interpretIndexingDiagnostics(indexingStatus, diagnostics) {
  if (!VALID_INDEXING_STATUSES.has(indexingStatus)) {
    throw new PythonResponseValidationError(
      `Unsupported data.indexing_status '${String(indexingStatus)}'.`,
      { reason: 'invalid_schema' }
    );
  }
  if (!isPlainObject(diagnostics)) {
    throw new PythonResponseValidationError('Missing or invalid data.indexing_diagnostics object.', {
      reason: 'invalid_schema',
    });
  }
  if (typeof diagnostics.latest_version_indexed !== 'boolean') {
    throw new PythonResponseValidationError(
      'Invalid data.indexing_diagnostics.latest_version_indexed: expected boolean.',
      { reason: 'invalid_schema' }
    );
  }
  if (typeof diagnostics.searchable !== 'boolean') {
    throw new PythonResponseValidationError(
      'Invalid data.indexing_diagnostics.searchable: expected boolean.',
      { reason: 'invalid_schema' }
    );
  }
  if (
    diagnostics.previous_version_searchable !== undefined &&
    typeof diagnostics.previous_version_searchable !== 'boolean'
  ) {
    throw new PythonResponseValidationError(
      'Invalid data.indexing_diagnostics.previous_version_searchable: expected boolean.',
      { reason: 'invalid_schema' }
    );
  }
  if (diagnostics.vector_store !== undefined) {
    assertNonEmptyString(diagnostics.vector_store, 'data.indexing_diagnostics.vector_store');
  }
  if (indexingStatus === 'Indexed' && diagnostics.latest_version_indexed !== true) {
    throw new PythonResponseValidationError(
      'Inconsistent indexing diagnostics: indexing_status is Indexed but latest_version_indexed is false.',
      { reason: 'invalid_schema' }
    );
  }
  if (indexingStatus !== 'Indexed' && diagnostics.latest_version_indexed !== false) {
    throw new PythonResponseValidationError(
      `Inconsistent indexing diagnostics: indexing_status is ${indexingStatus} but latest_version_indexed is true.`,
      { reason: 'invalid_schema' }
    );
  }
  if (diagnostics.chunk_count !== undefined && diagnostics.chunk_count !== null) {
    if (!Number.isInteger(diagnostics.chunk_count) || diagnostics.chunk_count < 0) {
      throw new PythonResponseValidationError(
        'Invalid data.indexing_diagnostics.chunk_count: expected non-negative integer.',
        { reason: 'invalid_schema' }
      );
    }
  }

  return {
    status: indexingStatus,
    vectorStore: diagnostics.vector_store || 'FAISS',
    durableOnDisk: Boolean(diagnostics.durable_on_disk),
    latestVersionIndexed: diagnostics.latest_version_indexed,
    previousVersionSearchable: Boolean(diagnostics.previous_version_searchable),
    searchable: diagnostics.searchable,
    chunkCount: diagnostics.chunk_count !== undefined && diagnostics.chunk_count !== null ? diagnostics.chunk_count : null,
    error: typeof diagnostics.error === 'string' ? diagnostics.error : null,
    errorType: typeof diagnostics.error_type === 'string' ? diagnostics.error_type : null,
  };
}

export function validateInternalExtractResponse(payload, expected = {}, secrets = []) {
  if (!isPlainObject(payload)) {
    throw new PythonResponseValidationError('Python response root must be a JSON object.', {
      reason: 'invalid_envelope',
    });
  }
  if (payload.status !== 'success') {
    throw new PythonResponseValidationError(
      scrubText(`Python response envelope status '${String(payload.status)}' is not 'success'.`, secrets),
      { reason: 'invalid_envelope' }
    );
  }
  assertNonEmptyString(payload.config_version, 'config_version');
  if (!isPlainObject(payload.data)) {
    throw new PythonResponseValidationError('Python response is missing a valid data payload object.', {
      reason: 'invalid_envelope',
    });
  }

  const data = payload.data;
  assertNonEmptyString(data.document_id, 'data.document_id');
  if (expected.documentId && data.document_id !== expected.documentId) {
    throw new PythonResponseValidationError(
      scrubText(
        `Python response document_id mismatch: expected '${expected.documentId}', got '${data.document_id}'.`,
        secrets
      ),
      { reason: 'document_id_mismatch' }
    );
  }

  assertNonEmptyString(data.mode, 'data.mode');
  if (!VALID_EXTRACTION_MODES.has(data.mode)) {
    throw new PythonResponseValidationError(`Unsupported extraction mode '${data.mode}' in response.`, {
      reason: 'invalid_schema',
    });
  }
  if (expected.mode && data.mode !== expected.mode) {
    throw new PythonResponseValidationError(
      scrubText(
        `Python response mode mismatch: expected '${expected.mode}', got '${data.mode}'.`,
        secrets
      ),
      { reason: 'mode_mismatch' }
    );
  }

  assertNonEmptyString(data.status, 'data.status');
  if (!VALID_EXTRACTION_STATUSES.has(data.status)) {
    throw new PythonResponseValidationError(`Unsupported extraction status '${data.status}' in response.`, {
      reason: 'invalid_schema',
    });
  }

  assertPositiveInteger(data.page_count, 'data.page_count');
  assertFiniteNumber(data.processing_time_ms, 'data.processing_time_ms');
  if (data.processing_time_ms < 0) {
    throw new PythonResponseValidationError('Invalid data.processing_time_ms: must be non-negative.', {
      reason: 'invalid_schema',
    });
  }

  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    throw new PythonResponseValidationError(
      'Invalid data.elements: expected a non-empty array of extracted elements.',
      { reason: 'invalid_schema' }
    );
  }
  for (let i = 0; i < data.elements.length; i += 1) {
    validateElementSchema(data.elements[i], i);
  }

  if (!isPlainObject(data.extractor)) {
    throw new PythonResponseValidationError('Invalid data.extractor: expected an object.', {
      reason: 'invalid_schema',
    });
  }
  assertNonEmptyString(data.extractor.name, 'data.extractor.name');
  assertNonEmptyString(data.extractor.version, 'data.extractor.version');
  if (
    data.extractor.fallback_occurred !== undefined &&
    typeof data.extractor.fallback_occurred !== 'boolean'
  ) {
    throw new PythonResponseValidationError('Invalid data.extractor.fallback_occurred: expected boolean.', {
      reason: 'invalid_schema',
    });
  }

  if (!isPlainObject(data.model_versions)) {
    throw new PythonResponseValidationError('Invalid data.model_versions: expected an object.', {
      reason: 'invalid_schema',
    });
  }
  for (const [k, v] of Object.entries(data.model_versions)) {
    if (typeof v !== 'string') {
      throw new PythonResponseValidationError(`Invalid data.model_versions.${k}: expected a string.`, {
        reason: 'invalid_schema',
      });
    }
  }

  let extractionWarnings = [];
  if (data.extraction_warnings !== undefined && data.extraction_warnings !== null) {
    if (!Array.isArray(data.extraction_warnings)) {
      throw new PythonResponseValidationError('Invalid data.extraction_warnings: expected an array.', {
        reason: 'invalid_schema',
      });
    }
    for (let i = 0; i < data.extraction_warnings.length; i += 1) {
      if (typeof data.extraction_warnings[i] !== 'string') {
        throw new PythonResponseValidationError(
          `Invalid data.extraction_warnings[${i}]: expected a string.`,
          { reason: 'invalid_schema' }
        );
      }
    }
    extractionWarnings = [...data.extraction_warnings];
  }

  const indexing = interpretIndexingDiagnostics(data.indexing_status, data.indexing_diagnostics);

  let fallbackInfo = null;
  if (data.fallback !== undefined && data.fallback !== null) {
    if (!isPlainObject(data.fallback)) {
      throw new PythonResponseValidationError('Invalid data.fallback: expected an object or null.', {
        reason: 'invalid_schema',
      });
    }
    if (typeof data.fallback.fallback_occurred !== 'boolean') {
      throw new PythonResponseValidationError('Invalid data.fallback.fallback_occurred: expected boolean.', {
        reason: 'invalid_schema',
      });
    }
    fallbackInfo = {
      fallbackOccurred: data.fallback.fallback_occurred,
      requestedMode: data.fallback.requested_mode || data.mode,
      actualExtractor: data.fallback.actual_extractor || data.extractor.name,
      reason: data.fallback.reason || data.extractor.fallback_reason || null,
    };
  }

  const fallbackOccurred = Boolean(data.extractor.fallback_occurred || fallbackInfo?.fallbackOccurred);
  const indexingDeferred = expected.skipIndexing === true && indexing.status === 'Skipped';
  const isDegraded =
    data.status === 'degraded' ||
    fallbackOccurred ||
    indexing.status === 'Failed' ||
    (!indexingDeferred && !indexing.latestVersionIndexed);

  return {
    configVersion: payload.config_version,
    envelopeStatus: payload.status,
    message: typeof payload.message === 'string' ? payload.message : null,
    timestamp: payload.timestamp || null,
    documentId: data.document_id,
    mode: data.mode,
    status: data.status,
    isDegraded,
    pageCount: data.page_count,
    elementCount: data.elements.length,
    elements: data.elements,
    processingTimeMs: data.processing_time_ms,
    extractor: {
      name: data.extractor.name,
      version: data.extractor.version,
      fallbackOccurred,
      fallbackReason: data.extractor.fallback_reason || fallbackInfo?.reason || null,
    },
    modelVersions: { ...data.model_versions },
    extractionWarnings,
    indexingStatus: indexing.status,
    indexingDiagnostics: indexing,
    fallback: fallbackInfo,
  };
}

async function readSafeErrorDetail(response, secrets) {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return '';
  }
  if (!rawText) {
    return '';
  }
  const bounded = rawText.slice(0, MAX_ERROR_BODY_CHARS);
  try {
    const parsed = JSON.parse(bounded);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.detail === 'string') {
        return scrubText(parsed.detail, secrets);
      }
      if (typeof parsed.message === 'string') {
        return scrubText(parsed.message, secrets);
      }
      if (parsed.detail !== undefined) {
        return scrubText(JSON.stringify(parsed.detail), secrets);
      }
    }
  } catch {
  }
  return scrubText(bounded.trim(), secrets);
}

function pickSearchProbeQuery(elements = [], filename = '', documentId = '') {
  if (Array.isArray(elements)) {
    const candidates = elements
      .map((el) => (typeof el?.text === 'string' ? el.text.replace(/\s+/g, ' ').trim() : ''))
      .filter((txt) => txt.length >= 3 && /[a-zA-Z0-9]{2,}/.test(txt));

    const substantial = candidates.find((txt) => txt.length >= 12);
    if (substantial) {
      return substantial.slice(0, 120);
    }
    if (candidates.length > 0) {
      return candidates[0].slice(0, 120);
    }
  }
  if (typeof filename === 'string' && filename.trim()) {
    const stem = filename.trim().replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    if (stem) {
      return stem.slice(0, 120);
    }
  }
  return String(documentId || 'document').trim().slice(0, 120);
}

export function createPythonExtractionClient(options = {}) {
  const secrets = collectKnownSecrets(process.env, [
    ...(Array.isArray(options.extraSecrets) ? options.extraSecrets : options.extraSecrets ? [options.extraSecrets] : []),
    options.internalApiSecret,
  ].filter(Boolean));

  const baseUrl = normalizeBaseUrl(options.baseUrl, secrets);
  if (typeof options.internalApiSecret !== 'string' || !options.internalApiSecret.trim()) {
    throw new PythonConfigurationError('INTERNAL_API_SECRET must be a non-empty string for Python extraction client.');
  }
  const internalApiSecret = options.internalApiSecret.trim();

  const timeoutMs =
    options.timeoutMs !== undefined ? Number(options.timeoutMs) : 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) {
    throw new PythonConfigurationError(
      'PYTHON_EXTRACTION_TIMEOUT_MS must be an integer between 100 and 600000.'
    );
  }

  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new PythonConfigurationError('Fetch implementation is unavailable in this Node.js runtime.');
  }

  const endpointUrl = `${baseUrl}${INTERNAL_EXTRACT_PATH}`;
  const searchUrl = `${baseUrl}${SEARCH_PATH}`;

  async function postJsonWithControl(targetUrl, headers, payloadBody, { signal, timeoutMs: callTimeoutMs, operationLabel }) {
    const effectiveTimeoutMs = callTimeoutMs !== undefined ? Number(callTimeoutMs) : timeoutMs;
    if (!Number.isInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 100 || effectiveTimeoutMs > 600000) {
      throw new PythonConfigurationError(
        'PYTHON_EXTRACTION_TIMEOUT_MS must be an integer between 100 and 600000.'
      );
    }

    if (signal?.aborted) {
      throw new PythonAbortError(`Python ${operationLabel} aborted before request dispatch.`);
    }

    const requestController = new AbortController();
    let timeoutTriggered = false;
    let callerAborted = false;

    const onCallerAbort = () => {
      callerAborted = true;
      requestController.abort(signal.reason || new Error(`Caller aborted Python ${operationLabel} request`));
    };

    if (signal) {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const timeoutTimer = setTimeout(() => {
      timeoutTriggered = true;
      requestController.abort(new Error(`Python ${operationLabel} timed out after ${effectiveTimeoutMs}ms`));
    }, effectiveTimeoutMs);

    const classifyAbortOrNetwork = (err) => {
      if (timeoutTriggered) {
        return new PythonTimeoutError(
          `Python ${operationLabel} request timed out after ${effectiveTimeoutMs}ms.`,
          { timeoutMs: effectiveTimeoutMs, cause: sanitizeWorkerError(err, secrets) }
        );
      }
      if (callerAborted || signal?.aborted) {
        return new PythonAbortError(`Python ${operationLabel} request was aborted by signal.`, {
          cause: sanitizeWorkerError(err, secrets),
        });
      }
      const sanitized = sanitizeWorkerError(err, secrets);
      return new PythonNetworkError(
        `Python ${operationLabel} network request failed: ${sanitized.message}`,
        { code: sanitized.code || 'ERR_PYTHON_NETWORK', cause: sanitized }
      );
    };

    try {
      let response;
      try {
        response = await fetchImpl(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payloadBody),
          signal: requestController.signal,
        });
      } catch (fetchErr) {
        throw classifyAbortOrNetwork(fetchErr);
      }

      if (!response.ok) {
        let detail = '';
        try {
          detail = await readSafeErrorDetail(response, secrets);
        } catch (bodyErr) {
          if (timeoutTriggered || callerAborted || signal?.aborted) {
            throw classifyAbortOrNetwork(bodyErr);
          }
        }

        if (timeoutTriggered) {
          throw new PythonTimeoutError(
            `Python ${operationLabel} request timed out after ${effectiveTimeoutMs}ms.`,
            { timeoutMs: effectiveTimeoutMs }
          );
        }
        if (callerAborted || signal?.aborted) {
          throw new PythonAbortError(`Python ${operationLabel} request was aborted by signal.`);
        }

        const statusCode = response.status;
        const suffix = detail ? `: ${detail}` : '';
        if (statusCode === 401 || statusCode === 403) {
          throw new PythonAuthenticationError(
            scrubText(`Python internal endpoint authentication failed with HTTP ${statusCode}${suffix}`, secrets),
            statusCode
          );
        }
        const httpErr = new PythonHttpError(
          scrubText(`Python ${operationLabel} returned HTTP ${statusCode}${suffix}`, secrets),
          statusCode
        );
        if (
          statusCode === 409 &&
          (operationLabel === 'indexing' ||
            /ownership|lease|stale|claim_token|lease_generation|deleted/i.test(detail))
        ) {
          httpErr.name = 'LeaseOwnershipError';
          httpErr.code = 'ERR_LEASE_OWNERSHIP';
          httpErr.retryable = false;
        }
        throw httpErr;
      }

      let rawBody;
      try {
        rawBody = await response.text();
      } catch (readErr) {
        throw classifyAbortOrNetwork(readErr);
      }

      if (timeoutTriggered) {
        throw new PythonTimeoutError(
          `Python ${operationLabel} request timed out after ${effectiveTimeoutMs}ms.`,
          { timeoutMs: effectiveTimeoutMs }
        );
      }
      if (callerAborted || signal?.aborted) {
        throw new PythonAbortError(`Python ${operationLabel} request was aborted by signal.`);
      }

      if (typeof rawBody !== 'string' || !rawBody.trim()) {
        throw new PythonResponseValidationError(`Python ${operationLabel} returned an empty JSON response body.`, {
          reason: 'malformed_json',
        });
      }

      try {
        return JSON.parse(rawBody);
      } catch {
        throw new PythonResponseValidationError(`Python ${operationLabel} returned malformed JSON.`, {
          reason: 'malformed_json',
        });
      }
    } finally {
      clearTimeout(timeoutTimer);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  return {
    baseUrl,
    endpointUrl,
    indexEndpointUrl: `${baseUrl}${INTERNAL_INDEX_PATH}`,
    searchUrl,
    timeoutMs,

    async extract({ documentId, filePath, mode, skipIndexing = false, signal, timeoutMs: callTimeoutMs } = {}) {
      if (typeof documentId !== 'string' || !documentId.trim()) {
        throw new PythonConfigurationError('Extraction requires a non-empty documentId.');
      }
      if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new PythonConfigurationError('Extraction requires a non-empty filePath.');
      }
      if (typeof mode !== 'string' || !VALID_EXTRACTION_MODES.has(mode)) {
        throw new PythonConfigurationError(`Unsupported extraction mode '${String(mode)}'.`);
      }

      const parsedPayload = await postJsonWithControl(
        endpointUrl,
        {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internalApiSecret,
        },
        {
          document_id: documentId.trim(),
          file_path: filePath,
          mode,
          skip_indexing: Boolean(skipIndexing),
        },
        { signal, timeoutMs: callTimeoutMs, operationLabel: 'extraction' }
      );

      return validateInternalExtractResponse(
        parsedPayload,
        { documentId: documentId.trim(), mode, skipIndexing: Boolean(skipIndexing) },
        secrets
      );
    },

    async indexPersistedElements({
      documentId,
      fileHash,
      filename = null,
      mode = 'flat',
      isDegraded = false,
      pageCount = 1,
      elements = [],
      jobId = null,
      workerId = null,
      claimToken = null,
      leaseGeneration = null,
      signal,
      timeoutMs: callTimeoutMs,
    } = {}) {
      if (typeof documentId !== 'string' || !documentId.trim()) {
        throw new PythonConfigurationError('Indexing requires a non-empty documentId.');
      }
      if (typeof fileHash !== 'string' || !fileHash.trim()) {
        throw new PythonConfigurationError('Indexing requires a non-empty fileHash.');
      }
      if (typeof mode !== 'string' || !VALID_EXTRACTION_MODES.has(mode)) {
        throw new PythonConfigurationError(`Unsupported indexing mode '${String(mode)}'.`);
      }
      if (!Array.isArray(elements) || elements.length === 0) {
        throw new PythonConfigurationError('Indexing requires a non-empty array of persisted elements.');
      }

      const indexEndpointUrl = `${baseUrl}${INTERNAL_INDEX_PATH}`;
      const serializedElements = elements.map((el) => ({
        page: Number(el.page),
        type: String(el.type || 'text'),
        reading_order: Number(el.reading_order),
        text: typeof el.text === 'string' ? el.text : '',
        bbox: el.bbox ?? null,
        structured: el.structured ?? null,
        confidence: el.confidence !== undefined ? Number(el.confidence) : Number(el.raw_confidence ?? 1.0),
        provenance: el.provenance ?? null,
        flags: el.flags ?? null,
        model_version: el.model_version ?? null,
      }));

      const indexPayload = {
        document_id: documentId.trim(),
        file_hash: fileHash.trim(),
        filename: filename || null,
        mode,
        is_degraded: Boolean(isDegraded),
        page_count: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1,
        elements: serializedElements,
      };
      if (jobId !== undefined && jobId !== null) {
        indexPayload.job_id = Number(jobId);
      }
      if (typeof workerId === 'string' && workerId.trim()) {
        indexPayload.worker_id = workerId.trim();
      }
      if (typeof claimToken === 'string' && claimToken.trim()) {
        indexPayload.claim_token = claimToken.trim();
      }
      if (leaseGeneration !== undefined && leaseGeneration !== null) {
        indexPayload.lease_generation = Number(leaseGeneration);
      }

      const parsedPayload = await postJsonWithControl(
        indexEndpointUrl,
        {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internalApiSecret,
        },
        indexPayload,
        { signal, timeoutMs: callTimeoutMs, operationLabel: 'indexing' }
      );

      if (
        !isPlainObject(parsedPayload) ||
        parsedPayload.status !== 'success' ||
        !isPlainObject(parsedPayload.data)
      ) {
        throw new PythonResponseValidationError(
          'Python indexing endpoint returned an invalid response envelope.',
          { reason: 'invalid_envelope' }
        );
      }

      const data = parsedPayload.data;
      if (data.document_id !== documentId.trim()) {
        throw new PythonResponseValidationError(
          scrubText(
            `Python indexing document_id mismatch: expected '${documentId.trim()}', got '${data.document_id}'.`,
            secrets
          ),
          { reason: 'document_id_mismatch' }
        );
      }
      if (data.mode !== mode) {
        throw new PythonResponseValidationError(
          scrubText(
            `Python indexing mode mismatch: expected '${mode}', got '${data.mode}'.`,
            secrets
          ),
          { reason: 'mode_mismatch' }
        );
      }

      const diagnostics = interpretIndexingDiagnostics(data.indexing_status, data.indexing_diagnostics);
      if (!Number.isInteger(data.chunk_count) || data.chunk_count < 0) {
        throw new PythonResponseValidationError('Invalid indexing response chunk_count.', {
          reason: 'invalid_schema',
        });
      }
      if (typeof data.searchable !== 'boolean') {
        throw new PythonResponseValidationError('Invalid indexing response searchable flag.', {
          reason: 'invalid_schema',
        });
      }
      assertFiniteNumber(data.processing_time_ms, 'data.processing_time_ms');

      return {
        documentId: data.document_id,
        mode: data.mode,
        indexingStatus: diagnostics.status,
        indexingDiagnostics: diagnostics,
        chunkCount: data.chunk_count,
        searchable: data.searchable,
        processingTimeMs: data.processing_time_ms,
      };
    },

    async verifyDocumentSearchable({
      documentId,
      expectedFileHash = null,
      elements = [],
      filename = '',
      signal,
      timeoutMs: callTimeoutMs,
    } = {}) {
      if (typeof documentId !== 'string' || !documentId.trim()) {
        throw new PythonConfigurationError('Search verification requires a non-empty documentId.');
      }

      const normalizedDocId = documentId.trim();
      const probeQuery = pickSearchProbeQuery(elements, filename, normalizedDocId);
      const parsedPayload = await postJsonWithControl(
        searchUrl,
        {
          'Content-Type': 'application/json',
        },
        {
          query: probeQuery,
          document_id: normalizedDocId,
          content_type: 'All',
          min_score: 0.0,
          top_k: 5,
        },
        { signal, timeoutMs: callTimeoutMs, operationLabel: 'search verification' }
      );

      if (
        !isPlainObject(parsedPayload) ||
        (parsedPayload.status !== 'success' && parsedPayload.status !== 'degraded') ||
        !Array.isArray(parsedPayload.data)
      ) {
        throw new PythonResponseValidationError(
          'Python search verification returned an invalid search response envelope.',
          { reason: 'invalid_envelope' }
        );
      }

      const matchingItems = parsedPayload.data.filter(
        (item) => isPlainObject(item) && item.document_id === normalizedDocId
      );
      if (matchingItems.length === 0) {
        throw new PythonSearchVerificationError(
          `Latest version search verification failed: document '${normalizedDocId}' returned 0 hits in FAISS search.`
        );
      }

      const normalizedHash =
        typeof expectedFileHash === 'string' && expectedFileHash.trim()
          ? expectedFileHash.trim().toLowerCase()
          : null;

      let verifiedItems = matchingItems;
      let sourceFileHashMatched = null;
      if (normalizedHash) {
        const itemsWithHash = matchingItems.filter(
          (item) => typeof item.provenance?.source_file_hash === 'string' && item.provenance.source_file_hash.trim()
        );
        if (itemsWithHash.length > 0) {
          verifiedItems = itemsWithHash.filter(
            (item) => item.provenance.source_file_hash.trim().toLowerCase() === normalizedHash
          );
          if (verifiedItems.length === 0) {
            throw new PythonSearchVerificationError(
              `Latest version search verification failed: FAISS search hits for '${normalizedDocId}' did not match current source_file_hash.`
            );
          }
          sourceFileHashMatched = true;
        }
      }

      const topHit = verifiedItems[0];
      return {
        verified: true,
        query: probeQuery,
        matchCount: verifiedItems.length,
        topScore: typeof topHit.relevance_score === 'number' ? topHit.relevance_score : null,
        topChunkId: typeof topHit.id === 'string' ? topHit.id : null,
        sourceFileHashMatched,
      };
    },
  };
}
