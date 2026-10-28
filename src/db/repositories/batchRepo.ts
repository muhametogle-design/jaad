import { getDb } from '../database';
import type { Batch, BatchBundle, BatchInventoryRow, StockRow, TypeStockSummary } from '../../types';
import { nowIso, compactDayKey } from '../../lib/time';
import { batchCode } from '../../lib/ids';
import { effectiveCogsForBatch, inboundCostTotal, round2, EPS } from '../../lib/cogs';

export interface BatchIntakeItem {
  khatTypeId: number;
  receivedKg: number;
  /** Optional per-batch override of the type's baseline landing cost. */
  baseCostPerKg?: number;
}

export interface BatchIntakeInput {
  flightNumber: string;
  airline: string;
  supplier: string;
  arrivalAt: string; // ISO
  grossWeightKg: number;
  freightCost: number;
  handlingCost: number;
  transportCost: number;
  otherInboundCost: number;
  notes: string;
  items: BatchIntakeItem[];
}

export interface CreatedBatch {
  batchId: number;
  batchCode: string;
  inboundCost: number;
  /** Effective COGS per KG by khat type id. */
  cogsPerKgByType: Record<number, number>;
}

/**
 * Module 1 — log an incoming flight and create its inventory lines.
 * Each variety's effective COGS = base purchase price + inbound costs
 * absorbed over the batch's gross weight.
 */
export async function createBatch(input: BatchIntakeInput): Promise<CreatedBatch> {
  const db = getDb();
  const inbound = inboundCostTotal({
    freight: input.freightCost,
    handling: input.handlingCost,
    transport: input.transportCost,
    other: input.otherInboundCost,
  });
  const activeItems = input.items.filter((i) => i.receivedKg > 0);
  if (activeItems.length === 0) throw new Error('Add kilograms for at least one khat type.');
  const totalReceived = round2(activeItems.reduce((s, i) => s + i.receivedKg, 0));
  if (totalReceived > input.grossWeightKg + EPS) {
    throw new Error('Type weights exceed the incoming gross weight of the flight.');
  }

  const dayKey = compactDayKey(new Date(input.arrivalAt));
  const countRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM batches WHERE batch_code LIKE ?`,
    [`BATCH-${dayKey}-%`],
  );
  const code = batchCode(`${dayKey.slice(0, 4)}-${dayKey.slice(4, 6)}-${dayKey.slice(6, 8)}`, (countRow?.c ?? 0) + 1);

  let batchId = 0;
  const cogsPerKgByType: Record<number, number> = {};

  await db.withTransactionAsync(async () => {
    const res = await db.runAsync(
      `INSERT INTO batches
        (batch_code, flight_number, airline, supplier, arrival_at, gross_weight_kg,
         freight_cost, handling_cost, transport_cost, other_inbound_cost, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        input.flightNumber,
        input.airline,
        input.supplier,
        input.arrivalAt,
        input.grossWeightKg,
        input.freightCost,
        input.handlingCost,
        input.transportCost,
        input.otherInboundCost,
        input.notes,
        nowIso(),
      ],
    );
    batchId = Number(res.lastInsertRowId);

    for (const item of activeItems) {
      const type = await db.getFirstAsync<{ id: number; cogs_price_per_kg: number }>(
        `SELECT id, cogs_price_per_kg FROM khat_types WHERE id = ?`,
        [item.khatTypeId],
      );
      if (!type) throw new Error('Unknown khat type in intake form.');
      const base = item.baseCostPerKg ?? type.cogs_price_per_kg;
      const eff = effectiveCogsForBatch(base, inbound, input.grossWeightKg);
      cogsPerKgByType[item.khatTypeId] = eff;
      await db.runAsync(
        `INSERT INTO batch_inventory (batch_id, khat_type_id, received_kg, remaining_kg, cogs_per_kg, arrived_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, item.khatTypeId, item.receivedKg, item.receivedKg, eff, input.arrivalAt],
      );
    }
  });

  return { batchId, batchCode: code, inboundCost: inbound, cogsPerKgByType };
}

export async function listBundles(): Promise<BatchBundle[]> {
  const db = getDb();
  const batches = await db.getAllAsync<Batch>(
    `SELECT * FROM batches ORDER BY arrival_at DESC, id DESC`,
  );
  const bundles: BatchBundle[] = [];
  for (const b of batches) {
    const types = await db.getAllAsync<BatchInventoryRow & { type_name: string }>(
      `SELECT bi.*, t.name AS type_name
       FROM batch_inventory bi JOIN khat_types t ON t.id = bi.khat_type_id
       WHERE bi.batch_id = ? ORDER BY t.name`,
      [b.id],
    );
    bundles.push({ batch: b, types });
  }
  return bundles;
}

export async function getBatch(id: number): Promise<BatchBundle | undefined> {
  const db = getDb();
  const batch = await db.getFirstAsync<Batch>(`SELECT * FROM batches WHERE id = ?`, [id]);
  if (!batch) return undefined;
  const types = await db.getAllAsync<BatchInventoryRow & { type_name: string }>(
    `SELECT bi.*, t.name AS type_name
     FROM batch_inventory bi JOIN khat_types t ON t.id = bi.khat_type_id
     WHERE bi.batch_id = ? ORDER BY t.name`,
    [id],
  );
  return { batch, types };
}

/** Live stock of one type, oldest batch first (FIFO order). */
export async function stockLedger(typeId: number): Promise<StockRow[]> {
  const db = getDb();
  return db.getAllAsync<StockRow>(
    `SELECT bi.*, b.batch_code, t.name AS type_name
     FROM batch_inventory bi
     JOIN batches b ON b.id = bi.batch_id
     JOIN khat_types t ON t.id = bi.khat_type_id
     WHERE bi.khat_type_id = ? AND bi.remaining_kg > ?
     ORDER BY bi.arrived_at ASC, bi.id ASC`,
    [typeId, EPS],
  );
}

/** Aggregated position per type for the POS type cards / dashboard. */
export async function stockByType(): Promise<TypeStockSummary[]> {
  const db = getDb();
  return db.getAllAsync<TypeStockSummary>(
    `SELECT
       t.id            AS type_id,
       t.name          AS name,
       t.cogs_price_per_kg,
       t.sell_price_per_kg,
       t.is_active,
       COALESCE(SUM(bi.remaining_kg), 0)             AS total_kg,
       COALESCE(SUM(bi.remaining_kg * bi.cogs_per_kg), 0) AS stock_value,
       MIN(bi.arrived_at)                            AS oldest_arrived_at,
       COUNT(DISTINCT bi.batch_id)                   AS batch_count
     FROM khat_types t
     LEFT JOIN batch_inventory bi
       ON bi.khat_type_id = t.id AND bi.remaining_kg > ?
     WHERE t.is_active = 1
     GROUP BY t.id
     ORDER BY t.name`,
    [EPS],
  );
}

/** Total stock value across all open inventory. */
export async function stockTotals(): Promise<{ kg: number; value: number }> {
  const db = getDb();
  const row = await db.getFirstAsync<{ kg: number; value: number }>(
    `SELECT COALESCE(SUM(remaining_kg), 0) AS kg,
            COALESCE(SUM(remaining_kg * cogs_per_kg), 0) AS value
     FROM batch_inventory WHERE remaining_kg > ?`,
    [EPS],
  );
  return { kg: row?.kg ?? 0, value: row?.value ?? 0 };
}
