import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}

/** Horizontal pill selector with big tap targets. */
export function Segmented<T extends string>({ options, value, onChange, className = '' }: Props<T>) {
  return (
    <View className={`flex-row gap-1 rounded-2xl bg-zinc-800 p-1 ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center justify-center rounded-xl px-2 py-2.5 ${active ? 'bg-emerald-500' : ''}`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-bold ${active ? 'text-zinc-950' : 'text-zinc-400'}`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
