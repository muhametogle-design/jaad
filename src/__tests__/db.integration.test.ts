/**
 * Headless integration test: runs the REAL schema + repositories against
 * an in-memory SQLite (node:sqlite shim standing in for expo-sqlite).
 *
 * Covers: intake → effective COGS → FIFO sale & inventory deduction →
 * MM resolution → credit + repayment → wastage → daily P&L.
 *
 * Run with: NODE_OPTIONS=--experimental-sqlite npx jest
 */
import { DDL_V1 } from '../db/schema';
import { mockSqliteDb } from './helpers/mockSqlite';

jest.mock('expo-sqlite', () => require('./helpers/mockSqlite').default);

import { initDatabase, getDb } from '../db/database';
import { listTypes } from '../db/repositories/khatTypeRepo';
import { createBatch, stockLedger } from '../db/repositories/batchRepo';
import { createCustomer } from '../db/repositories/customerRepo';
import { createSale, resolveSalePayment, listTodaySales } from '../db/repositories/saleRepo';
import { recordPayment } from '../db/repositories/paymentRepo';
import { recordWastage } from '../db/repositories/wastageRepo';
import { todayPnl } from '../db/repositories/reportingRepo';
import { InsufficientStockError, round2 } from '../lib/cogs';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Local-time ISO timestamp for today at a given hour (batch codes are per local day). */
const todayAt = (hour: number) => {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};

let miroId = 0;
let jebisId = 0;

beforeEach(() => {
  mockSqliteDb.__reset(DDL_V1);
});

test('full flow: intake → FIFO sale → debt → payment → P&L', async () => {
  initDatabase();
  const types = await listTypes();
  miroId = types.find((t) => t.name === 'Miro')!.id;
  jebisId = types.find((t) => t.name === 'Jebis')!.id;

  // ── 1. Intake ─────────────────────────────────────────────────────────
  const inbound = 1_450_000 + 220_000 + 130_000 + 50_000; // 1,850,000
  const created = await createBatch({
    flightNumber: 'ET 663',
    airline: 'Ethiopian Airlines',
    supplier: 'Hargeysa Aero Freight',
    arrivalAt: hoursAgo(5),
    grossWeightKg: 700,
    freightCost: 1_450_000,
    handlingCost: 220_000,
    transportCost: 130_000,
    otherInboundCost: 50_000,
    notes: '',
    items: [
      { khatTypeId: miroId, receivedKg: 400, baseCostPerKg: 11_000 },
      { khatTypeId: jebisId, receivedKg: 260, baseCostPerKg: 8_000 },
    ],
  });
  expect(created.batchCode).toMatch(/^BATCH-\d{8}-01$/);
  expect(created.cogsPerKgByType[miroId]).toBe(round2(11_000 + inbound / 700));

  // ── 2. Buyers ─────────────────────────────────────────────────────────
  const ahmed = await createCustomer('Ahmed Ware', '+252 63 412 3456', 1_000_000);
  const farhan = await createCustomer('Farhan Group Market', '+252 61 777 8899', 2_500_000);

  // ── 3. Sale #1 — EVC Plus, paid in full ───────────────────────────────
  const sale1 = await createSale({
    customerId: ahmed,
    khatTypeId: miroId,
    kg: 12.5,
    payMethod: 'evc_plus',
    amountPaid: 275_000,
  });
  expect(sale1.order_code).toMatch(/^SO-\d{8}-001$/);
  expect(sale1.status).toBe('mm_pending'); // charge not yet confirmed
  expect(sale1.revenue).toBe(275_000);
  expect(sale1.cogs_per_kg).toBe(created.cogsPerKgByType[miroId]);
  expect(sale1.item_cogs).toBe(round2(12.5 * created.cogsPerKgByType[miroId]));
  expect(sale1.gross_profit).toBe(round2(275_000 - sale1.item_cogs));

  // Automated inventory deduction
  let ledger = await stockLedger(miroId);
  expect(ledger[0].remaining_kg).toBe(round2(400 - 12.5));

  await resolveSalePayment(sale1.id, 'EVC-TEST-1', 'completed');
  const db = getDb();
  const after1 = db.getFirstSync<{ status: string; mm_ref: string }>(
    `SELECT status, mm_ref FROM sales WHERE id = ?`,
    [sale1.id],
  );
  expect(after1?.status).toBe('completed');
  expect(after1?.mm_ref).toBe('EVC-TEST-1');

  // ── 4. Sale #2 — Zaad partial payment → credit ────────────────────────
  const sale2 = await createSale({
    customerId: farhan,
    khatTypeId: jebisId,
    kg: 20,
    payMethod: 'zaad',
    amountPaid: 120_000,
  });
  expect(sale2.balance_due).toBe(200_000);
  const farhanAfter = db.getFirstSync<{ outstanding: number }>(
    `SELECT outstanding FROM customers WHERE id = ?`,
    [farhan],
  );
  expect(farhanAfter?.outstanding).toBe(200_000);

  // ── 5. Debt repayment ─────────────────────────────────────────────────
  await recordPayment(farhan, 100_000, 'cash', null, 'test');
  const farhanAfterPay = db.getFirstSync<{ outstanding: number }>(
    `SELECT outstanding FROM customers WHERE id = ?`,
    [farhan],
  );
  expect(farhanAfterPay?.outstanding).toBe(100_000);
  const lastLedger = db.getFirstSync<{ balance_after: number; amount: number }>(
    `SELECT balance_after, amount FROM credit_ledger ORDER BY id DESC LIMIT 1`,
  );
  expect(lastLedger?.amount).toBe(-100_000);
  expect(lastLedger?.balance_after).toBe(100_000);

  // ── 6. Wastage ────────────────────────────────────────────────────────
  const jebisLedger = await stockLedger(jebisId);
  const waste = await recordWastage(jebisLedger[0].id, 5, 'mould');
  expect(waste.loss).toBe(round2(5 * jebisLedger[0].cogs_per_kg));
  ledger = await stockLedger(jebisId);
  expect(ledger[0].remaining_kg).toBe(round2(260 - 20 - 5));

  // ── 7. Guards ─────────────────────────────────────────────────────────
  await expect(
    createSale({
      customerId: farhan,
      khatTypeId: miroId,
      kg: 999_999,
      payMethod: 'cash',
      amountPaid: 0,
    }),
  ).rejects.toThrow(InsufficientStockError);

  const limited = await createCustomer('Limited Co', '', 50_000);
  await expect(
    createSale({
      customerId: limited,
      khatTypeId: miroId,
      kg: 3, // 3 × 22,000 = 66,000 > 50,000 limit
      payMethod: 'cash',
      amountPaid: 0,
    }),
  ).rejects.toThrow(/Credit limit exceeded/);

  // ── 8. Daily P&L ──────────────────────────────────────────────────────
  const pnl = await todayPnl();
  const expectedRevenue = 275_000 + 320_000;
  const expectedCogs = round2(sale1.item_cogs + 20 * created.cogsPerKgByType[jebisId]);
  expect(pnl.orders).toBe(2);
  expect(pnl.revenue).toBe(expectedRevenue);
  expect(pnl.cogs).toBe(expectedCogs);
  expect(pnl.wastage_loss).toBe(waste.loss);
  expect(pnl.net_profit).toBe(round2(expectedRevenue - expectedCogs - waste.loss));
  expect(pnl.collected_evc).toBe(275_000);
  expect(pnl.collected_zaad).toBe(120_000);
  expect(pnl.new_credit).toBe(200_000);
  expect(pnl.debt_repaid).toBe(100_000);
  expect(pnl.stock_kg).toBe(round2(387.5 + 235));
  expect(pnl.fresh_kg).toBe(pnl.stock_kg); // 5h old → fresh

  const sales = await listTodaySales();
  expect(sales).toHaveLength(2);
});

