import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { useApp } from '../../state/AppProvider';
import { recordWastage } from '../../db/repositories/wastageRepo';
import { stockLedger } from '../../db/repositories/batchRepo';
import { useAsync } from '../../state/useAsync';
import { formatKg, formatMoney } from '../../lib/money';
import { round2 } from '../../lib/cogs';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  typeId: number;
  typeName: string;
  onClose: () => void;
}

/** Report spoilage / offload against the FIFO-oldest line of a type. */
export function WastageSheet({ visible, typeId, typeName, onClose }: Props) {
  const { bump } = useApp();
  const { data: ledger } = useAsync(() => stockLedger(typeId), [typeId, visible]);
  const [lineIdx, setLineIdx] = useState(0);
  const [kgStr, setKgStr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = (ledger ?? []).filter((l) => l.remaining_kg > 0.0005);
  const line = lines[Math.min(lineIdx, Math.max(0, lines.length - 1))];
  const kg = parseFloat(kgStr.replace(/[^0-9.]/g, '')) || 0;
  const loss = line ? round2(kg * line.cogs_per_kg) : 0;

  const close = () => {
    setKgStr('');
    setReason('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!line) return;
    setBusy(true);
    setError(null);
    try {
      await recordWastage(line.id, kg, reason.trim() || 'Spoilage');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      bump();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = lines.map((l, i) => ({
    value: String(i),
    label: `${l.batch_code.slice(-5)} · ${formatKg(l.remaining_kg)}`,
  }));

  return (
    <Sheet visible={visible} title={`Report wastage — ${typeName}`} onClose={close}>
      {lines.length === 0 ? (
        <Text className="py-6 text-center text-sm text-zinc-500">No stock left to write off.</Text>
      ) : (
        <View className="gap-4">
          <Segmented options={options} value={String(lineIdx)} onChange={(v) => setLineIdx(Number(v))} />
          {line ? (
            <Text className="text-xs text-zinc-500">
              Line cost {formatMoney(line.cogs_per_kg)}/KG · landed {formatKg(line.received_kg)} ·{' '}
              {formatKg(line.remaining_kg)} left
            </Text>
          ) : null}
          <Field
            label="Weight to write off"
            value={kgStr}
            onChangeText={setKgStr}
            placeholder="5"
            keyboardType="decimal-pad"
            suffix="KG"
          />
          <Field
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. mould in transit"
            autoCapitalize="sentences"
            autoCorrect
          />
          <View className="rounded-xl bg-zinc-800/70 px-4 py-3">
            <View className="flex-row justify-between">
              <Text className="text-sm text-zinc-400">Monetary loss (to daily P&L)</Text>
              <Text className="text-sm font-extrabold text-rose-400">{formatMoney(loss)}</Text>
            </View>
          </View>
          {error ? <Text className="text-sm font-semibold text-rose-400">{error}</Text> : null}
          <Button
            label="Record wastage"
            variant="danger"
            icon="warning-outline"
            onPress={submit}
            loading={busy}
            disabled={kg <= 0}
          />
        </View>
      )}
    </Sheet>
  );
}
