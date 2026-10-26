import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CardButton } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { Customer } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';

interface Props {
  customer: Customer;
  onPress: () => void;
}

export function BuyerRow({ customer, onPress }: Props) {
  const owes = customer.outstanding > 0.0005;
  const nearLimit =
    customer.credit_limit > 0 && customer.outstanding >= customer.credit_limit * 0.85;
  return (
    <CardButton onPress={onPress} className="flex-row items-center gap-3">
      <View
        className={`h-12 w-12 items-center justify-center rounded-full ${
          owes ? 'bg-rose-950' : 'bg-zinc-800'
        }`}
      >
        <Text className="text-lg font-extrabold text-zinc-200">
          {customer.name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="text-base font-bold text-zinc-100">
            {customer.name}
          </Text>
          {nearLimit ? <Badge label="NEAR LIMIT" tone="amber" /> : null}
        </View>
        <Text className="mt-0.5 text-xs text-zinc-500">
          {customer.phone || 'no phone'}
          {customer.last_purchased_at ? `  •  last ${formatDateTime(customer.last_purchased_at)}` : ''}
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Ionicons
            name={owes ? 'card-outline' : 'wallet-outline'}
            size={14}
            color={owes ? '#fb7185' : '#52525b'}
          />
          <Text className={`text-xs font-bold ${owes ? 'text-rose-400' : 'text-zinc-500'}`}>
            {owes ? `Owes ${formatMoney(customer.outstanding)}` : 'No debt'}
            {customer.credit_limit > 0
              ? `  ·  limit ${formatMoney(customer.credit_limit)}`
              : ''}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#3f3f46" />
    </CardButton>
  );
}
