ALTER TABLE jobs
    ADD COLUMN locked_by VARCHAR(128) NULL DEFAULT NULL AFTER attempts,
    ADD COLUMN locked_at TIMESTAMP NULL DEFAULT NULL AFTER locked_by,
    ADD COLUMN heartbeat_at TIMESTAMP NULL DEFAULT NULL AFTER locked_at,
    ADD COLUMN lease_timeout_seconds INT NOT NULL DEFAULT 300 AFTER heartbeat_at,
    ADD INDEX idx_jobs_status_heartbeat (status, heartbeat_at),
    ADD INDEX idx_jobs_status_mode (status, mode);
