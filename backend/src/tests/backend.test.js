/**
 * backend/src/tests/backend.test.js
 *
 * Self-contained Vitest suite (plain JS) for the Jaad Khat OS cloud backend,
 * built on pg-mem: the *real* 001_init.sql migration is applied to an
 * in-memory PostgreSQL and the *real* Express app is exercised over HTTP
 * (supertest) through the same pg-protocol adapter the app uses.
 *
 * Coverage:
 *   1. HMAC SHA-256 webhook signature verification + 401 rejection
 *   2. Webhook idempotency / deduplication (no double processing, no double SMS)
 *   3. Atomic offline outbox sync with ON CONFLICT (idempotency) handling
 *   4. P&L accuracy: total revenue, total COGS, net profit (+ credit/stock)
 *
 * Run with: npm test   (from backend/)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';

import { createApp } from '../app';
import { setPoolForTest } from '../db/pool';
import { setSmsSenderForTest } from '../services/smsService';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(path.join(here, '../db/migrations/001_init.sql'), 'utf8');

// Test env (also pinned in vitest.config.ts)
const WEBHOOK_SECRET = 'test-webhook-secret';
const DEVICE_KEY = 'test-key';
const DEVICE_ID = 'POS-TEST-01';
const devHeaders = { 'x-device-key': DEVICE_KEY, 'x-device-id': DEVICE_ID };

/** Fresh in-memory DB + real migration + real app. */
function makeContext() {
  const db = newDb({ autoCreateForeignKeyTables: false, noAstCoverageCheck: true });
  db.public.none(MIGRATION_SQL); // real schema, exactly what `npm run migrate` applies

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  setPoolForTest(pool);

  const smsLog = [];
  setSmsSenderForTest(async (to, message) => {
    smsLog.push({ to, message });
    return { ok: true, messageId: `SMS-${smsLog.length}` };
  });

  return { app: createApp(), pool, smsLog, db };
}

const sign = (raw, secret = WEBHOOK_SECRET) =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

const q = async (ctx, sql, params = []) => (await ctx.pool.query(sql, params)).rows;

/** Minimal but complete offline batch for device POS-TEST-01. */
function sampleSyncPayload(overrides = {}) {
  return {
    deviceId: DEVICE_ID,
    deviceName: 'Hargeysa POS 01',
    entries: [
      {
        kind: 'batch',
        batchCode: 'BATCH-20261020-01',
        flightNumber: 'SM 201',
        airline: 'Soma Air',
        supplier: 'Hargeysa Farms',
        arrivalAt: '2026-10-20T05:30:00.000Z',
        grossWeightKg: 60,
        freightCost: 2_000,
        handlingCost: 300,
        transportCost: 200,
        otherInboundCost: 0,
        notes: '',
        items: [{ khatType: 'Miro', receivedKg: 60, cogsPerKg: 10_000, arrivedAt: '2026-10-20T05:30:00.000Z' }],
      },
      {
        kind: 'customer',
        localId: 1,
        name: 'Ahmed Ware',
        phone: '+252 63 412 3456',
        creditLimit: 500_000,
      },
      {
        kind: 'customer',
        localId: 2,
        name: 'Farhan Group Market',
        phone: '+252 61 777 8899',
        creditLimit: 1_000_000,
      },
      {
        kind: 'sale',
        orderCode: 'SO-20261020-001',
        customerId: 1,
        customerName: 'Ahmed Ware',
        customerPhone: '+252 63 412 3456',
        khatType: 'Miro',
        kgSold: 10,
        sellPricePerKg: 20_000,
        revenue: 200_000,
        cogsPerKg: 10_000,
        itemCogs: 100_000,
        grossProfit: 100_000,
        amountPaid: 200_000,
        balanceDue: 0,
        payMethod: 'evc_plus',
        status: 'PENDING',
        smsSent: false,
        createdAt: '2026-10-20T08:15:00.000Z',
        allocations: [{ batchCode: 'BATCH-20261020-01', khatType: 'Miro', kg: 10, cogsPerKg: 10_000 }],
      },
      {
        kind: 'sale',
        orderCode: 'SO-20261020-002',
        customerId: 2,
        customerName: 'Farhan Group Market',
        customerPhone: '+252 61 777 8899',
        khatType: 'Miro',
        kgSold: 5,
        sellPricePerKg: 21_000,
        revenue: 105_000,
        cogsPerKg: 10_000,
        itemCogs: 50_000,
        grossProfit: 55_000,
        amountPaid: 55_000,
        balanceDue: 50_000,
        payMethod: 'zaad',
        status: 'PENDING',
        smsSent: false,
        createdAt: '2026-10-20T09:05:00.000Z',
        allocations: [{ batchCode: 'BATCH-20261020-01', khatType: 'Miro', kg: 5, cogsPerKg: 10_000 }],
      },
      {
        kind: 'payment',
        localId: 1,
        customerId: 2,
        amount: 30_000,
        payMethod: 'cash',
        note: 'Debt repayment',
        createdAt: '2026-10-20T10:00:00.000Z',
      },
      {
        kind: 'wastage',
        localId: 1,
        batchCode: 'BATCH-20261020-01',
        khatType: 'Miro',
        kg: 2,
        reason: 'Spoilage in store',
        cogsPerKg: 10_000,
        loss: 20_000,
        createdAt: '2026-10-20T11:00:00.000Z',
      },
      ...(overrides.extraEntries ?? []),
    ],
  };
}

