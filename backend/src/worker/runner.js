import { closePool } from '../db/pool.js';
import * as defaultDocumentRepository from '../db/repositories/documentRepository.js';
import * as defaultJobRepository from '../db/repositories/jobRepository.js';
import { DEFAULT_WORKER_CONFIG, loadWorkerConfig } from './config.js';
import { createExtractionJobHandler } from './extractionHandler.js';
import { createWorkerLogger } from './logger.js';
import { createPythonExtractionClient } from './pythonClient.js';
import { collectKnownSecrets, sanitizeWorkerError } from './sanitize.js';

export class WorkerRunner {
  constructor(options = {}) {
    const rawEnv = options.env || process.env;
    const hasCustomHandler = typeof options.jobHandler === 'function';
    const requireInternalApiSecret =
      options.requireInternalApiSecret !== undefined
        ? Boolean(options.requireInternalApiSecret)
        : !hasCustomHandler;

    if (
      options.config &&
      typeof options.config === 'object' &&
      options.config.workerId &&
      (hasCustomHandler || options.config.internalApiSecretConfigured !== undefined)
    ) {
      const hasCoreFields =
        options.config.concurrency !== undefined &&
        options.config.pollIntervalMs !== undefined &&
        options.config.heartbeatIntervalMs !== undefined &&
        options.config.shutdownGraceMs !== undefined &&
        options.config.maxAttempts !== undefined &&
        options.config.leaseRecoveryIntervalMs !== undefined &&
        options.config.leaseRecoveryBatchSize !== undefined;
      if (hasCoreFields && Object.isFrozen(options.config)) {
        this.config = options.config;
      } else {
        const mergedConfig = {
          ...DEFAULT_WORKER_CONFIG,
          ...options.config,
        };
        if (options.config.internalApiSecret !== undefined) {
          Object.defineProperty(mergedConfig, 'internalApiSecret', {
            value: options.config.internalApiSecret,
            enumerable: false,
            writable: false,
            configurable: false,
          });
        }
        this.config = mergedConfig;
      }
    } else {
      this.config = loadWorkerConfig(options.config || {}, rawEnv, {
        requireInternalApiSecret,
      });
    }

    this.workerId = this.config.workerId;
    this.repository = options.repository || defaultJobRepository;
    this.documentRepository = options.documentRepository || defaultDocumentRepository;
    this.elementRepository = options.elementRepository || null;
    this.db = options.db || { closePool };
    this.closeDbOnStop = options.closeDbOnStop !== false;
    this.onExtractionOutcome =
      typeof options.onExtractionOutcome === 'function' ? options.onExtractionOutcome : null;

    const extraSecrets = Array.isArray(options.extraSecrets)
      ? options.extraSecrets
      : options.extraSecrets
        ? [options.extraSecrets]
        : [];
    if (typeof this.config.internalApiSecret === 'string' && this.config.internalApiSecret.length > 0) {
      extraSecrets.push(this.config.internalApiSecret);
    }
    this.secrets = collectKnownSecrets(rawEnv, extraSecrets);

    this.logger =
      options.logger ||
      createWorkerLogger({
        workerId: this.workerId,
        extraSecrets: this.secrets,
        env: rawEnv,
      });

    if (hasCustomHandler) {
      this.pythonClient = options.pythonClient || null;
      this.jobHandler = options.jobHandler;
    } else {
      this.pythonClient =
        options.pythonClient ||
        createPythonExtractionClient({
          baseUrl: this.config.pythonServiceUrl,
          internalApiSecret: this.config.internalApiSecret,
          timeoutMs: this.config.pythonExtractionTimeoutMs,
          fetchImpl: options.fetchImpl,
          extraSecrets: this.secrets,
        });
      this.jobHandler = createExtractionJobHandler({
        documentRepository: this.documentRepository,
        elementRepository: this.elementRepository || undefined,
        pythonClient: this.pythonClient,
        secrets: this.secrets,
      });
    }

    this.state = 'idle';
    this.startedAt = null;
    this.stoppedAt = null;
    this.shutdownReason = null;
    this.databaseClosed = false;
    this.lastPollError = null;
    this.lastRecoveryError = null;
    this.lastRecoveryAt = null;
    this.timedOutJobIds = [];
    this.lastExtractionOutcomes = [];

    this.activeJobs = new Map();
    this._inFlightClaim = null;
    this._pollLoopPromise = null;
    this._pollTimer = null;
    this._pollWakeResolve = null;
    this._recoveryTimer = null;
    this._inFlightRecovery = null;
    this._stopPromise = null;

    this.metrics = {
      pollCycles: 0,
      emptyPolls: 0,
      jobsClaimed: 0,
      jobsCompleted: 0,
      jobsExtracted: 0,
      jobsExtractedClean: 0,
      jobsExtractedDegraded: 0,
      jobsFailed: 0,
      heartbeatsSent: 0,
      heartbeatErrors: 0,
      leaseLosses: 0,
      leaseRecoveryRuns: 0,
      leaseRecoveryErrors: 0,
      jobsRecovered: 0,
      jobsRecoveredRequeued: 0,
      jobsRecoveredFailed: 0,
      pollErrors: 0,
      consecutivePollErrors: 0,
      lastBackoffMs: 0,
      graceTimeouts: 0,
    };
  }

