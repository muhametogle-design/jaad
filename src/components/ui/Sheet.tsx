import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Cap sheet height (e.g. for long scrollable forms). */
  tall?: boolean;
}

/** Bottom sheet modal — the workhorse of the touch UI. */
export function Sheet({ visible, title, onClose, children, tall = false }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/70">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" />
        <View
          className={`rounded-t-3xl border-t border-zinc-700 bg-zinc-900 px-5 pb-8 pt-3 ${tall ? 'max-h-[90%]' : 'max-h-[80%]'}`}
        >
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-zinc-100">{title}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              hitSlop={12}
              className="h-10 w-10 items-center justify-center rounded-full bg-zinc-800"
            >
              <Ionicons name="close" size={22} color="#a1a1aa" />
            </Pressable>
          </View>
          <View className={tall ? 'max-h-[70%]' : ''}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}
