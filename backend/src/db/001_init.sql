-- Jaad Khat OS — cloud PostgreSQL schema (v1)
--
-- The cloud is the financial-audit system of record. It ingests immutable
-- transaction logs from offline-first SQLite POS terminals via
-- POST /api/sync/outbox, receives payment confirmations via webhooks,
-- and aggregates P&L. Device identity is the device_id string; local
-- surrogate ids (customer local ids etc.) are kept per device for joining.

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ
);

-- Cloud registry of khat varieties (mirrored from devices; no grades).
CREATE TABLE IF NOT EXISTS khat_types (
  name              TEXT PRIMARY KEY,
  cogs_price_per_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  sell_price_per_kg NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Landed flight batches (Module 1 intake, synced from devices).
CREATE TABLE IF NOT EXISTS batches (
  id                 SERIAL PRIMARY KEY,
  batch_code         TEXT NOT NULL UNIQUE,
  flight_number      TEXT NOT NULL DEFAULT '',
  airline            TEXT NOT NULL DEFAULT '',
  supplier           TEXT NOT NULL DEFAULT '',
  arrival_at         TIMESTAMPTZ NOT NULL,
  gross_weight_kg    NUMERIC(12,2) NOT NULL,
  freight_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  handling_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,
  transport_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_inbound_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes              TEXT NOT NULL DEFAULT '',
  device_id          TEXT NOT NULL REFERENCES devices(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-variety inventory lines. remaining_kg is RECOMPUTED by the server
-- from authoritative events (received − FIFO allocations − wastage).
CREATE TABLE IF NOT EXISTS batch_inventory (
  id           SERIAL PRIMARY KEY,
  batch_code   TEXT NOT NULL REFERENCES batches(batch_code) ON DELETE CASCADE,
  khat_type    TEXT NOT NULL,
  received_kg  NUMERIC(12,2) NOT NULL,
  remaining_kg NUMERIC(12,2) NOT NULL,
  cogs_per_kg  NUMERIC(14,2) NOT NULL,
  arrived_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (batch_code, khat_type)
);

CREATE TABLE IF NOT EXISTS customers (
  id             SERIAL PRIMARY KEY,
  device_id      TEXT NOT NULL REFERENCES devices(id),
  local_id       INTEGER NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL DEFAULT '',
  credit_limit   NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding    NUMERIC(14,2) NOT NULL DEFAULT 0, -- recomputed by sync
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id, local_id)
);

-- Immutable sale log (snapshots, exactly like the device DB).
CREATE TABLE IF NOT EXISTS sales (
  order_code          TEXT NOT NULL,
  device_id           TEXT NOT NULL REFERENCES devices(id),
  customer_device_id  TEXT,
  customer_local_id   INTEGER,
  customer_name       TEXT NOT NULL DEFAULT '',
  customer_phone      TEXT NOT NULL DEFAULT '',
  khat_type           TEXT NOT NULL,
  kg_sold             NUMERIC(12,2) NOT NULL,
  sell_price_per_kg   NUMERIC(14,2) NOT NULL,
  revenue             NUMERIC(14,2) NOT NULL,
  cogs_per_kg         NUMERIC(14,2) NOT NULL,
  item_cogs           NUMERIC(14,2) NOT NULL,
  gross_profit        NUMERIC(14,2) NOT NULL,
  amount_paid         NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due         NUMERIC(14,2) NOT NULL DEFAULT 0,
  pay_method          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | PARTIAL | CREDIT
  gateway_ref         TEXT,
  sms_sent            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, order_code)
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales (status);

-- FIFO allocation audit: which batch slices each sale consumed.
CREATE TABLE IF NOT EXISTS sales_alloc (
  id          SERIAL PRIMARY KEY,
  order_code  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  batch_code  TEXT NOT NULL,
  khat_type   TEXT NOT NULL,
  kg          NUMERIC(12,2) NOT NULL,
  cogs_per_kg NUMERIC(14,2) NOT NULL,
  UNIQUE (order_code, device_id, batch_code, khat_type)
);

CREATE INDEX IF NOT EXISTS idx_alloc_batch ON sales_alloc (batch_code, khat_type);

-- Debt repayments (buyer credit).
CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  device_id           TEXT NOT NULL REFERENCES devices(id),
  local_id            INTEGER NOT NULL,
  customer_device_id  TEXT NOT NULL,
  customer_local_id   INTEGER NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,
  pay_method          TEXT NOT NULL,
  gateway_ref         TEXT,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (device_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_device_id, customer_local_id);

-- Spoilage events (feed the P&L wastage loss).
CREATE TABLE IF NOT EXISTS wastage (
  id           SERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(id),
  local_id     INTEGER NOT NULL,
  batch_code   TEXT NOT NULL,
  khat_type    TEXT NOT NULL,
  kg           NUMERIC(12,2) NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  cogs_per_kg  NUMERIC(14,2) NOT NULL,
  loss         NUMERIC(14,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (device_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_wastage_batch ON wastage (batch_code, khat_type);

-- Buyer debt ledger (mirrors the device credit_ledger).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id                  SERIAL PRIMARY KEY,
  device_id           TEXT NOT NULL,
  customer_local_id   INTEGER NOT NULL,
  order_code          TEXT,
  amount              NUMERIC(14,2) NOT NULL,      -- + debt, − repayment
  balance_after       NUMERIC(14,2) NOT NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_customer ON credit_ledger (device_id, customer_local_id);

-- STK push requests dispatched to EVC Plus / Zaad (Module 2).
CREATE TABLE IF NOT EXISTS payments_stk (
  id            SERIAL PRIMARY KEY,
  order_code    TEXT NOT NULL,
  invoice_id    TEXT UNIQUE,
  provider      TEXT NOT NULL,      -- EVC_PLUS | ZAAD
  payer_phone   TEXT NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SUCCESS | FAILED | EXPIRED
  gateway_ref   TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at  TIMESTAMPTZ,
  raw           JSON NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_stk_order ON payments_stk (order_code);

-- Webhook idempotency ledger (Module 1): one row per invoice_id, ever.
CREATE TABLE IF NOT EXISTS webhook_events (
  id            SERIAL PRIMARY KEY,
  invoice_id    TEXT NOT NULL UNIQUE,
  provider      TEXT NOT NULL DEFAULT '',
  reference_id  TEXT,
  amount        NUMERIC(14,2),
  status        TEXT NOT NULL,
  raw           JSON NOT NULL DEFAULT '{}',
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
