# Jaad Khat OS

Offline-first React Native (Expo) app for running an end-to-end khat
distribution business from the airstrip down to the last kilogram —
built for phones **and** Android tablets, fully functional with zero
connectivity.

**Modules**

1. **Air Cargo Intake** — land flights as `BATCH-YYYYMMDD-XX` with
   inbound freight/handling/transport costs absorbed into per-KG COGS.
2. **Touch POS** — buyer search, khat-type cards, `+0.5/+1/+2/+5/+10 KG`
   taps + full keypad, live profit preview, atomic FIFO inventory
   deduction the moment an order is confirmed.
3. **Automated Profit & COGS** — per-transaction revenue/COGS/gross
   profit snapshots and a real-time daily P&L (revenue, COGS, wastage
   loss, net profit, collections, stock value, freshness buckets).
4. **Mobile Money, SMS & Credit** — EVC Plus (Hormuud) and Zaad
   (Telesom) STK checkout, automated SMS receipts (Order ID, KGs, Type,
   Total Paid, remaining credit), buyer credit limits + debt ledger —
   all on local SQLite with an offline retry outbox.

No quality grades: pricing, inventory and sales are managed strictly by
khat variety. Default varieties are **Miro** and **Jebis**; add new ones
any time via the “+ Add New Type” FAB/card.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design.

## Cloud Backend & Sync Database (`backend/`)

A production **Node.js 20 + Express + TypeScript** service backed by
**PostgreSQL 16** — the hosted merge point for the offline app:

- **Module 1** `POST /api/payments/webhook` — HMAC-SHA256-verified telecom
  callback (401 on mismatch), idempotent on `invoiceId`, marks orders
  `PAID` + provider ref, auto-fires the SMS receipt.
- **Module 2** `POST /api/payments/stk-push` — signed EVC Plus / Zaad STK
  dispatch, `PENDING` attempt logged, `202` + invoice (simulated mode when
  no merchant credentials).
- **Module 3** — SMS receipts via Africa's Talking / Telesom / Hormuud
  (`[KhatHub] Order #… Paid! Qty: … KG (…). Total: … via …. Ref: ….
  Remaining Debt: …`).
- **Module 4** `POST /api/sync/outbox` — batch sync (sales, intake, FIFO
  deductions, credit ledger) in a single transaction; returns synced vs
  skipped IDs so the device clears its `sync_queue`; recomputes global
  inventory and buyer debt.
- **Reporting** — real-time P&L aggregation + per-order FIFO/STK audit.

```bash
cd backend
cp .env.example .env && npm install
docker compose up -d db && npm run migrate
npm run dev            # or: npm test · npm run smoke · docker compose up
```

See **[backend/README.md](./backend/README.md)** for the API contract,
data model and production notes.

---

## Getting started

```bash
npm install
npx expo start          # scan the QR with Expo Go (Android/iOS)
```

Other scripts:

```bash
npm run typecheck       # tsc --noEmit
npm test                # unit tests for the FIFO/COGS/money/time logic
```

### First run

1. Launch → app creates the local SQLite DB and seeds **Miro** and
   **Jebis**.
2. Open **More → Data & sync → Load demo data** (empty business only) to
   get two flights, four buyers, today's sales, a repayment and a
   wastage event — a full picture of every screen in one tap.
3. Or go live: **Stock → Log Flight Batch** to land your first cargo.

### Mobile Money

Both providers ship in **Simulated mode** by default so the whole
checkout flow works offline. To go live: **More → Mobile Money** →
switch a provider to *Live merchant API* and enter the merchant
credentials (stored only in the local `settings` table). Confirmations
in live mode arrive via the merchant webhook (see ARCHITECTURE §7).

### SMS receipts

Configure an HTTP gateway in **More → SMS receipts**, or leave it empty
to have receipts open the device SMS app pre-filled (works offline).

---

## Stack

Expo SDK 53 · React Native 0.79 (new architecture) · expo-router ·
NativeWind v4 (Tailwind) · expo-sqlite · expo-network · expo-haptics ·
crypto-js · Jest
