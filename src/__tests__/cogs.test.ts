import {
  allocateFifo,
  previewAllocation,
  effectiveCogsForBatch,
  inboundCostTotal,
  round2,
  InsufficientStockError,
  EPS,
  type LedgerRow,
} from '../lib/cogs';

const rows: LedgerRow[] = [
  { invId: 1, arrivedAt: '2026-10-16T04:00:00.000Z', cogsPerKg: 100, remainingKg: 10 },
  { invId: 2, arrivedAt: '2026-10-16T10:00:00.000Z', cogsPerKg: 200, remainingKg: 5 },
  { invId: 3, arrivedAt: '2026-10-16T14:00:00.000Z', cogsPerKg: 300, remainingKg: 100 },
];

describe('allocateFifo', () => {
  it('takes from the oldest batch first', () => {
    const res = allocateFifo(rows, 10);
    expect(res.allocations).toEqual([{ invId: 1, kg: 10, cogsPerKg: 100 }]);
    expect(res.totalCogs).toBe(1000);
    expect(res.cogsPerKg).toBe(100);
  });

  it('spans multiple batches in FIFO order with a weighted COGS', () => {
    const res = allocateFifo(rows, 15); // 10 @100 + 5 @200
    expect(res.allocations.map((a) => a.invId)).toEqual([1, 2]);
    expect(res.totalKg).toBe(15);
    expect(res.totalCogs).toBe(round2(10 * 100 + 5 * 200)); // 2000
    expect(res.cogsPerKg).toBe(round2(2000 / 15)); // 133.33
  });

  it('handles sub-kilogram quantities', () => {
    const res = allocateFifo(rows, 0.5);
    expect(res.totalKg).toBe(0.5);
    expect(res.allocations[0].kg).toBe(0.5);
  });

  it('rounds to 2dp without drift', () => {
    const res = allocateFifo(rows, 12.55);
    expect(res.totalKg).toBe(12.55);
    expect(res.totalCogs).toBe(round2(10 * 100 + 2.55 * 200));
  });

  it('throws InsufficientStockError with the shortfall', () => {
    const tiny: LedgerRow[] = [
      { invId: 9, arrivedAt: '2026-10-16T04:00:00.000Z', cogsPerKg: 100, remainingKg: 2.5 },
    ];
    expect(() => allocateFifo(tiny, 10)).toThrow(InsufficientStockError);
    try {
      allocateFifo(tiny, 10);
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError);
      expect((e as InsufficientStockError).shortfallKg).toBeCloseTo(7.5, 5);
    }
  });

  it('rejects non-positive quantities', () => {
    expect(() => allocateFifo(rows, 0)).toThrow();
    expect(() => allocateFifo(rows, -1)).toThrow();
  });

  it('treats float-dust remainders as zero', () => {
    const dust: LedgerRow[] = [
      { invId: 1, arrivedAt: '2026-10-16T04:00:00.000Z', cogsPerKg: 100, remainingKg: EPS },
    ];
    expect(() => allocateFifo(dust, 1)).toThrow(InsufficientStockError);
  });
});

describe('previewAllocation', () => {
  it('caps at available stock instead of throwing', () => {
    const res = previewAllocation(rows, 999);
    expect(res.totalKg).toBe(round2(10 + 5 + 100));
    expect(res.allocations.length).toBe(3);
  });

  it('returns nothing for zero quantity', () => {
    const res = previewAllocation(rows, 0);
    expect(res.totalKg).toBe(0);
    expect(res.allocations).toHaveLength(0);
  });
});

describe('effectiveCogsForBatch', () => {
  it('absorbs inbound costs over the gross weight', () => {
    // base 11,000 + (1,450,000 freight) / 700 KG = 11,000 + 2,071.43
    const eff = effectiveCogsForBatch(11_000, 1_450_000, 700);
    expect(eff).toBeCloseTo(round2(11_000 + 1_450_000 / 700), 2);
  });

  it('falls back to base when gross weight is zero', () => {
    expect(effectiveCogsForBatch(11_000, 1_450_000, 0)).toBe(11_000);
  });

  it('sums inbound components', () => {
    expect(inboundCostTotal({ freight: 100, handling: 20.5, transport: 30, other: 0 })).toBe(150.5);
  });
});
