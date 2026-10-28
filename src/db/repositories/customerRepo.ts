import { getDb } from '../database';
import type { Customer, CustomerBundle, CreditEvent, SaleDetail } from '../../types';
import { nowIso } from '../../lib/time';

export async function listBuyers(): Promise<Customer[]> {
  const db = getDb();
  return db.getAllAsync<Customer>(
    `SELECT * FROM customers ORDER BY outstanding DESC, name COLLATE NOCASE`,
  );
}

/** Directory search by name or phone (prefix-friendly for fast POS entry). */
export async function searchCustomers(q: string, limit = 12): Promise<Customer[]> {
  const db = getDb();
  const t = q.trim();
  if (!t) {
    return db.getAllAsync<Customer>(
      `SELECT * FROM customers
       ORDER BY last_purchased_at DESC NULLS LAST, name COLLATE NOCASE
       LIMIT ?`,
      [limit],
    );
  }
  const like = `%${t.replace(/[%_]/g, '')}%`;
  return db.getAllAsync<Customer>(
    `SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ?
     ORDER BY last_purchased_at DESC NULLS LAST, name COLLATE NOCASE
     LIMIT ?`,
    [like, like, limit],
  );
}

export async function getCustomer(id: number): Promise<Customer | null> {
  const db = getDb();
  return db.getFirstAsync<Customer>(`SELECT * FROM customers WHERE id = ?`, [id]);
}

export async function createCustomer(
  name: string,
  phone: string,
  creditLimit: number,
): Promise<number> {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Buyer name is required.');
  const res = await db.runAsync(
    `INSERT INTO customers (name, phone, credit_limit, outstanding, created_at)
     VALUES (?, ?, ?, 0, ?)`,
    [trimmed, phone.trim(), creditLimit, nowIso()],
  );
  return Number(res.lastInsertRowId);
}

export async function updateCustomer(
  id: number,
  patch: { name?: string; phone?: string; creditLimit?: number },
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE customers SET
       name = COALESCE(?, name),
       phone = COALESCE(?, phone),
       credit_limit = COALESCE(?, credit_limit)
     WHERE id = ?`,
    [patch.name ?? null, patch.phone ?? null, patch.creditLimit ?? null, id],
  );
}

export async function getCustomerBundle(id: number): Promise<CustomerBundle | undefined> {
  const db = getDb();
  const customer = await getCustomer(id);
  if (!customer) return undefined;
  const ledger = await db.getAllAsync<CreditEvent>(
    `SELECT * FROM credit_ledger WHERE customer_id = ? ORDER BY id DESC LIMIT 200`,
    [id],
  );
  const recentSales = await db.getAllAsync<SaleDetail>(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, t.name AS type_name
     FROM sales s
     JOIN customers c ON c.id = s.customer_id
     JOIN khat_types t ON t.id = s.khat_type_id
     WHERE s.customer_id = ?
     ORDER BY s.id DESC LIMIT 50`,
    [id],
  );
  return { customer, ledger, recentSales };
}
