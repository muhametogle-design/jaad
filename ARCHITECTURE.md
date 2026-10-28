# Jaad Khat OS — Architecture Overview

An offline-first mobile operating system for an end-to-end khat distribution
business: air-cargo intake → FIFO inventory → touch POS with automated
deduction → real-time profit & COGS → Mobile Money checkout → SMS receipts →
buyer debt ledger. Built for phones **and** Android tablets, designed for
busy airstrips where cellular signal drops constantly.

---

## 1. Stack & Rationale

| Concern            | Choice                          | Why |
|--------------------|---------------------------------|-----|
| Runtime            | React Native via **Expo SDK 53** (new architecture) | Managed workflow, ships on Expo Go instantly; prebuild for store builds |
| UI                 | **NativeWind v4** (Tailwind)    | One design language across screens, fast iteration, tablet-responsive grids via Tailwind |
| Database           | **expo-sqlite** (on-device)     | Zero-latency reads/writes with no network; transactions guarantee inventory↔sales consistency |
| Navigation         | **expo-router** (file-based)    | Tab shell + modal flows (intake, buyer detail) with zero config |
| Money math         | Pure TypeScript module          | FIFO allocation & COGS are unit-tested pure functions — no native dependency |
| Crypto             | **crypto-js** (pure JS)         | SHA-256 signatures for the EVC+/Zaad merchant APIs without a native module |
| Connectivity       | **expo-network**                | Drives the offline outbox drain when signal returns |
| Haptics            | **expo-haptics**                | Physical confirmation on confirm-tap, key taps — essential for glove use |
| Tests              | Jest (jest-expo)                | Core business math is covered by unit tests that run in CI without a device |

**Design doctrine:** the device is the system of record. Every table lives in
local SQLite. The network is only needed for Mobile Money STK pushes and
gateway SMS — and even those degrade gracefully into a local retry queue.

---

## 2. Repository Map