  getState() {
    const activeJobs = Array.from(this.activeJobs.values()).map((entry) => ({
      jobId: entry.job.id,
      docId: entry.job.doc_id,
      mode: entry.job.mode,
      attempts: entry.job.attempts,
      leaseGeneration: entry.leaseGeneration,
      claimTokenPresent: Boolean(entry.claimToken),
      startedAt: new Date(entry.startedAt).toISOString(),
      heartbeatsSent: entry.heartbeatsSent,
      leaseLost: entry.leaseLost,
      graceExpired: entry.graceExpired,
    }));

    return {
      workerId: this.workerId,
      status: this.state,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      shutdownReason: this.shutdownReason,
      shuttingDown: this.state === 'stopping' || this.state === 'stopped',
      config: { ...this.config },
      activeJobCount: this.activeJobs.size,
      activeJobs,
      timedOutJobIds: [...this.timedOutJobIds],
      lastExtractionOutcomes: [...this.lastExtractionOutcomes],
      metrics: { ...this.metrics },
      lastPollError: this.lastPollError,
      lastRecoveryError: this.lastRecoveryError,
      lastRecoveryAt: this.lastRecoveryAt,
      databaseClosed: this.databaseClosed,
    };
  }

  async start() {
    if (this.state === 'running') {
      return this.getState();
    }
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error(`Cannot start worker from state '${this.state}'.`);
    }

    this.state = 'running';
    this.startedAt = new Date().toISOString();
    this.databaseClosed = false;

    this.logger.info('worker_started', {
      concurrency: this.config.concurrency,
      poll_interval_ms: this.config.pollIntervalMs,
      heartbeat_interval_ms: this.config.heartbeatIntervalMs,
      shutdown_grace_ms: this.config.shutdownGraceMs,
      max_attempts: this.config.maxAttempts,
      lease_recovery_interval_ms: this.config.leaseRecoveryIntervalMs,
      lease_recovery_batch_size: this.config.leaseRecoveryBatchSize,
      mode: this.config.mode || null,
      python_service_url: this.config.pythonServiceUrl || null,
      python_extraction_timeout_ms: this.config.pythonExtractionTimeoutMs || null,
      internal_api_secret_configured: Boolean(this.config.internalApiSecretConfigured),
      db_host: this.config.dbHost,
      db_port: this.config.dbPort,
      db_name: this.config.dbName,
    });

