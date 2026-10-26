import { z } from 'zod';
import { withTransaction } from '../db/pool.js';
import { logger } from '../logger.js';

// ── Payload schemas (mirror the mobile SQLite domain) ────────────────────

const num = z.number().finite().nonnegative();
const iso = z.string().datetime({ offset: true });

const batchItemSchema = z.object({
  khatType: z.string().min(1),
  receivedKg: num,
  cogsPerKg: num,
  arrivedAt: iso,
});

const batchSchema = z.object({
  kind: z.literal('batch'),
  batchCode: z.string().min(1),
  flightNumber: z.string().default(''),
  airline: z.string().default(''),
  supplier: z.string().default(''),
  arrivalAt: iso,
  grossWeightKg: num,
  freightCost: num.default(0),
  handlingCost: num.default(0),
  transportCost: num.default(0),
  otherInboundCost: num.default(0),
  notes: z.string().default(''),
  items: z.array(batchItemSchema).min(1),
});

const customerSchema = z.object({
  kind: z.literal('customer'),
  localId: z.number().int().nonnegative(),
  name: z.string().min(1),
  phone: z.string().default(''),
  creditLimit: num.default(0),
});

const allocSchema = z.object({
  batchCode: z.string().min(1),
  khatType: z.string().min(1),
  kg: num,
  cogsPerKg: num,
});

const saleSchema = z.object({
  kind: z.literal('sale'),
  orderCode: z.string().min(1),
  customerId: z.number().int().nonnegative(),
  customerName: z.string().default(''),
  customerPhone: z.string().default(''),
  khatType: z.string().min(1),
  kgSold: num,
  sellPricePerKg: num,
  revenue: num,
  cogsPerKg: num,
  itemCogs: num,
  grossProfit: num,
  amountPaid: num.default(0),
  balanceDue: num.default(0),
  payMethod: z.string().min(1),
  status: z.string().default('PENDING'),
  smsSent: z.boolean().default(false),
  gatewayRef: z.string().nullable().optional(),
  createdAt: iso,
  allocations: z.array(allocSchema).default([]),
});

const paymentSchema = z.object({
  kind: z.literal('payment'),
  localId: z.number().int().nonnegative(),
  customerId: z.number().int().nonnegative(),
  amount: z.number().positive().finite(),
  payMethod: z.string().min(1),
  gatewayRef: z.string().nullable().optional(),
  note: z.string().default(''),
  createdAt: iso,
});

const wastageSchema = z.object({
  kind: z.literal('wastage'),
  localId: z.number().int().nonnegative(),
  batchCode: z.string().min(1),
  khatType: z.string().min(1),
  kg: num,
  reason: z.string().default(''),
  cogsPerKg: num,
  loss: num,
  createdAt: iso,
});

const entrySchema = z.discriminatedUnion('kind', [
  batchSchema,
  customerSchema,
  saleSchema,
  paymentSchema,
  wastageSchema,
]);

const syncSchema = z.object({
  deviceId: z.string().min(1).max(64),
  deviceName: z.string().default(''),
  entries: z.array(entrySchema).min(1).max(500),
});

export type SyncPayload = z.infer<typeof syncSchema>;
export type { batchSchema, customerSchema, saleSchema, paymentSchema, wastageSchema };

export const syncSchemaZod = syncSchema;

export interface SyncResult {
  batches: string[];
  customers: number[];
  sales: string[];
  payments: number[];
  wastage: number[];
  skippedSales: string[];
}

