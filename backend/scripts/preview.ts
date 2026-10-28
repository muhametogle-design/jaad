/**
 * scripts/preview.ts — run the FULL API against an in-memory PostgreSQL
 * (no external database) and seed it with demo data through the real HTTP
 * routes, so every endpoint has live data the moment the preview opens.
 *
 * Usage (env must be set in the shell — ESM imports hoist):
 *   TELECOM_WEBHOOK_SECRET=preview-webhook-secret \
 *   DEVICE_API_KEYS=preview-key:POS-TEST-01 \
 *   SMS_PROVIDER=disabled PORT=8080 RUN_MIGRATIONS=false \
 *   npx tsx scripts/preview.ts
 */
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { setPoolForTest } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { hmacSha256Hex } from '../src/utils/hmac.js';
import { setSmsSenderForTest } from '../src/services/smsService.js';

// ── In-memory PostgreSQL + real migration ─────────────────────────────────
const db = newDb({ autoCreateForeignKeyTables: false, noAstCoverageCheck: true });
const adapter = db.adapters.createPg();
setPoolForTest(new adapter.Pool() as unknown as Pool);
await runMigrations();
logger.info('in-memory PostgreSQL ready (preview mode — data resets on restart)');

// SMS in preview mode: log only.
setSmsSenderForTest(async (to, message) => {
  logger.info({ to, message }, 'preview SMS');
  return { ok: true, messageId: 'SMS-PREVIEW' };
});

const app = createApp();
const server = app.listen(config.port, '0.0.0.0');

// ── Seed demo data through the REAL API (device auth + webhook HMAC) ──────
const BASE = `http://127.0.0.1:${config.port}`;
const dev = { 'Content-Type': 'application/json', 'x-device-key': 'preview-key', 'x-device-id': 'POS-TEST-01' };
const { sampleSyncPayload } = await import('../tests/helpers.js');

try {
  // 1) Offline batch: 1 flight, 2 buyers, 3 sales, 1 repayment, 1 wastage.
  const sync = await fetch(`${BASE}/api/sync/outbox`, { method: 'POST', headers: dev, body: JSON.stringify(sampleSyncPayload()) });
  logger.info({ status: sync.status }, 'preview seed: sync outbox');

  // 2) STK push for the first order, then confirm it via a signed webhook.
  const stk = await fetch(`${BASE}/api/payments/stk-push`, {
    method: 'POST',
    headers: dev,
    body: JSON.stringify({ payerPhone: '252634123456', amount: 275_000, orderId: 'SO-20261016-001', provider: 'EVC_PLUS' }),
  }).then((r) => r.json());

  const webhookPayload = {
    referenceId: 'PREVIEW-REF-1',
    invoiceId: stk.invoiceId,
    amount: 275_000,
    status: 'SUCCESS',
    accountNumber: '252634123456',
  };
  const raw = JSON.stringify(webhookPayload);
  const wh = await fetch(`${BASE}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-waafi-signature': hmacSha256Hex(config.telecomWebhookSecret, raw) },
    body: raw,
  });
  logger.info({ status: wh.status }, 'preview seed: webhook confirmation');
} catch (err) {
  logger.warn({ err }, 'preview seeding failed (API still running)');
}

logger.info(
  {
    port: config.port,
    try: [
      'GET  /',
      'GET  /health',
      'GET  /api/reporting/pnl?from=2026-10-16&to=2026-10-16  (add headers x-device-key: preview-key, x-device-id: POS-TEST-01)',
      'GET  /api/reporting/orders/SO-20261016-002  (same headers)',
    ],
  },
  'jaad-backend preview ready',
);

const shutdown = (signal: string) => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
