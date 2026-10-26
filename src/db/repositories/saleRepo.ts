import { getDb } from '../database';
import type { PayMethod, SaleDetail, SaleStatus } from '../../types';
import { nowIso, localDayKey, compactDayKey } from '../../lib/time';
import { orderCode } from '../../lib/ids';
import { EPS, allocateFifo, round2 } from '../../lib/cogs';
import { stockLedger } from './batchRepo';
import { getCustomer } from './customerRepo';

export interface CreateSaleInput {
  customerId: number;
  khatTypeId: number;
  kg: number;
  payMethod: PayMethod;
  /** Amount collected at checkout (<= total). */
  amountPaid: number;
}

/** True when the checkout must trigger a mobile-money STK charge. */
export function saleNeedsCharge(payMethod: PayMethod, amountPaid: number): boolean {
  return (payMethod === 'evc_plus' || payMethod === 'zaad') && amountPaid > EPS;
}

/**
 * Module 2 core transaction.
 *
 * 1. Read the type's live inventory ledger (FIFO order)
 * 2. Allocate the requested KGs across the oldest batches (pure math)
 * 3. Snapshot revenue / COGS / profit at current prices
 * 4. Deduct the exact slices from batch_inventory (automated deduction)
 * 5. Record the sale + allocation audit rows
 * 6. If partially unpaid, add the balance to the buyer's debt ledger
 *
 * All steps run in one SQLite transaction — a crash mid-sale can never
 * desync inventory from sales.
 */
export async function createSale(input: CreateSaleInput): Promise<SaleDetail> {
  const db = getDb();
  const kg = round2(input.kg);
  if (kg <= 0) throw new Error('Quantity must be positive.');

  const type = await db.getFirstAsync<{ id: number; sell_price_per_kg: number }>(
    `SELECT id, sell_price_per_kg FROM khat_types WHERE id = ? AND is_active = 1`,
    [input.khatTypeId],
  );
  if (!type) throw new Error('This khat type is not active.');

  const customer = await getCustomer(input.customerId);
  if (!customer) throw new Error('Select a buyer first.');

  const revenue = round2(kg * type.sell_price_per_kg);
  const paid = round2(Math.min(input.amountPaid, revenue));
  const balanceDue = round2(revenue - paid);

  // Stock check first (physical constraint): FIFO allocation over the
  // live ledger, throwing InsufficientStockError before anything else.
  const ledger = await stockLedger(input.khatTypeId);
  const alloc = allocateFifo(
    ledger.map((r) => ({
      invId: r.id,
      arrivedAt: r.arrived_at,
      cogsPerKg: r.cogs_per_kg,
      remainingKg: r.remaining_kg,
    })),
    kg,
  );

  // Credit-limit gate (limit 0 = no limit configured).
  if (balanceDue > EPS) {
    if (customer.credit_limit > 0 && customer.outstanding + balanceDue > customer.credit_limit + EPS) {
      throw new Error(
        `Credit limit exceeded — ${customer.name} may owe at most ${Math.round(customer.credit_limit)} So more.`,
      );
    }
  }

  const now = nowIso();

  const needsCharge = saleNeedsCharge(input.payMethod, paid);

  let saleId = 0;
  await db.withTransactionAsync(async () => {
    const codeRow = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sales WHERE order_code LIKE ?`,
      [`SO-${compactDayKey()}-%`],
    );
    const code = orderCode(localDayKey(), (codeRow?.c ?? 0) + 1);

    const res = await db.runAsync(
      `INSERT INTO sales
        (order_code, customer_id, khat_type_id, kg_sold, sell_price_per_kg, revenue,
         cogs_per_kg, item_cogs, gross_profit, amount_paid, balance_due, pay_method, status,
         mm_ref, sms_sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
      [
        code,
        input.customerId,
        input.khatTypeId,
        kg,
        type.sell_price_per_kg,
        revenue,
        alloc.cogsPerKg,
        alloc.totalCogs,
        round2(revenue - alloc.totalCogs),
        paid,
        balanceDue,
        input.payMethod,
        needsCharge ? 'mm_pending' : 'completed',
        now,
      ],
    );
    saleId = Number(res.lastInsertRowId);

    for (const a of alloc.allocations) {
      await db.runAsync(
        `INSERT INTO sales_batch_alloc (sale_id, batch_inventory_id, kg, cogs_per_kg)
         VALUES (?, ?, ?, ?)`,
        [saleId, a.invId, a.kg, a.cogsPerKg],
      );
      await db.runAsync(
        `UPDATE batch_inventory SET remaining_kg = remaining_kg - ? WHERE id = ?`,
        [a.kg, a.invId],
      );
    }

    if (balanceDue > EPS) {
      await db.runAsync(`UPDATE customers SET outstanding = outstanding + ? WHERE id = ?`, [
        balanceDue,
        input.customerId,
      ]);
      const bal = (
        await db.getFirstAsync<{ outstanding: number }>(
          `SELECT outstanding FROM customers WHERE id = ?`,
          [input.customerId],
        )
      )?.outstanding ?? 0;
      await db.runAsync(
        `INSERT INTO credit_ledger (customer_id, sale_id, payment_id, amount, balance_after, note, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        [input.customerId, saleId, balanceDue, bal, `Credit portion of ${code}`, now],
      );
    }

    await db.runAsync(`UPDATE customers SET last_purchased_at = ? WHERE id = ?`, [
      now,
      input.customerId,
    ]);
  });

  const sale = await getSaleDetail(saleId);
  if (!sale) throw new Error('Sale was not created.');
  return sale;
}

/** A mobile-money sale whose STK charge failed while offline. */
export async function markSaleMmPending(saleId: number): Promise<void> {
  const db = getDb();
  await db.runAsync(`UPDATE sales SET status = 'mm_pending' WHERE id = ?`, [saleId]);
}

/** Resolve a sale's payment (webhook in live mode, STK result in sim). */
export async function resolveSalePayment(
  saleId: number,
  ref: string,
  status: SaleStatus = 'completed',
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE sales SET status = ?, mm_ref = COALESCE(?, mm_ref) WHERE id = ?`,
    [status, ref, saleId],
  );
}

export async function markSmsSent(saleId: number): Promise<void> {
  const db = getDb();
  await db.runAsync(`UPDATE sales SET sms_sent = 1 WHERE id = ?`, [saleId]);
}

export async function getSaleDetail(id: number): Promise<SaleDetail | null> {
  const db = getDb();
  return db.getFirstAsync<SaleDetail>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, t.name AS type_name
     FROM sales s
     JOIN customers c ON c.id = s.customer_id
     JOIN khat_types t ON t.id = s.khat_type_id
     WHERE s.id = ?`,
    [id],
  );
}

export async function listRecentSales(limit = 20): Promise<SaleDetail[]> {
  const db = getDb();
  return db.getAllAsync<SaleDetail>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, t.name AS type_name
     FROM sales s
     JOIN customers c ON c.id = s.customer_id
     JOIN khat_types t ON t.id = s.khat_type_id
     ORDER BY s.id DESC LIMIT ?`,
    [limit],
  );
}

/** Today's sales, newest first. */
export async function listTodaySales(): Promise<SaleDetail[]> {
  const db = getDb();
  return db.getAllAsync<SaleDetail>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, t.name AS type_name
     FROM sales s
     JOIN customers c ON c.id = s.customer_id
     JOIN khat_types t ON t.id = s.khat_type_id
     WHERE strftime('%Y-%m-%d', s.created_at, 'localtime') = ?
     ORDER BY s.id DESC`,
    [localDayKey()],
  );
}
