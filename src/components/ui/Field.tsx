import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'phone-pad';
  prefix?: string;
  suffix?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  maxLength?: number;
  onFocus?: () => void;
  onSubmit?: () => void;
  className?: string;
  inputClassName?: string;
}

/** Labeled input with a large 52dp touch target — tuned for gloved hands. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  prefix,
  suffix,
  icon,
  autoCapitalize = 'none',
  autoCorrect = false,
  maxLength = 32,
  onFocus,
  onSubmit,
  className = '',
  inputClassName = '',
}: FieldProps) {
  return (
    <View className={className}>
      <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </Text>
      <View
        className={`flex-row items-center rounded-2xl border border-zinc-700 bg-zinc-800 px-4 ${inputClassName}`}
      >
        {icon ? <Ionicons name={icon} size={18} className="mr-2" color="#a1a1aa" /> : null}
        {prefix ? <Text className="mr-1 text-base font-semibold text-zinc-400">{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#52525b"
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          onFocus={onFocus}
          onSubmitEditing={onSubmit}
          className="h-[52px] flex-1 text-base text-zinc-100"
          maxLength={maxLength}
        />
        {suffix ? <Text className="ml-2 text-sm font-semibold text-zinc-400">{suffix}</Text> : null}
      </View>
    </View>
  );
}
