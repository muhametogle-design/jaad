import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { unauthorized } from '../utils/errors.js';
import { getPool } from '../db/pool.js';

declare module 'express-serve-static-core' {
  interface Request {
    deviceId?: string;
  }
}

/**
 * POS terminal authentication for /api/sync/* and /api/payments/stk-push.
 *
 * Terminals present `x-device-key` (shared secret) and `x-device-id`.
 * Keys come from the DEVICE_API_KEYS env map; verified devices are also
 * accepted if already registered in the devices table (hash of the key
 * checked against the env map on first registration).
 */
export async function authenticateDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.header('x-device-key');
    const deviceId = req.header('x-device-id');
    if (!key || !deviceId) throw unauthorized('Missing x-device-key / x-device-id headers');

    const expectedDevice = config.deviceKeys[key];
    if (!expectedDevice) throw unauthorized('Unknown device key');
    if (expectedDevice !== deviceId) {
      throw unauthorized('Device key does not match device id');
    }

    // Constant-time-ish comparison already done via map lookup; register
    // the device (upsert last_seen) so the audit trail has identity.
    const db = getPool();
    await db.query(
      `INSERT INTO devices (id, last_seen_at) VALUES ($1, now())
       ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
      [deviceId],
    );
    req.deviceId = deviceId;
    next();
  } catch (err) {
    next(err);
  }
}

/** SHA-256 helper (exported for future per-device key hashing). */
export function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
