import React from 'react';
import { ActivityIndicator, View } from 'react-native';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <View className={`items-center justify-center py-16 ${className}`}>
      <ActivityIndicator size="large" color="#10b981" />
    </View>
  );
}
