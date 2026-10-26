import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb, type IMemoryDb } from 'pg-mem';
import pg from 'pg';
import { setPoolForTest } from '../src/db/pool.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface TestContext {
  db: IMemoryDb;
  /** Same pg-adapter pool the app uses — use for test assertions. */
  pool: pg.Pool;
  app: ReturnType<typeof createApp>;
}

/** Assertion helper: run a parameterized SELECT against the test DB. */
export async function rows(sql: string, params?: unknown[]): Promise<any[]> {
  return (await (poolRef as pg.Pool).query(sql, params)).rows;
}

/** Poll until `cond` resolves truthy (fire-and-forget side effects) or time out. */
export async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

let poolRef: pg.Pool;

/**
 * Fresh in-memory PostgreSQL (pg-mem) + the real Express app.
 * Applies the real migration SQL so tests exercise production DDL.
 */
export function createTestContext(): TestContext {
  // noAstCoverageCheck: pg-mem's pg-adapter has an over-strict planner check
  // that rejects standard DDL (e.g. DEFAULT CURRENT_TIMESTAMP). Real Postgres
  // — the production target — handles all of it.
  const db = newDb({ autoCreateForeignKeyTables: false, noAstCoverageCheck: true });
  const sql = readFileSync(path.join(here, '../src/db/migrations/001_init.sql'), 'utf8');
  db.public.none(sql);
  db.public.none(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool() as unknown as pg.Pool;
  setPoolForTest(pool as pg.Pool);
  poolRef = pool as pg.Pool;

  return { db, pool: pool as pg.Pool, app: createApp() };
}

export const DEVICE_KEY = 'test-key';
export const DEVICE_ID = 'POS-TEST-01';

export function deviceHeaders() {
  return { 'x-device-key': DEVICE_KEY, 'x-device-id': DEVICE_ID };
}

/** A full, realistic sync outbox payload (two buyers, one flight, 3 sales). */
export function sampleSyncPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-10-16T09:00:00.000Z');
  const iso = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const batchCode = 'BATCH-20261016-01';
  return {
    deviceId: DEVICE_ID,
    deviceName: 'Hargeysa POS 01',
    entries: [
      {
        kind: 'batch',
        batchCode,
        flightNumber: 'ET 663',
        airline: 'Ethiopian Airlines',
        supplier: 'Hargeysa Aero Freight',
        arrivalAt: iso(5),
        grossWeightKg: 700,
        freightCost: 1_450_000,
        handlingCost: 220_000,
        transportCost: 130_000,
        otherInboundCost: 50_000,
        notes: '',
        items: [
          { khatType: 'Miro', receivedKg: 400, cogsPerKg: 13_642.86, arrivedAt: iso(5) },
          { khatType: 'Jebis', receivedKg: 260, cogsPerKg: 10_642.86, arrivedAt: iso(5) },
        ],
      },
      { kind: 'customer', localId: 1, name: 'Ahmed Ware', phone: '+252 63 412 3456', creditLimit: 1_000_000 },
      { kind: 'customer', localId: 2, name: 'Farhan Group Market', phone: '+252 61 777 8899', creditLimit: 2_500_000 },
      {
        kind: 'sale',
        orderCode: 'SO-20261016-001',
        customerId: 1,
        customerName: 'Ahmed Ware',
        customerPhone: '+252 63 412 3456',
        khatType: 'Miro',
        kgSold: 12.5,
        sellPricePerKg: 22_000,
        revenue: 275_000,
        cogsPerKg: 13_642.86,
        itemCogs: 170_535.75,
        grossProfit: 104_464.25,
        amountPaid: 275_000,
        balanceDue: 0,
        payMethod: 'evc_plus',
        status: 'PENDING',
        smsSent: false,
        createdAt: iso(2),
        allocations: [{ batchCode, khatType: 'Miro', kg: 12.5, cogsPerKg: 13_642.86 }],
      },
      {
        kind: 'sale',
        orderCode: 'SO-20261016-002',
        customerId: 2,
        customerName: 'Farhan Group Market',
        customerPhone: '+252 61 777 8899',
        khatType: 'Jebis',
        kgSold: 20,
        sellPricePerKg: 16_000,
        revenue: 320_000,
        cogsPerKg: 10_642.86,
        itemCogs: 212_857.2,
        grossProfit: 107_142.8,
        amountPaid: 120_000,
        balanceDue: 200_000,
        payMethod: 'zaad',
        status: 'PENDING',
        smsSent: false,
        createdAt: iso(1.5),
        allocations: [{ batchCode, khatType: 'Jebis', kg: 20, cogsPerKg: 10_642.86 }],
      },
      {
        kind: 'sale',
        orderCode: 'SO-20261016-003',
        customerId: 1,
        customerName: 'Ahmed Ware',
        customerPhone: '+252 63 412 3456',
        khatType: 'Miro',
        kgSold: 8,
        sellPricePerKg: 22_000,
        revenue: 176_000,
        cogsPerKg: 13_642.86,
        itemCogs: 109_142.88,
        grossProfit: 66_857.12,
        amountPaid: 176_000,
        balanceDue: 0,
        payMethod: 'cash',
        status: 'PENDING',
        smsSent: false,
        createdAt: iso(1),
        allocations: [{ batchCode, khatType: 'Miro', kg: 8, cogsPerKg: 13_642.86 }],
      },
      {
        kind: 'payment',
        localId: 1,
        customerId: 2,
        amount: 100_000,
        payMethod: 'cash',
        note: 'Morning collection',
        createdAt: iso(0.5),
      },
      {
        kind: 'wastage',
        localId: 1,
        batchCode,
        khatType: 'Jebis',
        kg: 5,
        reason: 'Mould in transit',
        cogsPerKg: 10_642.86,
        loss: 53_214.3,
        createdAt: iso(0.25),
      },
    ],
    ...overrides,
  };
}
