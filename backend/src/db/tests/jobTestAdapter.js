/**
 * Retrieva AI — Job Test Adapter (AIML-59 / M1.5.5)
 * 
 * Test-Only Adapter for Deterministic Concurrency & Failure Verification:
 * - Kept strictly in the test directory to isolate transaction hooks from the public repository export surface.
 * - Fails closed: only allows execution when NODE_ENV === 'test' or 'testing'.
 * - Preserves deterministic repository-level concurrency verification while keeping production claimJob() safe.
 */

import {
  _executeClaimJobForTest,
  _executeHeartbeatJobForTest,
  _executeCompleteJobForTest,
  _executeFailJobForTest,
  _executeRecoverExpiredLeasesForTest,
} from '../repositories/jobRepository.js';

export const jobTestAdapter = Object.freeze({
  /**
   * Invokes the internal job claim flow with an isolated post-lock hook for concurrency testing.
   * Fails closed if invoked outside an explicit test environment.
   * 
   * @param {string} [workerId=null] - Diagnostic worker ID
   * @param {Object} [options={}] - Query options (e.g. mode)
   * @param {Object} [hooks={}]
   * @param {Function} [hooks.afterLock] - Hook executed while row-level lock is held
   * @returns {Promise<Object|null>}
   */
  claimJobWithHook: async (workerId = null, options = {}, hooks = {}) => {
    return _executeClaimJobForTest(workerId, options, hooks);
  },
  heartbeatJobWithHook: async (jobId, workerId, claimTokenOrOptions = {}, hooks = {}) => {
    return _executeHeartbeatJobForTest(jobId, workerId, claimTokenOrOptions, hooks);
  },
  completeJobWithHook: async (jobId, workerId, details = {}, hooks = {}) => {
    return _executeCompleteJobForTest(jobId, workerId, details, hooks);
  },
  failJobWithHook: async (jobId, workerId, details = {}, hooks = {}) => {
    return _executeFailJobForTest(jobId, workerId, details, hooks);
  },
  recoverExpiredLeasesWithHook: async (options = {}, hooks = {}) => {
    return _executeRecoverExpiredLeasesForTest(options, hooks);
  },
});
