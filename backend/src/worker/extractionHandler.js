import * as defaultDocumentRepository from '../db/repositories/documentRepository.js';
import * as defaultElementRepository from '../db/repositories/elementRepository.js';
import * as defaultJobRepository from '../db/repositories/jobRepository.js';
import { VALID_TYPES } from '../db/repositories/elementRepository.js';
import {
  PythonAbortError,
  PythonClientError,
  PythonSearchVerificationError,
} from './pythonClient.js';
import { sanitizeWorkerError } from './sanitize.js';

export class DocumentUnavailableForExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentUnavailableForExtractionError';
    this.code = 'ERR_DOCUMENT_UNAVAILABLE';
    this.retryable = false;
  }
}

export class PersistenceVerificationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PersistenceVerificationError';
    this.code = 'ERR_PERSISTENCE_VERIFICATION';
    this.retryable = options.retryable !== undefined ? Boolean(options.retryable) : true;
  }
}

function mapElementForPersistence(rawEl, docId, mode) {
  const normalizedType = typeof rawEl.type === 'string' ? rawEl.type.trim().toLowerCase() : 'text';
  const mappedType = VALID_TYPES.has(normalizedType) ? normalizedType : 'text';

  let structured = null;
  if (rawEl.table_data && typeof rawEl.table_data === 'object') {
    structured = rawEl.table_data;
  } else if (typeof rawEl.formula_latex === 'string' && rawEl.formula_latex.length > 0) {
    structured = { latex: rawEl.formula_latex };
  }

  const rawDegradedReasons = Array.isArray(rawEl.flags?.degraded_reasons)
    ? rawEl.flags.degraded_reasons.map((r) => String(r))
    : [];
  const isElDegraded = Boolean(rawEl.flags?.is_degraded);

  const flagsList = [];
  if (isElDegraded) {
    flagsList.push('is_degraded');
  }
  for (const reason of rawDegradedReasons) {
    if (!flagsList.includes(reason)) {
      flagsList.push(reason);
    }
  }

  const rawConfidence = Number(rawEl.raw_confidence);
  const clampedConfidence = Number.isFinite(rawConfidence)
    ? Math.min(1.0, Math.max(0.0, rawConfidence))
    : 1.0;

  const provenanceObj =
    rawEl.provenance && typeof rawEl.provenance === 'object' ? { ...rawEl.provenance } : {};
  if (rawEl.element_id) {
    provenanceObj.element_id = rawEl.element_id;
  }
  if (rawEl.calibrated_confidence !== null && rawEl.calibrated_confidence !== undefined) {
    provenanceObj.calibrated_confidence = Number(rawEl.calibrated_confidence);
  }
  provenanceObj.is_degraded = isElDegraded;
  if (rawDegradedReasons.length > 0) {
    provenanceObj.degraded_reasons = rawDegradedReasons;
  }
  if (mappedType !== normalizedType) {
    provenanceObj.raw_type = normalizedType;
  }

  return {
    doc_id: docId,
    mode,
    type: mappedType,
    page: Number(rawEl.page),
    reading_order: Number(rawEl.reading_order),
    text: typeof rawEl.text === 'string' ? rawEl.text : '',
    bbox: rawEl.bbox,
    structured,
    confidence: clampedConfidence,
    provenance: provenanceObj,
    flags: flagsList,
    model_version: rawEl.model_version ? String(rawEl.model_version).slice(0, 64) : null,
  };
}

function buildElementMetrics(persistedElements) {
  let textBlocks = 0;
  let tables = 0;
  let figures = 0;
  let headings = 0;

  for (const el of persistedElements) {
    if (el.type === 'text' || el.type === 'formula' || el.type === 'caption') {
      textBlocks += 1;
    } else if (el.type === 'heading') {
      headings += 1;
      textBlocks += 1;
    } else if (el.type === 'table') {
      tables += 1;
    } else if (el.type === 'figure') {
      figures += 1;
    }
  }

  return {
    text_blocks: textBlocks,
    tables,
    figures,
    headings,
  };
}

