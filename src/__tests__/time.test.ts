import { agingStatus, formatAge, hoursSince, localDayKey, localFormToIso } from '../lib/time';

const T = { freshHours: 12, agingHours: 24 };

describe('aging classification', () => {
  it('fresh below the fresh threshold', () => {
    expect(agingStatus(0, T)).toBe('fresh');
    expect(agingStatus(11.9, T)).toBe('fresh');
  });
  it('aging between thresholds', () => {
    expect(agingStatus(12, T)).toBe('aging');
    expect(agingStatus(24, T)).toBe('aging');
  });
  it('stale past the aging window', () => {
    expect(agingStatus(24.1, T)).toBe('stale');
    expect(agingStatus(100, T)).toBe('stale');
  });
});

describe('hoursSince', () => {
  it('computes elapsed hours from an ISO timestamp', () => {
    const now = new Date('2026-10-16T12:00:00.000Z').getTime();
    const hours = hoursSince('2026-10-16T06:30:00.000Z', now);
    expect(hours).toBeCloseTo(5.5, 5);
  });
  it('never goes negative for future arrivals', () => {
    const now = new Date('2026-10-16T12:00:00.000Z').getTime();
    expect(hoursSince('2026-10-16T13:00:00.000Z', now)).toBe(0);
  });
});

describe('formatAge', () => {
  it('minutes for under an hour', () => expect(formatAge(0.75)).toBe('45m'));
  it('hours and minutes below 48h', () => expect(formatAge(6.5)).toBe('6h 30m'));
  it('days beyond 48h', () => expect(formatAge(51)).toBe('2d 3h'));
});

describe('localFormToIso', () => {
  it('combines local form date + time into ISO', () => {
    const iso = localFormToIso('2026-10-16', '09:40');
    expect(() => new Date(iso)).not.toThrow();
    expect(iso).toMatch(/Z$/);
  });
  it('rejects bad dates', () => {
    expect(() => localFormToIso('nope', '09:40')).toThrow();
  });
});

describe('localDayKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
});
