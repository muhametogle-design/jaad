import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { hmacSha256Hex } from '../utils/hmac.js';
import type { StkDispatchInput, StkDispatchResult, StkGateway } from './types.js';

/**
 * Zaad (Telesom) merchant STK gateway via the WaafiPay / Telesom e-Billing
 * API.
 *
 * Live flow: POST {ZAAD_API_BASE_URL}{ZAAD_STK_ENDPOINT}; the signature
 * binds merchant secret + amount + reference + request id (hex SHA-256)
 * in the `X-Zaad-Signature` header. The response `sessionId` becomes the
 * webhook invoiceId.
 */
export function makeZaad(): StkGateway {
  return {
    id: 'ZAAD',
    displayName: 'Zaad',
    async dispatch(input: StkDispatchInput): Promise<StkDispatchResult> {
      const c = config.zaad;
      if (!c.configured) return simulateStk(input, 'ZAAD-SIM');

      const requestId = randomUUID();
      const body = JSON.stringify({
        merchantCode: c.merchantCode,
        requestId,
        amount: Math.round(input.amount),
        phone: input.payerPhone.replace(/\D/g, ''),
        reference: input.orderId,
        callbackUrl: c.callbackUrl || undefined,
      });
      const signature = hmacSha256Hex(`${c.secret}${input.amount}${input.orderId}${requestId}`, body);

      try {
        const res = await fetch(`${c.baseUrl}${c.stkEndpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Zaad-Signature': signature,
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as
          | { sessionId?: string; status?: string; message?: string }
          | null;

        if (!res.ok || !json?.sessionId) {
          logger.warn({ status: res.status, json }, 'Zaad STK dispatch rejected');
          return { ok: false, message: json?.message || `Zaad API error ${res.status}` };
        }
        return { ok: true, invoiceId: json.sessionId, raw: json };
      } catch (err) {
        logger.error({ err, orderId: input.orderId }, 'Zaad STK dispatch failed');
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function simulateStk(input: StkDispatchInput, prefix: string): StkDispatchResult {
  const invoiceId = `${prefix}-${randomUUID().slice(0, 12).toUpperCase()}`;
  logger.warn({ orderId: input.orderId, invoiceId }, `[${prefix}] SIMULATED dispatch (no credentials)`);
  return {
    ok: true,
    invoiceId,
    simulated: true,
    message: 'Simulated STK dispatch (no live credentials)',
  };
}
