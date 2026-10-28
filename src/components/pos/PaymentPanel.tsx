import React from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '../ui/Segmented';
import { Field } from '../ui/Field';
import type { PayMethod } from '../../types';
import { formatMoney } from '../../lib/money';
import { EPS } from '../../lib/cogs';

const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'evc_plus', label: 'EVC+' },
  { value: 'zaad', label: 'Zaad' },
  { value: 'credit', label: 'Credit' },
];

interface Props {
  total: number;
  method: PayMethod;
  onMethod: (m: PayMethod) => void;
  paidStr: string;
  onPaid: (s: string) => void;
  paidEdited: boolean;
  balanceDue: number;
  customerName: string;
  creditLimit: number;
  outstanding: number;
  /** Block reason when the credit portion would breach the limit. */
  creditBlocked?: string | null;
}

/**
 * Checkout controls: settlement method (cash / EVC Plus / Zaad / credit),
 * amount paid (defaults to the full total), and a live credit-portion
 * preview with the buyer's limit guard.
 */
export function PaymentPanel({
  total,
  method,
  onMethod,
  paidStr,
  onPaid,
  paidEdited,
  balanceDue,
  customerName,
  creditLimit,
  outstanding,
  creditBlocked,
}: Props) {
  const isCreditOnly = method === 'credit';

  return (
    <View>
      <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Pay with
      </Text>
      <Segmented options={METHOD_OPTIONS} value={method} onChange={onMethod} />

      {!isCreditOnly && (
        <View className="mt-4">
          <Field
            label={paidEdited ? 'Amount paid' : 'Amount paid (full)'}
            value={paidStr}
            onChangeText={(t) => onPaid(t)}
            placeholder={String(Math.round(total))}
            keyboardType="numeric"
            prefix=""
            suffix="So"
          />
        </View>
      )}

      <View className="mt-3 rounded-xl bg-zinc-800/70 px-4 py-3">
        <Row label="Order total" value={formatMoney(total)} />
        {balanceDue > EPS ? (
          <Row
            label={
              method === 'credit' ? 'On buyer credit' : `Credit portion (${customerName})`
            }
            value={formatMoney(balanceDue)}
            valueTone="text-amber-300"
          />
        ) : (
          <Row label="Credit portion" value="0 So" valueTone="text-zinc-500" />
        )}
        {creditLimit > 0 ? (
          <Row
            label="Credit limit left"
            value={formatMoney(Math.max(0, creditLimit - outstanding - balanceDue))}
            valueTone={creditBlocked ? 'text-rose-400' : 'text-zinc-400'}
          />
        ) : null}
      </View>
      {creditBlocked ? (
        <Text className="mt-2 text-sm font-semibold text-rose-400">{creditBlocked}</Text>
      ) : null}
    </View>
  );
}

function Row({
  label,
  value,
  valueTone = 'text-zinc-200',
}: {
  label: string;
  value: string;
  valueTone?: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text className="text-sm text-zinc-400">{label}</Text>
      <Text className={`text-sm font-bold tabular-nums ${valueTone}`}>{value}</Text>
    </View>
  );
}