interface CreditEvent {
  customerKey: string; // "deviceId:localId"
  delta: number; // + debt / − repayment
  orderCode: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Module 4 — cloud sync (device SQLite ➔ PostgreSQL).
 *
 * One request = one SQL transaction:
 *   1. upsert device
 *   2. upsert batches + inventory lines (device is source of truth for
 *      received/cogs; remaining is RECOMPUTED from events below)
 *   3. upsert customers
 *   4. insert sales (ON CONFLICT DO NOTHING → duplicate order codes are
 *      detected and reported as skipped, never double-counted)
 *   5. insert payments + wastage (same dedup discipline)
 *   6. append credit-ledger rows for NEW debt events and recompute each
 *      affected buyer's outstanding = Σ balance_due − Σ payments
 *   7. recompute global inventory:
 *      remaining = received − Σ FIFO allocations − Σ wastage
 *
 * The response carries the synced IDs so the device can clear its
 * local sync_queue / mark items processed.
 */
export async function syncOutbox(payloadRaw: unknown): Promise<SyncResult> {
  const p: SyncPayload = syncSchema.parse(payloadRaw);
  const deviceId = p.deviceId;

  return withTransaction(async (client) => {
    const result: SyncResult = {
      batches: [],
      customers: [],
      sales: [],
      payments: [],
      wastage: [],
      skippedSales: [],
    };
    const creditEvents: CreditEvent[] = [];
    const affectedCustomers = new Set<string>();

    // 1) Device identity.
    await client.query(
      `INSERT INTO devices (id, name, last_seen_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_seen_at = now()`,
      [deviceId, p.deviceName],
    );

    // 2) Batches + inventory lines.
    for (const e of p.entries) {
      if (e.kind !== 'batch') continue;
      await client.query(
        `INSERT INTO batches
           (batch_code, flight_number, airline, supplier, arrival_at, gross_weight_kg,
            freight_cost, handling_cost, transport_cost, other_inbound_cost, notes, device_id, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         ON CONFLICT (batch_code) DO UPDATE SET
           flight_number = EXCLUDED.flight_number,
           airline = EXCLUDED.airline,
           supplier = EXCLUDED.supplier,
           arrival_at = EXCLUDED.arrival_at,
           gross_weight_kg = EXCLUDED.gross_weight_kg,
           freight_cost = EXCLUDED.freight_cost,
           handling_cost = EXCLUDED.handling_cost,
           transport_cost = EXCLUDED.transport_cost,
           other_inbound_cost = EXCLUDED.other_inbound_cost,
           notes = EXCLUDED.notes,
           synced_at = now()`,
        [
          e.batchCode, e.flightNumber, e.airline, e.supplier, e.arrivalAt, e.grossWeightKg,
          e.freightCost, e.handlingCost, e.transportCost, e.otherInboundCost, e.notes, deviceId,
        ],
      );
      for (const item of e.items) {
        await client.query(
          `INSERT INTO batch_inventory (batch_code, khat_type, received_kg, remaining_kg, cogs_per_kg, arrived_at)
           VALUES ($1,$2,$3,$3,$4,$5)
           ON CONFLICT (batch_code, khat_type) DO UPDATE SET
             received_kg = EXCLUDED.received_kg,
             remaining_kg = EXCLUDED.remaining_kg,
             cogs_per_kg = EXCLUDED.cogs_per_kg,
             arrived_at = EXCLUDED.arrived_at`,
          [e.batchCode, item.khatType, item.receivedKg, item.cogsPerKg, item.arrivedAt],
        );
      }
      result.batches.push(e.batchCode);
    }

    // 3) Customers.
    for (const e of p.entries) {
      if (e.kind !== 'customer') continue;
      await client.query(
        `INSERT INTO customers (device_id, local_id, name, phone, credit_limit, synced_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (device_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           credit_limit = EXCLUDED.credit_limit,
           synced_at = now()`,
        [deviceId, e.localId, e.name, e.phone, e.creditLimit],
      );
      result.customers.push(e.localId);
      affectedCustomers.add(`${deviceId}:${e.localId}`);
    }

    // 4) Sales — insert only new order codes (duplicate-order verification).
    for (const e of p.entries) {
      if (e.kind !== 'sale') continue;
      const existing = await client.query(
        'SELECT 1 FROM sales WHERE device_id = $1 AND order_code = $2',
        [deviceId, e.orderCode],
      );
      if ((existing.rowCount ?? 0) > 0) {
        result.skippedSales.push(e.orderCode);
        continue;
      }
      await client.query(
        `INSERT INTO sales
           (order_code, device_id, customer_device_id, customer_local_id, customer_name, customer_phone,
            khat_type, kg_sold, sell_price_per_kg, revenue, cogs_per_kg, item_cogs, gross_profit,
            amount_paid, balance_due, pay_method, status, gateway_ref, sms_sent, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          e.orderCode, deviceId, deviceId, e.customerId, e.customerName, e.customerPhone,
          e.khatType, e.kgSold, e.sellPricePerKg, e.revenue, e.cogsPerKg, e.itemCogs, e.grossProfit,
          e.amountPaid, e.balanceDue, e.payMethod, e.status, e.gatewayRef ?? null, e.smsSent, e.createdAt,
        ],
      );
      result.sales.push(e.orderCode);
      for (const a of e.allocations) {
        await client.query(
          `INSERT INTO sales_alloc (order_code, device_id, batch_code, khat_type, kg, cogs_per_kg)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (order_code, device_id, batch_code, khat_type) DO NOTHING`,
          [e.orderCode, deviceId, a.batchCode, a.khatType, a.kg, a.cogsPerKg],
        );
      }
      if (e.balanceDue > 0) {
        const key = `${deviceId}:${e.customerId}`;
        affectedCustomers.add(key);
        creditEvents.push({
          customerKey: key,
          delta: e.balanceDue,
          orderCode: e.orderCode,
          note: `Credit portion of ${e.orderCode}`,
          createdAt: e.createdAt,
        });
      }
    }

    // 5) Payments (debt repayments).
    for (const e of p.entries) {
      if (e.kind !== 'payment') continue;
      const existingP = await client.query('SELECT 1 FROM payments WHERE device_id = $1 AND local_id = $2', [
        deviceId,
        e.localId,
      ]);
      if ((existingP.rowCount ?? 0) > 0) continue;
      await client.query(
        `INSERT INTO payments
           (device_id, local_id, customer_device_id, customer_local_id, amount, pay_method, gateway_ref, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [deviceId, e.localId, deviceId, e.customerId, e.amount, e.payMethod, e.gatewayRef ?? null, e.note, e.createdAt],
      );
      result.payments.push(e.localId);
      const key = `${deviceId}:${e.customerId}`;
      affectedCustomers.add(key);
      creditEvents.push({
        customerKey: key,
        delta: -e.amount,
        orderCode: null,
        note: e.note || 'Debt repayment',
        createdAt: e.createdAt,
      });
    }

    // 6) Wastage.
    for (const e of p.entries) {
      if (e.kind !== 'wastage') continue;
      const existingW = await client.query('SELECT 1 FROM wastage WHERE device_id = $1 AND local_id = $2', [
        deviceId,
        e.localId,
      ]);
      if ((existingW.rowCount ?? 0) > 0) continue;
      await client.query(
        `INSERT INTO wastage
           (device_id, local_id, batch_code, khat_type, kg, reason, cogs_per_kg, loss, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [deviceId, e.localId, e.batchCode, e.khatType, e.kg, e.reason, e.cogsPerKg, e.loss, e.createdAt],
      );
      result.wastage.push(e.localId);
    }

    // 7) Debt ledger + recomputed balances for affected buyers.
    for (const key of affectedCustomers) {
      const [dev, localIdStr] = key.split(':');
      const localId = Number(localIdStr);
      const preQ = await client.query<{ outstanding: number }>(
        `SELECT outstanding FROM customers WHERE device_id = $1 AND local_id = $2`,
        [dev, localId],
      );
      const pre = preQ.rows[0]?.outstanding ?? 0;

      const events = creditEvents
        .filter((ev) => ev.customerKey === key)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let running = pre;
      for (const ev of events) {
        running = round2(running + ev.delta);
        await client.query(
          `INSERT INTO credit_ledger (device_id, customer_local_id, order_code, amount, balance_after, note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [dev, localId, ev.orderCode, ev.delta, running, ev.note, ev.createdAt],
        );
      }

      // Authoritative recompute: Σ credit created − Σ repaid.
      const recalc = await client.query<{ value: number }>(
        `SELECT GREATEST(0,
               COALESCE((SELECT SUM(balance_due) FROM sales s
                          WHERE s.customer_device_id = $1 AND s.customer_local_id = $2), 0)
             - COALESCE((SELECT SUM(amount) FROM payments p
                          WHERE p.customer_device_id = $1 AND p.customer_local_id = $2), 0)
           ) AS value`,
        [dev, localId],
      );
      const outstanding = round2(Number(recalc.rows[0]?.value ?? 0));
      await client.query(
        `UPDATE customers SET outstanding = $3 WHERE device_id = $1 AND local_id = $2`,
        [dev, localId, outstanding],
      );
      // Keep the ledger's last running balance equal to the authoritative value.
      if (events.length > 0) {
        await client.query(
          `UPDATE credit_ledger SET balance_after = $3
            WHERE id = (SELECT c2.id FROM credit_ledger c2
                         WHERE c2.device_id = $1 AND c2.customer_local_id = $2
                         ORDER BY c2.id DESC LIMIT 1)`,
          [dev, localId, outstanding],
        );
      }
    }

    // 8) Global inventory recompute (authoritative): received − allocated − wasted.
    const inv = await client.query(
      'SELECT batch_code, khat_type, received_kg FROM batch_inventory ORDER BY batch_code, khat_type',
    );
    for (const { batch_code, khat_type, received_kg } of inv.rows as {
      batch_code: string;
      khat_type: string;
      received_kg: string;
    }[]) {
      const alloc = Number(
        (
          await client.query(
            'SELECT COALESCE(SUM(kg), 0) AS s FROM sales_alloc WHERE batch_code = $1 AND khat_type = $2',
            [batch_code, khat_type],
          )
        ).rows[0].s,
      );
      const waste = Number(
        (
          await client.query(
            'SELECT COALESCE(SUM(kg), 0) AS s FROM wastage WHERE batch_code = $1 AND khat_type = $2',
            [batch_code, khat_type],
          )
        ).rows[0].s,
      );
      await client.query('UPDATE batch_inventory SET remaining_kg = $1 WHERE batch_code = $2 AND khat_type = $3', [
        Math.max(0, round2(Number(received_kg) - alloc - waste)),
        batch_code,
        khat_type,
      ]);
    }

    logger.info(
      {
        deviceId,
        batches: result.batches.length,
        sales: result.sales.length,
        skippedSales: result.skippedSales.length,
        payments: result.payments.length,
        wastage: result.wastage.length,
      },
      'sync outbox processed',
    );
    return result;
  });
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
