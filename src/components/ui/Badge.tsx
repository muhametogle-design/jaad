import React from 'react';
import { Text, View } from 'react-native';

type Tone = 'green' | 'amber' | 'red' | 'zinc' | 'sky';

const TONES: Record<Tone, { bg: string; text: string }> = {
  green: { bg: 'bg-emerald-950 border-emerald-700/60', text: 'text-emerald-300' },
  amber: { bg: 'bg-amber-950 border-amber-600/60', text: 'text-amber-300' },
  red: { bg: 'bg-rose-950 border-rose-700/60', text: 'text-rose-300' },
  zinc: { bg: 'bg-zinc-800 border-zinc-700', text: 'text-zinc-300' },
  sky: { bg: 'bg-sky-950 border-sky-700/60', text: 'text-sky-300' },
};

interface Props {
  label: string;
  tone?: Tone;
  className?: string;
}

export function Badge({ label, tone = 'zinc', className = '' }: Props) {
  const t = TONES[tone];
  return (
    <View className={`flex-row self-start items-center rounded-full border px-2.5 py-1 ${t.bg} ${className}`}>
      <Text className={`text-[11px] font-bold uppercase tracking-wide ${t.text}`}>{label}</Text>
    </View>
  );
}
