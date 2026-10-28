import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useApp } from '@/state/AppProvider';
import { useAsync } from '@/state/useAsync';
import { listBundles, stockTotals } from '@/db/repositories/batchRepo';
import { BatchCard } from '@/components/stock/BatchCard';
import { BatchDetailSheet } from '@/components/stock/BatchDetailSheet';
import { AddTypeSheet } from '@/components/AddTypeSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FAB } from '@/components/ui/FAB';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatKg, formatMoney } from '@/lib/money';

/**
 * Module 1 companion: the air-cargo batch log.
 * "Log Flight Batch" starts the intake form; each card is one landed
 * flight with its live per-type position and FIFO aging state.
 */
export default function StockScreen() {
  const { now, settings } = useApp();
  const router = useRouter();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [addTypeOpen, setAddTypeOpen] = useState(false);

  const { data: bundles, loading } = useAsync(() => listBundles(), []);
  const { data: totals } = useAsync(() => stockTotals(), []);

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-24"
        bounces={false}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-2xl font-extrabold text-zinc-100">Stock</Text>
          {totals ? (
            <View className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
              <Text className="text-xs font-bold text-zinc-300">
                {formatKg(totals.kg)} · {formatMoney(totals.value)}
              </Text>
            </View>
          ) : null}
        </View>

        <Button
          label="Log Flight Batch"
          icon="rocket-outline"
          size="lg"
          className="mb-4"
          onPress={() => router.push('/intake')}
        />

        {loading && !bundles ? (
          <Spinner />
        ) : !bundles || bundles.length === 0 ? (
          <Card>
            <EmptyState
              icon="rocket-outline"
              title="No flights logged yet"
              message="Log the first air-cargo batch to start tracking inventory, COGS and freshness."
            />
          </Card>
        ) : (
          <View className="gap-3">
            {bundles.map((b) => (
              <BatchCard
                key={b.batch.id}
                bundle={b}
                now={now}
                freshHours={settings.agingFreshHours}
                agingHours={settings.agingAgingHours}
                onPress={() => setDetailId(b.batch.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <FAB icon="add" label="Add new khat type" onPress={() => setAddTypeOpen(true)} />
      <BatchDetailSheet batchId={detailId} onClose={() => setDetailId(null)} />
      <AddTypeSheet visible={addTypeOpen} onClose={() => setAddTypeOpen(false)} />
    </View>
  );
}
