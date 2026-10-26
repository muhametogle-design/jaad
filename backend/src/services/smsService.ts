import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendSms, type SmsResult } from '../gateways/sms.js';
import { formatKg, formatMoney } from '../utils/money.js';

/** Test seam: swap the SMS sender (assertions in vitest). */
let smsSender: (to: string, message: string) => Promise<SmsResult> = sendSms;
export function setSmsSenderForTest(fn: (to: string, message: string) => Promise<SmsResult>): void {
  smsSender = fn;
}

const orderCodeSchema = z.string().min(1).max(64);

const PROVIDER_LABEL: Record<string, string> = {
  evc_plus: 'EVC Plus',
  zaad: 'Zaad',
  cash: 'Cash',
  credit: 'Credit',
};

interface OrderSmsRow {
  order_code: string;
  kg_sold: number;
  khat_type: string;
  revenue: number;
  pay_method: string;
  gateway_ref: string | null;
  customer_phone: string;
  credit_balance: number;
}

/**
 * Module 3 — automated payment-receipt SMS.
 *
 * Template (spec):
 *  [KhatHub] Order #{orderId} Paid! Qty: {kg} KG ({type}).
 *  Total: ${amount} via {provider}. Ref: {refId}. Remaining Debt: ${creditBalance}.
 *
 * Fired automatically after a webhook marks an order PAID; failures are
 * logged and the sale is left with sms_sent=false (retryable manually).
 */
export async function sendPaymentReceipt(orderCodeRaw: string): Promise<boolean> {
  const orderCode = orderCodeSchema.parse(orderCodeRaw);
  const db = getPool();

  const q = await db.query<OrderSmsRow>(
    `SELECT s.order_code, s.kg_sold, s.khat_type, s.revenue, s.pay_method, s.gateway_ref,
            s.customer_phone,
            COALESCE(c.outstanding, 0) AS credit_balance
       FROM sales s
       LEFT JOIN customers c
          ON c.device_id = s.customer_device_id
         AND c.local_id = s.customer_local_id
      WHERE s.order_code = $1`,
    [orderCode],
  );
  const row = q.rows[0];
  if (!row) {
    logger.warn({ orderCode }, 'SMS receipt: order not found in cloud DB');
    return false;
  }
  if (!row.customer_phone) {
    logger.warn({ orderCode }, 'SMS receipt: buyer has no phone number on file');
    return false;
  }

  const providerLabel = PROVIDER_LABEL[row.pay_method] ?? row.pay_method;
  const message =
    `[${config.sms.businessName}] Order #${row.order_code} Paid! ` +
    `Qty: ${formatKg(Number(row.kg_sold))} KG (${row.khat_type}). ` +
    `Total: ${formatMoney(Number(row.revenue))} via ${providerLabel}. ` +
    `Ref: ${row.gateway_ref ?? 'n/a'}. ` +
    `Remaining Debt: ${formatMoney(Number(row.credit_balance))}.`;

  const result = await smsSender(row.customer_phone, message);
  if (result.ok) {
    await db.query(`UPDATE sales SET sms_sent = TRUE WHERE order_code = $1`, [orderCode]);
    logger.info({ orderCode, to: row.customer_phone }, 'payment receipt SMS sent');
  } else {
    logger.warn({ orderCode, error: result.message }, 'payment receipt SMS failed');
  }
  return result.ok;
}
