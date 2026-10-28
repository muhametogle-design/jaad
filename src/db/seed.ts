import { getDb } from './database';
import { DEFAULT_TYPES } from '../config';
import { nowIso } from '../lib/time';
import { createBatch } from './repositories/batchRepo';
import { createCustomer } from './repositories/customerRepo';
import { createSale, resolveSalePayment } from './repositories/saleRepo';
import { recordPayment } from './repositories/paymentRepo';
import { recordWastage } from './repositories/wastageRepo';
import { stockLedger } from './repositories/batchRepo';
import type { PayMethod } from '../types';

/**
 * First-run seed: the two default varieties (Miro, Jebis). Idempotent by
 * name — safe to call again after a reset.
 */
export function seedDefaultTypes(): void {
  const db = getDb();
  for (const t of DEFAULT_TYPES) {
    const exists = db.getFirstSync<{ id: number }>(
      `SELECT id FROM khat_types WHERE name = ? COLLATE NOCASE`,
      [t.name],
    );
    if (!exists) {
      db.runSync(
        `INSERT INTO khat_types (name, cogs_price_per_kg, sell_price_per_kg, is_active, created_at)
         VALUES (?, ?, ?, 1, ?)`,
        [t.name, t.cogs, t.sell, nowIso()],
      );
    }
  }
}

/**
 * Optional demo dataset (Settings → Data). Only loads into an empty
 * business so it never clobbers real operations.
 */
export async function loadDemoData(): Promise<void> {
  const db = getDb();
  const hasBatches = (
    await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM batches`)
  )?.c ?? 0;
  const hasCustomers =
    (await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM customers`))?.c ?? 0;
  if (hasBatches > 0 || hasCustomers > 0) {
    throw new Error('Demo data can only be loaded into an empty business. Reset first.');
  }

  const nowMs = Date.now();
  const hoursAgo = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();

  // Type ids (seeded by name)
  const types = await db.getAllAsync<{ id: number; name: string }>(
    `SELECT id, name FROM khat_types ORDER BY id`,
  );
  const miro = types.find((t) => t.name === 'Miro');
  const jebis = types.find((t) => t.name === 'Jebis');
  if (!miro || !jebis) throw new Error('Default types missing — run initDatabase first.');

  // ── Two landed flights ────────────────────────────────────────────────
  const b1 = await createBatch({
    flightNumber: 'ET 663',
    airline: 'Ethiopian Airlines',
    supplier: 'Hargeysa Aero Freight',
    arrivalAt: hoursAgo(5),
    grossWeightKg: 700,
    freightCost: 1_450_000,
    handlingCost: 220_000,
    transportCost: 130_000,
    otherInboundCost: 50_000,
    notes: 'Landed HGA 09:40, offloaded to cold store A.',
    items: [
      { khatTypeId: miro.id, receivedKg: 400, baseCostPerKg: 11_000 },
      { khatTypeId: jebis.id, receivedKg: 260, baseCostPerKg: 8_000 },
    ],
  });

  const b2 = await createBatch({
    flightNumber: 'DA 104',
    airline: 'Daallo Airlines',
    supplier: 'Bari Agri Co.',
    arrivalAt: hoursAgo(30),
    grossWeightKg: 450,
    freightCost: 980_000,
    handlingCost: 150_000,
    transportCost: 90_000,
    otherInboundCost: 0,
    notes: 'Oldest stock — rotate first (FIFO).',
    items: [
      { khatTypeId: miro.id, receivedKg: 120, baseCostPerKg: 10_500 },
      { khatTypeId: jebis.id, receivedKg: 200, baseCostPerKg: 7_800 },
    ],
  });

  // ── Buyer directory ───────────────────────────────────────────────────
  const ahmed = await createCustomer('Ahmed Ware', '+252 63 412 3456', 1_000_000);
  const farhan = await createCustomer('Farhan Group Market', '+252 61 777 8899', 2_500_000);
  const ayaan = await createCustomer('Ayaan Trading', '+252 63 900 1122', 800_000);
  const walkin = await createCustomer('Walk-in Cash', '', 0);

  // ── Today's sales (FIFO pulls the 30h-old batch first) ───────────────
  const saleAhmed = await createSale({ customerId: ahmed, khatTypeId: miro.id, kg: 12.5, payMethod: 'evc_plus', amountPaid: 275_000 });
  const saleFarhan = await createSale({ customerId: farhan, khatTypeId: jebis.id, kg: 20, payMethod: 'zaad', amountPaid: 120_000 });
  await createSale({ customerId: ayaan, khatTypeId: miro.id, kg: 8, payMethod: 'cash', amountPaid: 176_000 });
  await createSale({ customerId: walkin, khatTypeId: jebis.id, kg: 5, payMethod: 'cash', amountPaid: 80_000 });

  // Demo MM charges resolve immediately (simulates the provider webhook).
  await resolveSalePayment(saleAhmed.id, 'EVC-DEMO-4F2A91', 'completed');
  await resolveSalePayment(saleFarhan.id, 'ZAAD-DEMO-88C1D0', 'completed');

  // ── A partial debt repayment from Farhan ─────────────────────────────
  await recordPayment(farhan, 100_000, 'cash', null, 'Morning collection, cash box 2');

  // ── One spoilage event ────────────────────────────────────────────────
  const jebisLedger = await stockLedger(jebis.id);
  const oldestJebis = jebisLedger[0];
  if (oldestJebis) {
    await recordWastage(oldestJebis.id, 5, 'Mould in transit — discarded');
  }

  console.log('[jaad] demo data loaded (batches', b1.batchCode, '+', b2.batchCode + ')');
}

export type { PayMethod };
