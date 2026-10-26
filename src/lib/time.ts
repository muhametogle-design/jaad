import type { AgingStatus } from '../types';

/** ISO timestamp of "now" (UTC). All DB timestamps are stored this way. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Local calendar day as YYYY-MM-DD (used for "today" aggregates). */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Local calendar day as YYYYMMDD (used for batch/order codes). */
export function compactDayKey(d: Date = new Date()): string {
  return localDayKey(d).replaceAll('-', '');
}

/** Whole hours (fractional) elapsed since an ISO timestamp. */
export function hoursSince(iso: string, nowMs: number = Date.now()): number {
  const ms = nowMs - new Date(iso).getTime();
  return Math.max(0, ms / 3_600_000);
}

/** Human age: "45m", "6h 20m", "2d 3h". */
export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) {
    const h = Math.floor(hours);
    const m = Math.round((hours % 1) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return h > 0 ? `${days}d ${h}h` : `${days}d`;
}

export interface AgingThresholds {
  freshHours: number;
  agingHours: number;
}

export function agingStatus(hours: number, t: AgingThresholds): AgingStatus {
  if (hours < t.freshHours) return 'fresh';
  if (hours <= t.agingHours) return 'aging';
  return 'stale';
}

/** "YYYY-MM-DD HH:mm" in local time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${localDayKey(d)} ${hh}:${mm}`;
}

/** "HH:mm" in local time. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Combine a form date (YYYY-MM-DD) and time (HH:MM) entered in local time
 * into a stored ISO (UTC) timestamp.
 */
export function localFormToIso(dateStr: string, timeStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Enter a valid landing date (YYYY-MM-DD).');
  }
  const d = new Date(parts[0], parts[1] - 1, parts[2], hh || 0, mm || 0);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid landing date/time.');
  return d.toISOString();
}

/** Default "now" values for the intake form, in local time. */
export function nowFormValues(): { date: string; time: string } {
  const d = new Date();
  return {
    date: localDayKey(d),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}
