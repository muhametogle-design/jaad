import { CURRENCY } from '../config';
import { round2 } from './cogs';

/** Format money in Somali Shillings, e.g. 1250000 -> "1,250,000 So". */
export function formatMoney(n: number): string {
  const v = Math.round(n);
  return `${v.toLocaleString('en-US')} ${CURRENCY}`;
}

/** Format kilograms with up to 2 decimals, e.g. 12.5 -> "12.5 KG". */
export function formatKg(n: number): string {
  const v = round2(n);
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} KG`;
}

/** Format a unit price, e.g. 22000 -> "22,000 So/KG". */
export function formatUnitPrice(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} ${CURRENCY}/KG`;
}

/** Parse a money/kg input field: strips commas/spaces, rejects negatives. */
export function parseAmount(input: string): number {
  const trimmed = input.trim();
  if (trimmed.startsWith('-')) return 0;
  const cleaned = trimmed.replace(/[^\d.]/g, '');
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
