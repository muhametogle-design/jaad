import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { searchCustomers } from '../../db/repositories/customerRepo';
import type { Customer } from '../../types';
import { formatMoney } from '../../lib/money';

interface Props {
  selected: Customer | null;
  onSelect: (c: Customer | null) => void;
}

/**
 * POS customer directory: quick search by name or phone with a
 * recently-used row. Results appear inline (no page navigation) so the
 * operator never leaves the sale screen.
 */
export function CustomerSearch({ selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Customer[]>([]);

  const runSearch = async (term: string) => {
    const rows = await searchCustomers(term);
    setResults(rows);
    setOpen(true);
  };

  const pick = (c: Customer) => {
    onSelect(c);
    setQ('');
    setOpen(false);
  };

  const clear = () => {
    onSelect(null);
    setQ('');
    setOpen(false);
  };

  return (
    <View>
      {selected ? (
        <View className="mb-2 flex-row items-center justify-between rounded-2xl border border-emerald-600/60 bg-emerald-950/60 px-4 py-3">
          <View className="flex-1 flex-row items-center">
            <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-emerald-500">
              <Ionicons name="person" size={20} color="#052e16" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-emerald-100">{selected.name}</Text>
              <Text className="text-xs text-emerald-300/80">
                {selected.phone || 'no phone'}
                {selected.outstanding > 0 ? `  •  owes ${formatMoney(selected.outstanding)}` : ''}
              </Text>
            </View>
          </View>
          <Pressable onPress={clear} hitSlop={10} className="h-10 w-10 items-center justify-center">
            <Ionicons name="close-circle" size={24} color="#6ee7b7" />
          </Pressable>
        </View>
      ) : (
        <View className="mb-2">
          <View
            className={`flex-row items-center rounded-2xl border bg-zinc-800 px-4 ${
              open && results.length > 0 ? 'border-emerald-600/70' : 'border-zinc-700'
            }`}
          >
            <Ionicons name="search" size={18} color="#a1a1aa" className="mr-2" />
            <TextInput
              value={q}
              onChangeText={(t) => {
                setQ(t);
                runSearch(t);
              }}
              onFocus={() => runSearch(q)}
              placeholder="Search buyer by name or phone…"
              placeholderTextColor="#52525b"
              autoCapitalize="words"
              autoCorrect={false}
              className="h-[52px] flex-1 text-base text-zinc-100"
            />
            <Pressable onPress={() => setOpen(false)} hitSlop={8} className="h-8 w-8 items-center justify-center">
              <Ionicons name="chevron-down" size={18} color="#71717a" />
            </Pressable>
          </View>

          {open && results.length > 0 ? (
            <View className="max-h-64 overflow-hidden rounded-b-2xl border border-t-0 border-zinc-700 bg-zinc-900">
              <ScrollView bounces={false}>
                {results.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => pick(c)}
                    className="flex-row items-center border-b border-zinc-800 px-4 py-3 active:bg-zinc-800"
                  >
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-zinc-100">{c.name}</Text>
                      <Text className="text-xs text-zinc-500">
                        {c.phone || 'no phone'}
                        {c.outstanding > 0 ? `  •  owes ${formatMoney(c.outstanding)}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="arrow-forward" size={18} color="#3f3f46" />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
