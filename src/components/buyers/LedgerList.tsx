import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CreditEvent } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';

/** Self-auditing debt ledger: credit sales (+) and repayments (−) with running balance. */
export function LedgerList({ ledger }: { ledger: CreditEvent[] }) {
  if (ledger.length === 0) {
    return (
      <Text className="py-6 text-center text-sm text-zinc-500">
        No credit activity yet.
      </Text>
    );
  }
  return (
    <View>
      {ledger.map((e) => {
        const isDebt = e.amount > 0;
        return (
          <View
            key={e.id}
            className="mb-2 flex-row items-center justify-between rounded-xl bg-zinc-800/60 px-3 py-2.5"
          >
            <View className="flex-1 flex-row items-center">
              <View
                className={`mr-3 h-8 w-8 items-center justify-center rounded-full ${
                  isDebt ? 'bg-rose-950' : 'bg-emerald-950'
                }`}
              >
                <Ionicons
                  name={isDebt ? 'add' : 'arrow-down'}
                  size={16}
                  color={isDebt ? '#fb7185' : '#34d399'}
                />
              </View>
              <View className="flex-1">
                <Text numberOfLines={1} className="text-sm font-semibold text-zinc-200">
                  {isDebt ? 'Credit sale' : 'Payment'}
                </Text>
                <Text className="text-[11px] text-zinc-500">
                  {formatDateTime(e.created_at)}
                  {e.note ? ` · ${e.note}` : ''}
                </Text>
              </View>
            </View>
            <View className="items-end">
              <Text
                className={`text-sm font-extrabold tabular-nums ${
                  isDebt ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {isDebt ? '+' : '−'}
                {formatMoney(Math.abs(e.amount))}
              </Text>
              <Text className="text-[11px] tabular-nums text-zinc-500">
                bal {formatMoney(e.balance_after)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
