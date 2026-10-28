import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { hmacSha256Hex } from '../utils/hmac.js';
import type { StkDispatchInput, StkDispatchResult, StkGateway } from './types.js';

/**
 * EVC Plus (Hormuud) merchant STK-push gateway.
 *
 * Live flow: POST {EVC_API_BASE_URL}{EVC_STK_ENDPOINT} with merchant
 * credentials; the body is signed with SHA-256(secret + body) in the
 * `X-EVC-SIGNATURE` header. The response carries a `sessionId` that
 * correlates the STK prompt with the later webhook (invoiceId).
 *
 * Without credentials the client simulates the gateway (deterministic
 * sandbox invoice id) so the full webhook pipeline can be exercised in
 * staging.
 */
export function makeEvcPlus(): StkGateway {
  return {
    id: 'EVC_PLUS',
    displayName: 'EVC Plus',
    async dispatch(input: StkDispatchInput): Promise<StkDispatchResult> {
      const c = config.evc;
      if (!c.configured) return simulated(input, 'EVC-SIM');

      const requestId = randomUUID();
      const body = JSON.stringify({
        merchantId: c.merchantId,
        requestId,
        amount: Math.round(input.amount),
        phone: input.payerPhone.replace(/\D/g, ''),
        callbackUrl: c.callbackUrl || undefined,
        metadata: { orderId: input.orderId },
      });
      const signature = hmacSha256Hex(c.secret, body);

      try {
        const res = await fetch(`${c.baseUrl}${c.stkEndpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EVC-KEY': c.apiKey,
            'X-EVC-SIGNATURE': signature,
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => null)) as
          | { sessionId?: string; status?: string; message?: string; code?: string }
          | null;

        if (!res.ok || !json?.sessionId) {
          logger.warn({ status: res.status, json }, 'EVC+ STK dispatch rejected');
          return { ok: false, message: json?.message || `EVC API error ${res.status}` };
        }
        return { ok: true, invoiceId: json.sessionId, raw: json };
      } catch (err) {
        logger.error({ err, orderId: input.orderId }, 'EVC+ STK dispatch failed');
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function simulated(input: StkDispatchInput, prefix: string): StkDispatchResult {
  const invoiceId = `${prefix}-${randomUUID().slice(0, 12).toUpperCase()}`;
  logger.warn(
    { orderId: input.orderId, invoiceId },
    `[${prefix}] SIMULATED dispatch (no credentials configured)`,
  );
  return { ok: true, invoiceId, simulated: true, message: 'Simulated STK dispatch (no live credentials)' };
}

export { simulated as simulateStk };
