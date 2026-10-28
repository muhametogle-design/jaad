import React from 'react';
import { Text, View } from 'react-native';

interface Props {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'sky';
  big?: boolean;
}

const VALUE_TONES = {
  default: 'text-zinc-100',
  green: 'text-emerald-400',
  amber: 'text-amber-300',
  red: 'text-rose-400',
  sky: 'text-sky-300',
};

export function Stat({ label, value, sub, tone = 'default', big = false }: Props) {
  return (
    <View className="flex-1">
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className={`mt-1 font-extrabold ${big ? 'text-3xl' : 'text-xl'} ${VALUE_TONES[tone]}`}
      >
        {value}
      </Text>
      {sub ? <Text className="mt-0.5 text-xs text-zinc-500">{sub}</Text> : null}
    </View>
  );
}