async function waitFor(cond, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Seed one synced order, then dispatch a simulated STK; returns invoiceId. */
async function seedOrderWithStk(ctx, orderCode = 'SO-20261020-001', amount = 200_000) {
  // Simulate the device having synced. Resends are idempotent no-ops, so just
  // assert the order exists (seeded by whichever test ran first in this suite).
  await request(ctx.app)
    .post('/api/sync/outbox')
    .set(devHeaders)
    .send(sampleSyncPayload())
    .expect(200);
  expect((await q(ctx, 'SELECT 1 FROM sales WHERE order_code = $1', [orderCode]))).toHaveLength(1);

  const stkRes = await request(ctx.app)
    .post('/api/payments/stk-push')
    .set(devHeaders)
    .send({ payerPhone: '252634123456', amount, orderId: orderCode, provider: 'EVC_PLUS' })
    .expect(202);
  return stkRes.body.invoiceId;
}

const sendWebhook = (ctx, payload, { header = 'x-waafi-signature', secret = WEBHOOK_SECRET, sig } = {}) => {
  const raw = JSON.stringify(payload);
  return request(ctx.app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set(header, sig ?? sign(raw, secret))
    .send(raw);
};

// ─────────────────────────────────────────────────────────────────────────
// 1. HMAC SHA-256 signature verification & 401 rejection
// ─────────────────────────────────────────────────────────────────────────
describe('Module 1 — HMAC webhook signature verification', () => {
  let ctx;
  beforeAll(() => {
    ctx = makeContext();
  });

  it('rejects a webhook with a bad signature (401)', async () => {
    const payload = { referenceId: 'R-1', invoiceId: 'INV-BAD', amount: 100, status: 'SUCCESS' };
    const raw = JSON.stringify(payload);
    const res = await request(ctx.app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-waafi-signature', 'deadbeef'.repeat(8)) // wrong hex
      .send(raw);
    expect(res.status).toBe(401);
  });

  it('rejects a webhook signed with the wrong secret (401)', async () => {
    const payload = { referenceId: 'R-2', invoiceId: 'INV-BADSECRET', amount: 100, status: 'SUCCESS' };
    const res = await sendWebhook(ctx, payload, { secret: 'some-other-secret' });
    expect(res.status).toBe(401);
  });

  it('rejects a webhook with a missing signature header (401)', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .send({ referenceId: 'R-3', invoiceId: 'INV-NOHEADER', amount: 100, status: 'SUCCESS' });
    expect(res.status).toBe(401);
  });

  it('accepts a correctly signed webhook (200 + exact OK body)', async () => {
    const payload = { referenceId: 'R-OK', invoiceId: 'INV-OK', amount: 100, status: 'SUCCESS' };
    const res = await sendWebhook(ctx, payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'OK', message: 'Webhook processed successfully' });
  });

  it('accepts the x-signature header alias', async () => {
    const payload = { referenceId: 'R-ALIAS', invoiceId: 'INV-ALIAS', amount: 100, status: 'SUCCESS' };
    const res = await sendWebhook(ctx, payload, { header: 'x-signature' });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Webhook idempotency & deduplication (no duplicate SMS)
// ─────────────────────────────────────────────────────────────────────────
describe('Module 1 — webhook idempotency & deduplication', () => {
  let ctx;
  beforeAll(async () => {
    ctx = makeContext();
  });

  it('first SUCCESS callback: order PAID, gateway_ref set, exactly ONE SMS', async () => {
    const invoiceId = await seedOrderWithStk(ctx);
    const payload = {
      referenceId: 'GATEWAY-REF-991',
      invoiceId,
      amount: 200_000,
      status: 'SUCCESS',
      accountNumber: '252634123456',
    };
    const res = await sendWebhook(ctx, payload);
    expect(res.status).toBe(200);

    // Receipt SMS is fire-and-forget — poll for delivery + flag.
    await waitFor(async () => (await q(ctx, 'SELECT sms_sent FROM sales WHERE order_code = $1', ['SO-20261020-001']))[0]?.sms_sent === true);

    const [sale] = await q(ctx, 'SELECT * FROM sales WHERE order_code = $1', ['SO-20261020-001']);
    expect(sale.status).toBe('PAID');
    expect(sale.gateway_ref).toBe('GATEWAY-REF-991');

    const [stk] = await q(ctx, 'SELECT * FROM payments_stk WHERE invoice_id = $1', [invoiceId]);
    expect(stk.status).toBe('SUCCESS');
    expect(stk.gateway_ref).toBe('GATEWAY-REF-991');

    expect(ctx.smsLog).toHaveLength(1);
    expect(ctx.smsLog[0].message).toContain('Order #SO-20261020-001 Paid!');
    expect(ctx.smsLog[0].message).toContain('Ref: GATEWAY-REF-991');
  });

  it('duplicate COMPLETED callback: 200 OK, no re-processing, no second SMS', async () => {
    const invoiceId = await seedOrderWithStk(ctx, 'SO-20261020-002', 105_000);
    const payload = {
      referenceId: 'GATEWAY-REF-552',
      invoiceId,
      amount: 105_000,
      status: 'COMPLETED',
      accountNumber: '252617778899',
    };

    await sendWebhook(ctx, payload).expect(200);
    // Let THIS order's receipt land (the log also holds test 1's receipt).
    await waitFor(() => ctx.smsLog.some((m) => m.message.includes('SO-20261020-002')));
    const smsCountAfterFirst = ctx.smsLog.length;

    const dup = await sendWebhook(ctx, payload);
    expect(dup.status).toBe(200);
    expect(dup.body).toEqual({ status: 'OK', message: 'Webhook processed successfully' });

    // Give any (incorrect) duplicate SMS a chance to arrive, then assert none did.
    await new Promise((r) => setTimeout(r, 150));
    expect(ctx.smsLog.length).toBe(smsCountAfterFirst);

    // Exactly one webhook_events row per invoiceId — the dedup gate.
    const events = await q(ctx, 'SELECT * FROM webhook_events WHERE invoice_id = $1', [invoiceId]);
    expect(events).toHaveLength(1);
  });

  it('a late FAILED callback for an already-COMPLETED invoice is ignored', async () => {
    const invoiceId = (await q(ctx, 'SELECT invoice_id FROM payments_stk WHERE order_code = $1', ['SO-20261020-002']))[0].invoice_id;
    const before = await q(ctx, 'SELECT status FROM payments_stk WHERE invoice_id = $1', [invoiceId]);

    const res = await sendWebhook(ctx, {
      referenceId: 'LATE-FAIL',
      invoiceId,
      amount: 105_000,
      status: 'FAILED',
      accountNumber: '252617778899',
    });
    expect(res.status).toBe(200);

    const after = await q(ctx, 'SELECT status FROM payments_stk WHERE invoice_id = $1', [invoiceId]);
    expect(after[0].status).toBe(before[0].status); // still SUCCESS
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Atomic offline outbox sync (ON CONFLICT / idempotency)
// ─────────────────────────────────────────────────────────────────────────
describe('Module 4 — atomic offline outbox sync', () => {
  let ctx;
  beforeAll(() => {
    ctx = makeContext();
  });

  it('applies a full batch atomically and returns the synced IDs', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(devHeaders)
      .send(sampleSyncPayload())
      .expect(200);

    expect(res.body.status).toBe('OK');
    expect(res.body.synced.sales).toEqual(['SO-20261020-001', 'SO-20261020-002']);
    expect(res.body.synced.batches).toEqual(['BATCH-20261020-01']);
    expect(res.body.synced.payments).toEqual([1]);
    expect(res.body.synced.wastage).toEqual([1]);
    expect(res.body.skipped.sales).toEqual([]);

    expect((await q(ctx, 'SELECT * FROM sales')).length).toBe(2);
    expect((await q(ctx, 'SELECT * FROM payments')).length).toBe(1);
    expect((await q(ctx, 'SELECT * FROM wastage')).length).toBe(1);

    // Inventory: 60 received − 15 sold − 2 wastage = 43 remaining.
    const [inv] = await q(ctx, 'SELECT * FROM batch_inventory WHERE batch_code = $1', ['BATCH-20261020-01']);
    expect(Number(inv.received_kg)).toBe(60);
    expect(Number(inv.remaining_kg)).toBeCloseTo(43);

    // Debt: Farhan credit 50,000 − repayment 30,000 = 20,000 outstanding.
    const [farhan] = await q(ctx, 'SELECT * FROM customers WHERE local_id = $1', [2]);
    expect(Number(farhan.outstanding)).toBeCloseTo(20_000);
  });

  it('is idempotent: resending the identical batch skips duplicates and changes nothing', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(devHeaders)
      .send(sampleSyncPayload())
      .expect(200);

    expect(res.body.synced.sales).toEqual([]);
    expect(res.body.skipped.sales).toEqual(['SO-20261020-001', 'SO-20261020-002']);
    expect(res.body.synced.payments).toEqual([]);
    expect(res.body.synced.wastage).toEqual([]);

    // ON CONFLICT guards held: no duplicate rows anywhere.
    expect((await q(ctx, 'SELECT * FROM sales')).length).toBe(2);
    expect((await q(ctx, 'SELECT * FROM payments')).length).toBe(1);
    expect((await q(ctx, 'SELECT * FROM wastage')).length).toBe(1);
    expect((await q(ctx, 'SELECT * FROM sales_alloc')).length).toBe(2);

    // Ledger unchanged (2 events: +50k credit, −30k repayment).
    const ledger = await q(ctx, 'SELECT * FROM credit_ledger WHERE customer_local_id = $1 ORDER BY id', [2]);
    expect(ledger).toHaveLength(2);
    expect(Number(ledger[1].balance_after)).toBeCloseTo(20_000);

    // Inventory recompute is stable.
    const [inv] = await q(ctx, 'SELECT * FROM batch_inventory WHERE batch_code = $1', ['BATCH-20261020-01']);
    expect(Number(inv.remaining_kg)).toBeCloseTo(43);
  });

  it('is all-or-nothing: one invalid entry rejects the WHOLE batch (no partial writes)', async () => {
    const payload = sampleSyncPayload();
    // New, valid sale that must NOT be persisted…
    payload.entries.push({
      kind: 'sale',
      orderCode: 'SO-20261020-009',
      customerId: 1,
      customerName: 'Ahmed Ware',
      khatType: 'Miro',
      kgSold: 3,
      sellPricePerKg: 20_000,
      revenue: 60_000,
      cogsPerKg: 10_000,
      itemCogs: 30_000,
      grossProfit: 30_000,
      amountPaid: 60_000,
      balanceDue: 0,
      payMethod: 'cash',
      status: 'PENDING',
      smsSent: false,
      createdAt: '2026-10-20T12:00:00.000Z',
      allocations: [{ batchCode: 'BATCH-20261020-01', khatType: 'Miro', kg: 3, cogsPerKg: 10_000 }],
    });
    // …paired with an invalid payment (negative amount) that must sink the batch.
    payload.entries.push({
      kind: 'payment',
      localId: 99,
      customerId: 1,
      amount: -5,
      payMethod: 'cash',
      createdAt: '2026-10-20T12:05:00.000Z',
    });

    await request(ctx.app).post('/api/sync/outbox').set(devHeaders).send(payload).expect(400);

    // Nothing from the rejected batch was written.
    expect((await q(ctx, 'SELECT * FROM sales')).length).toBe(2);
    expect((await q(ctx, 'SELECT * FROM payments')).length).toBe(1);
    expect((await q(ctx, 'SELECT * FROM sales WHERE order_code = $1', ['SO-20261020-009']))).toHaveLength(0);
  });

  it('rejects an unknown device key (401) and a deviceId/header mismatch (400)', async () => {
    await request(ctx.app)
      .post('/api/sync/outbox')
      .set({ 'x-device-key': 'wrong', 'x-device-id': DEVICE_ID })
      .send(sampleSyncPayload())
      .expect(401);

    await request(ctx.app)
      .post('/api/sync/outbox')
      .set(devHeaders)
      .send({ ...sampleSyncPayload(), deviceId: 'POS-SOMEONE-ELSE' })
      .expect(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. P&L accuracy (total_revenue, total_cogs, net_profit, credit, stock)
// ─────────────────────────────────────────────────────────────────────────
describe('Reporting — P&L calculations', () => {
  let ctx;
  beforeAll(async () => {
    ctx = makeContext();
    await request(ctx.app).post('/api/sync/outbox').set(devHeaders).send(sampleSyncPayload()).expect(200);
  });

  it('aggregates total_revenue, total_cogs and net_profit accurately', async () => {
    const res = await request(ctx.app)
      .get('/api/reporting/pnl?from=2026-10-20&to=2026-10-20')
      .set(devHeaders)
      .expect(200);

    const pnl = res.body.pnl; // API field names: revenue = total revenue, cogs = total COGS
    expect(pnl.orders).toBe(2);
    expect(pnl.revenue).toBe(305_000); // 200,000 + 105,000
    expect(pnl.cogs).toBe(150_000); // 100,000 + 50,000
    expect(pnl.wastage_loss).toBe(20_000);
    expect(pnl.net_profit).toBe(135_000); // 305,000 − 150,000 − 20,000

    expect(pnl.collected).toBe(255_000); // amount_paid at sale time
    expect(pnl.collections_by_method.evc_plus).toBe(200_000);
    expect(pnl.collections_by_method.zaad).toBe(55_000);
    expect(pnl.credit_created).toBe(50_000); // Farhan's balance due
    expect(pnl.debt_repaid).toBe(30_000); // cash repayment

    // Stock: 60 − 15 sold − 2 wastage = 43 kg @ 10,000 = 430,000.
    expect(pnl.stock.kg).toBeCloseTo(43);
    expect(pnl.stock.value).toBeCloseTo(430_000);

    expect(pnl.by_day).toHaveLength(1);
    expect(pnl.by_day[0].day).toBe('2026-10-20');
    expect(pnl.by_day[0].orders).toBe(2);
    expect(pnl.by_day[0].revenue).toBe(305_000);
    expect(pnl.by_day[0].cogs).toBe(150_000);
  });

  it('validates the date range (bad dates / inverted range → 400)', async () => {
    await request(ctx.app).get('/api/reporting/pnl?from=bad-date&to=2026-10-20').set(devHeaders).expect(400);
    await request(ctx.app).get('/api/reporting/pnl?from=2026-10-21&to=2026-10-20').set(devHeaders).expect(400);
  });

  it('returns a per-order audit with FIFO allocations (404 for unknown order)', async () => {
    const res = await request(ctx.app)
      .get('/api/reporting/orders/SO-20261020-002')
      .set(devHeaders)
      .expect(200);
    expect(res.body.order.order_code).toBe('SO-20261020-002');
    expect(res.body.order.status).toBe('PENDING');
    expect(res.body.order.balance_due).toBeCloseTo(50_000);
    expect(res.body.fifo_allocations).toHaveLength(1);
    expect(res.body.fifo_allocations[0].batch_code).toBe('BATCH-20261020-01');
    expect(Number(res.body.fifo_allocations[0].kg)).toBe(5);

    await request(ctx.app).get('/api/reporting/orders/SO-NOPE-1').set(devHeaders).expect(404);
  });
});
