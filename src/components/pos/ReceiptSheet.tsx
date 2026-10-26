import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { ChargeOutcome } from '../../integrations/mobileMoney';
import type { SmsSendResult } from '../../integrations/sms';
import type { SaleDetail } from '../../types';
import { formatKg, formatMoney } from '../../lib/money';
import { PROVIDER_LABEL } from '../../integrations/providers/types';

export interface ReceiptState {
  sale: SaleDetail;
  charge?: ChargeOutcome | null;
  sms?: SmsSendResult | null;
  remainingCredit: number;
}

interface Props {
  receipt: ReceiptState;
  onClose: () => void;
  onNewSale: () => void;
  onRetryCharge: () => void;
  onSendSms: () => void;
  busy: boolean;
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  evc_plus: 'EVC Plus',
  zaad: 'Zaad',
  credit: 'Credit',
};

/** Post-sale receipt: confirm the STK charge (or retry when offline), fire the SMS. */
export function ReceiptSheet({ receipt, onClose, onNewSale, onRetryCharge, onSendSms, busy }: Props) {
  const { sale, charge, sms } = receipt;
  const isMm = sale.pay_method === 'evc_plus' || sale.pay_method === 'zaad';
  const [showSmsBody, setShowSmsBody] = useState(false);

  return (
    <Sheet visible title="Sale confirmed" onClose={onClose}>
      <View className="gap-4">
        {/* Order header */}
        <View className="items-center rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-5">
          <View className="mb-2 h-12 w-12 items-center justify-center rounded-full bg-emerald-500">
            <Ionicons name="checkmark" size={28} color="#052e16" />
          </View>
          <Text className="text-xl font-extrabold text-zinc-100">{sale.order_code}</Text>
          <Text className="mt-1 text-sm text-zinc-400">
            {sale.customer_name}  •  {METHOD_LABEL[sale.pay_method] ?? sale.pay_method}
          </Text>
        </View>

        {/* Line items */}
        <View className="rounded-2xl bg-zinc-800/60 px-4 py-3">
          <Row label={formatKg(sale.kg_sold)} value={sale.type_name} />
          <Row label="Unit price" value={formatMoney(sale.sell_price_per_kg)} />
          <Row label="Total" value={formatMoney(sale.revenue)} bold />
          <Row label="Paid" value={formatMoney(sale.amount_paid)} />
          {sale.balance_due > 0 ? (
            <Row label="Credit balance" value={formatMoney(sale.balance_due)} tone="text-amber-300" />
          ) : null}
          <View className="my-2 h-px bg-zinc-700" />
          <Row label="Gross profit" value={formatMoney(sale.gross_profit)} tone="text-emerald-300" bold />
        </View>

        {/* Mobile money charge state */}
        {isMm && sale.amount_paid > 0 ? (
          <View className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold text-zinc-200">
                {PROVIDER_LABEL[sale.pay_method as 'evc_plus' | 'zaad']} charge
              </Text>
              {sale.status === 'completed' && charge?.status === 'charged' ? (
                <Badge label="CONFIRMED" tone="green" />
              ) : (
                <Badge label="PENDING" tone="amber" />
              )}
            </View>
            {charge?.message ? (
              <Text className="mt-2 text-xs leading-4 text-zinc-400">{charge.message}</Text>
            ) : null}
            {charge?.status === 'charged' && charge.reference ? (
              <Text className="mt-2 text-xs text-zinc-500">
                Ref: <Text className="font-mono text-zinc-300">{charge.reference}</Text>
              </Text>
            ) : null}
            {sale.status !== 'completed' ? (
              <Button
                label={`Retry ${PROVIDER_LABEL[sale.pay_method as 'evc_plus' | 'zaad']} charge`}
                variant="success"
                className="mt-3 w-full"
                onPress={onRetryCharge}
                loading={busy}
              />
            ) : null}
          </View>
        ) : null}

        {/* SMS receipt */}
        <View className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-bold text-zinc-200">SMS receipt</Text>
            {sale.sms_sent || sms?.sent ? <Badge label="SENT" tone="green" /> : <Badge label="NOT SENT" tone="zinc" />}
          </View>
          <Button
            label="Send SMS receipt"
            variant="secondary"
            icon="mail-outline"
            className="mt-3 w-full"
            onPress={onSendSms}
            loading={busy}
          />
          {sms?.error ? <Text className="mt-2 text-xs text-amber-400">{sms.error}</Text> : null}
          <PressableRow label="Preview message" onPress={() => setShowSmsBody((v) => !v)} />
          {showSmsBody ? <SmsPreview sale={sale} remainingCredit={receipt.remainingCredit} /> : null}
        </View>

        <View className="flex-row gap-3">
          <Button label="Close" variant="secondary" className="flex-1" onPress={onClose} />
          <Button label="New sale" icon="add" className="flex-1" onPress={onNewSale} />
        </View>
      </View>
    </Sheet>
  );
}

function Row({
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
    <View className="flex-row items-center justify-between py-0.5">
      <Text className={`text-sm ${bold ? 'font-bold text-zinc-100' : 'text-zinc-400'}`}>{label}</Text>
      <Text className={`text-sm tabular-nums ${bold ? 'font-extrabold' : 'font-semibold'} ${tone}`}>
        {value}
      </Text>
    </View>
  );
}

function PressableRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableHit onPress={onPress}>
      <Text className="mt-2 text-xs font-semibold text-zinc-500 underline">{label}</Text>
    </PressableHit>
  );
}

function PressableHit({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} className="items-start">
      {children}
    </Pressable>
  );
}

function SmsPreview({ sale, remainingCredit }: { sale: SaleDetail; remainingCredit: number }) {
  const lines = [
    'Receipt:',
    `Order ${sale.order_code}`,
    `Item: ${formatKg(sale.kg_sold)} ${sale.type_name}`,
    `Total paid: ${formatMoney(sale.amount_paid)}`,
    `Credit balance: ${formatMoney(remainingCredit)}`,
  ];
  return (
    <View className="mt-3 rounded-xl bg-zinc-900 p-3">
      {lines.map((l, i) => (
        <Text key={i} className="text-xs leading-5 text-zinc-400">
          {l}
        </Text>
      ))}
    </View>
  );
}
