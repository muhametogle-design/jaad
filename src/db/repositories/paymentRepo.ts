import { getDb } from '../database';
import type { PayMethod, Payment } from '../../types';
import { nowIso } from '../../lib/time';
import { EPS, round2 } from '../../lib/cogs';

/**
 * Record a debt repayment. Reduces the buyer's outstanding balance and
 * writes a negative credit-ledger entry in the same transaction.
 */
export async function recordPayment(
  customerId: number,
  amount: number,
  payMethod: PayMethod,
  mmRef: string | null,
  note = '',
): Promise<Payment> {
  const db = getDb();
  const amt = round2(amount);
  if (amt <= 0) throw new Error('Payment amount must be positive.');

  const customer = await db.getFirstAsync<{ id: number; outstanding: number }>(
    `SELECT id, outstanding FROM customers WHERE id = ?`,
    [customerId],
  );
  if (!customer) throw new Error('Buyer not found.');

  const now = nowIso();
  let paymentId = 0;
  await db.withTransactionAsync(async () => {
    const newOutstanding = round2(Math.max(0, customer.outstanding - amt));
    await db.runAsync(`UPDATE customers SET outstanding = ? WHERE id = ?`, [
      newOutstanding,
      customerId,
    ]);
    const res = await db.runAsync(
      `INSERT INTO payments (customer_id, amount, pay_method, mm_ref, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [customerId, amt, payMethod, mmRef, note, now],
    );
    paymentId = Number(res.lastInsertRowId);
    await db.runAsync(
      `INSERT INTO credit_ledger (customer_id, sale_id, payment_id, amount, balance_after, note, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [customerId, paymentId, -amt, newOutstanding, note || 'Debt repayment', now],
    );
  });

  const payment = await db.getFirstAsync<Payment>(`SELECT * FROM payments WHERE id = ?`, [
    paymentId,
  ]);
  if (!payment) throw new Error('Payment was not recorded.');
  return payment;
}

export async function listPaymentsForCustomer(customerId: number): Promise<Payment[]> {
  const db = getDb();
  return db.getAllAsync<Payment>(
    `SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC`,
    [customerId],
  );
}

/** Sum of debt repaid on a given local day (dashboard). */
export async function debtRepaidOn(dayKey: string): Promise<number> {
  const db = getDb();
  const row = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM payments
     WHERE strftime('%Y-%m-%d', created_at, 'localtime') = ?`,
    [dayKey],
  );
  return row?.s ?? 0;
}

export { EPS };
