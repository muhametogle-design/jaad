import React from 'react';
import { Text, View } from 'react-native';
import { Link, Stack } from 'expo-router';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 items-center justify-center bg-zinc-950 p-6">
        <Text className="text-2xl font-extrabold text-zinc-100">Screen not found</Text>
        <Link href="/" className="mt-4 text-base font-bold text-emerald-400">
          Back to dashboard
        </Link>
      </View>
    </>
  );
}
