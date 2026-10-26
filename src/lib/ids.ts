import { compactDayKey, localDayKey } from './time';

/**
 * RFC4122-ish v4 id without native crypto (safe in RN, good enough for
 * request ids / STK session correlation).
 */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Batch code: BATCH-YYYYMMDD-XX where XX is the 1-based sequence of that
 * day's landings. The sequence is derived inside a transaction so two
 * batches landed the same day never collide.
 */
export function batchCode(dayKey: string, seq: number): string {
  return `BATCH-${compactDayKey(new Date(`${dayKey}T12:00:00`))}-${String(seq).padStart(2, '0')}`;
}

/** Order code: SO-YYYYMMDD-XXX. */
export function orderCode(dayKey: string, seq: number): string {
  return `SO-${compactDayKey(new Date(`${dayKey}T12:00:00`))}-${String(seq).padStart(3, '0')}`;
}

export function todayKey(): string {
  return localDayKey();
}
