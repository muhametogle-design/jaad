import request from 'supertest';
import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, deviceHeaders, rows, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(() => {
  ctx = createTestContext();
});

describe('POST /api/payments/stk-push', () => {
  it('requires device authentication', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/stk-push')
      .send({ payerPhone: '252611234567', amount: 1000, orderId: 'SO-1', provider: 'ZAAD' });
    expect(res.status).toBe(401);
  });

  it('validates the payload (provider enum, positive amount, phone)', async () => {
    const base = { payerPhone: '252611234567', amount: 1000, orderId: 'SO-1', provider: 'ZAAD' };

    expect(
      (
        await request(ctx.app).post('/api/payments/stk-push').set(deviceHeaders()).send({ ...base, provider: 'AIRTEL' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app).post('/api/payments/stk-push').set(deviceHeaders()).send({ ...base, amount: -5 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app).post('/api/payments/stk-push').set(deviceHeaders()).send({ ...base, payerPhone: 'abc' })
      ).status,
    ).toBe(400);
  });

  it('dispatches a simulated STK and logs a PENDING attempt (EVC_PLUS)', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/stk-push')
      .set(deviceHeaders())
      .send({ payerPhone: '+252611234567', amount: 45_000, orderId: 'ORD-1042', provider: 'EVC_PLUS' })
      .expect(202);

    expect(res.body.status).toBe('OK');
    expect(res.body.paymentStatus).toBe('PENDING');
    expect(res.body.orderId).toBe('ORD-1042');
    expect(res.body.provider).toBe('EVC_PLUS');
    expect(res.body.invoiceId).toMatch(/^EVC-SIM-/);
    expect(res.body.simulated).toBe(true);

    const stkRows = await rows('SELECT * FROM payments_stk WHERE order_code = $1', ['ORD-1042']);
    expect(stkRows).toHaveLength(1);
    expect(stkRows[0].status).toBe('PENDING');
    expect(stkRows[0].payer_phone).toBe('252611234567');
    expect(Number(stkRows[0].amount)).toBe(45_000);
  });

  it('dispatches a simulated STK for ZAAD and normalizes local 0… numbers', async () => {
    const res = await request(ctx.app)
      .post('/api/payments/stk-push')
      .set(deviceHeaders())
      .send({ payerPhone: '061 123 4567', amount: 12_000, orderId: 'ORD-1043', provider: 'ZAAD' })
      .expect(202);
    expect(res.body.invoiceId).toMatch(/^ZAAD-SIM-/);

    const stkRows = await rows('SELECT * FROM payments_stk WHERE order_code = $1', ['ORD-1043']);
    expect(stkRows[0].payer_phone).toBe('252611234567');
  });

  it('GET /api/payments/status/:orderId reflects PENDING, then SUCCESS after webhook', async () => {
    const push = await request(ctx.app)
      .post('/api/payments/stk-push')
      .set(deviceHeaders())
      .send({ payerPhone: '252619998877', amount: 80_000, orderId: 'ORD-1044', provider: 'EVC_PLUS' })
      .expect(202);

    const st1 = await request(ctx.app).get('/api/payments/status/ORD-1044').set(deviceHeaders()).expect(200);
    expect(st1.body.paymentStatus).toBe('PENDING');

    // Simulate the gateway webhook (HMAC from test env secret).
    const payload = {
      referenceId: 'REF-777',
      invoiceId: push.body.invoiceId,
      amount: 80_000,
      status: 'SUCCESS',
      accountNumber: '252619998877',
    };
    const raw = JSON.stringify(payload);
    await request(ctx.app)
      .post('/api/payments/webhook')
      .set({
        'Content-Type': 'application/json',
        'x-waafi-signature': crypto.createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex'),
      })
      .send(payload)
      .expect(200);

    const st2 = await request(ctx.app).get('/api/payments/status/ORD-1044').set(deviceHeaders()).expect(200);
    expect(st2.body.paymentStatus).toBe('SUCCESS');
    expect(st2.body.gatewayRef).toBe('REF-777');
  });

  it('returns 404 for unknown order status', async () => {
    const res = await request(ctx.app).get('/api/payments/status/NO-SUCH').set(deviceHeaders());
    expect(res.status).toBe(404);
  });
});
