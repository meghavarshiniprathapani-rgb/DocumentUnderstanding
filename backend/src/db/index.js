/**
 * Retrieva AI — Database Layer Entry Point (AIML-59 / M1.4)
 */

export * from './pool.js';
export * from './repositories/index.js';
export {
  runMigrations,
  verifySchema,
  computeChecksum,
  detectPartialSchema,
  preflightDocumentIdentities,
  verifyDocumentIdentities,
  acquireLock,
  releaseLock,
  LOCK_NAME,
  LOCK_TIMEOUT_SECONDS,
  MigrationLockError,
  ChecksumMismatchError,
  MigrationExecutionError,
  PostMigrationVerificationError,
  DocumentIdentityError,
  DocumentIdentityUnresolvableError,
  DocumentIdentityMismatchError,
} from './migrator.js';
