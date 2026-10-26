import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TypeStockSummary, AgingStatus } from '../../types';
import { formatKg, formatUnitPrice } from '../../lib/money';
import { formatAge, hoursSince, agingStatus } from '../../lib/time';
import { Badge } from '../ui/Badge';

interface Props {
  stock: TypeStockSummary;
  selected: boolean;
  onPress: () => void;
  freshHours: number;
  agingHours: number;
  now: number;
}

const AGING_TONE: Record<AgingStatus, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  fresh: { tone: 'green', label: 'FRESH' },
  aging: { tone: 'amber', label: 'AGING' },
  stale: { tone: 'red', label: 'STALE' },
};

/** Visual touch card: variety, price per KG, live stock, freshness flag. */
export function TypeCard({ stock, selected, onPress, freshHours, agingHours, now }: Props) {
  const age = stock.oldest_arrived_at ? hoursSince(stock.oldest_arrived_at, now) : 0;
  const status: AgingStatus = agingStatus(age, { freshHours, agingHours });
  const meta = AGING_TONE[status];
  const empty = stock.total_kg <= 0.0005;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: empty }}
      onPress={onPress}
      disabled={empty}
      className={`flex-1 min-w-0 rounded-2xl border-2 p-4 ${
        selected
          ? 'border-emerald-400 bg-emerald-950/50'
          : empty
            ? 'border-zinc-800 bg-zinc-900/50 opacity-50'
            : 'border-zinc-700 bg-zinc-900 active:bg-zinc-800'
      }`}
    >
      <View className="flex-row items-center justify-between">
        <Text numberOfLines={1} className="text-lg font-extrabold text-zinc-100">
          {stock.name}
        </Text>
        {selected ? <Ionicons name="checkmark-circle" size={22} color="#34d399" /> : null}
      </View>
      <Text className="mt-1 text-base font-bold text-emerald-400">
        {formatUnitPrice(stock.sell_price_per_kg)}
      </Text>
      <Text className="mt-2 text-xs text-zinc-400">
        Stock: <Text className="font-bold text-zinc-200">{formatKg(stock.total_kg)}</Text>
        {stock.batch_count > 0 ? `  •  ${stock.batch_count} batch${stock.batch_count > 1 ? 'es' : ''}` : ''}
      </Text>
      {!empty && stock.oldest_arrived_at ? (
        <View className="mt-3">
          <Badge label={`${meta.label} • ${formatAge(age)}`} tone={meta.tone} />
        </View>
      ) : (
        <View className="mt-3">
          <Badge label="OUT OF STOCK" tone="zinc" />
        </View>
      )}
    </Pressable>
  );
}
