import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useAsync } from '@/state/useAsync';
import { listBuyers, searchCustomers } from '@/db/repositories/customerRepo';
import { BuyerRow } from '@/components/buyers/BuyerRow';
import { AddBuyerSheet } from '@/components/buyers/AddBuyerSheet';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatMoney } from '@/lib/money';

/** Buyer directory: credit limits, outstanding debt at a glance. */
export default function BuyersScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const { data: all, loading } = useAsync(() => listBuyers(), []);
  const { data: results } = useAsync(() => searchCustomers(q), [q]);

  const rows = q.trim() ? (results ?? []) : (all ?? []);
  const totalDebt = (all ?? []).reduce((s, c) => s + c.outstanding, 0);

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-10" bounces={false}>
        <View className="mb-3 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-extrabold text-zinc-100">Buyers</Text>
            {totalDebt > 0 ? (
              <Text className="text-xs font-semibold text-rose-400">
                Total outstanding debt {formatMoney(totalDebt)}
              </Text>
            ) : (
              <Text className="text-xs text-zinc-500">Credit & debt ledger</Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAddOpen(true)}
            className="flex-row items-center rounded-xl bg-emerald-500 px-3.5 py-2.5 active:bg-emerald-600"
          >
            <Ionicons name="add" size={18} color="#052e16" className="mr-1" />
            <Text className="text-sm font-extrabold text-zinc-950">Buyer</Text>
          </Pressable>
        </View>

        <View className="mb-3 flex-row items-center rounded-2xl border border-zinc-700 bg-zinc-800 px-4">
          <Ionicons name="search" size={18} color="#a1a1aa" className="mr-2" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search name or phone…"
            placeholderTextColor="#52525b"
            autoCapitalize="words"
            autoCorrect={false}
            className="h-[48px] flex-1 text-base text-zinc-100"
          />
        </View>

        {loading && !all ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              icon="people-outline"
              title={q ? 'No buyers match' : 'No buyers yet'}
              message={q ? 'Try a different name or phone fragment.' : 'Add your first buyer to start selling on credit or cash.'}
            />
          </Card>
        ) : (
          <View className="gap-2.5">
            {rows.map((c) => (
              <BuyerRow key={c.id} customer={c} onPress={() => router.push(`/buyer/${c.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>

      <AddBuyerSheet visible={addOpen} onClose={() => setAddOpen(false)} />
    </View>
  );
}
