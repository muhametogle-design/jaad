import React from 'react';
import { Text, View } from 'react-native';

import type { AllocationResult } from '../../lib/cogs';
import { formatMoney } from '../../lib/money';

interface Props {
  kg: number;
  total: number;
  preview: AllocationResult | null;
}

/**
 * Module 3 — the per-transaction financial triptych, computed live:
 *   Revenue = KG × selling price
 *   COGS    = KG × FIFO-weighted landing cost
 *   Gross   = Revenue − COGS
 */
export function ProfitPreview({ kg, total, preview }: Props) {
  const cogs = preview ? preview.totalCogs : 0;
  const gross = total - cogs;
  const margin = total > 0 ? Math.round((gross / total) * 100) : 0;

  return (
    <View>
      <View className="flex-row justify-between">
        <Line label="Item revenue" value={formatMoney(total)} tone="text-zinc-100" />
        <View className="w-px bg-zinc-800 mx-2" />
        <Line label="Item COGS" value={kg > 0 ? formatMoney(cogs) : '—'} tone="text-amber-300" />
      </View>
      <View className="mt-3 flex-row items-center justify-between rounded-xl border border-emerald-700/50 bg-emerald-950/50 px-4 py-3">
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">
            Gross profit
          </Text>
          <Text className="mt-0.5 text-2xl font-extrabold text-emerald-300">
            {kg > 0 ? formatMoney(gross) : '—'}
          </Text>
        </View>
        <Text className="text-sm font-bold text-emerald-400/90">
          {kg > 0 ? `${margin}% margin` : ''}
        </Text>
      </View>
    </View>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View className="flex-1">
      <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</Text>
      <Text className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>{value}</Text>
    </View>
  );
}
