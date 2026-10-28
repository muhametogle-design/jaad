/**
 * Throwaway end-to-end smoke: boots the real app (createApp) on a real HTTP
 * port backed by pg-mem, then exercises the full flow over fetch().
 * Run (env must be set in the shell — ESM imports hoist above assignments):
 *   TELECOM_WEBHOOK_SECRET=smoke-secret DEVICE_API_KEYS=smoke-key:POS-TEST-01 \
 *   SMS_PROVIDER=disabled PORT=8931 RUN_MIGRATIONS=false npx tsx scripts/smoke.ts
 */
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { setPoolForTest } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { hmacSha256Hex } from '../src/utils/hmac.js';
import { setSmsSenderForTest } from '../src/services/smsService.js';

const db = newDb({ autoCreateForeignKeyTables: false, noAstCoverageCheck: true });
const adapter = db.adapters.createPg();
const pool = new adapter.Pool() as unknown as Pool;
setPoolForTest(pool as Pool);

let smsLog: string[] = [];
setSmsSenderForTest(async (to, message) => {
  smsLog.push(`${to}: ${message}`);
  return { ok: true, messageId: 'SMS-SMOKE-1' };
});

await runMigrations();
const app = createApp();
const server = app.listen(8931, '0.0.0.0');

const BASE = 'http://127.0.0.1:8931';
const dev = { 'x-device-key': 'smoke-key', 'x-device-id': 'POS-TEST-01' };
let failed = 0;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
  if (!cond) failed++;
};

// 1) health
{
  const r = await fetch(`${BASE}/health`);
  check('GET /health → 200 ok', r.status === 200 && (await r.json()).status === 'OK');
}

// 2) sync a batch (canonical payload shape from the test suite)
const { sampleSyncPayload } = await import('../tests/helpers.js');
const syncPayload = sampleSyncPayload();
const SYNC_DATE = '2026-10-16'; // sampleSyncPayload's fixed sales date
{
  const r = await fetch(`${BASE}/api/sync/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...dev },
    body: JSON.stringify(syncPayload),
  });
  const b = await r.json();
  check(
    'POST /api/sync/outbox → 200, 3 sales synced',
    r.status === 200 && b.synced.sales?.length === 3 && b.synced.batches?.length === 1,
    JSON.stringify(b),
  );
}

// 3) STK push
let invoiceId = '';
{
  const r = await fetch(`${BASE}/api/payments/stk-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...dev },
    body: JSON.stringify({ payerPhone: '061 000 0002', amount: 275_000, orderId: 'SO-20261016-001', provider: 'EVC_PLUS' }),
  });
  const b = await r.json();
  invoiceId = b.invoiceId;
  check(
    'POST /api/payments/stk-push → 202 PENDING',
    r.status === 202 && b.paymentStatus === 'PENDING' && /^EVC-SIM-/.test(invoiceId),
    JSON.stringify(b),
  );
}

// 4) webhook (signed)
{
  const payload = {
    referenceId: 'SMOKE-REF-1',
    invoiceId,
    amount: 150_000,
    status: 'SUCCESS',
    accountNumber: '252610000002',
  };
  const raw = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-waafi-signature': hmacSha256Hex('smoke-secret', raw) },
    body: raw,
  });
  const b = await r.json();
  check(
    'POST /api/payments/webhook → 200 exact body',
    r.status === 200 && b.status === 'OK' && b.message === 'Webhook processed successfully',
    JSON.stringify(b),
  );

  // wait for fire-and-forget SMS + flag
  for (let i = 0; i < 50 && smsLog.length === 0; i++) await new Promise((res) => setTimeout(res, 20));
  check(
    'SMS receipt delivered (spec template)',
    smsLog.length === 1 && smsLog[0].includes('SO-20261016-001') && smsLog[0].includes('Remaining Debt: 0 So'),
    JSON.stringify(smsLog),
  );

  // duplicate webhook → dedup, no 2nd SMS
  const r2 = await fetch(`${BASE}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-waafi-signature': hmacSha256Hex('smoke-secret', raw) },
    body: raw,
  });
  await new Promise((res) => setTimeout(res, 100));
  check(
    'duplicate webhook → 200, no 2nd SMS',
    r2.status === 200 && smsLog.length === 1,
  );
}

// 5) bad signature → 401
{
  const raw = JSON.stringify({ referenceId: 'X', invoiceId: 'Y', amount: 1, status: 'SUCCESS' });
  const r = await fetch(`${BASE}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-waafi-signature': 'bad' },
    body: raw,
  });
  check('bad signature → 401', r.status === 401, `got ${r.status}`);
}

// 6) P&L
{
  const r = await fetch(`${BASE}/api/reporting/pnl?from=${SYNC_DATE}&to=${SYNC_DATE}`, { headers: dev });
  const b = await r.json();
  check(
    'GET /api/reporting/pnl → revenue 771000, cogs 492535.83',
    r.status === 200 && b.pnl?.revenue === 771_000 && Math.abs(b.pnl.cogs - 492_535.83) < 0.01,
    JSON.stringify(b.pnl),
  );
  check('P&L credit_created 200000, debt_repaid 100000', b.pnl?.credit_created === 200_000 && b.pnl.debt_repaid === 100_000, JSON.stringify(b));
}

// 7) order audit
{
  const r = await fetch(`${BASE}/api/reporting/orders/SO-20261016-002`, { headers: dev });
  const b = await r.json();
  check(
    'GET order audit → FIFO allocation present',
    r.status === 200 && b.order?.status === 'PENDING' && b.fifo_allocations?.length === 1,
    JSON.stringify({ status: b.order?.status, fa: b.fifo_allocations }),
  );
}

server.close();
console.log(failed === 0 ? '\nSMOKE: ALL OK' : `\nSMOKE: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
