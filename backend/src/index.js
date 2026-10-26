/**
 * src/index.js — Express server & webhook listener (JS entry point).
 *
 * Boots the same production server defined in server.ts / app.ts:
 *
 *   POST /api/payments/webhook   — HMAC-SHA256 verified (x-waafi-signature /
 *                                  x-signature), idempotent per invoiceId,
 *                                  SMS receipt dispatch on confirmation
 *   POST /api/sync/outbox        — atomic SQLite→PostgreSQL outbox sync
 *                                  (ON CONFLICT idempotency, single
 *                                  transaction, rollback on any failure)
 *   POST /api/payments/stk-push  — EVC Plus / Zaad STK dispatch
 *   GET  /api/reporting/pnl      — real-time P&L aggregation
 *   GET  /health, /health/ready  — liveness / DB readiness
 *
 * Dev:      npx tsx src/index.js
 * Production: npm run build && npm start   (node dist/server.js)
 *
 * server.ts self-executes main() on import: migrations (if
 * RUN_MIGRATIONS=true), then listen on process.env.PORT with graceful
 * SIGTERM/SIGINT drain.
 */
import './server.js';
