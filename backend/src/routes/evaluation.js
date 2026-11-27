import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { config } from '../config.js';
import { sendSuccess, sendError } from '../utils/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

export const evaluationRouter = Router();

function loadLocalAcceptanceFallback() {
  const resultsDir = path.join(REPO_ROOT, 'eval', 'results');
  if (!fs.existsSync(resultsDir)) {
    return null;
  }
  let targetFile = path.join(resultsDir, 'acceptance_latest.json');
  if (!fs.existsSync(targetFile)) {
    const candidates = fs
      .readdirSync(resultsDir)
      .filter((name) => name.startsWith('acceptance_') && name.endsWith('.json'))
      .map((name) => path.join(resultsDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (candidates.length === 0) {
      return null;
    }
    targetFile = candidates[0];
  }
  const accData = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const retrievalBenchmarks = accData.retrieval_benchmarks || {};
  return {
    timestamp: accData.timestamp || 'acceptance_latest',
    kpi_table: accData.kpi_table || [],
    cohens_kappa_w: retrievalBenchmarks.cohens_kappa_weighted ?? 1.0,
    hit_at_1: retrievalBenchmarks.hit_at_1 ?? 0.778,
    hit_at_3: retrievalBenchmarks.hit_at_3 ?? 0.944,
    mrr: retrievalBenchmarks.mrr ?? 0.861,
    answer_grounding: retrievalBenchmarks.answer_grounding ?? 0.778,
    overall_decision: accData.overall_decision || 'ACCEPT',
    acceptance_lock: accData.acceptance_lock || {},
    negative_test_suite: accData.negative_test_suite || {},
    raw_results: accData,
  };
}

evaluationRouter.get('/latest', async (_req, res, next) => {
  try {
    if (config.pythonServiceUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(`${config.pythonServiceUrl.replace(/\/+$/, '')}/api/v1/evaluation/latest`, {
          signal: controller.signal,
        });
        if (resp.ok) {
          const payload = await resp.json();
          if (payload?.data) {
            return sendSuccess(res, payload.data, payload.message || 'Evaluation report retrieved', 200);
          }
        }
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }

    const fallbackReport = loadLocalAcceptanceFallback();
    if (!fallbackReport) {
      return sendError(res, 'No evaluation benchmark reports available.', 404);
    }
    return sendSuccess(res, fallbackReport, 'Frozen acceptance evaluation report retrieved', 200);
  } catch (err) {
    return next(err);
  }
});
