import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { Button } from '../ui/Button';
import { useApp } from '../../state/AppProvider';
import { recordPayment } from '../../db/repositories/paymentRepo';
import { chargeStandalone } from '../../integrations/mobileMoney';
import type { Customer, PayMethod } from '../../types';
import { formatMoney } from '../../lib/money';
import * as Haptics from 'expo-haptics';

const METHODS: { value: Exclude<PayMethod, 'credit'>; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'evc_plus', label: 'EVC Plus' },
  { value: 'zaad', label: 'Zaad' },
];

interface Props {
  visible: boolean;
  customer: Customer;
  onClose: () => void;
}

/** Debt repayment: cash is recorded instantly; MM is recorded once the STK confirms. */
export function RecordPaymentSheet({ visible, customer, onClose }: Props) {
  const { bump } = useApp();
  const [amountStr, setAmountStr] = useState(String(Math.round(customer.outstanding) || ''));
  const [method, setMethod] = useState<Exclude<PayMethod, 'credit'>>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const amount = parseFloat(amountStr.replace(/[^0-9.]/g, '')) || 0;

  const close = () => {
    setAmountStr('');
    setNote('');
    setError(null);
    setInfo(null);
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let mmRef: string | null = null;
      if (method !== 'cash') {
        const res = await chargeStandalone(method, {
          phone: customer.phone,
          amount,
          reference: `PAY-${customer.name.slice(0, 8).toUpperCase().replace(/\s/g, '-')}`,
        });
        if (!res.ok) throw new Error(res.error || 'Mobile money charge failed — try again.');
        mmRef = res.reference ?? null;
      }
      await recordPayment(customer.id, amount, method, mmRef, note.trim());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      bump();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title={`Record payment — ${customer.name}`} onClose={close}>
      <View className="gap-4">
        <View className="rounded-xl bg-zinc-800/70 px-4 py-3">
          <View className="flex-row justify-between">
            <Text className="text-sm text-zinc-400">Current outstanding</Text>
            <Text className="text-sm font-extrabold text-rose-400">
              {formatMoney(customer.outstanding)}
            </Text>
          </View>
        </View>
        <Field
          label="Amount received"
          value={amountStr}
          onChangeText={setAmountStr}
          placeholder={String(Math.round(customer.outstanding) || 0)}
          keyboardType="numeric"
          suffix="So"
        />
        <View>
          <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Received via
          </Text>
          <Segmented options={METHODS} value={method} onChange={setMethod} />
        </View>
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. cash box 2" autoCapitalize="sentences" autoCorrect />
        {info ? <Text className="text-xs text-sky-300">{info}</Text> : null}
        {error ? <Text className="text-sm font-semibold text-rose-400">{error}</Text> : null}
        <Button
          label="Record payment"
          icon="cash-outline"
          onPress={submit}
          loading={busy}
          disabled={amount <= 0}
        />
      </View>
    </Sheet>
  );
}
