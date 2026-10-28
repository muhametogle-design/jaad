import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { formatKg, parseAmount } from '../../lib/money';
import { round2 } from '../../lib/cogs';

const STEPS = [0.5, 1, 2, 5, 10];

interface Props {
  kgStr: string;
  maxKg: number;
  onAdd: (delta: number) => void;
  onClear: () => void;
  onKeypad: () => void;
}

/**
 * Quick-increment KG taps (+0.5 / +1 / +2 / +5 / +10) plus a keypad
 * launcher for exact weights. The big display doubles as a readout of the
 * live total.
 */
export function KgControls({ kgStr, maxKg, onAdd, onClear, onKeypad }: Props) {
  const kg = parseAmount(kgStr);
  return (
    <View>
      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Weight
          </Text>
          <Text className="mt-1 text-5xl font-extrabold tabular-nums text-zinc-100">
            {formatKg(kg)}
          </Text>
        </View>
        <View className="flex-row gap-2 pb-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear weight"
            onPress={onClear}
            className="h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 active:bg-zinc-700"
          >
            <Ionicons name="trash-outline" size={20} color="#a1a1aa" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open keypad"
            onPress={onKeypad}
            className="h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 active:bg-zinc-700"
          >
            <Ionicons name="keypad" size={22} color="#a1a1aa" />
          </Pressable>
        </View>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {STEPS.map((step) => {
          const atMax = round2(kg + step) > maxKg + 0.0005;
          return (
            <Pressable
              key={step}
              accessibilityRole="button"
              disabled={atMax}
              onPress={() => onAdd(step)}
              className={`h-14 flex-1 items-center justify-center rounded-xl font-extrabold ${
                atMax
                  ? 'bg-zinc-800/60 text-zinc-600'
                  : 'bg-zinc-800 text-emerald-300 active:bg-zinc-700'
              }`}
            >
              <Text className="text-lg">+{step} KG</Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mt-2 text-xs text-zinc-500">
        Available: {formatKg(maxKg)} — oldest stock is deducted first (FIFO)
      </Text>
    </View>
  );
}
