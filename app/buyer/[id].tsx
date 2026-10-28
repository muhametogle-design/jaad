import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAsync } from '@/state/useAsync';
import { getCustomerBundle } from '@/db/repositories/customerRepo';
import { LedgerList } from '@/components/buyers/LedgerList';
import { RecordPaymentSheet } from '@/components/buyers/RecordPaymentSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { formatKg, formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/time';

/**
 * Buyer detail: credit position, repayment capture (cash or Mobile Money
 * with STK confirmation) and the self-auditing debt ledger.
 */
export default function BuyerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);

  const { data, loading, error } = useAsync(() => getCustomerBundle(Number(id)), [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) {
    return (
      <View className="flex-1 bg-zinc-950">
        <EmptyState
          icon="person-outline"
          title="Buyer not found"
          message={error ?? 'This buyer may have been removed.'}
          action={<Button label="Back to buyers" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const { customer, ledger, recentSales } = data;
  const nearLimit = customer.credit_limit > 0 && customer.outstanding >= customer.credit_limit * 0.85;
  const pct =
    customer.credit_limit > 0
      ? Math.min(100, (customer.outstanding / customer.credit_limit) * 100)
      : 0;

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-10" bounces={false}>
        {/* Identity + credit position */}
        <Card className="mb-4">
          <View className="flex-row items-center gap-3">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-emerald-950">
              <Text className="text-2xl font-extrabold text-emerald-300">
                {customer.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xl font-extrabold text-zinc-100">{customer.name}</Text>
              <Text className="text-sm text-zinc-500">{customer.phone || 'no phone on file'}</Text>
            </View>
            {nearLimit ? <Badge label="NEAR LIMIT" tone="amber" /> : null}
          </View>

          <View className="mt-4 flex-row justify-between">
            <Stat label="Outstanding" value={formatMoney(customer.outstanding)} tone={customer.outstanding > 0 ? 'text-rose-400' : 'text-emerald-400'} />
            <Stat label="Credit limit" value={customer.credit_limit > 0 ? formatMoney(customer.credit_limit) : 'Unlimited'} tone="text-zinc-200" />
          </View>
          {customer.credit_limit > 0 ? (
            <View className="mt-3">
              <View className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <View
                  className={`h-full rounded-full ${pct > 85 ? 'bg-rose-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </View>
              <Text className="mt-1 text-[11px] text-zinc-500">{Math.round(pct)}% of limit used</Text>
            </View>
          ) : null}

          <Button
            label="Record payment"
            icon="cash-outline"
            className="mt-4 w-full"
            disabled={customer.outstanding <= 0}
            onPress={() => setPayOpen(true)}
          />
        </Card>

        {/* Debt ledger */}
        <Card className="mb-4">
          <Text className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Debt ledger
          </Text>
          <LedgerList ledger={ledger} />
        </Card>

        {/* Purchase history */}
        <Card>
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Purchase history
          </Text>
          {recentSales.length === 0 ? (
            <Text className="py-4 text-center text-sm text-zinc-500">No purchases yet.</Text>
          ) : (
            recentSales.slice(0, 15).map((s) => (
              <View key={s.id} className="mb-2 flex-row items-center justify-between border-b border-zinc-800/70 pb-2 last:border-0 last:pb-0">
                <View className="flex-1 pr-2">
                  <Text numberOfLines={1} className="text-sm font-bold text-zinc-200">
                    {s.order_code} · {s.type_name}
                  </Text>
                  <Text className="text-[11px] text-zinc-500">
                    {formatDateTime(s.created_at)} · {formatKg(s.kg_sold)}
                    {s.balance_due > 0 ? ` · credit ${formatMoney(s.balance_due)}` : ''}
                  </Text>
                </View>
                <Text className="text-sm font-extrabold tabular-nums text-zinc-100">
                  {formatMoney(s.revenue)}
                </Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      {payOpen ? (
        <RecordPaymentSheet visible customer={customer} onClose={() => setPayOpen(false)} />
      ) : null}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View className="flex-1">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</Text>
      <Text className={`mt-1 text-lg font-extrabold ${tone}`}>{value}</Text>
    </View>
  );
}
