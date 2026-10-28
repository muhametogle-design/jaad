/** Format an amount in Somali Shillings: 1250000 -> "1,250,000 So". */
export function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} So`;
}

/** Format kilograms: 12.5 -> "12.5". */
export function formatKg(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