```
jaad/
├── app/                        # expo-router screens
│   ├── _layout.tsx             # Root stack, splash gate, AppProvider
│   ├── (tabs)/
│   │   ├── index.tsx           # Module 3 — Daily P&L dashboard
│   │   ├── pos.tsx             # Module 2 — Touch POS
│   │   ├── stock.tsx           # Module 1 — Batch log (FAB: add type)
│   │   ├── buyers.tsx          # Module 4 — Buyer directory & debt
│   │   └── more.tsx            # Settings: types, freshness, MM, SMS, data
│   ├── intake.tsx              # Module 1 — Flight intake form (modal)
│   └── buyer/[id].tsx          # Module 4 — Buyer detail: ledger + payments
├── src/
│   ├── config.ts               # Compile-time defaults (seeded settings)
│   ├── types.ts                # Domain row/view models
│   ├── db/
│   │   ├── schema.ts           # DDL + migration version
│   │   ├── database.ts         # open / migrate / reset
│   │   ├── settingsRepo.ts     # Key-value runtime settings
│   │   ├── seed.ts             # Default types (Miro, Jebis) + demo data
│   │   └── repositories/
│   │       ├── khatTypeRepo.ts # Dynamic type catalog (no grades)
│   │       ├── batchRepo.ts    # Intake, batch bundles, FIFO ledger, stock
│   │       ├── customerRepo.ts # Directory search, credit fields
│   │       ├── saleRepo.ts     # ★ Sale transaction: FIFO deduction + COGS
│   │       ├── paymentRepo.ts  # Debt repayments
│   │       ├── wastageRepo.ts  # Spoilage → P&L loss
│   │       ├── reportingRepo.ts# ★ Daily P&L aggregates
│   │       └── syncQueueRepo.ts# Offline outbox
│   ├── lib/
│   │   ├── cogs.ts             # ★ allocateFifo / previewAllocation / effectiveCogsForBatch
│   │   ├── money.ts            # SOS formatting, input parsing
│   │   ├── time.ts             # Local day keys, freshness math
│   │   └── ids.ts              # BATCH-YYYYMMDD-XX / SO-YYYYMMDD-XXX / uuid
│   ├── integrations/
│   │   ├── providers/
│   │   │   ├── evcPlus.ts      # EVC Plus merchant STK client (signed)
│   │   │   └── zaad.ts         # Zaad merchant STK client (signed)
│   │   ├── mobileMoney.ts      # chargeSale / chargeStandalone / processQueue
│   │   └── sms.ts              # Receipt builder, gateway or sms: fallback
│   ├── state/
│   │   ├── AppProvider.tsx     # DB bootstrap, 30s freshness clock, NetInfo
│   │   └── useAsync.ts         # Query hook bound to the mutation refresh bus
│   └── components/
│       ├── ui/                 # Button, Card, Field, Sheet, Segmented, …
│       ├── pos/                # CustomerSearch, TypeCard, KgControls,
│       │                       # KeypadOverlay, ProfitPreview, PaymentPanel,
│       │                       # ReceiptSheet
│       ├── stock/              # BatchCard, AgingBadge, BatchDetailSheet,
│       │                       # WastageSheet
│       ├── buyers/             # BuyerRow, AddBuyerSheet, RecordPaymentSheet,
│       │                       # LedgerList
│       └── AddTypeSheet.tsx    # Dynamic “+ Add New Type” (FAB target)
├── src/__tests__/              # cogs / money / time / ids unit tests
└── backend/                    # ★ Cloud API + PostgreSQL sync DB (see §12)
    ├── index.js                # JS entry point (boots server.ts)
    ├── src/
    │   ├── routes/             # payments (webhook, stk-push), sync (outbox),
    │   │                       # reporting (pnl, order audit)
    │   ├── services/           # webhook, stk, sms, sync, pnl logic
    │   ├── gateways/           # evcPlus / zaad signed STK clients, sms bulk
    │   ├── db/                 # pool.ts + index.js, migrate.ts,
    │   │                       # 001_init.sql migration
    │   ├── middleware/         # device-key auth, zod/error handling
    │   ├── tests/backend.test.js # self-contained pg-mem suite (15 tests)
    │   └── utils/              # hmac (timing-safe), money, http errors
    ├── tests/                  # 27 tests on in-memory pg (real DDL + SQL)
    └── scripts/smoke.ts        # end-to-end over real HTTP (npm run smoke)
```

---

## 3. Data Model

```
khat_types 1 ──── * batch_inventory * ──── 1 batches
     │                    │  ▲
     │                    │  │ (sales_batch_alloc audit)
     │                    ▼  │
     └────────────  sales  ─┘   customers 1 ── * payments
                           │             1 ── * credit_ledger
                           │
                     batch_inventory 1 ── * wastage

settings (key/value) · sync_queue (offline outbox) · meta (schema version)
```

Key invariants (enforced inside SQLite transactions):

1. **`batch_inventory.remaining_kg`** is the only live inventory figure.
   Sales and wastage decrement it; nothing else touches it.
2. **`sales` rows are immutable snapshots** — `sell_price_per_kg`,
   `cogs_per_kg`, `revenue`, `item_cogs`, `gross_profit` are frozen at
   sale time, so later price changes never rewrite history.
3. **`sales_batch_alloc`** records the exact FIFO slices consumed, giving
   a full audit trail from any sale back to the flight batch.
4. **`credit_ledger.balance_after`** keeps the debt ledger
   self-auditing: the last row's balance equals `customers.outstanding`.
5. **`sync_queue`** is the outbox for anything that needs the network
   (MM charges, SMS receipts).

---

## 4. Module 1 — Air Cargo Intake

`app/intake.tsx` + `batchRepo.createBatch`:

- Flight number, airline, supplier, arrival date/time, gross weight, and
  inbound import costs (freight / handling / transport / other).
- Batch IDs are auto-generated: **`BATCH-YYYYMMDD-XX`** (sequence derived
  inside the transaction, so same-day landings never collide).
- Each variety line gets an **effective COGS per KG**:

