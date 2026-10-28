import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useApp } from '@/state/AppProvider';
import { useAsync } from '@/state/useAsync';
import { createBatch } from '@/db/repositories/batchRepo';
import { stockByType } from '@/db/repositories/batchRepo';
import { AddTypeSheet } from '@/components/AddTypeSheet';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { nowFormValues, localFormToIso } from '@/lib/time';
import { effectiveCogsForBatch, inboundCostTotal, round2 } from '@/lib/cogs';
import { formatKg, formatMoney } from '@/lib/money';

interface LineState {
  typeId: number;
  name: string;
  kgStr: string;
  baseStr: string;
}

/**
 * Module 1 — Air Cargo Intake.
 *
 * Records the flight, inbound logistics costs and per-variety weights.
 * Each variety's effective COGS/KG = base purchase price + inbound costs
 * absorbed over the batch's gross weight. Submitting creates the batch
 * (BATCH-YYYYMMDD-XX) and its FIFO inventory lines atomically.
 */
export default function IntakeScreen() {
  const router = useRouter();
  const { bump } = useApp();
  const defaults = nowFormValues();

  const [flight, setFlight] = useState('');
  const [airline, setAirline] = useState('');
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [grossStr, setGrossStr] = useState('');
  const [freight, setFreight] = useState('');
  const [handling, setHandling] = useState('');
  const [transport, setTransport] = useState('');
  const [other, setOther] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [addTypeOpen, setAddTypeOpen] = useState(false);

  const { data: stock } = useAsync(() => stockByType(), []);
  const [lines, setLines] = useState<LineState[] | null>(null);

  const effectiveLines = useMemo<LineState[]>(() => {
    if (lines) return lines;
    return (stock ?? []).map((t) => ({
      typeId: t.type_id,
      name: t.name,
      kgStr: '',
      baseStr: String(t.cogs_price_per_kg),
    }));
  }, [lines, stock]);

  const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, '')) || 0;
  const gross = num(grossStr);
  const inbound = inboundCostTotal({
    freight: num(freight),
    handling: num(handling),
    transport: num(transport),
    other: num(other),
  });
  const totalReceived = round2(effectiveLines.reduce((s, l) => s + num(l.kgStr), 0));

  const setLine = (typeId: number, patch: Partial<LineState>) => {
    setLines(effectiveLines.map((l) => (l.typeId === typeId ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    setBusy(true);
    try {
      let arrivalAt: string;
      try {
        arrivalAt = localFormToIso(date, time);
      } catch (e) {
        throw e;
      }
      if (gross <= 0) throw new Error('Enter the incoming gross weight (KG).');
      await createBatch({
        flightNumber: flight.trim(),
        airline: airline.trim(),
        supplier: supplier.trim(),
        arrivalAt,
        grossWeightKg: gross,
        freightCost: num(freight),
        handlingCost: num(handling),
        transportCost: num(transport),
        otherInboundCost: num(other),
        notes: notes.trim(),
        items: effectiveLines
          .filter((l) => num(l.kgStr) > 0)
          .map((l) => ({
            khatTypeId: l.typeId,
            receivedKg: round2(num(l.kgStr)),
            baseCostPerKg: num(l.baseStr) || undefined,
          })),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      bump();
      router.back();
    } catch (e) {
      Alert.alert('Intake failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView className="flex-1" contentContainerClassName="p-4 pb-32" bounces={false} keyboardShouldPersistTaps="handled">
        {/* Flight identity */}
        <Card className="mb-4">
          <SectionLabel icon="rocket-outline" text="Flight details" />
          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <Field label="Flight number" value={flight} onChangeText={setFlight} placeholder="ET 663" className="flex-1" />
              <Field label="Airline" value={airline} onChangeText={setAirline} placeholder="Ethiopian" className="flex-1" />
            </View>
            <Field label="Supplier / source" value={supplier} onChangeText={setSupplier} placeholder="Hargeysa Aero Freight" icon="business-outline" />
            <View className="flex-row gap-3">
              <Field label="Arrival date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" className="flex-1" />
              <Field label="Arrival time" value={time} onChangeText={setTime} placeholder="HH:MM" keyboardType="numeric" className="flex-1" />
            </View>
            <Field label="Incoming gross weight" value={grossStr} onChangeText={setGrossStr} placeholder="700" keyboardType="numeric" suffix="KG" />
          </View>
        </Card>

        {/* Inbound costs */}
        <Card className="mb-4">
          <SectionLabel icon="cash-outline" text="Inbound import costs" />
          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <Field label="Freight" value={freight} onChangeText={setFreight} placeholder="0" keyboardType="numeric" suffix="So" className="flex-1" />
              <Field label="Handling" value={handling} onChangeText={setHandling} placeholder="0" keyboardType="numeric" suffix="So" className="flex-1" />
            </View>
            <View className="flex-row gap-3">
              <Field label="Transport" value={transport} onChangeText={setTransport} placeholder="0" keyboardType="numeric" suffix="So" className="flex-1" />
              <Field label="Other" value={other} onChangeText={setOther} placeholder="0" keyboardType="numeric" suffix="So" className="flex-1" />
            </View>
            <View className="flex-row items-center justify-between rounded-xl bg-zinc-800/70 px-4 py-3">
              <Text className="text-sm text-zinc-400">
                Absorbed over {gross > 0 ? `${gross} KG` : 'gross weight'} → {gross > 0 ? formatMoney(round2(inbound / gross)) : '—'}/KG
              </Text>
              <Text className="text-sm font-extrabold text-amber-300">{formatMoney(inbound)}</Text>
            </View>
          </View>
        </Card>

        {/* Per-type intake lines */}
        <Card className="mb-4">
          <View className="flex-row items-center justify-between">
            <SectionLabel icon="leaf-outline" text="Khat varieties on this flight" />
            <Pressable onPress={() => setAddTypeOpen(true)} hitSlop={8} className="flex-row items-center">
              <Ionicons name="add" size={16} color="#34d399" />
              <Text className="ml-1 text-sm font-bold text-emerald-400">Type</Text>
            </Pressable>
          </View>
          <View className="mt-3 gap-3">
            {effectiveLines.map((l) => {
              const kg = num(l.kgStr);
              const base = num(l.baseStr);
              const eff = gross > 0 ? effectiveCogsForBatch(base, inbound, gross) : base;
              return (
                <View key={l.typeId} className={`rounded-xl border p-3 ${kg > 0 ? 'border-emerald-700/50 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-base font-bold text-zinc-100">{l.name}</Text>
                    {kg > 0 ? (
                      <Text className="text-xs font-bold text-emerald-300">
                        eff. COGS {formatMoney(eff)}/KG
                      </Text>
                    ) : null}
                  </View>
                  <View className="mt-2 flex-row gap-3">
                    <Field label="Weight" value={l.kgStr} onChangeText={(t) => setLine(l.typeId, { kgStr: t })} placeholder="0" keyboardType="numeric" suffix="KG" className="flex-1" />
                    <Field label="Base cost" value={l.baseStr} onChangeText={(t) => setLine(l.typeId, { baseStr: t })} keyboardType="numeric" suffix="So" className="flex-1" />
                  </View>
                </View>
              );
            })}
          </View>
          <View className="mt-3 flex-row items-center justify-between rounded-xl bg-zinc-800/70 px-4 py-3">
            <Text className="text-sm text-zinc-400">
              Typed {formatKg(totalReceived)} of {gross > 0 ? formatKg(gross) : 'gross weight'}
            </Text>
            {totalReceived > gross + 0.0005 ? (
              <Text className="text-xs font-bold text-rose-400">Exceeds gross!</Text>
            ) : null}
          </View>
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} className="mt-3" autoCapitalize="sentences" autoCorrect />
        </Card>
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 p-4">
        <Button label="Land this batch" icon="checkmark-circle" size="lg" onPress={submit} loading={busy} />
      </View>

      <AddTypeSheet visible={addTypeOpen} onClose={() => setAddTypeOpen(false)} />
    </View>
  );
}

function SectionLabel({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View className="flex-row items-center">
      <Ionicons name={icon} size={16} color="#34d399" className="mr-2" />
      <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{text}</Text>
    </View>
  );
}
