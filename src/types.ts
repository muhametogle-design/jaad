/**
 * Domain types shared across repositories, UI and integrations.
 * Row types mirror the SQLite schema 1:1 (snake_case columns).
 */

export type PayMethod = 'cash' | 'evc_plus' | 'zaad' | 'credit';
export type SaleStatus = 'completed' | 'mm_pending';
export type AgingStatus = 'fresh' | 'aging' | 'stale';
export type QueueKind = 'mm_payment' | 'sms_receipt';

export interface KhatType {
  id: number;
  name: string;
  cogs_price_per_kg: number;
  sell_price_per_kg: number;
  is_active: number;
  created_at: string;
}

export interface Batch {
  id: number;
  batch_code: string;
  flight_number: string;
  airline: string;
  supplier: string;
  arrival_at: string; // ISO
  gross_weight_kg: number;
  freight_cost: number;
  handling_cost: number;
  transport_cost: number;
  other_inbound_cost: number;
  notes: string;
  created_at: string;
}

/** One variety's share of one flight batch. */
export interface BatchInventoryRow {
  id: number;
  batch_id: number;
  khat_type_id: number;
  received_kg: number;
  remaining_kg: number;
  cogs_per_kg: number;
  arrived_at: string; // ISO (inherited from the batch landing time)
}

export interface StockRow extends BatchInventoryRow {
  batch_code: string;
  type_name: string;
}

/** Aggregated position of one khat type across all open batches. */
export interface TypeStockSummary {
  type_id: number;
  name: string;
  cogs_price_per_kg: number;
  sell_price_per_kg: number;
  total_kg: number;
  stock_value: number;
  oldest_arrived_at: string | null;
  batch_count: number;
  is_active: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  credit_limit: number; // 0 = no credit limit set
  outstanding: number;
  last_purchased_at: string | null;
  created_at: string;
}

export interface Sale {
  id: number;
  order_code: string;
  customer_id: number;
  khat_type_id: number;
  kg_sold: number;
  sell_price_per_kg: number; // snapshot at sale time
  revenue: number;
  cogs_per_kg: number; // FIFO-weighted snapshot at sale time
  item_cogs: number;
  gross_profit: number;
  amount_paid: number;
  balance_due: number;
  pay_method: PayMethod;
  status: SaleStatus;
  mm_ref: string | null;
  sms_sent: number; // 0 | 1
  created_at: string;
}

export interface SaleDetail extends Sale {
  customer_name: string;
  customer_phone: string;
  type_name: string;
}

export interface Payment {
  id: number;
  customer_id: number;
  amount: number;
  pay_method: PayMethod;
  mm_ref: string | null;
  note: string;
  created_at: string;
}

export interface CreditEvent {
  id: number;
  customer_id: number;
  sale_id: number | null;
  payment_id: number | null;
  amount: number; // + adds debt, - reduces debt
  balance_after: number;
  note: string | null;
  created_at: string;
}

export interface Wastage {
  id: number;
  batch_inventory_id: number;
  khat_type_id: number;
  batch_id: number;
  kg: number;
  reason: string;
  cogs_per_kg: number;
  loss: number; // kg * cogs_per_kg
  created_at: string;
}

export interface QueueItem {
  id: number;
  kind: QueueKind;
  payload: string; // JSON
  status: 'pending' | 'processed' | 'failed';
  attempts: number;
  created_at: string;
  processed_at: string | null;
}

/** Real-time financial snapshot for the mobile P&L dashboard. */
export interface PnlToday {
  date: string; // local YYYY-MM-DD
  orders: number;
  revenue: number;
  cogs: number;
  collected: number;
  collected_cash: number;
  collected_evc: number;
  collected_zaad: number;
  new_credit: number;
  debt_repaid: number;
  wastage_loss: number;
  net_profit: number; // revenue - cogs - wastage
  stock_kg: number;
  stock_value: number;
  fresh_kg: number;
  aging_kg: number;
  stale_kg: number;
}

export interface CustomerBundle {
  customer: Customer;
  ledger: CreditEvent[];
  recentSales: SaleDetail[];
}

export interface BatchBundle {
  batch: Batch;
  types: Array<BatchInventoryRow & { type_name: string }>;
}
