import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  className?: string;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-500 active:bg-emerald-600',
  secondary: 'bg-zinc-800 border border-zinc-700 active:bg-zinc-700',
  danger: 'bg-rose-600 active:bg-rose-700',
  ghost: 'bg-transparent active:bg-zinc-800',
  success: 'bg-emerald-900 border border-emerald-700 active:bg-emerald-800',
};

const SIZES: Record<Size, { pad: string; text: string; icon: number }> = {
  sm: { pad: 'px-3 py-2', text: 'text-sm', icon: 16 },
  md: { pad: 'px-4 py-3.5', text: 'text-base', icon: 18 },
  lg: { pad: 'px-5 py-4', text: 'text-lg', icon: 22 },
};

const TEXT: Record<Variant, string> = {
  primary: 'text-zinc-950',
  secondary: 'text-zinc-100',
  danger: 'text-white',
  ghost: 'text-zinc-200',
  success: 'text-emerald-200',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  className = '',
}: Props) {
  const s = SIZES[size];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      className={`flex-row items-center justify-center rounded-2xl font-bold ${VARIANTS[variant]} ${s.pad} ${TEXT[variant]} ${isDisabled ? 'opacity-40' : ''} ${className}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? '#052e16' : '#f4f4f5'} />
      ) : (
        <>
          {icon ? (
            <Ionicons name={icon} size={s.icon} className="mr-2" color={variant === 'primary' ? '#052e16' : 'currentColor'} />
          ) : null}
          <Text className={s.text}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