```
effective COGS = base purchase price/KG
               + (freight + handling + transport + other) / gross batch weight
```

- The batch and all its `batch_inventory` lines are inserted in one
  transaction. `arrived_at` is inherited from the flight landing time —
  this starts the freshness timer and defines FIFO order.

---

## 5. Module 2 — POS & Automated Inventory Deduction

`app/(tabs)/pos.tsx` — a single screen, zero navigation during a sale:

1. **Customer search** (name or phone, inline results, recent buyers).
2. **Type cards** — one per khat variety showing sell price/KG, remaining
   KG across all batches, and a live **freshness badge** (FRESH / AGING /
   STALE with age). A **"+ Add New Type"** card + **FAB** open
   `AddTypeSheet` so a manager can add a new variety (name, landing COGS
   /KG, selling /KG) mid-shift. **No quality grades exist anywhere** —
   price and stock are strictly per type.
3. **Quantity** — big display with quick-increment taps
   **`+0.5 / +1 / +2 / +5 / +10`** plus a full-screen **numeric keypad**
   overlay for exact weights (capped at available stock).
4. **Live profit preview** — revenue, FIFO-weighted COGS, gross profit and
   margin update on every tap.
5. **Payment panel** — Cash / EVC+ / Zaad / Credit segmented selector,
   amount-paid field (defaults to full total), live credit-portion
   preview and **credit-limit guard** (a sale that would push the buyer
   over their limit is blocked with a reason).
6. **Confirm & charge** runs `saleRepo.createSale` — one SQLite
   transaction that:
   - reads the type's stock ledger (oldest first),
   - calls the pure `allocateFifo` (throws `InsufficientStockError` on
     shortfalls — overselling is impossible),
   - snapshots prices/COGS/profit,
   - **deducts the exact slices from `batch_inventory`** (automated
     inventory deduction),
   - writes the sale + allocation audit rows,
   - if partially unpaid, adds the balance to the buyer's debt ledger and
     outstanding balance.

Tablet: the type grid goes 3-up, and all targets stay ≥ 52 dp.

---

## 6. Module 3 — Automated Profit & COGS Calculator

The math lives in `src/lib/cogs.ts` (pure, unit-tested):

```
Item Revenue  = KG sold × selling price/KG (snapshot)
Item COGS     = Σ (slice kg × slice COGS/KG)      ← weighted FIFO
Gross Profit  = Item Revenue − Item COGS
```

`reportingRepo.todayPnl` aggregates per local day:

```
Net profit  = Σ revenue − Σ item_cogs − Σ wastage loss
Wastage     = spoiled KG × that batch line's COGS   (WastageSheet entry)
Collections = cash / EVC+ / Zaad / new-credit split
Stock       = Σ remaining KG and Σ remaining × COGS (stock value)
Aging       = fresh / aging / stale KG buckets (30 s ticking clock)
```

The dashboard renders all of it live; any mutation anywhere in the app
bumps the refresh bus and every dashboard query re-runs.

---

## 7. Module 4 — Mobile Money, SMS, Credit, Offline Storage

### 7.1 Mobile Money (EVC Plus + Zaad)

`integrations/providers/*` implement a common
`MobileMoneyProvider` interface:

- **Live mode** — signed HTTPS merchant-API call
  (SHA-256 signature over secret + request body for EVC;
  secret + amount + reference for Zaad), returns an STK `sessionId`,
  and the app hands the provider deep link
  (`evcstk://<sessionId>`, `zaad://?session=…`) to the OS so the buyer's
  wallet opens the prompt. Final confirmation arrives via the merchant
  webhook in a hosted deployment; until then the sale is
  `mm_pending` and queued for retry.
- **Simulated mode** (default) — resolves locally after ~1 s with a
  sandbox reference so the entire checkout, receipt and ledger flow can
  be exercised with **no credentials and no connectivity**.

Switching per provider is one segment control in Settings; credentials
live in the local `settings` table (never in code).

### 7.2 Automated SMS Receipts

