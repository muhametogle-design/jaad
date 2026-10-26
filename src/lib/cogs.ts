/**
 * FIFO allocation + COGS math.
 *
 * Pure functions only — no database, no React. This module is the single
 * source of truth for cost flow: a sale is deducted from the OLDEST landed
 * stock first, and the sale's COGS is the weighted average of the exact
 * batch slices that covered it.
 */

export interface LedgerRow {
  /** batch_inventory.id */
  invId: number;
  arrivedAt: string;
  cogsPerKg: number;
  remainingKg: number;
}

export interface Allocation {
  invId: number;
  kg: number;
  cogsPerKg: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  totalKg: number;
  totalCogs: number;
  /** Weighted average cost per KG actually consumed. */
  cogsPerKg: number;
}

/** Weights smaller than this are treated as zero (avoids float dust). */
export const EPS = 0.0005;

export class InsufficientStockError extends Error {
  constructor(
    public shortfallKg: number,
  ) {
    super(`Insufficient stock — short by ${round2(shortfallKg)} KG`);
    this.name = 'InsufficientStockError';
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Allocate `requestedKg` from `rows` in FIFO order (rows must already be
 * sorted by arrival, oldest first). Throws InsufficientStockError when the
 * total available is less than requested.
 */
export function allocateFifo(rows: LedgerRow[], requestedKg: number): AllocationResult {
  const kg = round2(requestedKg);
  if (kg <= 0) throw new Error('Quantity must be positive');

  const allocations: Allocation[] = [];
  let remaining = kg;

  for (const row of rows) {
    if (remaining <= EPS) break;
    const avail = round2(row.remainingKg);
    if (avail <= EPS) continue;
    const take = round2(Math.min(remaining, avail));
    if (take > 0) allocations.push({ invId: row.invId, kg: take, cogsPerKg: row.cogsPerKg });
    remaining = round2(remaining - take);
  }

  if (remaining > EPS) throw new InsufficientStockError(remaining);

  const totalKg = round2(allocations.reduce((s, a) => s + a.kg, 0));
  const totalCogs = round2(allocations.reduce((s, a) => s + a.kg * a.cogsPerKg, 0));

  return {
    allocations,
    totalKg,
    totalCogs,
    cogsPerKg: totalKg > 0 ? round2(totalCogs / totalKg) : 0,
  };
}

/**
 * UI preview version of allocateFifo: silently caps at available stock so
 * the POS can show a live COGS estimate while the buyer taps kilograms.
 */
export function previewAllocation(rows: LedgerRow[], requestedKg: number): AllocationResult {
  const kg = round2(requestedKg);
  if (kg <= 0) return { allocations: [], totalKg: 0, totalCogs: 0, cogsPerKg: 0 };
  const available = round2(rows.reduce((s, r) => s + Math.max(0, r.remainingKg), 0));
  return allocateFifo(rows, Math.min(kg, available));
}

/**
 * Effective landing COGS per KG for one variety inside one flight batch:
 *
 *   effective = base purchase price per KG
 *             + (freight + handling + transport + other) / gross batch weight
 *
 * Inbound logistics costs are spread evenly over the gross weight of the
 * batch (standard absorption for air-cargo produce).
 */
export function effectiveCogsForBatch(
  basePerKg: number,
  inboundCostTotal: number,
  grossWeightKg: number,
): number {
  if (grossWeightKg <= 0) return round2(basePerKg);
  return round2(basePerKg + inboundCostTotal / grossWeightKg);
}

/** Total inbound logistics cost for a batch. */
export function inboundCostTotal(c: {
  freight: number;
  handling: number;
  transport: number;
  other: number;
}): number {
  return round2(c.freight + c.handling + c.transport + c.other);
}