test('FIFO ordering across two same-day batches', async () => {
  initDatabase();
  const types = await listTypes();
  const miro = types.find((t) => t.name === 'Miro')!.id;

  const older = await createBatch({
    flightNumber: 'DA 104',
    airline: 'Daallo',
    supplier: 'S1',
    arrivalAt: todayAt(6),
    grossWeightKg: 100,
    freightCost: 100_000,
    handlingCost: 0,
    transportCost: 0,
    otherInboundCost: 0,
    notes: '',
    items: [{ khatTypeId: miro, receivedKg: 100, baseCostPerKg: 10_000 }],
  });
  const newer = await createBatch({
    flightNumber: 'ET 100',
    airline: 'Ethiopian',
    supplier: 'S2',
    arrivalAt: todayAt(10),
    grossWeightKg: 100,
    freightCost: 100_000,
    handlingCost: 0,
    transportCost: 0,
    otherInboundCost: 0,
    notes: '',
    items: [{ khatTypeId: miro, receivedKg: 100, baseCostPerKg: 12_000 }],
  });
  expect(older.batchCode).toMatch(/-01$/);
  expect(newer.batchCode).toMatch(/-02$/);

  const buyer = await createCustomer('FIFO Buyer', '', 0);
  await createSale({
    customerId: buyer,
    khatTypeId: miro,
    kg: 120, // spans both batches: 100 @ old cost + 20 @ new cost
    payMethod: 'cash',
    amountPaid: 2_640_000,
  });

  const db = getDb();
  const oldLine = db.getFirstSync<{ remaining_kg: number }>(
    `SELECT remaining_kg FROM batch_inventory ORDER BY id ASC LIMIT 1`,
  );
  const newLine = db.getFirstSync<{ remaining_kg: number }>(
    `SELECT remaining_kg FROM batch_inventory ORDER BY id DESC LIMIT 1`,
  );
  expect(oldLine?.remaining_kg).toBe(0);
  expect(newLine?.remaining_kg).toBe(80);

  // Weighted COGS = (100×old + 20×new) / 120
  const sale = db.getFirstSync<{ cogs_per_kg: number }>(`SELECT cogs_per_kg FROM sales LIMIT 1`);
  expect(sale?.cogs_per_kg).toBe(
    round2((100 * older.cogsPerKgByType[miro] + 20 * newer.cogsPerKgByType[miro]) / 120),
  );

  const led = await stockLedger(miro);
  expect(led).toHaveLength(1); // older line exhausted
});
