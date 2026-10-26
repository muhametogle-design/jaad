import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { logger } from '../logger.js';
import { makeEvcPlus } from '../gateways/evcPlus.js';
import { makeZaad } from '../gateways/zaad.js';
import type { MMProvider } from '../gateways/types.js';
import { badRequest } from '../utils/errors.js';

const stkSchema = z.object({
  payerPhone: z.string().min(9).max(16),
  amount: z.number().positive().finite(),
  orderId: z.string().min(1).max(64),
  provider: z.enum(['EVC_PLUS', 'ZAAD']),
});

export type StkPushInput = z.infer<typeof stkSchema>;

/** Normalize to international digits: +25261… / 25261… / 061… → 25261… */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = `252${d.slice(1)}`;
  if (!d.startsWith('252')) d = `252${d}`;
  return d;
}

/**
 * Module 2 — STK push dispatcher.
 *
 * Formulates the provider request (EVC Plus or WaafiPay/Telesom e-Billing),
 * dispatches the asynchronous prompt to the buyer's phone, and logs a
 * PENDING payments_stk row awaiting the webhook callback.
 */
export async function requestStkPush(
  inputRaw: unknown,
): Promise<{ status: string; orderId: string; invoiceId: string; provider: MMProvider; simulated?: boolean }> {
  const input: StkPushInput = stkSchema.parse(inputRaw);
  const payerPhone = normalizePhone(input.payerPhone);
  if (payerPhone.length < 10 || payerPhone.length > 13) {
    throw badRequest('payerPhone must be a valid Somaliland/Somalia mobile number');
  }

  const gateway = input.provider === 'EVC_PLUS' ? makeEvcPlus() : makeZaad();
  const result = await gateway.dispatch({
    payerPhone,
    amount: input.amount,
    orderId: input.orderId,
  });

  if (!result.ok || !result.invoiceId) {
    logger.warn({ orderId: input.orderId, provider: input.provider, msg: result.message }, 'STK dispatch failed');
    throw badRequest(`STK dispatch failed: ${result.message ?? 'provider error'}`, { provider: input.provider });
  }

  const db = getPool();
  await db.query(
    `INSERT INTO payments_stk (order_code, invoice_id, provider, payer_phone, amount, status, raw)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)`,
    [
      input.orderId,
      result.invoiceId,
      input.provider,
      payerPhone,
      input.amount,
      JSON.stringify({
        dispatchedAt: new Date().toISOString(),
        simulated: result.simulated ?? false,
        raw: result.raw ?? null,
      }),
    ],
  );

  logger.info(
    { orderId: input.orderId, invoiceId: result.invoiceId, provider: input.provider },
    'STK push dispatched — awaiting webhook',
  );
  return {
    status: 'PENDING',
    orderId: input.orderId,
    invoiceId: result.invoiceId,
    provider: input.provider,
    simulated: result.simulated,
  };
}

/** Current STK/payment state for an order (mobile polls this to close the loop). */
export async function getPaymentStatus(orderCode: string): Promise<{
  orderId: string;
  status: string;
  provider: string | null;
  gatewayRef: string | null;
}> {
  const db = getPool();
  const q = await db.query<{
    order_code: string;
    status: string;
    provider: string;
    gateway_ref: string | null;
  }>(
    `SELECT order_code, status, provider, gateway_ref
       FROM payments_stk WHERE order_code = $1
       ORDER BY id DESC LIMIT 1`,
    [orderCode],
  );
  const row = q.rows[0];
  return {
    orderId: orderCode,
    status: row ? row.status : 'NOT_FOUND',
    provider: row?.provider ?? null,
    gatewayRef: row?.gateway_ref ?? null,
  };
}
