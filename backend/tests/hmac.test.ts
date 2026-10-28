import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { hmacSha256Hex, verifyHmac } from '../src/utils/hmac.js';

describe('hmac utilities', () => {
  it('matches node:crypto HMAC-SHA256 output', () => {
    const known = crypto.createHmac('sha256', 'secret').update('hello').digest('hex');
    expect(hmacSha256Hex('secret', 'hello')).toBe(known);
    // 64 lowercase hex chars
    expect(hmacSha256Hex('secret', 'hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies matching signatures (case-insensitive hex)', () => {
    const sig = hmacSha256Hex('s3cret', 'payload');
    expect(verifyHmac('s3cret', 'payload', sig)).toBe(true);
    expect(verifyHmac('s3cret', 'payload', sig.toUpperCase())).toBe(true);
    expect(verifyHmac('s3cret', 'payload', ` ${sig} `)).toBe(true);
  });

  it('rejects tampered payloads, wrong secrets, and malformed signatures', () => {
    const sig = hmacSha256Hex('s3cret', 'payload');
    expect(verifyHmac('s3cret', 'payload-tampered', sig)).toBe(false);
    expect(verifyHmac('other', 'payload', sig)).toBe(false);
    expect(verifyHmac('s3cret', 'payload', 'zzzz')).toBe(false);
    expect(verifyHmac('s3cret', 'payload', undefined)).toBe(false);
    expect(verifyHmac('', 'payload', sig)).toBe(false); // fail closed
  });
});
