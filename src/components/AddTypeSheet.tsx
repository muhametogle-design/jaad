import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Sheet } from './ui/Sheet';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import { useApp } from '../state/AppProvider';
import { addType, updateType } from '../db/repositories/khatTypeRepo';
import type { KhatType } from '../types';
import { formatMoney } from '../lib/money';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the sheet edits an existing type instead of creating one. */
  edit?: KhatType | null;
}

/**
 * Dynamic "+ Add New Type" — a warehouse manager can add a new khat variety
 * on the fly with a custom name, landing COGS price/KG and selling price/KG.
 */
export function AddTypeSheet({ visible, onClose, edit }: Props) {
  const { bump } = useApp();
  const [name, setName] = useState(edit?.name ?? '');
  const [cogs, setCogs] = useState(edit ? String(edit.cogs_price_per_kg) : '');
  const [sell, setSell] = useState(edit ? String(edit.sell_price_per_kg) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(edit?.name ?? '');
    setCogs(edit ? String(edit.cogs_price_per_kg) : '');
    setSell(edit ? String(edit.sell_price_per_kg) : '');
    setError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const cogsN = parseFloat(cogs.replace(/[^0-9.]/g, '')) || 0;
      const sellN = parseFloat(sell.replace(/[^0-9.]/g, '')) || 0;
      if (edit) {
        await updateType(edit.id, { name: name.trim(), cogsPerKg: cogsN, sellPerKg: sellN });
      } else {
        await addType(name, cogsN, sellN);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      bump();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const margin =
    (parseFloat(sell) || 0) - (parseFloat(cogs) || 0) > 0 ? null : 'margin-check';

  return (
    <Sheet visible={visible} title={edit ? `Edit ${edit.name}` : 'Add New Khat Type'} onClose={close}>
      <View className="gap-4">
        <Field
          label="Variety name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Qamra"
          icon="leaf-outline"
          autoCapitalize="words"
          autoCorrect
        />
        <Field
          label="Landing COGS price / KG"
          value={cogs}
          onChangeText={setCogs}
          placeholder="11000"
          keyboardType="numeric"
          prefix=""
          suffix="So"
        />
        <Field
          label="Selling price / KG"
          value={sell}
          onChangeText={setSell}
          placeholder="22000"
          keyboardType="numeric"
          suffix="So"
        />
        {margin === 'margin-check' && name && (
          <Text className="text-xs text-amber-400">
            Tip: selling price should exceed landing COGS for a positive margin.
          </Text>
        )}
        {error ? <Text className="text-sm font-semibold text-rose-400">{error}</Text> : null}
        <View className="flex-row gap-3">
          <Button label="Cancel" variant="secondary" className="flex-1" onPress={close} />
          <Button
            label={edit ? 'Save changes' : 'Add type'}
            icon={edit ? 'checkmark' : 'add'}
            className="flex-1"
            onPress={submit}
            loading={busy}
          />
        </View>
      </View>
    </Sheet>
  );
}
