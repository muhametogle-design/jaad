import * as Linking from 'expo-linking';
import { getSettings } from '../db/settingsRepo';
import { markSmsSent } from '../db/repositories/saleRepo';
import { enqueue } from '../db/repositories/syncQueueRepo';
import type { SaleDetail } from '../types';
import { formatKg, formatMoney } from '../lib/money';

/**
 * Module 4 — automated SMS receipts.
 *
 * The payload always contains: Order ID, KGs sold, Khat Type, Total Paid,
 * and the buyer's remaining credit balance.
 *
 * Delivery:
 *  1. If a gateway (Twilio-style POST) is configured in Settings → send
 *     HTTP.
 *  2. Otherwise hand the message to the device SMS app via an `sms:`
 *     deep link — works fully offline at the airstrip.
 *  3. Any failure is parked in sync_queue for automatic retry.
 */
export function buildReceiptText(
  sale: SaleDetail,
  opts: { businessName: string; remainingCredit: number },
): string {
  const payLabel =
    sale.pay_method === 'evc_plus'
      ? 'EVC Plus'
      : sale.pay_method === 'zaad'
        ? 'Zaad'
        : sale.pay_method === 'credit'
          ? 'Credit'
          : 'Cash';
  return [
    `${opts.businessName} receipt:`,
    `Order ${sale.order_code}`,
    `Item: ${formatKg(sale.kg_sold)} ${sale.type_name}`,
    `Total paid: ${formatMoney(sale.amount_paid)} (${payLabel})`,
    `Credit balance: ${formatMoney(opts.remainingCredit)}`,
    `Thank you for your business!`,
  ].join('\n');
}

export interface SmsSendResult {
  sent: boolean;
  mode: 'gateway' | 'device' | 'queued';
  error?: string;
}

export async function sendReceipt(sale: SaleDetail, remainingCredit: number): Promise<SmsSendResult> {
  const settings = getSettings();
  const text = buildReceiptText(sale, { businessName: settings.businessName, remainingCredit });

  if (settings.smsGatewayUrl && settings.smsGatewayToken) {
    try {
      const res = await fetch(settings.smsGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.smsGatewayToken}`,
        },
        body: JSON.stringify({ to: sale.customer_phone, body: text }),
      });
      if (!res.ok) throw new Error(`SMS gateway error ${res.status}`);
      await markSmsSent(sale.id);
      return { sent: true, mode: 'gateway' };
    } catch (e) {
      await queueReceipt(sale, text);
      return { sent: false, mode: 'queued', error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Device fallback: open the SMS composer pre-filled.
  const phone = sale.customer_phone.replace(/[^\d+]/g, '');
  if (!phone) {
    return { sent: false, mode: 'queued', error: 'Buyer has no phone number on file.' };
  }
  try {
    await Linking.openURL(`sms:${phone}?body=${encodeURIComponent(text)}`);
    await markSmsSent(sale.id);
    return { sent: true, mode: 'device' };
  } catch (e) {
    await queueReceipt(sale, text);
    return { sent: false, mode: 'queued', error: e instanceof Error ? e.message : String(e) };
  }
}

async function queueReceipt(sale: SaleDetail, text: string): Promise<void> {
  await enqueue('sms_receipt', {
    saleId: sale.id,
    phone: sale.customer_phone,
    text,
  });
}

/** Used by the sync-queue drainer to re-attempt a parked receipt. */
export async function sendQueuedSms(payload: Record<string, unknown>): Promise<boolean> {
  const settings = getSettings();
  const text = String(payload.text ?? '');
  const phone = String(payload.phone ?? '').replace(/[^\d+]/g, '');
  const saleId = Number(payload.saleId ?? 0);

  if (settings.smsGatewayUrl && settings.smsGatewayToken) {
    try {
      const res = await fetch(settings.smsGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.smsGatewayToken}`,
        },
        body: JSON.stringify({ to: phone, body: text }),
      });
      if (!res.ok) return false;
      if (saleId) await markSmsSent(saleId);
      return true;
    } catch {
      return false;
    }
  }

  if (!phone) return false;
  try {
    await Linking.openURL(`sms:${phone}?body=${encodeURIComponent(text)}`);
    if (saleId) await markSmsSent(saleId);
    return true;
  } catch {
    return false;
  }
}
