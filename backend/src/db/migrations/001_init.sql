-- =============================================================================
-- Migration: 001_init.sql
-- Description: Initial relational schema for Retrieva AI (AIML-59)
-- Engine: MySQL 8 (InnoDB, utf8mb4)
-- Tables: documents, elements, jobs, eval_runs
-- =============================================================================

-- 1. Documents Table
CREATE TABLE IF NOT EXISTS documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    path VARCHAR(512) NOT NULL,
    pages_count INT NOT NULL DEFAULT 0,
    doc_type VARCHAR(40) NOT NULL DEFAULT 'unclassified',
    split ENUM('dev', 'ac3', 'none') NOT NULL DEFAULT 'none',
    status VARCHAR(40) NOT NULL DEFAULT 'ready',
    metadata JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_documents_sha256 UNIQUE (sha256),
    INDEX idx_documents_split (split),
    INDEX idx_documents_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Elements Table (Preserves all 4 experimental arms)
CREATE TABLE IF NOT EXISTS elements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    doc_id BIGINT NOT NULL,
    mode ENUM('flat', 'reference', 'candidate', 'candidate_ft') NOT NULL,
    type ENUM('text', 'heading', 'table', 'formula', 'figure', 'caption') NOT NULL,
    page INT NOT NULL,
    reading_idx INT NOT NULL,
    text MEDIUMTEXT NULL,
    bbox JSON NULL,
    structured JSON NULL,
    confidence FLOAT NOT NULL DEFAULT 1.0,
    provenance JSON NULL,
    flags JSON NULL,
    model_version VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_elements_document FOREIGN KEY (doc_id)
        REFERENCES documents (id) ON DELETE CASCADE,
    INDEX idx_elements_doc_mode_reading (doc_id, mode, reading_idx),
    INDEX idx_elements_doc_page (doc_id, page),
    INDEX idx_elements_doc_type (doc_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Ingestion Jobs Table (Async queue & status tracking)
CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    doc_id BIGINT NOT NULL,
    mode VARCHAR(30) NOT NULL,
    status ENUM('queued', 'running', 'done', 'degraded', 'failed') NOT NULL DEFAULT 'queued',
    seconds FLOAT NULL,
    error TEXT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_jobs_document FOREIGN KEY (doc_id)
        REFERENCES documents (id) ON DELETE CASCADE,
    INDEX idx_jobs_status (status),
    INDEX idx_jobs_doc_status (doc_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Evaluation Runs Table (Benchmarking & KPI tracking)
CREATE TABLE IF NOT EXISTS eval_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    config_hash CHAR(64) NOT NULL,
    model_versions JSON NOT NULL,
    split VARCHAR(20) NOT NULL,
    kpi JSON NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_eval_runs_config_hash (config_hash),
    INDEX idx_eval_runs_split (split)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
