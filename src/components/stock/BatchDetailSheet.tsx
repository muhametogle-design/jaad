import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { WastageSheet } from './WastageSheet';
import { getBatch } from '../../db/repositories/batchRepo';
import { useAsync } from '../../state/useAsync';
import { useApp } from '../../state/AppProvider';
import type { BatchBundle } from '../../types';
import { formatKg, formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { round2, EPS } from '../../lib/cogs';

interface Props {
  batchId: number | null;
  onClose: () => void;
}

/** Batch drill-down: per-type position, inbound cost build-up, wastage entry. */
export function BatchDetailSheet({ batchId, onClose }: Props) {
  const { now, settings, version } = useApp();
  const { data } = useAsync(() => (batchId ? getBatch(batchId) : Promise.resolve(undefined)), [batchId, version]);
  const [wastageType, setWastageType] = useState<{ id: number; name: string } | null>(null);

  if (!data) return <Sheet visible={batchId !== null} title="Batch" onClose={onClose}><View /></Sheet>;

  const { batch, types } = data as BatchBundle;
  const inbound = round2(
    batch.freight_cost + batch.handling_cost + batch.transport_cost + batch.other_inbound_cost,
  );

  return (
    <>
      <Sheet visible={batchId !== null} title={batch.batch_code} onClose={onClose} tall>
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-2">
            <Badge label={`${batch.flight_number || 'flight n/a'} · ${batch.airline || ''}`} tone="sky" />
            <Badge label={batch.supplier || 'supplier n/a'} tone="zinc" />
          </View>

          <View className="rounded-2xl bg-zinc-950/60 p-4">
            <InfoRow label="Landed (local time)" value={formatDateTime(batch.arrival_at)} />
            <InfoRow label="Gross weight" value={formatKg(batch.gross_weight_kg)} />
            <InfoRow label="Freight" value={formatMoney(batch.freight_cost)} />
            <InfoRow label="Handling" value={formatMoney(batch.handling_cost)} />
            <InfoRow label="Transport" value={formatMoney(batch.transport_cost)} />
            <InfoRow label="Other inbound" value={formatMoney(batch.other_inbound_cost)} />
            <View className="my-2 h-px bg-zinc-800" />
            <InfoRow label="Total inbound (absorbed)" value={formatMoney(inbound)} bold tone="text-amber-300" />
            {batch.notes ? (
              <Text className="mt-2 text-xs italic leading-4 text-zinc-500">“{batch.notes}”</Text>
            ) : null}
          </View>

          <View className="rounded-2xl border border-zinc-800 p-3">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Inventory lines
            </Text>
            {types.map((t) => {
              const empty = t.remaining_kg <= EPS;
              return (
                <View
                  key={t.id}
                  className="mb-2 rounded-xl bg-zinc-800/60 p-3 last:mb-0"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-base font-bold text-zinc-100">{t.type_name}</Text>
                    <Text className="text-sm font-extrabold tabular-nums text-emerald-300">
                      {formatKg(Math.max(0, t.remaining_kg))} left
                    </Text>
                  </View>
                  <View className="mt-1 flex-row justify-between">
                    <Text className="text-xs text-zinc-500">
                      received {formatKg(t.received_kg)} · COGS {formatMoney(t.cogs_per_kg)}/KG
                    </Text>
                    {!empty ? (
                      <Button
                        label="Wastage"
                        size="sm"
                        variant="secondary"
                        onPress={() => setWastageType({ id: t.khat_type_id, name: t.type_name })}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </Sheet>

      {wastageType ? (
        <WastageSheet
          visible
          typeId={wastageType.id}
          typeName={wastageType.name}
          onClose={() => setWastageType(null)}
        />
      ) : null}
    </>
  );
}

function InfoRow({
  label,
  value,
  bold,
  tone = 'text-zinc-200',
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className={`text-sm ${bold ? 'font-bold text-zinc-200' : 'text-zinc-500'}`}>{label}</Text>
      <Text className={`text-sm tabular-nums ${bold ? 'font-extrabold' : 'font-semibold'} ${tone}`}>
        {value}
      </Text>
    </View>
  );
}
