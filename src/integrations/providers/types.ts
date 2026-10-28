export type MMProviderId = 'evc_plus' | 'zaad';

export interface MMChargeRequest {
  /** Buyer phone, E.164-ish, e.g. +252912345678. */
  phone: string;
  /** Amount in whole shillings. */
  amount: number;
  /** Merchant-side reference (order code). */
  reference: string;
}

export interface MMChargeResult {
  success: boolean;
  /** Provider session id (live mode) — used to open the STK prompt. */
  sessionId?: string;
  /** Provider payment reference once the STK is confirmed. */
  reference?: string;
  /** Deep link that opens the STK prompt on the buyer's phone. */
  deepLink?: string;
  /** Human-readable status for the UI. */
  message?: string;
}

/**
 * A pluggable Mobile Money merchant integration.
 *
 * Live mode performs the real HTTPS merchant-API call (signed) and returns
 * a STK session deep link. Simulated mode resolves locally after a short
 * delay so the whole checkout flow can be exercised on-device with no
 * credentials or connectivity — ideal for field testing and demos.
 */
export interface MobileMoneyProvider {
  id: MMProviderId;
  displayName: string;
  charge(req: MMChargeRequest): Promise<MMChargeResult>;
  buildStkDeepLink(sessionId: string): string;
}

export const PROVIDER_LABEL: Record<MMProviderId, string> = {
  evc_plus: 'EVC Plus',
  zaad: 'Zaad',
};
