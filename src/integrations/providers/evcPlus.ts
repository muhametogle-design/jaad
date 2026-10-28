import SHA256 from 'crypto-js/sha256';
import type { MMChargeRequest, MMChargeResult, MobileMoneyProvider } from './types';
import type { Settings } from '../../db/settingsRepo';
import { uuid } from '../../lib/ids';

/**
 * EVC Plus (Hormuud) merchant STK-push client.
 *
 * Live flow:
 *   1. POST {baseUrl}/merchant/stk/push  with merchant credentials and a
 *      SHA-256 signature (secret + raw body) in the X-EVC-SIGNATURE header.
 *   2. Provider responds with a sessionId that correlates the STK push.
 *   3. We hand `evcstk://<sessionId>` to the OS so the EVC Plus app opens
 *      the buyer's payment prompt.
 *   4. Confirmation arrives via the merchant webhook (see ARCHITECTURE §7)
 *      or, in this offline-first build, via our local STK result callback.
 *
 * Credentials are kept in the local settings table — never in code.
 */
export function makeEvcPlus(settings: Settings): MobileMoneyProvider {
  return {
    id: 'evc_plus',
    displayName: 'EVC Plus',
    buildStkDeepLink: (sessionId: string) => `${settings.evcStkScheme}${sessionId}`,
    async charge(req: MMChargeRequest): Promise<MMChargeResult> {
      if (settings.evcMode !== 'live' || !settings.evcApiKey || !settings.evcSecret) {
        return simulatedCharge(`EVC-SIM-${uuid().slice(0, 8).toUpperCase()}`);
      }

      const requestId = uuid();
      const body = JSON.stringify({
        merchantId: settings.evcMerchantId,
        requestId,
        amount: Math.round(req.amount),
        phone: req.phone.replace(/\D/g, ''),
        callbackUrl: settings.evcCallbackUrl || undefined,
        metadata: { reference: req.reference },
      });
      const signature = SHA256(`${settings.evcSecret}${body}`).toString();

      const res = await fetch(`${settings.evcBaseUrl.replace(/\/$/, '')}/merchant/stk/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EVC-KEY': settings.evcApiKey,
          'X-EVC-SIGNATURE': signature,
        },
        body,
      });

      const json = (await res.json().catch(() => null)) as
        | { sessionId?: string; status?: string; message?: string; code?: string }
        | null;
      if (!res.ok || !json?.sessionId) {
        return {
          success: false,
          message: json?.message || `EVC API error ${res.status}${json?.code ? ` (${json.code})` : ''}`,
        };
      }
      return {
        success: true,
        sessionId: json.sessionId,
        deepLink: `${settings.evcStkScheme}${json.sessionId}`,
        message: 'STK prompt sent to buyer phone',
      };
    },
  };
}

/** Local simulation: resolves after a short delay with a deterministic ref. */
async function simulatedCharge(prefix: string): Promise<MMChargeResult> {
  await new Promise((r) => setTimeout(r, 900));
  return {
    success: true,
    reference: `${prefix}-${Date.now().toString(36).toUpperCase()}`,
    message: 'Simulated STK confirmed (configure live keys in Settings → Mobile Money)',
  };
}
