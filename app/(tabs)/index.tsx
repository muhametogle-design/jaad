import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useApp } from '@/state/AppProvider';
import { useAsync } from '@/state/useAsync';
import { fullTodayPnl } from '@/db/repositories/reportingRepo';
import { listTodaySales } from '@/db/repositories/saleRepo';
import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatKg, formatMoney } from '@/lib/money';
import { localDayKey, formatTime } from '@/lib/time';

/**
 * Module 3 — mobile daily P&L dashboard.
 * Real-time aggregates: revenue, COGS, wastage loss, net profit,
 * collections by method, stock value and the freshness breakdown.
 */
export default function DashboardScreen() {
  const { now, settings, online, pendingCount } = useApp();
  const router = useRouter();
  const { data: pnl, loading, error } = useAsync(() => fullTodayPnl(), []);
  const { data: sales } = useAsync(() => listTodaySales(), []);

  if (loading && !pnl) return <Spinner />;

  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="p-4 pb-10" bounces={false}>
      {/* Header */}
      <View className="mb-4 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-extrabold text-zinc-100">{settings.businessName}</Text>
          <Text className="text-sm text-zinc-500">
            Daily P&L · {localDayKey()} · {formatTime(new Date(now).toISOString())}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
          <View
            className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-rose-400'}`}
          />
          <Text className="text-xs font-semibold text-zinc-400">
            {online ? 'Online' : 'Offline'}
            {pendingCount > 0 ? ` · ${pendingCount} queued` : ''}
          </Text>
        </View>
      </View>

      {error ? (
        <Card className="mb-4">
          <Text className="text-sm text-rose-400">{error}</Text>
        </Card>
      ) : null}

      {/* Money grid */}
      {pnl ? (
        <>
          <Card className="mb-3">
            <View className="flex-row">
              <Stat label="Revenue" value={formatMoney(pnl.revenue)} tone="green" sub={`${pnl.orders} orders`} />
              <View className="mx-2 w-px bg-zinc-800" />
              <Stat label="COGS" value={formatMoney(pnl.cogs)} tone="amber" />
            </View>
            <View className="mt-3 flex-row">
              <Stat label="Wastage loss" value={formatMoney(pnl.wastage_loss)} tone="red" />
              <View className="mx-2 w-px bg-zinc-800" />
              <Stat
                label="Net profit"
                value={formatMoney(pnl.net_profit)}
                tone={pnl.net_profit >= 0 ? 'green' : 'red'}
                big
              />
            </View>
          </Card>

          {/* Collections split */}
          <Card className="mb-3">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Collected today — {formatMoney(pnl.collected)}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Badge label={`Cash ${formatMoney(pnl.collected_cash)}`} tone="green" />
              <Badge label={`EVC+ ${formatMoney(pnl.collected_evc)}`} tone="sky" />
              <Badge label={`Zaad ${formatMoney(pnl.collected_zaad)}`} tone="sky" />
              <Badge label={`New credit ${formatMoney(pnl.new_credit)}`} tone="amber" />
              {pnl.debt_repaid > 0 ? (
                <Badge label={`Debt repaid ${formatMoney(pnl.debt_repaid)}`} tone="zinc" />
              ) : null}
            </View>
          </Card>

          {/* Stock & freshness */}
          <Card className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Stock on hand
              </Text>
              <Text className="text-xs font-bold text-zinc-400">
                {formatKg(pnl.stock_kg)} · value {formatMoney(pnl.stock_value)}
              </Text>
            </View>
            <View className="mt-3 flex-row gap-2">
              <AgingPill label="Fresh" kg={pnl.fresh_kg} tone="green" />
              <AgingPill label="Aging" kg={pnl.aging_kg} tone="amber" />
              <AgingPill label="Stale" kg={pnl.stale_kg} tone="red" />
            </View>
            {pnl.stale_kg > 0 ? (
              <Text className="mt-2 text-xs text-rose-400/90">
                {formatKg(pnl.stale_kg)} past {settings.agingAgingHours}h — rotate or discount before it turns.
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* Today's orders */}
      <Card className="mb-2">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Today's orders
          </Text>
          <Text className="text-xs text-zinc-600">tap to sell</Text>
        </View>
        {!sales || sales.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No sales yet today"
            message="Open the Sell tab to ring up the first order."
          />
        ) : (
          sales.slice(0, 8).map((s) => (
            <View key={s.id} className="mb-2 flex-row items-center justify-between border-b border-zinc-800/70 pb-2 last:border-0 last:pb-0">
              <View className="flex-1 pr-2">
                <Text numberOfLines={1} className="text-sm font-bold text-zinc-200">
                  {s.order_code} · {s.type_name}
                </Text>
                <Text numberOfLines={1} className="text-xs text-zinc-500">
                  {s.customer_name} · {formatKg(s.kg_sold)} · {formatTime(s.created_at)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm font-extrabold tabular-nums text-zinc-100">
                  {formatMoney(s.revenue)}
                </Text>
                <Text className="text-[11px] font-bold tabular-nums text-emerald-400">
                  +{formatMoney(s.gross_profit)}
                  {s.status === 'mm_pending' ? ' · MM pending' : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function AgingPill({ label, kg, tone }: { label: string; kg: number; tone: 'green' | 'amber' | 'red' }) {
  const colors = {
    green: 'border-emerald-700/60 bg-emerald-950/60 text-emerald-300',
    amber: 'border-amber-600/60 bg-amber-950/60 text-amber-300',
    red: 'border-rose-700/60 bg-rose-950/60 text-rose-300',
  } as const;
  return (
    <View className={`flex-1 items-center rounded-xl border px-2 py-2 ${colors[tone]}`}>
      <Text className="text-[11px] font-bold uppercase">{label}</Text>
      <Text className="mt-0.5 text-base font-extrabold tabular-nums">{formatKg(kg)}</Text>
    </View>
  );
}
