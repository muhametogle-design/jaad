import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CardButton } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { AgingBadge } from './AgingBadge';
import type { BatchBundle } from '../../types';
import { formatKg, formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { EPS, round2 } from '../../lib/cogs';

interface Props {
  bundle: BatchBundle;
  now: number;
  freshHours: number;
  agingHours: number;
  onPress: () => void;
}

/** One landed flight: code, flight details, inbound costs, per-type stock. */
export function BatchCard({ bundle, now, freshHours, agingHours, onPress }: Props) {
  const { batch, types } = bundle;
  const inbound = round2(
    batch.freight_cost + batch.handling_cost + batch.transport_cost + batch.other_inbound_cost,
  );
  const remaining = round2(types.reduce((s, t) => s + Math.max(0, t.remaining_kg), 0));
  const soldKg = round2(batch.gross_weight_kg - remaining);
  const pct =
    batch.gross_weight_kg > 0 ? Math.min(100, (remaining / batch.gross_weight_kg) * 100) : 0;

  return (
    <CardButton onPress={onPress} className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-mono text-sm font-extrabold text-emerald-300">{batch.batch_code}</Text>
        <AgingBadge
          arrivedAt={batch.arrival_at}
          now={now}
          freshHours={freshHours}
          agingHours={agingHours}
        />
      </View>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Meta icon="rocket-outline" text={`${batch.flight_number || '—'}${batch.airline ? ` · ${batch.airline}` : ''}`} />
        <Meta icon="time-outline" text={formatDateTime(batch.arrival_at)} />
        <Meta icon="business-outline" text={batch.supplier || 'Unknown supplier'} />
      </View>

      {/* Per-type remaining stock chips */}
      <View className="flex-row flex-wrap gap-2">
        {types.map((t) => {
          const empty = t.remaining_kg <= EPS;
          return (
            <View
              key={t.id}
              className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                empty ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-700 bg-zinc-800'
              }`}
            >
              <Text className={`text-xs font-bold ${empty ? 'text-zinc-600' : 'text-zinc-200'}`}>
                {t.type_name}
              </Text>
              <Text className={`text-xs tabular-nums ${empty ? 'text-zinc-600' : 'text-emerald-300'}`}>
                {formatKg(Math.max(0, t.remaining_kg))}
              </Text>
              <Text className="text-[10px] text-zinc-500">@{formatMoney(t.cogs_per_kg)}/KG</Text>
            </View>
          );
        })}
      </View>

      {/* Progress: remaining vs gross landed */}
      <View>
        <View className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <View
            className={`h-full rounded-full ${pct > 50 ? 'bg-emerald-500' : pct > 15 ? 'bg-amber-500' : 'bg-rose-500'}`}
            style={{ width: `${pct}%` }}
          />
        </View>
        <View className="mt-1.5 flex-row justify-between">
          <Text className="text-xs text-zinc-500">
            Landed {formatKg(batch.gross_weight_kg)} · sold {formatKg(soldKg)}
          </Text>
          <Text className="text-xs font-semibold text-zinc-400">
            Inbound costs {formatMoney(inbound)}
          </Text>
        </View>
      </View>
    </CardButton>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-center">
      <Ionicons name={icon} size={14} color="#71717a" className="mr-1.5" />
      <Text className="text-xs text-zinc-400">{text}</Text>
    </View>
  );
}
