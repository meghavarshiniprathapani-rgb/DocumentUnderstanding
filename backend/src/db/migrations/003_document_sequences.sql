CREATE TABLE IF NOT EXISTS document_sequences (
    sequence_name VARCHAR(64) NOT NULL PRIMARY KEY,
    current_val BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO document_sequences (sequence_name, current_val)
SELECT 'document_id', COALESCE(MAX(CAST(SUBSTRING(document_id, 5) AS UNSIGNED)), 100)
FROM documents
WHERE document_id REGEXP '^doc-[0-9]+$'
ON DUPLICATE KEY UPDATE sequence_name = sequence_name;