    await this._runLeaseRecoveryPass({ trigger: 'startup' });
    if (this.state === 'running' && !this.databaseClosed) {
      this._scheduleRecovery();
      this._pollLoopPromise = this._runPollLoop();
    }
    return this.getState();
  }

  async stop(options = {}) {
    if (this.state === 'stopped') {
      return this._buildStopSummary();
    }
    if (this._stopPromise) {
      return this._stopPromise;
    }

    const reason = options.reason || 'manual';
    this._stopPromise = this._performStop(reason);
    return this._stopPromise;
  }

  async _performStop(reason) {
    if (this.state === 'idle') {
      this._clearRecoveryTimer();
      this.state = 'stopped';
      this.shutdownReason = reason;
      this.stoppedAt = new Date().toISOString();
      if (this.closeDbOnStop) {
        await this._closeDatabaseCleanly();
      }
      return this._buildStopSummary();
    }

    this.state = 'stopping';
    this.shutdownReason = reason;
    this._clearRecoveryTimer();

    this.logger.info('worker_shutdown_initiated', {
      reason,
      active_jobs: this.activeJobs.size,
      shutdown_grace_ms: this.config.shutdownGraceMs,
    });

    this._wakePoll();
    if (this._pollLoopPromise) {
      await Promise.allSettled([this._pollLoopPromise]);
    }

    let graceTimedOut = false;
    const pendingExecutions = Array.from(this.activeJobs.values()).map((entry) => entry.promise);

    if (pendingExecutions.length > 0) {
      const allActivePromise = Promise.allSettled(pendingExecutions);
      let graceTimer = null;

      if (this.config.shutdownGraceMs === 0) {
        graceTimedOut = true;
      } else {
        const timeoutSentinel = new Promise((resolve) => {
          graceTimer = setTimeout(() => resolve('timeout'), this.config.shutdownGraceMs);
        });
        const raceOutcome = await Promise.race([
          allActivePromise.then(() => 'drained'),
          timeoutSentinel,
        ]);
        if (graceTimer) {
          clearTimeout(graceTimer);
        }
        graceTimedOut = raceOutcome === 'timeout';
      }

      if (graceTimedOut) {
        await this._handleGraceExpiration();
      }
    }

    await this._stopRecoveryScheduler({ maxWaitMs: graceTimedOut ? 250 : null });

    if (this.closeDbOnStop) {
      await this._closeDatabaseCleanly();
    }

    this.shutdownReason = graceTimedOut ? 'grace_timeout' : reason === 'manual' ? 'grace_completed' : reason;
    this.state = 'stopped';
    this.stoppedAt = new Date().toISOString();

    this.logger.info('worker_stopped', {
      reason: this.shutdownReason,
      timed_out_job_ids: this.timedOutJobIds,
      database_closed: this.databaseClosed,
    });

    return this._buildStopSummary();
  }

  async _handleGraceExpiration() {
    const remainingEntries = Array.from(this.activeJobs.values());
    const pendingDbOps = [];

    for (const entry of remainingEntries) {
      entry.graceExpired = true;
      this.metrics.graceTimeouts += 1;
      this.timedOutJobIds.push(entry.job.id);
      if (entry.heartbeatTimer) {
        clearTimeout(entry.heartbeatTimer);
        entry.heartbeatTimer = null;
      }
      if (entry.inFlightHeartbeat) {
        pendingDbOps.push(entry.inFlightHeartbeat);
      }
      if (entry.inFlightTransition) {
        pendingDbOps.push(entry.inFlightTransition);
      }
      entry.abortController.abort(new Error('Worker shutdown grace period expired'));
    }

    this.logger.warn('shutdown_grace_timeout', {
      timed_out_jobs: remainingEntries.length,
      timed_out_job_ids: remainingEntries.map((e) => e.job.id),
    });

    if (pendingDbOps.length > 0) {
      let settleTimer = null;
      await Promise.race([
        Promise.allSettled(pendingDbOps),
        new Promise((resolve) => {
          settleTimer = setTimeout(resolve, 250);
        }),
      ]);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
    }
  }

  async _closeDatabaseCleanly() {
    if (this.databaseClosed) {
      return;
    }
    try {
      await this.db.closePool();
      this.databaseClosed = true;
    } catch (err) {
      const sanitized = sanitizeWorkerError(err, this.secrets);
      this.logger.error('database_close_error', {
        error: sanitized.message,
        code: sanitized.code || null,
      });
      throw sanitized;
    }
  }

  _buildStopSummary() {
    return {
      workerId: this.workerId,
      status: this.state,
      shutdownReason: this.shutdownReason,
      timedOutJobIds: [...this.timedOutJobIds],
      lastExtractionOutcomes: [...this.lastExtractionOutcomes],
      databaseClosed: this.databaseClosed,
      metrics: { ...this.metrics },
    };
  }

  _clearRecoveryTimer() {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }

  _scheduleRecovery() {
    this._clearRecoveryTimer();
    if (typeof this.repository?.recoverExpiredLeases !== 'function') {
      return;
    }
    if (this.state !== 'running' || this.databaseClosed) {
      return;
    }

    const recoveryIntervalMs =
      Number.isInteger(Number(this.config.leaseRecoveryIntervalMs)) &&
      Number(this.config.leaseRecoveryIntervalMs) >= 20
        ? Number(this.config.leaseRecoveryIntervalMs)
        : DEFAULT_WORKER_CONFIG.leaseRecoveryIntervalMs;

    const timer = setTimeout(() => {
      if (this._recoveryTimer === timer) {
        this._recoveryTimer = null;
      }
      if (this.state !== 'running' || this.databaseClosed) {
        return;
      }
      this._runLeaseRecoveryPass({ trigger: 'periodic' }).finally(() => {
        if (this.state === 'running' && !this.databaseClosed) {
          this._scheduleRecovery();
        }
      });
    }, recoveryIntervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this._recoveryTimer = timer;
  }

  async _stopRecoveryScheduler(options = {}) {
    this._clearRecoveryTimer();
    const inFlight = this._inFlightRecovery;
    if (!inFlight) {
      return;
    }
    const maxWaitMs =
      options && Number.isFinite(options.maxWaitMs) && options.maxWaitMs >= 0
        ? options.maxWaitMs
        : null;

    if (maxWaitMs === null) {
      await Promise.allSettled([inFlight]);
      return;
    }

    let waitTimer = null;
    await Promise.race([
      Promise.allSettled([inFlight]),
      new Promise((resolve) => {
        waitTimer = setTimeout(resolve, maxWaitMs);
      }),
    ]);
    if (waitTimer) {
      clearTimeout(waitTimer);
    }
  }

  async _runLeaseRecoveryPass(options = {}) {
    const trigger = options.trigger || 'periodic';
    if (typeof this.repository?.recoverExpiredLeases !== 'function') {
      return null;
    }
    if (this.state !== 'running' || this.databaseClosed) {
      return null;
    }
    if (this._inFlightRecovery) {
      return this._inFlightRecovery;
    }

    const recoveryPromise = this._executeLeaseRecoveryPass(trigger);
    this._inFlightRecovery = recoveryPromise;
    try {
      return await recoveryPromise;
    } finally {
      if (this._inFlightRecovery === recoveryPromise) {
        this._inFlightRecovery = null;
      }
    }
  }

  async _executeLeaseRecoveryPass(trigger) {
    this.metrics.leaseRecoveryRuns += 1;
    this.lastRecoveryAt = new Date().toISOString();

    const rawBatchLimit = Number(this.config.leaseRecoveryBatchSize);
    const batchLimit =
      Number.isInteger(rawBatchLimit) && rawBatchLimit >= 1 && rawBatchLimit <= 100
        ? rawBatchLimit
        : DEFAULT_WORKER_CONFIG.leaseRecoveryBatchSize;
    const rawMaxAttempts = Number(this.config.maxAttempts);
    const maxAttempts =
      Number.isInteger(rawMaxAttempts) && rawMaxAttempts >= 1
        ? rawMaxAttempts
        : DEFAULT_WORKER_CONFIG.maxAttempts;
    const maxBatchesPerPass = 10;
    let totalRecovered = 0;
    let totalRequeued = 0;
    let totalFailed = 0;
    const recoveredJobIds = [];

    try {
      for (let batch = 0; batch < maxBatchesPerPass; batch += 1) {
        if (this.state !== 'running' || this.databaseClosed) {
          break;
        }
        const batchResult = await this.repository.recoverExpiredLeases({
          limit: batchLimit,
          maxAttempts,
        });

        const recoveredCount = Number(batchResult?.recoveredCount) || 0;
        const requeuedCount = Number(batchResult?.requeuedCount) || 0;
        const failedCount = Number(batchResult?.failedCount) || 0;
        const jobs = Array.isArray(batchResult?.jobs) ? batchResult.jobs : [];

        totalRecovered += recoveredCount;
        totalRequeued += requeuedCount;
        totalFailed += failedCount;
        for (const item of jobs) {
          if (item?.job?.id !== undefined) {
            recoveredJobIds.push(item.job.id);
          }
        }

        if (recoveredCount < batchLimit) {
          break;
        }
      }

      this.lastRecoveryError = null;
      this.metrics.jobsRecovered += totalRecovered;
      this.metrics.jobsRecoveredRequeued += totalRequeued;
      this.metrics.jobsRecoveredFailed += totalFailed;

      if (totalRecovered > 0) {
        this.logger.info('expired_leases_recovered', {
          trigger,
          recovered_count: totalRecovered,
          requeued_count: totalRequeued,
          failed_count: totalFailed,
          recovered_job_ids: recoveredJobIds,
        });
      }

      if (totalRequeued > 0 && this.state === 'running' && !this.databaseClosed) {
        this._wakePoll();
      }

      return {
        recoveredCount: totalRecovered,
        requeuedCount: totalRequeued,
        failedCount: totalFailed,
        jobIds: recoveredJobIds,
      };
    } catch (err) {
      this.metrics.leaseRecoveryErrors += 1;
      const sanitized = sanitizeWorkerError(err, this.secrets);
      this.lastRecoveryError = {
        message: sanitized.message,
        code: sanitized.code || null,
        at: new Date().toISOString(),
        trigger,
      };
      this.logger.error('lease_recovery_error', {
        trigger,
        error: sanitized.message,
        code: sanitized.code || null,
      });
      return null;
    }
  }

  _wakePoll() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._pollWakeResolve) {
      const resolve = this._pollWakeResolve;
      this._pollWakeResolve = null;
      resolve();
    }
  }

  _waitForWake(delayMs) {
    if (this.state !== 'running') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._pollWakeResolve = resolve;
      if (typeof delayMs === 'number' && delayMs >= 0) {
        this._pollTimer = setTimeout(() => {
          this._pollTimer = null;
          if (this._pollWakeResolve === resolve) {
            this._pollWakeResolve = null;
            resolve();
          }
        }, delayMs);
      }
    });
  }

  async _runPollLoop() {
    while (this.state === 'running') {
      if (this.activeJobs.size >= this.config.concurrency) {
        await this._waitForWake(null);
        continue;
      }

      let claimedAny = false;
      let queueEmpty = false;
      let pollFailed = false;
      let backoffMs = 0;

      while (this.state === 'running' && this.activeJobs.size < this.config.concurrency) {
        this.metrics.pollCycles += 1;
        try {
          const claimOptions = this.config.mode ? { mode: this.config.mode } : {};
          const claimPromise = this.repository.claimJob(this.workerId, claimOptions);
          this._inFlightClaim = claimPromise;
          let claimedJob = null;
          try {
            claimedJob = await claimPromise;
          } finally {
            this._inFlightClaim = null;
          }

          this.metrics.consecutivePollErrors = 0;
          this.metrics.lastBackoffMs = 0;
          this.lastPollError = null;

          if (!claimedJob) {
            this.metrics.emptyPolls += 1;
            queueEmpty = true;
            break;
          }

          if (!this._hasValidClaimOwnership(claimedJob)) {
            this.logger.error('invalid_claim_ownership', {
              job_id: claimedJob.id,
              locked_by: claimedJob.locked_by || null,
              has_claim_token: Boolean(claimedJob.claim_token),
              lease_generation: claimedJob.lease_generation || 0,
            });
            throw new Error(`Claimed job ${claimedJob.id} lacked required claim ownership metadata.`);
          }

          claimedAny = true;
          this._startJobExecution(claimedJob);
        } catch (err) {
          pollFailed = true;
          this.metrics.pollErrors += 1;
          this.metrics.consecutivePollErrors += 1;
          backoffMs = Math.min(
            this.config.maxPollErrorBackoffMs,
            this.config.pollErrorBackoffMs * 2 ** (this.metrics.consecutivePollErrors - 1)
          );
          this.metrics.lastBackoffMs = backoffMs;
          const sanitized = sanitizeWorkerError(err, this.secrets);
          this.lastPollError = sanitized.message;
          this.logger.error('poll_error', {
            error: sanitized.message,
            code: sanitized.code || null,
            consecutive_errors: this.metrics.consecutivePollErrors,
            backoff_ms: backoffMs,
          });
          break;
        }
      }

      if (this.state !== 'running') {
        break;
      }

      if (pollFailed) {
        await this._waitForWake(backoffMs);
      } else if (queueEmpty) {
        await this._waitForWake(this.config.pollIntervalMs);
      } else if (!claimedAny && this.activeJobs.size >= this.config.concurrency) {
        await this._waitForWake(null);
      }
    }
  }

  _hasValidClaimOwnership(job) {
    return (
      Boolean(job) &&
      Number.isInteger(job.id) &&
      job.id > 0 &&
      job.locked_by === this.workerId &&
      typeof job.claim_token === 'string' &&
      job.claim_token.trim().length > 0 &&
      Number.isInteger(job.lease_generation) &&
      job.lease_generation >= 1
    );
  }

  _startJobExecution(job) {
    this.metrics.jobsClaimed += 1;
    const entry = {
      job,
      claimToken: job.claim_token,
      leaseGeneration: job.lease_generation,
      startedAt: Date.now(),
      heartbeatTimer: null,
      inFlightHeartbeat: null,
      inFlightTransition: null,
      heartbeatsSent: 0,
      leaseLost: false,
      graceExpired: false,
      finished: false,
      abortController: new AbortController(),
      promise: null,
    };

    this.activeJobs.set(job.id, entry);
    this._scheduleHeartbeat(entry);
    entry.promise = this._executeClaimedJob(entry);
    entry.promise.catch(() => {});
  }

  _scheduleHeartbeat(entry) {
    if (entry.finished || entry.graceExpired || entry.leaseLost || this.state === 'stopped') {
      return;
    }

    entry.heartbeatTimer = setTimeout(() => {
      entry.heartbeatTimer = null;
      if (entry.finished || entry.graceExpired || entry.leaseLost || this.state === 'stopped') {
        return;
      }

      const hbPromise = (async () => {
        try {
          await this.repository.heartbeatJob(entry.job.id, this.workerId, {
            claimToken: entry.claimToken,
            leaseGeneration: entry.leaseGeneration,
          });
          entry.heartbeatsSent += 1;
          this.metrics.heartbeatsSent += 1;
        } catch (err) {
          this.metrics.heartbeatErrors += 1;
          const sanitized = sanitizeWorkerError(err, this.secrets);
          const isOwnershipLoss =
            err?.name === 'LeaseOwnershipError' ||
            err?.code === 'ERR_LEASE_OWNERSHIP' ||
            err?.name === 'InvalidJobTransitionError' ||
            err?.code === 'ERR_INVALID_JOB_TRANSITION';

          if (isOwnershipLoss) {
            entry.leaseLost = true;
            this.metrics.leaseLosses += 1;
            this.logger.warn('heartbeat_lease_lost', {
              job_id: entry.job.id,
              lease_generation: entry.leaseGeneration,
              error: sanitized.message,
            });
            entry.abortController.abort(sanitized);
            return;
          }

          this.logger.warn('heartbeat_error', {
            job_id: entry.job.id,
            lease_generation: entry.leaseGeneration,
            error: sanitized.message,
            code: sanitized.code || null,
          });
        } finally {
          if (entry.inFlightHeartbeat === hbPromise) {
            entry.inFlightHeartbeat = null;
          }
          if (!entry.finished && !entry.graceExpired && !entry.leaseLost && this.state !== 'stopped') {
            this._scheduleHeartbeat(entry);
          }
        }
      })();

      entry.inFlightHeartbeat = hbPromise;
    }, this.config.heartbeatIntervalMs);
  }

  async _stopEntryHeartbeat(entry) {
    if (entry.heartbeatTimer) {
      clearTimeout(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }
    if (entry.inFlightHeartbeat) {
      await Promise.allSettled([entry.inFlightHeartbeat]);
    }
  }

  async _executeClaimedJob(entry) {
    const executionContext = {
      job: entry.job,
      jobId: entry.job.id,
      workerId: this.workerId,
      claimToken: entry.claimToken,
      leaseGeneration: entry.leaseGeneration,
      attempt: entry.job.attempts,
      signal: entry.abortController.signal,
      startedAt: entry.startedAt,
    };

    try {
      const handlerResult = await this.jobHandler(executionContext);
      if (entry.graceExpired || entry.leaseLost) {
        return;
      }

      if (
        !handlerResult ||
        typeof handlerResult !== 'object' ||
        (handlerResult.status !== 'done' && handlerResult.status !== 'degraded')
      ) {
        const unrecognizedErr = new Error('Handler resolved without a valid pipeline completion status.');
        unrecognizedErr.retryable = false;
        throw unrecognizedErr;
      }

      entry.finished = true;
      await this._stopEntryHeartbeat(entry);

      if (entry.graceExpired || entry.leaseLost) {
        return;
      }

      const elapsedSeconds = Number(((Date.now() - entry.startedAt) / 1000).toFixed(3));
      const completionStatus = handlerResult.status;
      const completionSeconds =
        handlerResult.seconds !== undefined ? handlerResult.seconds : elapsedSeconds;
      const completionError =
        handlerResult.error !== undefined ? handlerResult.error : undefined;

      const completePromise = this.repository.completeJob(entry.job.id, this.workerId, {
        claimToken: entry.claimToken,
        leaseGeneration: entry.leaseGeneration,
        status: completionStatus,
        seconds: completionSeconds,
        error: completionError,
        documentUpdate: handlerResult.documentUpdate,
      });
      entry.inFlightTransition = completePromise;
      try {
        await completePromise;
      } finally {
        entry.inFlightTransition = null;
      }

      if (entry.graceExpired || entry.leaseLost) {
        return;
      }

      let outcomeSummary = null;
      if (handlerResult.pipelineTelemetry) {
        outcomeSummary = this._recordExtractionOutcome(
          entry,
          {
            ...handlerResult.pipelineTelemetry,
            outcome: 'completed',
            jobStatus: completionStatus,
            persisted: true,
          },
          completionSeconds
        );
      }

      this.metrics.jobsCompleted += 1;
      this.logger.info('job_completed', {
        job_id: entry.job.id,
        doc_id: entry.job.doc_id,
        document_id: outcomeSummary?.documentId || null,
        mode: entry.job.mode,
        status: completionStatus,
        elements_inserted: handlerResult.pipelineTelemetry?.persistedElementsCount ?? null,
        search_verified: Boolean(handlerResult.pipelineTelemetry?.searchVerified),
        lease_generation: entry.leaseGeneration,
        attempts: entry.job.attempts,
        seconds: completionSeconds,
      });

      if (outcomeSummary && this.onExtractionOutcome) {
        await this.onExtractionOutcome(outcomeSummary, handlerResult.pipelineTelemetry.extractionResult || null);
      }
    } catch (err) {
      entry.finished = true;
      await this._stopEntryHeartbeat(entry);

      if (entry.graceExpired || entry.leaseLost) {
        return;
      }

      const isOwnershipLoss =
        err?.name === 'LeaseOwnershipError' ||
        err?.code === 'ERR_LEASE_OWNERSHIP' ||
        err?.name === 'InvalidJobTransitionError' ||
        err?.code === 'ERR_INVALID_JOB_TRANSITION';

      if (isOwnershipLoss) {
        entry.leaseLost = true;
        this.metrics.leaseLosses += 1;
        this.logger.warn('job_ownership_lost', {
          job_id: entry.job.id,
          lease_generation: entry.leaseGeneration,
          error: sanitizeWorkerError(err, this.secrets).message,
        });
        return;
      }

      const sanitized = sanitizeWorkerError(err, this.secrets);
      const elapsedSeconds = Number(((Date.now() - entry.startedAt) / 1000).toFixed(3));
      try {
        const failPromise = this.repository.failJob(entry.job.id, this.workerId, {
          claimToken: entry.claimToken,
          leaseGeneration: entry.leaseGeneration,
          error: sanitized.message,
          seconds: elapsedSeconds,
          maxAttempts: this.config.maxAttempts,
          retryable: err?.retryable !== false,
        });
        entry.inFlightTransition = failPromise;
        let failedRecord = null;
        try {
          failedRecord = await failPromise;
        } finally {
          entry.inFlightTransition = null;
        }

        this.metrics.jobsFailed += 1;
        this.logger.warn('job_failed', {
          job_id: entry.job.id,
          doc_id: entry.job.doc_id,
          mode: entry.job.mode,
          lease_generation: entry.leaseGeneration,
          attempts: entry.job.attempts,
          retryable: Boolean(failedRecord?.retryable),
          error: sanitized.message,
        });
      } catch (failErr) {
        const sanitizedFail = sanitizeWorkerError(failErr, this.secrets);
        const failOwnershipLost =
          failErr?.name === 'LeaseOwnershipError' ||
          failErr?.code === 'ERR_LEASE_OWNERSHIP' ||
          failErr?.name === 'InvalidJobTransitionError' ||
          failErr?.code === 'ERR_INVALID_JOB_TRANSITION';
        if (failOwnershipLost) {
          entry.leaseLost = true;
          this.metrics.leaseLosses += 1;
        }
        this.logger.error('job_fail_transition_error', {
          job_id: entry.job.id,
          lease_generation: entry.leaseGeneration,
          error: sanitizedFail.message,
        });
      }
    } finally {
      await this._stopEntryHeartbeat(entry);
      this.activeJobs.delete(entry.job.id);
      if (this.state === 'running') {
        this._wakePoll();
      }
    }
  }

  _recordExtractionOutcome(entry, handlerResult, elapsedSeconds) {
    const result = handlerResult.extractionResult || null;
    const isDegraded = Boolean(handlerResult.isDegraded || handlerResult.extractionStatus === 'degraded');

    this.metrics.jobsExtracted += 1;
    if (isDegraded) {
      this.metrics.jobsExtractedDegraded += 1;
    } else {
      this.metrics.jobsExtractedClean += 1;
    }

    const summary = {
      jobId: entry.job.id,
      docId: entry.job.doc_id,
      documentId: result?.documentId || null,
      mode: entry.job.mode,
      outcome: handlerResult.outcome || 'persist_and_complete',
      jobStatus: handlerResult.jobStatus || handlerResult.status || null,
      persisted: Boolean(handlerResult.persisted),
      searchVerified: Boolean(handlerResult.searchVerified),
      extractionStatus: handlerResult.extractionStatus,
      isDegraded,
      pageCount: result?.pageCount ?? null,
      elementCount: result?.elementCount ?? null,
      processingTimeMs: result?.processingTimeMs ?? null,
      indexingStatus: handlerResult.indexingStatus ?? result?.indexingStatus ?? null,
      latestVersionIndexed:
        handlerResult.indexingDiagnostics?.latestVersionIndexed ??
        result?.indexingDiagnostics?.latestVersionIndexed ??
        null,
      searchable:
        handlerResult.indexingDiagnostics?.searchable ??
        result?.indexingDiagnostics?.searchable ??
        null,
      fallbackOccurred: Boolean(result?.extractor?.fallbackOccurred),
      extractorName: result?.extractor?.name ?? null,
      leaseGeneration: entry.leaseGeneration,
      attempts: entry.job.attempts,
      seconds: elapsedSeconds,
      recordedAt: new Date().toISOString(),
    };

    this.lastExtractionOutcomes.push(summary);
    if (this.lastExtractionOutcomes.length > 50) {
      this.lastExtractionOutcomes.shift();
    }

    const logFields = {
      job_id: entry.job.id,
      doc_id: entry.job.doc_id,
      document_id: summary.documentId,
      mode: entry.job.mode,
      outcome: 'extracted',
      extraction_status: summary.extractionStatus,
      is_degraded: isDegraded,
      page_count: summary.pageCount,
      element_count: summary.elementCount,
      indexing_status: summary.indexingStatus,
      latest_version_indexed: summary.latestVersionIndexed,
      searchable: summary.searchable,
      fallback_occurred: summary.fallbackOccurred,
      lease_generation: entry.leaseGeneration,
      attempts: entry.job.attempts,
      seconds: elapsedSeconds,
    };

    if (isDegraded) {
      this.logger.warn('job_extracted_degraded', logFields);
    } else {
      this.logger.info('job_extracted', logFields);
    }

    return summary;
  }
}

export function createWorker(options = {}) {
  return new WorkerRunner(options);
}
