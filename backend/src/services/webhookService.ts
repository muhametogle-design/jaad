import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { logger } from '../logger.js';

const webhookSchema = z.object({
  referenceId: z.string().min(1),
  invoiceId: z.string().min(1),
  amount: z.union([z.number(), z.string().transform((v) => Number(v))]).optional(),
  status: z.string().min(1),
  accountNumber: z.string().optional(),
  /** Optional direct order link (the STK record carries it otherwise). */
  orderId: z.string().optional(),
  provider: z.string().optional(),
});

export type WebhookBody = z.infer<typeof webhookSchema>;

const SUCCESS_STATUSES = new Set(['SUCCESS', 'COMPLETED', 'PAID', 'CAPTURED']);
const TERMINAL_FAILURES = new Set(['FAILED', 'EXPIRED', 'ABANDONED', 'CANCELLED', 'DECLINED']);

export interface WebhookResult {
  /** True when the invoice was already processed (duplicate callback). */
  deduplicated: boolean;
  /** The order that reached a terminal paid state, if any (drives SMS). */
  orderId?: string;
  status: string;
}

/**
 * Module 1 — telecom webhook processing (WaafiPay/Telesom, Hormuud EVC+).
 *
 * Called AFTER the HMAC signature was verified by the route. Idempotent by
 * design: webhook_events keeps one row per invoiceId; a callback for an
 * already-COMPLETED invoice is acknowledged and ignored. A failed→success
 * transition is re-processed (webhooks retry); a success is terminal.
 */
export async function processPaymentWebhook(body: unknown): Promise<WebhookResult> {
  const parsed: WebhookBody = webhookSchema.parse(body);
  const status = parsed.status.toUpperCase();
  const succeeded = SUCCESS_STATUSES.has(status);
  const failed = TERMINAL_FAILURES.has(status);
  const amount = parsed.amount !== undefined && Number.isFinite(Number(parsed.amount))
    ? Number(parsed.amount)
    : null;

  return withTransaction(async (client) => {
    // 1) Idempotency gate (pre-check; webhook_events.invoice_id is UNIQUE).
    const prevQ = await client.query<{ status: string; processed_at: string | null }>(
      `SELECT status, processed_at FROM webhook_events WHERE invoice_id = $1`,
      [parsed.invoiceId],
    );
    const prev = prevQ.rows[0];
    if (prev) {
      if (prev.processed_at && SUCCESS_STATUSES.has(prev.status)) {
        logger.info({ invoiceId: parsed.invoiceId }, 'duplicate webhook for COMPLETED invoice — ignored');
        return { deduplicated: true, status: prev.status };
      }
      if (prev.processed_at && TERMINAL_FAILURES.has(prev.status)) {
        logger.info({ invoiceId: parsed.invoiceId }, 'duplicate webhook for failed invoice — ignored');
        return { deduplicated: true, status: prev.status };
      }
      // State transition on an existing event (e.g. PENDING echo → SUCCESS).
      await client.query(
        `UPDATE webhook_events
            SET status = $2, reference_id = $3, amount = $4, raw = $5, processed_at = now()
          WHERE invoice_id = $1`,
        [parsed.invoiceId, status, parsed.referenceId, amount, JSON.stringify(body)],
      );
    } else {
      await client.query(
        `INSERT INTO webhook_events (invoice_id, provider, reference_id, amount, status, raw, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [parsed.invoiceId, parsed.provider ?? '', parsed.referenceId, amount, status, JSON.stringify(body)],
      );
    }

    // 2) Apply the state change.
    let orderId = parsed.orderId;

    if (succeeded) {
      await client.query(
        `UPDATE payments_stk
            SET status = 'SUCCESS', gateway_ref = $2, completed_at = now()
          WHERE invoice_id = $1`,
        [parsed.invoiceId, parsed.referenceId],
      );
      if (!orderId) {
        const stkQ = await client.query<{ order_code: string }>(
          `SELECT order_code FROM payments_stk WHERE invoice_id = $1`,
          [parsed.invoiceId],
        );
        orderId = stkQ.rows[0]?.order_code;
      }
      if (orderId) {
        const upd = await client.query(
          `UPDATE sales
              SET status = 'PAID', gateway_ref = COALESCE($2, gateway_ref)
            WHERE order_code = $1`,
          [orderId, parsed.referenceId],
        );
        logger.info({ orderId, gatewayRef: parsed.referenceId, salesUpdated: upd.rowCount }, 'webhook marked order PAID');
      } else {
        logger.warn({ invoiceId: parsed.invoiceId }, 'webhook success but no order resolved');
      }
    } else if (failed) {
      await client.query(
        `UPDATE payments_stk
            SET status = $2, completed_at = now()
          WHERE invoice_id = $1 AND status = 'PENDING'`,
        [parsed.invoiceId, status],
      );
    }

    return { deduplicated: false, status, orderId };
  });
}