`integrations/sms.ts` always assembles a payload containing the five
required fields — **Order ID, KGs sold, Khat Type, Total Paid, remaining
credit balance** — then delivers via:

1. configured HTTP SMS gateway (Twilio-style), or
2. the device SMS app via `sms:+252…?body=…` (works offline at the
   airstrip), and
3. any failure is parked in `sync_queue` for automatic retry.

### 7.3 Buyer Credit & Debt Ledger

- Credit limit per buyer (0 = unlimited), outstanding balance, and a
  running **credit ledger** (credit sales `+`, repayments `−`,
  `balance_after` on every row).
- Repayments are captured on the buyer detail screen; cash posts
  instantly, EVC+/Zaad post **only after STK confirmation**.
- POS blocks sales that would breach the limit; the buyer list flags
  accounts ≥ 85% of limit.

### 7.4 Offline-First Storage & Sync

- **All** business data (types, batches, inventory, sales, allocations,
  payments, ledger, wastage, settings) is in on-device SQLite.
- `expo-network` watches connectivity; on recovery — and on app start —
  `processQueue()` drains the outbox (MM charges, SMS receipts) with
  attempt caps, and the dashboard header shows `Online/Offline · N queued`.

---

## 8. State & Refresh Model

No heavy state library. `AppProvider` owns:

- DB bootstrap (migrations + default types) before the splash lifts,
- a **refresh bus** (`version` counter) — every mutation calls `bump()`,
  and every `useAsync` query re-runs on change (single source of truth
  between screens without prop drilling),
- a **30-second clock** driving the freshness/aging badges,
- the NetInfo watcher + queue runner.

---

## 9. Testing Strategy (three headless layers)

1. **Unit** (`cogs`, `money`, `time`, `ids`): FIFO ordering across
   batches, weighted COGS, float-dust handling, insufficient-stock
   errors, batch/order code formats, aging buckets, SOS formatting.
2. **Database integration** (`db.integration.test.ts`): the *real* DDL
   and *real* repository SQL run against an in-memory SQLite (a
   `node:sqlite` shim stands in for `expo-sqlite`). Covers intake →
   effective COGS → FIFO sale & automated deduction → MM resolution →
   credit + repayment → wastage → daily P&L, plus same-day batch
   sequencing and cross-batch FIFO spans.
3. **UI smoke** (`ui.smoke.test.tsx`): renders the key touch widgets
   (type cards, keypad, payment panel, receipt, batch cards, ledger,
   sheets) inside the real `AppProvider` with `react-test-renderer`.

```bash
npm test            # unit layer (always green, no flags)
npm run test:all    # all three layers (needs node --experimental-sqlite)
npm run typecheck   # tsc --noEmit
```

The demo dataset (Settings → Data → **Load demo data**) is a
reproducible on-device end-to-end fixture: two flights, four buyers,
four sales, one repayment, one wastage event — handy for manual QA.
The whole app is also verified to bundle: `npx expo export --platform android`.

## 10. Production Hardening Roadmap

- ~~Webhook receiver to resolve live STK payments~~ — **done**: `backend/`
  Module 1 (`POST /api/payments/webhook`, HMAC-verified, idempotent, marks
  orders `PAID` with the provider reference) + Module 2 STK dispatch.
- ~~Multi-device sync via a small relay~~ — **done server-side**:
  `backend/` Module 4 (`POST /api/sync/outbox`) is the merge point for any
  number of devices; the app's outbox now needs a thin HTTP client +
  inbound pull to complete the loop.
- Wire the app's outbox to `backend` (device keys, HTTP transport,
  inbound pulls) — the API contract is frozen and spec'd in
  `backend/README.md`.
- Encrypted local backup / restore (SQLite export).
- Biometric/PIN lock + optional per-operator logins (who sold what).
- PDF/WhatsApp share of the day's P&L (backend already exposes
  `GET /api/reporting/pnl` for it).
- Role-based UI (warehouse manager vs. seller) and per-shift reports.
- i18n (Somali/English) and light theme option.

