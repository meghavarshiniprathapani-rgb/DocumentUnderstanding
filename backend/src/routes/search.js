import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { ensurePythonRecovered } from '../services/recoveryService.js';
import { sendSuccess, sendError } from '../utils/response.js';

export const searchRouter = Router();

async function fetchDeletedDocumentIds(candidateIds) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return new Set();
  }
  const uniqueIds = Array.from(new Set(candidateIds.filter((id) => typeof id === 'string' && id.trim())));
  if (uniqueIds.length === 0) {
    return new Set();
  }
  const [rows] = await query(
    `SELECT document_id FROM documents WHERE document_id IN (?) AND deleted_at IS NOT NULL`,
    [uniqueIds]
  );
  return new Set(rows.map((r) => r.document_id));
}

async function handleSearchProxy(req, res, next, aggregate = false) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const searchQuery = typeof body.query === 'string' ? body.query.trim() : '';
    if (!searchQuery) {
      return sendError(res, 'Search query must be a non-empty string.', 400);
    }

    if (!config.pythonServiceUrl) {
      return sendError(res, 'Python search service URL is not configured.', 503);
    }

    await ensurePythonRecovered().catch(() => {});

    const endpoint = aggregate
      ? `${config.pythonServiceUrl.replace(/\/+$/, '')}/api/v1/search/aggregate`
      : `${config.pythonServiceUrl.replace(/\/+$/, '')}/api/v1/search`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          document_id: body.document_id ?? 'All',
          document_ids: Array.isArray(body.document_ids) ? body.document_ids : undefined,
          content_type: body.content_type ?? 'All',
          min_score: body.min_score !== undefined ? Number(body.min_score) : 0.5,
          page_range: body.page_range ?? undefined,
          top_k: body.top_k !== undefined ? Number(body.top_k) : 10,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      const msg =
        fetchErr?.name === 'AbortError'
          ? 'Python search request timed out.'
          : 'Python search service is unreachable.';
      return sendError(res, msg, 503);
    } finally {
      clearTimeout(timeoutId);
    }

    let upstreamPayload = null;
    try {
      upstreamPayload = await upstreamResponse.json();
    } catch {
      return sendError(res, 'Python search service returned malformed JSON.', 502);
    }

    if (!upstreamResponse.ok) {
      const detail =
        upstreamPayload?.detail || upstreamPayload?.message || `Python search failed (${upstreamResponse.status})`;
      return sendError(res, String(detail), upstreamResponse.status >= 400 && upstreamResponse.status < 500 ? upstreamResponse.status : 502);
    }

    if (!aggregate && Array.isArray(upstreamPayload?.data)) {
      const deletedSet = await fetchDeletedDocumentIds(
        upstreamPayload.data.map((item) => item?.document_id)
      );
      const filtered = upstreamPayload.data.filter((item) => !deletedSet.has(item?.document_id));
      return sendSuccess(
        res,
        filtered,
        upstreamPayload.message || `Query '${searchQuery}' executed with ${filtered.length} matches`,
        200
      );
    }

    if (aggregate && upstreamPayload?.data && Array.isArray(upstreamPayload.data.results)) {
      const deletedSet = await fetchDeletedDocumentIds(
        upstreamPayload.data.results.map((item) => item?.document_id)
      );
      const filteredResults = upstreamPayload.data.results.filter(
        (item) => !deletedSet.has(item?.document_id)
      );
      const matchedDocs = Array.from(new Set(filteredResults.map((r) => r.document_id))).sort();
      return sendSuccess(
        res,
        {
          ...upstreamPayload.data,
          results: filteredResults,
          total_matches: filteredResults.length,
          documents_matched: matchedDocs,
        },
        upstreamPayload.message || 'Aggregate search executed',
        200
      );
    }

    return sendSuccess(res, upstreamPayload?.data ?? null, upstreamPayload?.message || 'Search completed', 200);
  } catch (err) {
    return next(err);
  }
}

searchRouter.post('/', (req, res, next) => handleSearchProxy(req, res, next, false));
searchRouter.post('/aggregate', (req, res, next) => handleSearchProxy(req, res, next, true));
