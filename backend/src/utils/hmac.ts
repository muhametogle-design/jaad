import crypto from 'node:crypto';

/**
 * HMAC-SHA256 utilities for webhook verification.
 *
 * The telecom gateway (WaafiPay/Telesom, Hormuud EVC Plus) signs the RAW
 * request body with the shared secret and sends the hex digest in
 * `x-waafi-signature` (or `x-signature`). Verification uses
 * crypto.timingSafeEqual so response time never leaks signature info.
 */
export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmac(
  secret: string,
  rawBody: string | Buffer,
  providedSignature: string | undefined,
): boolean {
  if (!secret) return false; // fail closed when the secret is not configured
  if (!providedSignature) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  const provided = providedSignature.trim().toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Extract the signature from either accepted header name. */
export function webhookSignature(req: { headers: Record<string, unknown> }): string | undefined {
  const waafi = req.headers['x-waafi-signature'];
  const generic = req.headers['x-signature'];
  const pick = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return pick(waafi) ?? pick(generic);
}