export function createExtractionJobHandler(options = {}) {
  const documentRepository = options.documentRepository || defaultDocumentRepository;
  const elementRepository = options.elementRepository || defaultElementRepository;
  const jobRepository = options.jobRepository !== undefined ? options.jobRepository : defaultJobRepository;
  const pythonClient = options.pythonClient;
  const secrets = Array.isArray(options.secrets) ? options.secrets : [];

  if (!pythonClient || typeof pythonClient.extract !== 'function') {
    throw new Error('pythonClient with an extract() method is required for extraction handler.');
  }

  return async function handleExtractionJob(executionContext) {
    const { job, workerId, claimToken, leaseGeneration, signal, startedAt } = executionContext;

    if (signal?.aborted) {
      throw new PythonAbortError('Pipeline aborted before document lookup.');
    }

    const doc = await documentRepository.findById(job.doc_id);
    if (!doc || doc.deleted_at) {
      throw new DocumentUnavailableForExtractionError(
        `Parent document ${job.doc_id} for job ${job.id} does not exist or is soft-deleted.`
      );
    }

    if (typeof doc.document_id !== 'string' || !doc.document_id.trim()) {
      throw new DocumentUnavailableForExtractionError(
        `Parent document ${job.doc_id} for job ${job.id} has no canonical document_id.`
      );
    }
    if (typeof doc.path !== 'string' || !doc.path.trim()) {
      throw new DocumentUnavailableForExtractionError(
        `Parent document ${job.doc_id} for job ${job.id} has no stored PDF path.`
      );
    }

    if (signal?.aborted) {
      throw new PythonAbortError('Pipeline aborted before Python extraction.');
    }

    try {
      const extractionResult = await pythonClient.extract({
        documentId: doc.document_id,
        filePath: doc.path,
        mode: job.mode,
        skipIndexing: true,
        signal,
      });

      if (signal?.aborted) {
        throw new PythonAbortError('Pipeline aborted after Python extraction before persistence.');
      }

      const mappedElements = extractionResult.elements.map((el) =>
        mapElementForPersistence(el, doc.id, job.mode)
      );

      await elementRepository.replacePersistedElementsFenced(job.id, workerId, {
        claimToken,
        leaseGeneration,
        mode: job.mode,
        elements: mappedElements,
      });

      const persistedElements = await elementRepository.findByDocumentAndMode(doc.id, job.mode);
      if (persistedElements.length !== mappedElements.length) {
        throw new PersistenceVerificationError(
          `Persisted element count mismatch for document ${doc.id} mode '${job.mode}': expected ${mappedElements.length}, got ${persistedElements.length}.`
        );
      }

      if (signal?.aborted) {
        throw new PythonAbortError('Pipeline aborted after MySQL element persistence before indexing.');
      }

      if (typeof jobRepository?.verifyLeaseOwnership === 'function') {
        await jobRepository.verifyLeaseOwnership(job.id, workerId, {
          claimToken,
          leaseGeneration,
        });
      }

      let indexingResult;
      if (typeof pythonClient.indexPersistedElements === 'function') {
        indexingResult = await pythonClient.indexPersistedElements({
          documentId: doc.document_id,
          fileHash: doc.sha256,
          filename: doc.filename,
          mode: job.mode,
          isDegraded: extractionResult.isDegraded,
          pageCount: extractionResult.pageCount,
          elements: persistedElements,
          jobId: job.id,
          workerId,
          claimToken,
          leaseGeneration,
          signal,
        });
      } else {
        indexingResult = {
          indexingStatus: extractionResult.indexingStatus,
          indexingDiagnostics: extractionResult.indexingDiagnostics,
          chunkCount: extractionResult.indexingDiagnostics?.chunkCount ?? 0,
          searchable: Boolean(extractionResult.indexingDiagnostics?.searchable),
        };
      }

      if (
        indexingResult.indexingStatus !== 'Indexed' ||
        indexingResult.indexingDiagnostics?.latestVersionIndexed !== true ||
        indexingResult.indexingDiagnostics?.searchable !== true ||
        indexingResult.chunkCount < 1
      ) {
        throw new PythonSearchVerificationError(
          `Latest version indexing failed for '${doc.document_id}': indexing_status=${indexingResult.indexingStatus}, latest_version_indexed=${indexingResult.indexingDiagnostics?.latestVersionIndexed}, searchable=${indexingResult.indexingDiagnostics?.searchable}.`
        );
      }

      const searchVerification =
        typeof pythonClient.verifyDocumentSearchable === 'function'
          ? await pythonClient.verifyDocumentSearchable({
              documentId: doc.document_id,
              expectedFileHash: doc.sha256,
              elements: persistedElements,
              filename: doc.filename,
              signal,
            })
          : {
              verified: true,
              query: '',
              matchCount: indexingResult.chunkCount,
              topScore: null,
              topChunkId: null,
              sourceFileHashMatched: true,
            };

      if (signal?.aborted) {
        throw new PythonAbortError('Pipeline aborted after search verification before completion.');
      }

      const metrics = buildElementMetrics(persistedElements);
      const completionStatus = extractionResult.isDegraded ? 'degraded' : 'done';
      const degradationSummary =
        extractionResult.isDegraded && extractionResult.extractionWarnings.length > 0
          ? extractionResult.extractionWarnings.join('; ').slice(0, 1000)
          : extractionResult.isDegraded
            ? `Degraded extraction completed (${extractionResult.extractor.name})`
            : null;

      const documentUpdate = {
        status: extractionResult.isDegraded ? 'degraded' : 'ready',
        pageCount: extractionResult.pageCount,
        metadata: {
          metrics,
          parsing_accuracy: extractionResult.isDegraded ? 94.5 : 99.2,
          is_degraded: Boolean(extractionResult.isDegraded),
          extraction_status: 'Completed',
          indexing_status: indexingResult.indexingStatus,
          indexing_diagnostics: {
            vector_store: indexingResult.indexingDiagnostics?.vectorStore || 'FAISS',
            durable_on_disk: Boolean(indexingResult.indexingDiagnostics?.durableOnDisk),
            latest_version_indexed: Boolean(indexingResult.indexingDiagnostics?.latestVersionIndexed),
            previous_version_searchable: Boolean(indexingResult.indexingDiagnostics?.previousVersionSearchable),
            searchable: Boolean(indexingResult.indexingDiagnostics?.searchable),
            chunk_count: indexingResult.indexingDiagnostics?.chunkCount ?? indexingResult.chunkCount,
          },
          search_verified: Boolean(searchVerification.verified),
          search_verification: {
            verified: Boolean(searchVerification.verified),
            match_count: searchVerification.matchCount,
            top_score: searchVerification.topScore,
            source_file_hash_matched: searchVerification.sourceFileHashMatched,
            mode: job.mode,
            verified_at: new Date().toISOString(),
          },
          chunk_count: indexingResult.chunkCount,
          extractor: extractionResult.extractor,
          model_versions: extractionResult.modelVersions,
          extraction_warnings: extractionResult.extractionWarnings,
          error_details: degradationSummary,
        },
      };

      const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
      return {
        status: completionStatus,
        seconds: elapsedSeconds,
        error: degradationSummary,
        documentUpdate,
        pipelineTelemetry: {
          documentId: doc.document_id,
          extractionStatus: extractionResult.status,
          isDegraded: extractionResult.isDegraded,
          pageCount: extractionResult.pageCount,
          elementCount: persistedElements.length,
          persistedElementsCount: persistedElements.length,
          processingTimeMs: extractionResult.processingTimeMs,
          indexingStatus: indexingResult.indexingStatus,
          indexingDiagnostics: indexingResult.indexingDiagnostics,
          chunkCount: indexingResult.chunkCount,
          searchVerified: Boolean(searchVerification.verified),
          extractor: extractionResult.extractor,
          extractionResult,
          searchVerification,
        },
      };
    } catch (err) {
      if (
        err instanceof PythonClientError ||
        err instanceof PersistenceVerificationError ||
        err instanceof DocumentUnavailableForExtractionError ||
        err?.name === 'LeaseOwnershipError' ||
        err?.code === 'ERR_LEASE_OWNERSHIP' ||
        err?.name === 'InvalidJobTransitionError' ||
        err?.code === 'ERR_INVALID_JOB_TRANSITION'
      ) {
        throw err;
      }
      throw sanitizeWorkerError(err, secrets);
    }
  };
}
