import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, deviceHeaders, sampleSyncPayload, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = createTestContext();
  await request(ctx.app).post('/api/sync/outbox').set(deviceHeaders()).send(sampleSyncPayload()).expect(200);
});

describe('GET /api/reporting/pnl', () => {
  it('aggregates revenue, COGS, wastage and net profit for the day', async () => {
    const res = await request(ctx.app)
      .get('/api/reporting/pnl?from=2026-10-16&to=2026-10-16')
      .set(deviceHeaders())
      .expect(200);

    const pnl = res.body.pnl;
    expect(pnl.orders).toBe(3);
    expect(pnl.revenue).toBeCloseTo(275_000 + 320_000 + 176_000);
    expect(pnl.cogs).toBeCloseTo(170_535.75 + 212_857.2 + 109_142.88);
    expect(pnl.wastage_loss).toBeCloseTo(53_214.3);
    expect(pnl.net_profit).toBeCloseTo(pnl.revenue - pnl.cogs - pnl.wastage_loss);
    expect(pnl.collected).toBeCloseTo(275_000 + 120_000 + 176_000);
    expect(pnl.collections_by_method.cash).toBeCloseTo(176_000);
    expect(pnl.collections_by_method.evc_plus).toBeCloseTo(275_000);
    expect(pnl.collections_by_method.zaad).toBeCloseTo(120_000);
    expect(pnl.credit_created).toBeCloseTo(200_000);
    expect(pnl.debt_repaid).toBeCloseTo(100_000);

    // Stock value = remaining KG × COGS.
    expect(pnl.stock.kg).toBeCloseTo(379.5 + 235);
    expect(pnl.stock.value).toBeCloseTo(379.5 * 13_642.86 + 235 * 10_642.86);

    expect(pnl.by_day).toHaveLength(1);
    expect(pnl.by_day[0].day).toBe('2026-10-16');
    expect(pnl.by_day[0].orders).toBe(3);
  });

  it('validates the date range', async () => {
    expect(
      (await request(ctx.app).get('/api/reporting/pnl?from=2026-10-20&to=2026-10-01').set(deviceHeaders())).status,
    ).toBe(400);
    expect(
      (await request(ctx.app).get('/api/reporting/pnl?from=bad-date').set(deviceHeaders())).status,
    ).toBe(400);
  });
});

describe('GET /api/reporting/orders/:orderCode (audit)', () => {
  it('returns the sale, its FIFO slices and STK attempts', async () => {
    const res = await request(ctx.app)
      .get('/api/reporting/orders/SO-20261016-002')
      .set(deviceHeaders())
      .expect(200);

    expect(res.body.order.order_code).toBe('SO-20261016-002');
    expect(res.body.order.khat_type).toBe('Jebis');
    expect(res.body.order.kg_sold).toBe(20);
    expect(res.body.order.balance_due).toBeCloseTo(200_000);
    expect(res.body.order.customer.name).toBe('Farhan Group Market');
    expect(res.body.fifo_allocations).toHaveLength(1);
    expect(res.body.fifo_allocations[0].batch_code).toBe('BATCH-20261016-01');
    expect(Number(res.body.fifo_allocations[0].kg)).toBe(20);
  });

  it('404s for unknown orders', async () => {
    const res = await request(ctx.app).get('/api/reporting/orders/SO-NOPE-1').set(deviceHeaders());
    expect(res.status).toBe(404);
  });
});
