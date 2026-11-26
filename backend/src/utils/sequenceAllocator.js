import { query } from '../db/pool.js';

let tableEnsured = false;

export async function ensureSequenceTable(runner = { query }) {
  if (tableEnsured) {
    return;
  }

  await runner.query(`
    INSERT INTO document_sequences (sequence_name, current_val)
    SELECT 'document_id', COALESCE(MAX(CAST(SUBSTRING(document_id, 5) AS UNSIGNED)), 100)
    FROM documents
    WHERE document_id REGEXP '^doc-[0-9]+$'
    ON DUPLICATE KEY UPDATE sequence_name = sequence_name
  `);

  tableEnsured = true;
}

export async function allocateNextDocumentId(connection = null) {
  const runner = connection || { query };
  await ensureSequenceTable(runner);

  const [updateResult] = await runner.query(
    `UPDATE document_sequences
     SET current_val = LAST_INSERT_ID(current_val + 1)
     WHERE sequence_name = ?`,
    ['document_id']
  );

  let nextVal = updateResult?.insertId;
  if (!nextVal) {
    const [rows] = await runner.query('SELECT LAST_INSERT_ID() AS next_val');
    nextVal = rows[0]?.next_val;
  }

  return `doc-${String(nextVal).padStart(3, '0')}`;
}

export async function resetSequenceForTest(startVal = 100, connection = null) {
  const runner = connection || { query };
  await ensureSequenceTable(runner);
  await runner.query(
    `UPDATE document_sequences SET current_val = ? WHERE sequence_name = ?`,
    [startVal, 'document_id']
  );
}

export function releaseAllocatedDocumentId(documentId) {
  return documentId;
}
