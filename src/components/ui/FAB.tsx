import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

/** Floating action button — bottom-right, thumb reach. */
export function FAB({ icon, label, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="absolute bottom-5 right-4 h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/30 active:scale-95"
    >
      <Ionicons name={icon} size={28} color="#052e16" />
    </Pressable>
  );
}
