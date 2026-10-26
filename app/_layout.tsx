import '../global.css';

import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { AppProvider, useApp } from '@/state/AppProvider';
import { APP } from '@/config';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Root() {
  const { ready } = useApp();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#09090b' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="intake"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: 'Log Flight Batch',
            headerStyle: { backgroundColor: '#09090b' },
            headerTintColor: '#f4f4f5',
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="buyer/[id]"
          options={{
            headerShown: true,
            title: 'Buyer',
            headerStyle: { backgroundColor: '#09090b' },
            headerTintColor: '#f4f4f5',
            headerShadowVisible: false,
          }}
        />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