## 11. Security Notes

- Provider secrets are stored in the on-device `settings` table; the
  device should be PIN-protected. For a hardened build, move secrets to
  the Android Keystore/Keychain via a config plugin.
- The app requests **no** SMS permission — receipts use the `sms:` intent
  (user-visible, per-message) or a server-side gateway, so the user always
  controls outbound messages.
- **Webhook authenticity** (backend): the telecom callback is rejected
  (401) unless `HMAC-SHA256(raw body)` matches `TELECOM_WEBHOOK_SECRET`
  (timing-safe compare, `x-waafi-signature`/`x-signature`). Sync/STK
  routes require `x-device-key` + `x-device-id` pairs from `DEVICE_API_KEYS`.
  Full details in [backend/README.md](./backend/README.md).

## 12. Cloud Backend & Sync (backend/)

The app is 100 % offline; `backend/` is the hosted merge point for cloud
truth — batches, FIFO inventory, buyer debt, STK payments and financial
reporting. Node 20 + Express + TypeScript (ESM), PostgreSQL 16, `pg`
pool, pino logging, zod validation, Docker + compose.

**Modules → endpoints**

1. `POST /api/payments/webhook` — HMAC-verified telecom callback.
   Idempotent on `invoiceId` (`webhook_events` gate). On success marks the
   order `PAID` + `gateway_ref`, fires the SMS receipt (fire-and-forget),
   and returns exactly
   `{"status":"OK","message":"Webhook processed successfully"}`.
2. `POST /api/payments/stk-push` (+ `GET /api/payments/status/:orderId`) —
   device-authenticated. Signs & dispatches the EVC Plus / Zaad STK,
   records a `PENDING` attempt, returns `202` + `invoiceId`. Empty
   credentials ⇒ simulated dispatch (`EVC-SIM-*` / `ZAAD-SIM-*`).
3. SMS receipts (auto, Module 1) — Africa's Talking / Telesom / Hormuud
   bulk, template
   `[KhatHub] Order #… Paid! Qty: … KG (…). Total: … via …. Ref: ….
   Remaining Debt: …`
4. `POST /api/sync/outbox` — device-authenticated batch
   (batches, customers, sales, payments, wastage) applied in a **single
   SQL transaction**: upserts, duplicate order-ID detection (response
   carries `synced` vs `skipped` IDs so the device clears `sync_queue`),
   then authoritative recompute of global FIFO inventory
   (`received − allocated − wastage`) and buyer debt
   (`credit − repaid`, floored at 0).
5. Reporting — `GET /api/reporting/pnl?from&to&deviceId` (revenue, COGS,
   wastage loss, net profit, collections by method, credit created/repaid,
   stock kg/value, per-day) and `GET /api/reporting/orders/:code`
   (order + FIFO slices + STK attempts).

**Schema** (13 tables, `backend/src/db/001_init.sql`) mirrors
the mobile data model (`devices`, `khat_types`, `batches`,
`batch_inventory`, `customers`, `sales`, `sales_alloc`, `payments`,
`wastage`, `credit_ledger`, `payments_stk`, `webhook_events` +
`schema_migrations`) with idempotency keys on every device-scoped table.

**Verification**: `backend` runs 42 tests on an in-memory PostgreSQL
applying the *real* migration (incl. the self-contained
`backend/src/tests/backend.test.js` suite: HMAC 401s, webhook dedupe,
atomic ON CONFLICT outbox sync, P&L accuracy), plus a real-HTTP
end-to-end smoke (`npm run smoke`): sync → STK push → signed webhook →
SMS → P&L.
`tsc --noEmit` strict; Dockerfile is multi-stage `node:20-alpine`
(non-root) and `docker-compose.yml` wires `api → db (healthy)`.

**Status**: server-side contract is frozen and spec'd in
`backend/README.md`. The remaining app-side work is a thin HTTP client
that posts the local outbox to `/api/sync/outbox` and pulls inbound
state (see §10).
