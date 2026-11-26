CREATE TABLE IF NOT EXISTS cleanup_queue (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    file_path VARCHAR(512) NOT NULL,
    reason VARCHAR(128) NOT NULL,
    doc_id BIGINT NULL,
    attempts INT NOT NULL DEFAULT 0,
    status ENUM('pending', 'failed', 'completed') NOT NULL DEFAULT 'pending',
    last_error TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cleanup_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
