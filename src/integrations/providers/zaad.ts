import SHA256 from 'crypto-js/sha256';
import type { MMChargeRequest, MMChargeResult, MobileMoneyProvider } from './types';
import type { Settings } from '../../db/settingsRepo';
import { uuid } from '../../lib/ids';

/**
 * Zaad (Telesom) merchant STK-push client.
 *
 * Live flow mirrors EVC Plus: signed merchant API call → session → deep
 * link `zaad://...` opens the STK prompt on the buyer's phone. The
 * signature binds merchant code + amount + reference so the provider can
 * detect tampering.
 */
export function makeZaad(settings: Settings): MobileMoneyProvider {
  return {
    id: 'zaad',
    displayName: 'Zaad',
    buildStkDeepLink: (sessionId: string) => `${settings.zaadStkScheme}?session=${sessionId}`,
    async charge(req: MMChargeRequest): Promise<MMChargeResult> {
      if (settings.zaadMode !== 'live' || !settings.zaadSecret || !settings.zaadMerchantCode) {
        return simulatedCharge(`ZAAD-SIM-${uuid().slice(0, 8).toUpperCase()}`);
      }

      const requestId = uuid();
      const body = JSON.stringify({
        merchantCode: settings.zaadMerchantCode,
        requestId,
        amount: Math.round(req.amount),
        phone: req.phone.replace(/\D/g, ''),
        reference: req.reference,
      });
      const signature = SHA256(
        `${settings.zaadSecret}${req.amount}${req.reference}${requestId}`,
      ).toString();

      const res = await fetch(`${settings.zaadBaseUrl.replace(/\/$/, '')}/api/merchant/stk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Zaad-Signature': signature,
        },
        body,
      });

      const json = (await res.json().catch(() => null)) as
        | { sessionId?: string; status?: string; message?: string }
        | null;
      if (!res.ok || !json?.sessionId) {
        return {
          success: false,
          message: json?.message || `Zaad API error ${res.status}`,
        };
      }
      return {
        success: true,
        sessionId: json.sessionId,
        deepLink: `${settings.zaadStkScheme}?session=${json.sessionId}`,
        message: 'STK prompt sent to buyer phone',
      };
    },
  };
}

async function simulatedCharge(prefix: string): Promise<MMChargeResult> {
  await new Promise((r) => setTimeout(r, 900));
  return {
    success: true,
    reference: `${prefix}-${Date.now().toString(36).toUpperCase()}`,
    message: 'Simulated STK confirmed (configure live keys in Settings → Mobile Money)',
  };
}
