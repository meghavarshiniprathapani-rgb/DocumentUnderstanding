-- =============================================================================
-- Migration: 002_schema_compatibility.sql
-- Description: Schema compatibility, data integrity constraints & audit preservation
-- Engine: MySQL 8.4+ (InnoDB, utf8mb4)
-- Scope:
--   1. documents: Add stable unique document_id (e.g. doc-001) while preserving numeric id
--   2. documents: Add deleted_at for soft deletion
--   3. jobs: Change fk_jobs_document from ON DELETE CASCADE to ON DELETE RESTRICT
--   4. elements: Rename reading_idx to reading_order (preserving values)
--   5. elements: Add check constraints (confidence [0,1], page >= 1, reading_order >= 0)
--   6. eval_runs: Add provenance columns (dataset_split_hash, acceptance_hash)
-- =============================================================================

-- 1. Documents: Add stable external document_id
ALTER TABLE documents
    ADD COLUMN document_id VARCHAR(64) NULL AFTER id;

-- Backfill existing rows if any exist
UPDATE documents
SET document_id = COALESCE(
    REGEXP_SUBSTR(filename, 'doc-[0-9]+'),
    REGEXP_SUBSTR(path, 'doc-[0-9]+'),
    CONCAT('doc-', LPAD(id, 3, '0'))
)
WHERE document_id IS NULL;

ALTER TABLE documents
    MODIFY COLUMN document_id VARCHAR(64) NOT NULL;

ALTER TABLE documents
    ADD CONSTRAINT uq_documents_document_id UNIQUE (document_id);

-- 2. Documents: Soft Deletion Audit Support
ALTER TABLE documents
    ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at,
    ADD INDEX idx_documents_deleted_at (deleted_at);

-- 3. Jobs: Prevent cascading destruction of job history (Audit Preservation)
ALTER TABLE jobs
    DROP FOREIGN KEY fk_jobs_document;

ALTER TABLE jobs
    ADD CONSTRAINT fk_jobs_document FOREIGN KEY (doc_id)
        REFERENCES documents (id) ON DELETE RESTRICT;

-- 4. Elements: Rename reading_idx to reading_order
ALTER TABLE elements
    RENAME COLUMN reading_idx TO reading_order;

ALTER TABLE elements
    RENAME INDEX idx_elements_doc_mode_reading TO idx_elements_doc_mode_reading_order;

-- 5. Elements: Integrity Check Constraints
ALTER TABLE elements
    ADD CONSTRAINT chk_elements_confidence CHECK (confidence >= 0.0 AND confidence <= 1.0);

ALTER TABLE elements
    ADD CONSTRAINT chk_elements_page CHECK (page >= 1);

ALTER TABLE elements
    ADD CONSTRAINT chk_elements_reading_order CHECK (reading_order >= 0);

-- 6. Eval Runs: Acceptance & Dataset Provenance Tracking
ALTER TABLE eval_runs
    ADD COLUMN dataset_split_hash CHAR(64) NULL AFTER split,
    ADD COLUMN acceptance_hash CHAR(64) NULL AFTER dataset_split_hash,
    ADD INDEX idx_eval_runs_acceptance_hash (acceptance_hash);
