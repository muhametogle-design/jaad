import { getDb } from '../database';
import type { KhatType } from '../../types';
import { nowIso } from '../../lib/time';

export async function listTypes(includeInactive = false): Promise<KhatType[]> {
  const db = getDb();
  const sql = `SELECT * FROM khat_types ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY name`;
  return db.getAllAsync<KhatType>(sql);
}

export async function getType(id: number): Promise<KhatType | null> {
  const db = getDb();
  return db.getFirstAsync<KhatType>(`SELECT * FROM khat_types WHERE id = ?`, [id]);
}

export async function addType(name: string, cogsPerKg: number, sellPerKg: number): Promise<number> {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Type name is required.');
  if (sellPerKg <= 0) throw new Error('Selling price per KG must be positive.');
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM khat_types WHERE name = ? COLLATE NOCASE`,
    [trimmed],
  );
  if (existing) throw new Error(`Type "${trimmed}" already exists.`);
  const res = await db.runAsync(
    `INSERT INTO khat_types (name, cogs_price_per_kg, sell_price_per_kg, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)`,
    [trimmed, cogsPerKg, sellPerKg, nowIso()],
  );
  return Number(res.lastInsertRowId);
}

export async function updateType(
  id: number,
  patch: { name?: string; cogsPerKg?: number; sellPerKg?: number },
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE khat_types SET
       name = COALESCE(?, name),
       cogs_price_per_kg = COALESCE(?, cogs_price_per_kg),
       sell_price_per_kg = COALESCE(?, sell_price_per_kg)
     WHERE id = ?`,
    [patch.name ?? null, patch.cogsPerKg ?? null, patch.sellPerKg ?? null, id],
  );
}

export async function setTypeActive(id: number, active: boolean): Promise<void> {
  const db = getDb();
  await db.runAsync(`UPDATE khat_types SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id]);
}
