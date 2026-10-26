import { getDb } from '../database';
import type { QueueItem, QueueKind } from '../../types';
import { nowIso } from '../../lib/time';

const MAX_ATTEMPTS = 8;

export async function enqueue(kind: QueueKind, payload: unknown): Promise<number> {
  const db = getDb();
  const res = await db.runAsync(
    `INSERT INTO sync_queue (kind, payload, status, attempts, created_at)
     VALUES (?, ?, 'pending', 0, ?)`,
    [kind, JSON.stringify(payload), nowIso()],
  );
  return Number(res.lastInsertRowId);
}

export async function listPending(): Promise<QueueItem[]> {
  const db = getDb();
  return db.getAllAsync<QueueItem>(
    `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY id ASC`,
  );
}

export async function listAll(): Promise<QueueItem[]> {
  const db = getDb();
  return db.getAllAsync<QueueItem>(`SELECT * FROM sync_queue ORDER BY id DESC LIMIT 100`);
}

export async function markProcessed(id: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE sync_queue SET status = 'processed', processed_at = ? WHERE id = ?`,
    [nowIso(), id],
  );
}

/** Increment attempts; flip to failed once the retry cap is exceeded. */
export async function recordAttempt(id: number): Promise<boolean> {
  const db = getDb();
  await db.runAsync(`UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?`, [id]);
  const row = await db.getFirstAsync<{ attempts: number }>(
    `SELECT attempts FROM sync_queue WHERE id = ?`,
    [id],
  );
  if (row && row.attempts >= MAX_ATTEMPTS) {
    await db.runAsync(`UPDATE sync_queue SET status = 'failed' WHERE id = ?`, [id]);
    return false;
  }
  return true;
}

export async function clearFinished(): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM sync_queue WHERE status IN ('processed', 'failed')`);
}
