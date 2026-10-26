import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from './helpers.js';
import { createTestContext, deviceHeaders, sampleSyncPayload, rows, waitFor } from './helpers.js';
import { hmacSha256Hex } from '../src/utils/hmac.js';
import { setSmsSenderForTest } from '../src/services/smsService.js';

const SECRET = 'test-webhook-secret'; // matches vitest.config env

let ctx: TestContext;
let smsSent: { to: string; message: string }[];

beforeAll(() => {
  ctx = createTestContext();
  smsSent = [];
  setSmsSenderForTest(async (to, message) => {
    smsSent.push({ to, message });
    return { ok: true, messageId: 'SMS-TEST-1' };
  });
});

/** Seed one synced order + one dispatched STK; returns the invoiceId. */
async function seedOrderWithStk(orderCode = 'SO-20261016-001'): Promise<string> {
  // Simulate the device having synced this sale. Resends are idempotent no-ops,
  // so just assert the order exists (seeded by whichever test ran first).
  await request(ctx.app)
    .post('/api/sync/outbox')
    .set(deviceHeaders())
    .send(sampleSyncPayload())
    .expect(200);
  const existing = await rows('SELECT 1 FROM sales WHERE order_code = $1', [orderCode]);
  expect(existing).toHaveLength(1);

  const stkRes = await request(ctx.app)
    .post('/api/payments/stk-push')
    .set(deviceHeaders())
    .send({ payerPhone: '252634123456', amount: 275_000, orderId: orderCode, provider: 'EVC_PLUS' })
    .expect(202);
  return stkRes.body.invoiceId as string;
}

function sign(payload: object): Record<string, string> {
  const raw = JSON.stringify(payload);
  return { 'Content-Type': 'application/json', 'x-waafi-signature': hmacSha256Hex(SECRET, raw) };
}

describe('POST /api/payments/webhook', () => {
  it('rejects a bad signature with 401', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/webhook')
      .set({ 'Content-Type': 'application/json', 'x-waafi-signature': 'deadbeef'.repeat(8) })
      .send({ referenceId: 'R1', invoiceId: 'INV-X', amount: 100, status: 'SUCCESS' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing signature with 401', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .send({ referenceId: 'R1', invoiceId: 'INV-X', amount: 100, status: 'SUCCESS' });
    expect(res.status).toBe(401);
  });

  it('processes a SUCCESS callback: PAID + gateway_ref + SMS + 200 OK', async () => {
    const invoiceId = await seedOrderWithStk();

    const payload = {
      referenceId: 'GATEWAY-REF-991',
      invoiceId,
      amount: 275_000,
      status: 'SUCCESS',
      accountNumber: '252634123456',
    };
    const res = await request(ctx.app).post('/api/payments/webhook').set(sign(payload)).send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'OK', message: 'Webhook processed successfully' });

    // Receipt SMS is fire-and-forget — poll until the flag + delivery land.
    await waitFor(async () => (await rows('SELECT sms_sent FROM sales WHERE order_code = $1', ['SO-20261016-001']))[0]?.sms_sent === true);

    const sales = await rows('SELECT * FROM sales WHERE order_code = $1', ['SO-20261016-001']);
    expect(sales).toHaveLength(1);
    expect(sales[0].status).toBe('PAID');
    expect(sales[0].gateway_ref).toBe('GATEWAY-REF-991');
    expect(sales[0].sms_sent).toBe(true);

    const stk = await rows('SELECT * FROM payments_stk WHERE invoice_id = $1', [invoiceId]);
    expect(stk[0].status).toBe('SUCCESS');
    expect(stk[0].gateway_ref).toBe('GATEWAY-REF-991');

    // Automated SMS receipt with the spec template.
    expect(smsSent).toHaveLength(1);
    expect(smsSent[0].to).toBe('+252 63 412 3456');
    expect(smsSent[0].message).toContain('[KhatHub] Order #SO-20261016-001 Paid!');
    expect(smsSent[0].message).toContain('Qty: 12.5 KG (Miro)');
    expect(smsSent[0].message).toContain('Total: 275,000 So via EVC Plus');
    expect(smsSent[0].message).toContain('Ref: GATEWAY-REF-991');
    expect(smsSent[0].message).toContain('Remaining Debt: 0 So');
  });

  it('is idempotent: duplicate COMPLETED invoice is ignored (no second SMS)', async () => {
    const invoiceId = await seedOrderWithStk('SO-20261016-002');
    const payload = {
      referenceId: 'GATEWAY-REF-552',
      invoiceId,
      amount: 120_000,
      status: 'COMPLETED',
      accountNumber: '252617778899',
    };
    const h = sign(payload);

    const first = await request(ctx.app).post('/api/payments/webhook').set(h).send(payload);
    expect(first.status).toBe(200);

    // Let THIS order's receipt land before comparing counts.
    await waitFor(() => smsSent.some((m) => m.message.includes('SO-20261016-002')));
    const before = smsSent.length;
    const second = await request(ctx.app).post('/api/payments/webhook').set(h).send(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'OK', message: 'Webhook processed successfully' });
    expect(smsSent.length).toBe(before); // no duplicate SMS

    const events = await rows('SELECT * FROM webhook_events WHERE invoice_id = $1', [invoiceId]);
    expect(events).toHaveLength(1);
  });

  it('accepts the x-signature header alias', async () => {
    const invoiceId = await seedOrderWithStk('SO-20261016-003');
    const payload = {
      referenceId: 'CASH-REF-N/A',
      invoiceId,
      amount: 176_000,
      status: 'PAID',
      accountNumber: '252634123456',
    };
    const raw = JSON.stringify(payload);
    const res = await request(ctx.app)
      .post('/api/payments/webhook')
      .set({ 'Content-Type': 'application/json', 'x-signature': hmacSha256Hex(SECRET, raw) })
      .send(payload);
    expect(res.status).toBe(200);
  });

  it('records FAILED callbacks and marks the STK attempt failed', async () => {
    const stkRes = await request(ctx.app)
      .post('/api/payments/stk-push')
      .set(deviceHeaders())
      .send({ payerPhone: '252634123456', amount: 50_000, orderId: 'SO-20261016-004', provider: 'ZAAD' })
      .expect(202);
    const failedInvoice = stkRes.body.invoiceId as string;

    const payload = {
      referenceId: 'FAIL-REF-1',
      invoiceId: failedInvoice,
      amount: 50_000,
      status: 'FAILED',
      accountNumber: '252634123456',
    };
    const res = await request(ctx.app).post('/api/payments/webhook').set(sign(payload)).send(payload);
    expect(res.status).toBe(200);

    const stk = await rows('SELECT * FROM payments_stk WHERE invoice_id = $1', [failedInvoice]);
    expect(stk[0].status).toBe('FAILED');
  });
});
