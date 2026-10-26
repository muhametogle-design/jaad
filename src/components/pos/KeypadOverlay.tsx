import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { formatKg } from '../../lib/money';
import { parseAmount } from '../../lib/money';
import { round2 } from '../../lib/cogs';

interface Props {
  visible: boolean;
  kgStr: string;
  maxKg: number;
  onChange: (kgStr: string) => void;
  onClose: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Full-screen touch keypad for entering exact kilogram weights. */
export function KeypadOverlay({ visible, kgStr, maxKg, onChange, onClose }: Props) {
  const press = (k: string) => {
    const cur = kgStr.replace(/[^\d.]/g, '');
    if (k === 'back') {
      onChange(cur.slice(0, -1));
      return;
    }
    if (k === '.') {
      if (cur.includes('.')) return;
      onChange(cur === '' ? '0.' : cur + '.');
      return;
    }
    if (cur === '0' && k !== '.') {
      onChange(k);
      return;
    }
    const next = cur + k;
    // Cap so nobody can exceed available stock via the keypad.
    if (parseAmount(next) > maxKg + 0.0005) return;
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/80">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="rounded-t-3xl border-t border-zinc-700 bg-zinc-900 px-5 pb-8 pt-4">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Exact weight
            </Text>
            <Pressable onPress={onClose} hitSlop={12} className="h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
              <Ionicons name="close" size={22} color="#a1a1aa" />
            </Pressable>
          </View>

          <View className="mb-4 items-center rounded-2xl bg-zinc-800 py-6">
            <Text className="text-5xl font-extrabold tabular-nums text-zinc-100">
              {formatKg(parseAmount(kgStr))}
            </Text>
          </View>

          <View className="flex-row flex-wrap justify-between">
            {KEYS.map((k) => (
              <View key={k} className="w-1/3">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => press(k)}
                  className="mb-2 h-[72px] items-center justify-center rounded-2xl bg-zinc-800 active:bg-zinc-700"
                >
                  {k === 'back' ? (
                    <Ionicons name="backspace-outline" size={28} color="#e4e4e7" />
                  ) : (
                    <Text className="text-3xl font-bold text-zinc-100">{k}</Text>
                  )}
                </Pressable>
              </View>
            ))}
          </View>

          <View className="flex-row gap-3">
            <Pressable
              onPress={() => onChange('')}
              className="h-14 flex-1 items-center justify-center rounded-2xl bg-zinc-800 active:bg-zinc-700"
            >
              <Text className="text-base font-bold text-zinc-300">Clear</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              className="h-14 flex-1 items-center justify-center rounded-2xl bg-emerald-500 active:bg-emerald-600"
            >
              <Text className="text-base font-extrabold text-zinc-950">Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
