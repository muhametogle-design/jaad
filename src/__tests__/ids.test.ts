import { batchCode, orderCode, uuid } from '../lib/ids';

describe('batch codes', () => {
  it('produces BATCH-YYYYMMDD-XX format', () => {
    expect(batchCode('2026-10-16', 1)).toBe('BATCH-20261016-01');
    expect(batchCode('2026-10-16', 12)).toBe('BATCH-20261016-12');
  });
});

describe('order codes', () => {
  it('produces SO-YYYYMMDD-XXX format', () => {
    expect(orderCode('2026-10-16', 4)).toBe('SO-20261016-004');
    expect(orderCode('2026-10-16', 123)).toBe('SO-20261016-123');
  });
});

describe('uuid', () => {
  it('is unique and v4-shaped', () => {
    const a = uuid();
    const b = uuid();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
