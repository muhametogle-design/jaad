import React from 'react';
import { Pressable, View, type ViewProps, type PressableProps } from 'react-native';

interface Props extends ViewProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...rest }: Props) {
  return (
    <View
      className={`rounded-2xl border border-zinc-800 bg-zinc-900 p-4 ${className}`}
      {...rest}
    >
      {children}
    </View>
  );
}

interface PressableCardProps extends Omit<PressableProps, 'children'> {
  children: React.ReactNode;
  className?: string;
}

export function CardButton({ children, className = '', ...rest }: PressableCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      className={`rounded-2xl border border-zinc-800 bg-zinc-900 p-4 active:bg-zinc-800 ${className}`}
    >
      {children}
    </Pressable>
  );
}
