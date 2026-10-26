import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export interface PnlRange {
  from: string;
  to: string; // inclusive local day
}

/**
 * Financial auditing — P&L aggregation over a date range.
 *
 *   net profit = revenue − COGS − wastage loss
 * Collections split, credit created and debt repaid are reported too,
 * plus a per-day breakdown and the current stock valuation.
 */
export async function pnlBetween(
  fromRaw?: string,
  toRaw?: string,
  deviceId?: string,
): Promise<Record<string, unknown>> {
  const to = toRaw ? dateSchema.parse(toRaw) : new Date().toISOString().slice(0, 10);
  const from = fromRaw ? dateSchema.parse(fromRaw) : to;
  if (from > to) throw badRequest('from must be <= to');

  const where: string[] = [`created_at::date >= $1::date`, `created_at::date <= $2::date`];
  const params: unknown[] = [from, to];
  if (deviceId) {
    params.push(deviceId);
    where.push(`device_id = $${params.length}`);
  }
  const whereSql = where.join(' AND ');

  const db = getPool();

  const totals = await db.query<{
    revenue: number;
    cogs: number;
    gross: number;
    orders: number;
    collected: number;
    credit_created: number;
  }>(
    `SELECT COALESCE(SUM(revenue), 0)        AS revenue,
            COALESCE(SUM(item_cogs), 0)      AS cogs,
            COALESCE(SUM(gross_profit), 0)   AS gross,
            COUNT(*)::int                    AS orders,
            COALESCE(SUM(amount_paid), 0)    AS collected,
            COALESCE(SUM(balance_due), 0)    AS credit_created
       FROM sales WHERE ${whereSql}`,
    params,
  );

  const byMethod = await db.query<{ pay_method: string; total: number }>(
    `SELECT pay_method, COALESCE(SUM(amount_paid), 0) AS total
       FROM sales WHERE ${whereSql}
      GROUP BY pay_method`,
    params,
  );

  const wastage = await db.query<{ s: number }>(
    `SELECT COALESCE(SUM(loss), 0) AS s FROM wastage WHERE ${whereSql}`,
    params,
  );
  const repaid = await db.query<{ s: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE ${whereSql}`,
    params,
  );

  const stock = await db.query<{ kg: number; value: number }>(
    `SELECT COALESCE(SUM(remaining_kg), 0) AS kg,
            COALESCE(SUM(remaining_kg * cogs_per_kg), 0) AS value
       FROM batch_inventory WHERE remaining_kg > 0`,
  );

  const byDay = await db.query<{ day: string | Date; revenue: number; cogs: number; gross: number; orders: number }>(
    `SELECT created_at::date AS day,
            COALESCE(SUM(revenue), 0)    AS revenue,
            COALESCE(SUM(item_cogs), 0)  AS cogs,
            COALESCE(SUM(gross_profit), 0) AS gross,
            COUNT(*)::int                AS orders
       FROM sales WHERE ${whereSql}
      GROUP BY created_at::date
      ORDER BY created_at::date`,
    params,
  );

  const revenue = Number(totals.rows[0].revenue);
  const cogs = Number(totals.rows[0].cogs);
  const wastageLoss = Number(wastage.rows[0].s);

  return {
    range: { from, to } satisfies PnlRange,
    orders: totals.rows[0].orders,
    revenue: Number(revenue.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    wastage_loss: Number(wastageLoss.toFixed(2)),
    net_profit: Number((revenue - cogs - wastageLoss).toFixed(2)),
    collected: Number(totals.rows[0].collected),
    collections_by_method: Object.fromEntries(
      byMethod.rows.map((r) => [r.pay_method, Number(r.total)]),
    ),
    credit_created: Number(totals.rows[0].credit_created),
    debt_repaid: Number(repaid.rows[0].s),
    stock: { kg: Number(stock.rows[0].kg), value: Number(stock.rows[0].value) },
    by_day: byDay.rows.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      revenue: Number(r.revenue),
      cogs: Number(r.cogs),
      gross: Number(r.gross),
      orders: r.orders,
    })),
  };
}

/** Full audit trail for one order: sale, FIFO allocations, payment state. */
export async function orderAudit(orderCode: string): Promise<Record<string, unknown>> {
  if (!/^[A-Z0-9-]{4,64}$/i.test(orderCode)) throw badRequest('Invalid order code');
  const db = getPool();

  const sale = await db.query(
    `SELECT * FROM sales WHERE order_code = $1`,
    [orderCode],
  );
  if (sale.rowCount === 0) throw notFound(`Order ${orderCode} not found`);

  const allocs = await db.query(
    `SELECT a.batch_code, a.khat_type, a.kg, a.cogs_per_kg,
            b.flight_number, b.arrival_at
       FROM sales_alloc a LEFT JOIN batches b ON b.batch_code = a.batch_code
      WHERE a.order_code = $1`,
    [orderCode],
  );
  const stk = await db.query(
    `SELECT invoice_id, provider, status, gateway_ref, payer_phone, amount
       FROM payments_stk WHERE order_code = $1 ORDER BY id DESC`,
    [orderCode],
  );

  const row = sale.rows[0] as Record<string, unknown>;
  return {
    order: {
      order_code: row.order_code,
      device_id: row.device_id,
      customer: {
        deviceId: row.customer_device_id,
        localId: row.customer_local_id,
        name: row.customer_name,
        phone: row.customer_phone,
      },
      khat_type: row.khat_type,
      kg_sold: Number(row.kg_sold),
      sell_price_per_kg: Number(row.sell_price_per_kg),
      revenue: Number(row.revenue),
      cogs_per_kg: Number(row.cogs_per_kg),
      item_cogs: Number(row.item_cogs),
      gross_profit: Number(row.gross_profit),
      amount_paid: Number(row.amount_paid),
      balance_due: Number(row.balance_due),
      pay_method: row.pay_method,
      status: row.status,
      gateway_ref: row.gateway_ref,
      sms_sent: row.sms_sent,
      created_at: row.created_at,
    },
    fifo_allocations: allocs.rows,
    stk_attempts: stk.rows,
  };
}
