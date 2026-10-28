import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/Field';
import { Button } from '../ui/Button';
import { useApp } from '../../state/AppProvider';
import { createCustomer } from '../../db/repositories/customerRepo';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function AddBuyerSheet({ visible, onClose }: Props) {
  const { bump } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [limitStr, setLimitStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setPhone('');
    setLimitStr('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const limit = parseFloat(limitStr.replace(/[^0-9.]/g, '')) || 0;
      await createCustomer(name, phone, limit);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      bump();
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Add buyer" onClose={() => { reset(); onClose(); }}>
      <View className="gap-4">
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Halgan Market" icon="person-outline" autoCapitalize="words" autoCorrect />
        <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+252 61 …" keyboardType="phone-pad" icon="call-outline" />
        <Field
          label="Credit limit (0 = unlimited)"
          value={limitStr}
          onChangeText={setLimitStr}
          placeholder="1000000"
          keyboardType="numeric"
          suffix="So"
        />
        {error ? <Text className="text-sm font-semibold text-rose-400">{error}</Text> : null}
        <Button label="Save buyer" icon="add" onPress={submit} loading={busy} />
      </View>
    </Sheet>
  );
}
