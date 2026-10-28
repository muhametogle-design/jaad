import { formatMoney, formatKg, formatUnitPrice, parseAmount } from '../lib/money';

describe('money formatting (SOS)', () => {
  it('formats whole shillings with thousands separators', () => {
    expect(formatMoney(1_250_000)).toBe('1,250,000 So');
    expect(formatMoney(0)).toBe('0 So');
    expect(formatMoney(999.4)).toBe('999 So');
  });

  it('formats kg with up to 2 decimals', () => {
    expect(formatKg(12.5)).toBe('12.5 KG');
    expect(formatKg(12.555)).toBe('12.56 KG');
    expect(formatKg(1000)).toBe('1,000 KG');
  });

  it('formats unit prices', () => {
    expect(formatUnitPrice(22_000)).toBe('22,000 So/KG');
  });
});

describe('parseAmount', () => {
  it('strips currency noise', () => {
    expect(parseAmount('1,250,000 So')).toBe(1_250_000);
    expect(parseAmount(' 22.5 ')).toBe(22.5);
  });

  it('clamps garbage to zero', () => {
    expect(parseAmount('abc')).toBe(0);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('-5')).toBe(0);
  });
});
