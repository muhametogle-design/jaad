# Jaad Khat OS — Cloud Backend

Production Node.js 20 + Express + TypeScript API and PostgreSQL sync database for the
offline-first Jaad POS mobile app (`/` repo root). The app works 100 % offline; this
service is where cloud-synced truth lives: **batches, FIFO inventory, buyer debt,
payments (EVC Plus / Zaad STK), and financial reporting.**

```
mobile POS (SQLite + outbox) ──POST /api/sync/outbox──▶  ┌────────────────────┐
                                                          │  Express API      │
telecom gateway  ──POST /api/payments/webhook (HMAC)──▶   │  (Node 20, ESM)   │
POS ──POST /api/payments/stk-push──▶                      │        │          │
                                                          │        ▼          │
   Africa's Talking / Telesom / Hormuud ◀──SMS receipts── │  PostgreSQL 16   │
                                                          └────────────────────┘
```

## Modules

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `POST /api/payments/webhook` | Verify `HMAC-SHA256(raw body)` in `x-waafi-signature`/`x-signature` against `TELECOM_WEBHOOK_SECRET` (401 on mismatch). Idempotent on `invoiceId`. On success → order `PAID` + `gateway_ref`, fire-and-forget SMS receipt. Returns exactly `{"status":"OK","message":"Webhook processed successfully"}`. |
| 2 | `POST /api/payments/stk-push` | Device-authenticated. Validates `{payerPhone, amount, orderId, provider: EVC_PLUS\|ZAAD}`, normalizes `0…` → `252…`, signs & dispatches the gateway STK request, records a `PENDING` attempt, returns `202` + `invoiceId`. `GET /api/payments/status/:orderId` for poll fallback. |
| 3 | (auto) SMS receipts | Triggered by Module 1. Template: `[KhatHub] Order #{orderId} Paid! Qty: {kg} KG ({type}). Total: {money} via {provider}. Ref: {refId}. Remaining Debt: {money}.` Provider pluggable: `africastalking` \| `telesom` \| `hormuud` \| `disabled`. |
| 4 | `POST /api/sync/outbox` | Device-authenticated JSON batch (batches, customers, sales, payments, wastage). **Single SQL transaction**: upserts, duplicate order-ID detection (synced vs skipped IDs in the response so the device clears `sync_queue`), recomputes global FIFO inventory (`received − allocated − wastage`) and buyer debt (`credit − repaid`). |
| 5 | `GET /api/reporting/pnl` · `GET /api/reporting/orders/:code` | Real-time P&L aggregation (revenue, COGS, wastage loss, net profit, collections by method, credit created/repaid, stock kg/value, per-day) and per-order audit (FIFO slices + STK attempts). |

All `/api/*` routes except the webhook require `x-device-key` + `x-device-id` matching
`DEVICE_API_KEYS`.

## Quickstart

```bash
cp .env.example .env          # set secrets
npm install
docker compose up -d db       # Postgres 16 (or point DATABASE_URL at managed PG)
npm run migrate               # apply migrations (also auto-runs on boot unless RUN_MIGRATIONS=false)
npm run dev                   # http://localhost:8080/health
```

Useful scripts:

```bash
npm run typecheck   # strict tsc
npm test            # 42 tests (vitest + supertest + in-memory pg)
npm run smoke       # end-to-end over real HTTP: sync → STK → webhook → SMS → P&L
npm run build && npm start   # production start (node dist/server.js)
```

## Data model (PostgreSQL, `src/db/migrations/001_init.sql`)

| Table | Role |
|---|---|
| `devices` | POS terminals (auth-registered, `last_seen_at`) |
| `khat_types`, `batches` | Air-cargo intake (flight, arrival, per-type cost) |
| `batch_inventory` | Per batch × khat type: `received_kg` / `remaining_kg` (recomputed on sync) |
| `sales`, `sales_alloc` | Orders + FIFO allocation audit (batch, kg, COGS/kg) |
| `customers`, `credit_ledger` | Buyer credit + append-only ledger; `outstanding` recomputed = Σcredit − Σrepaid |
| `payments` | Debt repayments (idempotent on device `local_id`) |
| `wastage` | Spoilage losses feeding P&L |
| `payments_stk` | STK push attempts (invoice, status, gateway ref) |
| `webhook_events` | One row per `invoiceId` → idempotency gate for Module 1 |

Idempotency keys: `sales (device_id, order_code)`, `payments (device_id, local_id)`,
`wastage (device_id, local_id)`, `credit_ledger (device_id, order_code, direction)`,
`webhook_events (invoice_id)`, `payments_stk (invoice_id)`.

## Production notes

- **Webhooks are verified against the raw body** — the JSON parser captures the raw
  buffer before parsing; never re-serialize.
- **Simulated gateways**: when a provider's credentials are empty, STK dispatch runs in
  simulation mode (`EVC-SIM-*` / `ZAAD-SIM-*` invoice IDs, loud warn logs) so staging
  works without live merchant accounts.
- **Replicas**: set `RUN_MIGRATIONS=false` on all but one instance (or run
  `npm run migrate` in CI).
- **Money/units** are `NUMERIC(14,2)`/`NUMERIC(12,2)`; rounding to 2 dp is centralized.
- Docker image: multi-stage `node:20-alpine`, non-root, `docker compose` wires
  `api → db (healthy)`.

## Tests

`npm test` runs 42 tests against a real in-memory PostgreSQL (pg-mem, applying the real
`001_init.sql` migration) through the same pg-protocol adapter the app uses:

- `tests/hmac` — signature verify (timing-safe, fail-closed, header aliases)
- `tests/migrate` — runner applies/records versions, idempotent
- `tests/webhook` — 401s, PAID + `gateway_ref`, SMS template, duplicate dedupe (no double SMS), FAILED callbacks
- `tests/stk` — auth/validation, EVC+/Zaad dispatch, phone normalization, status lifecycle
- `tests/sync` — atomic batch apply, inventory & debt recompute, idempotent resubmit, multi-device merge
- `tests/pnl` — revenue/COGS/net, collections, credit/repaid, stock value, per-day, order audit, validation
- `src/tests/backend.test.js` — self-contained JS suite covering the four headline
  guarantees in one file: HMAC 401s, webhook dedupe (no double SMS), atomic outbox
  sync with ON CONFLICT handling + all-or-nothing invalid batches, and P&L accuracy
  (total revenue / total COGS / net profit / stock / credit)
