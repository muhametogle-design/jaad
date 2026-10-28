/**
 * SQLite schema for the offline-first Jaad database.
 *
 * Migration policy: additive, forward-only. Each released version appends
 * new DDL to DDL_V<n> and the version is stored in `meta.schema_version`.
 */

export const SCHEMA_VERSION = 1;

export const DDL_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Product catalog: khat varieties. NO quality grades — pricing and
-- inventory are managed strictly by type.
CREATE TABLE IF NOT EXISTS khat_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cogs_price_per_kg REAL NOT NULL DEFAULT 0,
  sell_price_per_kg REAL NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

-- One row per landed flight.
CREATE TABLE IF NOT EXISTS batches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code         TEXT NOT NULL UNIQUE,
  flight_number      TEXT NOT NULL DEFAULT '',
  airline            TEXT NOT NULL DEFAULT '',
  supplier           TEXT NOT NULL DEFAULT '',
  arrival_at         TEXT NOT NULL,
  gross_weight_kg    REAL NOT NULL,
  freight_cost       REAL NOT NULL DEFAULT 0,
  handling_cost      REAL NOT NULL DEFAULT 0,
  transport_cost     REAL NOT NULL DEFAULT 0,
  other_inbound_cost REAL NOT NULL DEFAULT 0,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_arrival ON batches(arrival_at);

-- One row per variety inside a batch. remaining_kg is the live inventory
-- that POS sales and wastage deductions decrement (inside a transaction).
CREATE TABLE IF NOT EXISTS batch_inventory (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  khat_type_id   INTEGER NOT NULL REFERENCES khat_types(id),
  received_kg    REAL NOT NULL,
  remaining_kg   REAL NOT NULL,
  cogs_per_kg    REAL NOT NULL,
  arrived_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bi_fifo ON batch_inventory(khat_type_id, arrived_at, id);

-- Buyer directory + credit.
CREATE TABLE IF NOT EXISTS customers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',
  credit_limit      REAL NOT NULL DEFAULT 0,
  outstanding       REAL NOT NULL DEFAULT 0,
  last_purchased_at TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- POS sales. Monetary fields are snapshots at sale time so history is
-- immutable even if prices change later.
CREATE TABLE IF NOT EXISTS sales (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code        TEXT NOT NULL UNIQUE,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  khat_type_id      INTEGER NOT NULL REFERENCES khat_types(id),
  kg_sold           REAL NOT NULL,
  sell_price_per_kg REAL NOT NULL,
  revenue           REAL NOT NULL,
  cogs_per_kg       REAL NOT NULL,
  item_cogs         REAL NOT NULL,
  gross_profit      REAL NOT NULL,
  amount_paid       REAL NOT NULL DEFAULT 0,
  balance_due       REAL NOT NULL DEFAULT 0,
  pay_method        TEXT NOT NULL DEFAULT 'cash',
  status            TEXT NOT NULL DEFAULT 'completed',
  mm_ref            TEXT,
  sms_sent          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

-- Audit trail of the exact FIFO slices consumed by each sale.
CREATE TABLE IF NOT EXISTS sales_batch_alloc (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id            INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  batch_inventory_id INTEGER NOT NULL REFERENCES batch_inventory(id),
  kg                 REAL NOT NULL,
  cogs_per_kg        REAL NOT NULL
);

-- Debt repayments recorded against a buyer.
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  amount       REAL NOT NULL,
  pay_method   TEXT NOT NULL DEFAULT 'cash',
  mm_ref       TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);

-- Double-entry-ish debt ledger: + = new debt, - = repayment.
-- balance_after keeps the ledger self-auditing.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id       INTEGER,
  payment_id    INTEGER,
  amount        REAL NOT NULL,
  balance_after REAL NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON credit_ledger(customer_id);

-- Spoilage / offload records; the loss feeds the daily P&L.
CREATE TABLE IF NOT EXISTS wastage (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_inventory_id INTEGER NOT NULL REFERENCES batch_inventory(id),
  khat_type_id       INTEGER NOT NULL REFERENCES khat_types(id),
  batch_id           INTEGER NOT NULL,
  kg                 REAL NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  cogs_per_kg        REAL NOT NULL,
  loss               REAL NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wastage_created ON wastage(created_at);

-- Offline outbox for Mobile Money charges and SMS receipts. Items are
-- created while offline / on provider failure and retried when
-- connectivity returns.
CREATE TABLE IF NOT EXISTS sync_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status);
`;
