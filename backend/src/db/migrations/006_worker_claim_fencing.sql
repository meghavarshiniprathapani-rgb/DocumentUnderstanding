ALTER TABLE jobs
    ADD COLUMN claim_token CHAR(36) NULL DEFAULT NULL AFTER locked_by,
    ADD COLUMN lease_generation INT NOT NULL DEFAULT 0 AFTER claim_token;
