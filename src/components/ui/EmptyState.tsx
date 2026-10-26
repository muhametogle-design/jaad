import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <View className="items-center justify-center px-6 py-14">
      <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800">
        <Ionicons name={icon} size={30} color="#71717a" />
      </View>
      <Text className="text-center text-base font-bold text-zinc-300">{title}</Text>
      {message ? (
        <Text className="mt-1 text-center text-sm leading-5 text-zinc-500">{message}</Text>
      ) : null}
      {action ? <View className="mt-4">{action}</View> : null}
    </View>
  );
}
