import * as Linking from 'expo-linking';
import type { MMProviderId } from './providers/types';
import { PROVIDER_LABEL } from './providers/types';
import { makeEvcPlus } from './providers/evcPlus';
import { makeZaad } from './providers/zaad';
import { getSettings } from '../db/settingsRepo';
import { markSaleMmPending, resolveSalePayment, saleNeedsCharge } from '../db/repositories/saleRepo';
import type { Sale } from '../types';
import { enqueue, listPending, markProcessed, recordAttempt } from '../db/repositories/syncQueueRepo';
import { sendQueuedSms } from './sms';

export type ChargeOutcome =
  | { status: 'charged'; reference: string; message?: string }
  | { status: 'pending'; error?: string; message?: string };

/**
 * Charge a confirmed sale via the buyer's mobile-money wallet.
 *
 * - Live mode: merchant API → open the STK deep link on the buyer's phone →
 *   mark the sale mm_pending until the provider webhook confirms (the
 *   reference is stored when it arrives; queue items are retried meanwhile).
 * - Simulated mode: resolves immediately with a sandbox reference so the
 *   full checkout flow works offline.
 *
 * On any failure the charge is enqueued in sync_queue and retried
 * automatically when connectivity returns (see processQueue).
 */
export async function chargeSale(
  provider: MMProviderId,
  sale: Sale,
  phone: string,
): Promise<ChargeOutcome> {
  const settings = getSettings();
  const client = provider === 'evc_plus' ? makeEvcPlus(settings) : makeZaad(settings);
  const amount = sale.amount_paid;

  try {
    const res = await client.charge({ phone, amount, reference: sale.order_code });
    if (!res.success) throw new Error(res.message || 'STK request rejected');

    if (res.reference) {
      // Simulated / instant confirmation — the money is in.
      await resolveSalePayment(sale.id, res.reference, 'completed');
      return { status: 'charged', reference: res.reference, message: res.message };
    }

    // Live STK session: open the prompt, await webhook confirmation.
    if (res.deepLink) {
      try {
        await Linking.openURL(res.deepLink);
      } catch {
        // Buyer phone not reachable from this device — webhook will still land.
      }
    }
    await markSaleMmPending(sale.id);
    await enqueue('mm_payment', {
      saleId: sale.id,
      provider,
      phone,
      amount,
      orderCode: sale.order_code,
      sessionId: res.sessionId ?? null,
    });
    return {
      status: 'pending',
      message: `${PROVIDER_LABEL[provider]} STK sent — awaiting confirmation`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markSaleMmPending(sale.id);
    await enqueue('mm_payment', {
      saleId: sale.id,
      provider,
      phone,
      amount,
      orderCode: sale.order_code,
      sessionId: null,
    });
    return { status: 'pending', error: message };
  }
}

/**
 * Standalone charge for debt repayments (Buyer detail → Record Payment).
 * Returns success only when the provider confirmed; otherwise the caller
 * does NOT record the payment.
 */
export async function chargeStandalone(
  provider: MMProviderId,
  args: { phone: string; amount: number; reference: string },
): Promise<{ ok: boolean; reference?: string; error?: string }> {
  const settings = getSettings();
  const client = provider === 'evc_plus' ? makeEvcPlus(settings) : makeZaad(settings);
  try {
    const res = await client.charge(args);
    if (!res.success) return { ok: false, error: res.message || 'STK request rejected' };
    if (res.reference) return { ok: true, reference: res.reference };
    // Live STK without instant confirmation — cannot verify receipt yet.
    if (res.deepLink) {
      try {
        await Linking.openURL(res.deepLink);
      } catch {
        /* offline buyer phone */
      }
    }
    return { ok: false, error: 'Awaiting STK confirmation — retry after the buyer approves.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Drain the offline outbox. Called on app start, on connectivity recovery
 * and manually from Settings → Data.
 */
export async function processQueue(): Promise<{ retried: number; ok: number; failed: number }> {
  const items = await listPending();
  let ok = 0;
  let failed = 0;

  for (const item of items) {
    let success = false;
    try {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      if (item.kind === 'mm_payment') {
        success = await retryMmPayment(payload);
      } else if (item.kind === 'sms_receipt') {
        success = await retrySms(payload);
      }
    } catch {
      success = false;
    }

    if (success) {
      await markProcessed(item.id);
      ok += 1;
    } else {
      const keepGoing = await recordAttempt(item.id);
      if (!keepGoing) failed += 1;
    }
  }
  return { retried: items.length, ok, failed };
}

async function retryMmPayment(payload: Record<string, unknown>): Promise<boolean> {
  const settings = getSettings();
  const provider = (payload.provider as MMProviderId) || 'evc_plus';
  const client = provider === 'evc_plus' ? makeEvcPlus(settings) : makeZaad(settings);
  try {
    const res = await client.charge({
      phone: String(payload.phone ?? ''),
      amount: Number(payload.amount ?? 0),
      reference: String(payload.orderCode ?? 'retry'),
    });
    if (res.reference) {
      await resolveSalePayment(Number(payload.saleId), res.reference, 'completed');
      return true;
    }
    if (res.success && res.deepLink) {
      try {
        await Linking.openURL(res.deepLink);
      } catch {
        /* ignore */
      }
    }
    return Boolean(res.reference);
  } catch {
    return false;
  }
}

async function retrySms(payload: Record<string, unknown>): Promise<boolean> {
  return sendQueuedSms(payload);
}

export { saleNeedsCharge };
