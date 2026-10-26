import { getDb } from '../database';
import type { PnlToday } from '../../types';
import { localDayKey, hoursSince, agingStatus } from '../../lib/time';
import { round2, EPS } from '../../lib/cogs';
import { getSettings } from '../settingsRepo';
import { debtRepaidOn } from './paymentRepo';

/**
 * Module 3 — real-time daily P&L.
 *
 *   revenue     = Σ sales.revenue        (KG × selling price, snapshot)
 *   cogs        = Σ sales.item_cogs      (KG × FIFO-weighted landing cost)
 *   wastage     = Σ wastage.loss         (spoiled KG × that line's COGS)
 *   net profit  = revenue − cogs − wastage
 */
export async function todayPnl(): Promise<PnlToday> {
  const db = getDb();
  const today = localDayKey();
  const daySql = `strftime('%Y-%m-%d', created_at, 'localtime') = ?`;

  const rev = (
    await db.getFirstAsync<{
      revenue: number;
      cogs: number;
      orders: number;
      collected: number;
      new_credit: number;
    }>(
      `SELECT COALESCE(SUM(revenue), 0) AS revenue,
              COALESCE(SUM(item_cogs), 0) AS cogs,
              COUNT(*) AS orders,
              COALESCE(SUM(amount_paid), 0) AS collected,
              COALESCE(SUM(balance_due), 0) AS new_credit
       FROM sales WHERE ${daySql}`,
      [today],
    )
  ) ?? { revenue: 0, cogs: 0, orders: 0, collected: 0, new_credit: 0 };

  const byMethod = await db.getAllAsync<{ pay_method: string; s: number }>(
    `SELECT pay_method, COALESCE(SUM(amount_paid), 0) AS s
     FROM sales WHERE ${daySql} GROUP BY pay_method`,
    [today],
  );

  const wastageRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(loss), 0) AS s FROM wastage WHERE ${daySql}`,
    [today],
  );
  const wastageLoss = wastageRow?.s ?? 0;

  const stock = (
    await db.getFirstAsync<{ kg: number; value: number }>(
      `SELECT COALESCE(SUM(remaining_kg), 0) AS kg,
              COALESCE(SUM(remaining_kg * cogs_per_kg), 0) AS value
       FROM batch_inventory WHERE remaining_kg > ?`,
      [EPS],
    )
  ) ?? { kg: 0, value: 0 };

  // Aging buckets (live freshness timer).
  const lines = await db.getAllAsync<{ remaining_kg: number; arrived_at: string }>(
    `SELECT remaining_kg, arrived_at FROM batch_inventory WHERE remaining_kg > ?`,
    [EPS],
  );
  const settings = getSettings();
  let fresh = 0;
  let aging = 0;
  let stale = 0;
  const nowMs = Date.now();
  for (const line of lines) {
    const status = agingStatus(hoursSince(line.arrived_at, nowMs), {
      freshHours: settings.agingFreshHours,
      agingHours: settings.agingAgingHours,
    });
    if (status === 'fresh') fresh += line.remaining_kg;
    else if (status === 'aging') aging += line.remaining_kg;
    else stale += line.remaining_kg;
  }

  const methodSum = (m: string): number => byMethod.find((r) => r.pay_method === m)?.s ?? 0;

  return {
    date: today,
    orders: rev.orders,
    revenue: round2(rev.revenue),
    cogs: round2(rev.cogs),
    collected: round2(rev.collected),
    collected_cash: round2(methodSum('cash')),
    collected_evc: round2(methodSum('evc_plus')),
    collected_zaad: round2(methodSum('zaad')),
    new_credit: round2(rev.new_credit),
    debt_repaid: round2(await debtRepaidOn(today)),
    wastage_loss: round2(wastageLoss),
    net_profit: round2(rev.revenue - rev.cogs - wastageLoss),
    stock_kg: round2(stock.kg),
    stock_value: round2(stock.value),
    fresh_kg: round2(fresh),
    aging_kg: round2(aging),
    stale_kg: round2(stale),
  };
}

/** Convenience: full P&L including debt repaid today. */
export async function fullTodayPnl(): Promise<PnlToday> {
  return todayPnl();
}
