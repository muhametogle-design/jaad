import { getDb } from '../database';
import type { Wastage } from '../../types';
import { nowIso } from '../../lib/time';
import { EPS, round2 } from '../../lib/cogs';

/**
 * Record spoilage / offload. Decrements the specific batch line and
 * snapshots the monetary loss (kg × that line's COGS) for the P&L.
 */
export async function recordWastage(
  batchInventoryId: number,
  kg: number,
  reason: string,
): Promise<Wastage> {
  const db = getDb();
  const k = round2(kg);
  if (k <= 0) throw new Error('Wastage weight must be positive.');

  const row = await db.getFirstAsync<{
    id: number;
    batch_id: number;
    khat_type_id: number;
    remaining_kg: number;
    cogs_per_kg: number;
  }>(`SELECT id, batch_id, khat_type_id, remaining_kg, cogs_per_kg FROM batch_inventory WHERE id = ?`, [
    batchInventoryId,
  ]);
  if (!row) throw new Error('Stock line not found.');
  if (k > row.remaining_kg + EPS) {
    throw new Error(`Only ${round2(row.remaining_kg)} KG left on this line.`);
  }

  const now = nowIso();
  const loss = round2(k * row.cogs_per_kg);
  let wastageId = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE batch_inventory SET remaining_kg = remaining_kg - ? WHERE id = ?`, [
      k,
      row.id,
    ]);
    const res = await db.runAsync(
      `INSERT INTO wastage
        (batch_inventory_id, khat_type_id, batch_id, kg, reason, cogs_per_kg, loss, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.khat_type_id, row.batch_id, k, reason, row.cogs_per_kg, loss, now],
    );
    wastageId = Number(res.lastInsertRowId);
  });

  const w = await db.getFirstAsync<Wastage>(`SELECT * FROM wastage WHERE id = ?`, [wastageId]);
  if (!w) throw new Error('Wastage was not recorded.');
  return w;
}

/** Total wastage loss on a given local day. */
export async function wastageLossOn(dayKey: string): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(loss), 0) AS s FROM wastage
     WHERE strftime('%Y-%m-%d', created_at, 'localtime') = ?`,
    [dayKey],
  );
  return row?.s ?? 0;
}
