import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, deviceHeaders, rows, sampleSyncPayload, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestContext();
});

const num = (v: unknown) => Number(v);

describe('POST /api/sync/outbox', () => {
  it('rejects unknown device keys with 401', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set({ 'x-device-key': 'nope', 'x-device-id': 'POS-TEST-01' })
      .send(sampleSyncPayload());
    expect(res.status).toBe(401);
  });

  it('rejects a deviceId/header mismatch with 400', async () => {
    const payload = sampleSyncPayload();
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(deviceHeaders())
      .send({ ...payload, deviceId: 'POS-SOMEONE-ELSE' });
    expect(res.status).toBe(400);
  });

  it('rejects an empty entry batch with 400', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(deviceHeaders())
      .send({ deviceId: 'POS-TEST-01', entries: [] });
    expect(res.status).toBe(400);
  });

  it('applies a full offline batch atomically and returns synced IDs', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(deviceHeaders())
      .send(sampleSyncPayload())
      .expect(200);

    expect(res.body.status).toBe('OK');
    expect(res.body.synced.batches).toEqual(['BATCH-20261016-01']);
    expect(res.body.synced.customers).toEqual([1, 2]);
    expect(res.body.synced.sales).toEqual(['SO-20261016-001', 'SO-20261016-002', 'SO-20261016-003']);
    expect(res.body.synced.payments).toEqual([1]);
    expect(res.body.synced.wastage).toEqual([1]);
    expect(res.body.skipped.sales).toEqual([]);

    // Sales landed with snapshots.
    const sales = await rows('SELECT * FROM sales ORDER BY order_code');
    expect(sales).toHaveLength(3);
    const s1 = sales.find((s) => s.order_code === 'SO-20261016-001');
    expect(num(s1!.revenue)).toBe(275_000);
    expect(num(s1!.item_cogs)).toBeCloseTo(170_535.75);
    expect(num(s1!.gross_profit)).toBeCloseTo(104_464.25);

    // FIFO allocation audit rows.
    const allocs = await rows('SELECT * FROM sales_alloc ORDER BY order_code');
    expect(allocs).toHaveLength(3);

    // Global inventory recompute: received − allocations − wastage.
    const inv = await rows('SELECT * FROM batch_inventory ORDER BY khat_type');
    const miro = inv.find((i) => i.khat_type === 'Miro');
    const jebis = inv.find((i) => i.khat_type === 'Jebis');
    expect(num(miro!.remaining_kg)).toBeCloseTo(400 - 12.5 - 8);
    expect(num(jebis!.remaining_kg)).toBeCloseTo(260 - 20 - 5);

    // Buyer debt recompute: Farhan owes 200,000 − 100,000.
    const customers = await rows('SELECT * FROM customers ORDER BY local_id');
    const ahmed = customers.find((c) => c.local_id === 1);
    const farhan = customers.find((c) => c.local_id === 2);
    expect(num(ahmed!.outstanding)).toBe(0);
    expect(num(farhan!.outstanding)).toBe(100_000);

    // Credit ledger rows for Farhan (+200k credit, −100k repayment).
    const ledger = await rows(
      'SELECT * FROM credit_ledger WHERE customer_local_id = $1 ORDER BY id',
      [2],
    );
    expect(ledger).toHaveLength(2);
    expect(num(ledger[0].amount)).toBe(200_000);
    expect(num(ledger[1].amount)).toBe(-100_000);
    expect(num(ledger[1].balance_after)).toBe(100_000);

    // Wastage recorded (feeds P&L).
    const waste = await rows('SELECT * FROM wastage');
    expect(waste).toHaveLength(1);
    expect(num(waste[0].loss)).toBeCloseTo(53_214.3);
  });

  it('is idempotent: resending the same batch skips duplicates and changes nothing', async () => {
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(deviceHeaders())
      .send(sampleSyncPayload())
      .expect(200);

    expect(res.body.synced.sales).toEqual([]);
    expect(res.body.skipped.sales).toEqual(['SO-20261016-001', 'SO-20261016-002', 'SO-20261016-003']);

    const sales = await rows('SELECT * FROM sales');
    expect(sales).toHaveLength(3); // no duplicates
    const ledger = await rows('SELECT * FROM credit_ledger WHERE customer_local_id = $1', [2]);
    expect(ledger).toHaveLength(2); // no duplicate ledger entries
    const inv = await rows('SELECT * FROM batch_inventory WHERE khat_type = $1', ['Miro']);
    expect(num(inv[0].remaining_kg)).toBeCloseTo(379.5); // unchanged
  });

  it('accepts a follow-up order and recomputes inventory globally', async () => {
    const payload = {
      deviceId: 'POS-TEST-01',
      entries: [
        {
          kind: 'sale',
          orderCode: 'SO-20261016-009',
          customerId: 1,
          customerName: 'Ahmed Ware',
          customerPhone: '+252 63 412 3456',
          khatType: 'Miro',
          kgSold: 2,
          sellPricePerKg: 22_000,
          revenue: 44_000,
          cogsPerKg: 13_642.86,
          itemCogs: 27_285.72,
          grossProfit: 16_714.28,
          amountPaid: 44_000,
          balanceDue: 0,
          payMethod: 'cash',
          status: 'PENDING',
          smsSent: false,
          createdAt: new Date('2026-10-16T09:30:00.000Z').toISOString(),
          allocations: [
            { batchCode: 'BATCH-20261016-01', khatType: 'Miro', kg: 2, cogsPerKg: 13_642.86 },
          ],
        },
      ],
    };
    const res = await request(ctx.app)
      .post('/api/sync/outbox')
      .set(deviceHeaders())
      .send(payload)
      .expect(200);
    expect(res.body.synced.sales).toEqual(['SO-20261016-009']);

    const inv = await rows('SELECT * FROM batch_inventory WHERE khat_type = $1', ['Miro']);
    expect(num(inv[0].remaining_kg)).toBeCloseTo(379.5 - 2); // recompute picks up the new alloc
  });
});
