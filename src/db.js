import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

const publicColumns = `
  id, delivery_key, status, attempt_count, processing,
  failure_reason, created_at, updated_at, last_attempt_at
`;

export const initializeDatabase = async () => {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
  await pool.query(await fs.readFile(schemaPath, 'utf8'));
};

export const closeDatabase = () => pool.end();

export const pingDatabase = () => pool.query('SELECT 1');

export const insertOrFindEvent = async ({ deliveryKey, payload, rawBodyHash }) => {
  const inserted = await pool.query(
    `INSERT INTO events (id, delivery_key, payload, raw_body_hash)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (delivery_key) DO NOTHING
     RETURNING ${publicColumns}`,
    [crypto.randomUUID(), deliveryKey, JSON.stringify(payload), rawBodyHash]
  );

  if (inserted.rowCount > 0) return { event: inserted.rows[0], duplicate: false };

  const existing = await pool.query(
    `SELECT ${publicColumns} FROM events WHERE delivery_key = $1`,
    [deliveryKey]
  );
  return { event: existing.rows[0], duplicate: true };
};

export const listEvents = async (limit) => {
  const result = await pool.query(
    `SELECT ${publicColumns} FROM events ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
};

export const getEvent = async (id) => {
  const result = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
  return result.rows[0] ?? null;
};

export const claimInitialEvent = async (id) => {
  const result = await pool.query(
    `UPDATE events
     SET processing = TRUE, attempt_count = attempt_count + 1,
         last_attempt_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'Received' AND processing = FALSE
     RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
};

export const claimRetryEvent = async (id) => {
  const result = await pool.query(
    `UPDATE events
     SET processing = TRUE, attempt_count = attempt_count + 1,
         last_attempt_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'Failed' AND processing = FALSE
     RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
};

export const markCompleted = async (id) => {
  const result = await pool.query(
    `UPDATE events SET status = 'Completed', processing = FALSE,
       failure_reason = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING ${publicColumns}`,
    [id]
  );
  return result.rows[0];
};

export const markFailed = async (id, reason) => {
  const result = await pool.query(
    `UPDATE events SET status = 'Failed', processing = FALSE,
       failure_reason = $2, updated_at = NOW()
     WHERE id = $1 RETURNING ${publicColumns}`,
    [id, reason.slice(0, 1000)]
  );
  return result.rows[0];
};

export const publicEvent = (event) => ({
  id: event.id,
  deliveryKey: event.delivery_key,
  status: event.status,
  attemptCount: event.attempt_count,
  processing: event.processing,
  createdAt: event.created_at,
  updatedAt: event.updated_at,
  lastAttemptAt: event.last_attempt_at
});

export const privateEvent = (event) => ({
  ...publicEvent(event),
  failureReason: event.failure_reason,
  payload: event.payload
});

