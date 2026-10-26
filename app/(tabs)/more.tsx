import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useApp } from '@/state/AppProvider';
import { useAsync } from '@/state/useAsync';
import { listTypes, setTypeActive, updateType } from '@/db/repositories/khatTypeRepo';
import { getSettings, saveSettings, type Settings } from '@/db/settingsRepo';
import { resetDatabase } from '@/db/database';
import { loadDemoData } from '@/db/seed';
import { listAll } from '@/db/repositories/syncQueueRepo';
import { AddTypeSheet } from '@/components/AddTypeSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge } from '@/components/ui/Badge';
import { Sheet } from '@/components/ui/Sheet';
import { APP } from '@/config';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/time';
import type { KhatType } from '@/types';

/**
 * More: business profile, freshness thresholds, khat type manager,
 * Mobile Money provider config, SMS gateway, and data tools
 * (offline queue, demo data, reset).
 */
export default function MoreScreen() {
  const { settings, refreshSettings, pendingCount, runQueueNow, bump } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [editType, setEditType] = useState<KhatType | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [busyQueue, setBusyQueue] = useState(false);

  const { data: types } = useAsync(() => listTypes(true), []);
  const { data: queue } = useAsync(() => listAll(), [queueOpen]);

  const save = (patch: Partial<Settings>) => {
    saveSettings(patch);
    refreshSettings();
    bump();
  };

  const onDemo = () => {
    Alert.alert('Load demo data', 'Loads two flights, four buyers and today\'s sales into an EMPTY business. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load',
        onPress: async () => {
          try {
            await loadDemoData();
            bump();
            Alert.alert('Done', 'Demo data loaded.');
          } catch (e) {
            Alert.alert('Could not load', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  const onReset = () => {
    Alert.alert('Reset database', 'Deletes ALL batches, sales, buyers and the debt ledger. Settings are kept. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset everything',
        style: 'destructive',
        onPress: () => {
          resetDatabase();
          refreshSettings();
          bump();
          Alert.alert('Reset complete', 'Default types Miro and Jebis are back.');
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="p-4 pb-12" bounces={false}>
      <Text className="mb-3 text-2xl font-extrabold text-zinc-100">More</Text>

      {/* Business */}
      <Section title="Business">
        <SettingsFields
          fields={[
            { key: 'businessName', label: 'Business name (SMS receipts)', value: settings.businessName },
          ]}
          settings={settings}
          onSave={save}
        />
        <Text className="mt-3 text-xs text-zinc-600">
          {APP.name} v{APP.version} · offline-first · all data stored on this device
        </Text>
      </Section>

      {/* Freshness */}
      <Section title="Freshness & aging">
        <View className="flex-row gap-3">
          <Field
            label="Fresh until (h)"
            value={String(settings.agingFreshHours)}
            onChangeText={(t) => save({ agingFreshHours: parseFloat(t) || 0 })}
            keyboardType="numeric"
            className="flex-1"
          />
          <Field
            label="Aging until (h)"
            value={String(settings.agingAgingHours)}
            onChangeText={(t) => save({ agingAgingHours: parseFloat(t) || 0 })}
            keyboardType="numeric"
            className="flex-1"
          />
        </View>
        <Text className="mt-2 text-xs text-zinc-500">
          Stock older than the aging window is flagged STALE and should be rotated, discounted or written off as wastage.
        </Text>
      </Section>

      {/* Khat types */}
      <Section
        title="Khat types"
        action={
          <Pressable onPress={() => setAddOpen(true)} hitSlop={8} className="flex-row items-center">
            <Ionicons name="add" size={16} color="#34d399" />
            <Text className="ml-1 text-sm font-bold text-emerald-400">Add</Text>
          </Pressable>
        }
      >
        {(types ?? []).map((t) => (
          <View key={t.id} className="mb-2 flex-row items-center justify-between rounded-xl bg-zinc-800/60 p-3 last:mb-0">
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-base font-bold text-zinc-100">{t.name}</Text>
                {t.is_active === 0 ? <Badge label="HIDDEN" tone="zinc" /> : null}
              </View>
              <Text className="mt-0.5 text-xs text-zinc-500">
                COGS {formatMoney(t.cogs_price_per_kg)}/KG · Sells {formatMoney(t.sell_price_per_kg)}/KG
              </Text>
            </View>
            <View className="flex-row gap-1.5">
              <Pressable
                onPress={() => setEditType(t)}
                hitSlop={10}
                className="h-9 w-9 items-center justify-center rounded-lg bg-zinc-700"
              >
                <Ionicons name="create-outline" size={16} color="#e4e4e7" />
              </Pressable>
              <Pressable
                onPress={async () => {
                  await setTypeActive(t.id, t.is_active === 0);
                  bump();
                }}
                hitSlop={10}
                className="h-9 w-9 items-center justify-center rounded-lg bg-zinc-700"
              >
                <Ionicons
                  name={t.is_active === 1 ? 'eye-off-outline' : 'eye-outline'}
                  size={16}
                  color={t.is_active === 1 ? '#a1a1aa' : '#34d399'}
                />
              </Pressable>
            </View>
          </View>
        ))}
      </Section>

      {/* Mobile money */}
      <Section title="Mobile Money — EVC Plus (Hormuud)">
        <Segmented
          options={[
            { value: 'simulated', label: 'Simulated (offline demo)' },
            { value: 'live', label: 'Live merchant API' },
          ]}
          value={settings.evcMode}
          onChange={(v) => save({ evcMode: v as 'simulated' | 'live' })}
          className="mb-3"
        />
        <MmFields
          settings={settings}
          onSave={save}
          fields={[
            { key: 'evcBaseUrl', label: 'API base URL', value: settings.evcBaseUrl, long: true },
            { key: 'evcMerchantId', label: 'Merchant ID', value: settings.evcMerchantId },
            { key: 'evcApiKey', label: 'API key (X-EVC-KEY)', value: settings.evcApiKey },
            { key: 'evcSecret', label: 'Signature secret', value: settings.evcSecret },
            { key: 'evcCallbackUrl', label: 'Webhook callback URL', value: settings.evcCallbackUrl, long: true },
            { key: 'evcStkScheme', label: 'STK deep-link scheme', value: settings.evcStkScheme },
          ]}
        />
      </Section>

      <Section title="Mobile Money — Zaad (Telesom)">
        <Segmented
          options={[
            { value: 'simulated', label: 'Simulated (offline demo)' },
            { value: 'live', label: 'Live merchant API' },
          ]}
          value={settings.zaadMode}
          onChange={(v) => save({ zaadMode: v as 'simulated' | 'live' })}
          className="mb-3"
        />
        <MmFields
          settings={settings}
          onSave={save}
          fields={[
            { key: 'zaadBaseUrl', label: 'API base URL', value: settings.zaadBaseUrl, long: true },
            { key: 'zaadMerchantCode', label: 'Merchant code', value: settings.zaadMerchantCode },
            { key: 'zaadSecret', label: 'Signature secret', value: settings.zaadSecret },
            { key: 'zaadStkScheme', label: 'STK deep-link scheme', value: settings.zaadStkScheme },
          ]}
        />
      </Section>

      {/* SMS */}
      <Section title="SMS receipts">
        <MmFields
          settings={settings}
          onSave={save}
          fields={[
            { key: 'smsGatewayUrl', label: 'Gateway URL (optional)', value: settings.smsGatewayUrl, long: true },
            { key: 'smsGatewayToken', label: 'Gateway token (optional)', value: settings.smsGatewayToken },
          ]}
        />
        <Text className="mt-2 text-xs text-zinc-500">
          Without a gateway, receipts open the device SMS app pre-filled — works fully offline.
        </Text>
      </Section>

      {/* Data tools */}
      <Section title="Data & sync">
        <View className="flex-row items-center justify-between rounded-xl bg-zinc-800/60 p-3">
          <View className="flex-1">
            <Text className="text-sm font-bold text-zinc-200">Offline outbox</Text>
            <Text className="text-xs text-zinc-500">
              {pendingCount > 0
                ? `${pendingCount} item(s) waiting for connectivity`
                : 'Nothing pending'}
            </Text>
          </View>
          <Button
            label="Process"
            size="sm"
            variant="secondary"
            loading={busyQueue}
            onPress={async () => {
              setBusyQueue(true);
              try {
                const res = await runQueueNow();
                if (res) Alert.alert('Outbox', `Retried ${res.retried} · confirmed ${res.ok} · still failing ${res.failed}.`);
              } finally {
                setBusyQueue(false);
                setQueueOpen(true);
              }
            }}
          />
        </View>
        <Button
          label="View outbox"
          variant="secondary"
          icon="list-outline"
          className="mt-2 w-full"
          onPress={() => setQueueOpen(true)}
        />
        <Button
          label="Load demo data"
          variant="secondary"
          icon="flask-outline"
          className="mt-2 w-full"
          onPress={onDemo}
        />
        <Button
          label="Reset database"
          variant="danger"
          icon="trash-outline"
          className="mt-2 w-full"
          onPress={onReset}
        />
      </Section>

      <AddTypeSheet visible={addOpen} onClose={() => setAddOpen(false)} />
      <AddTypeSheet visible={!!editType} edit={editType} onClose={() => setEditType(null)} />

      {/* Outbox sheet */}
      <Sheet visible={queueOpen} title="Offline outbox" onClose={() => setQueueOpen(false)} tall>
        {!queue || queue.length === 0 ? (
          <Text className="py-6 text-center text-sm text-zinc-500">Outbox is empty.</Text>
        ) : (
          <View className="gap-2">
            {queue.map((item) => (
              <View key={item.id} className="flex-row items-center justify-between rounded-xl bg-zinc-800/60 p-3">
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-bold text-zinc-200">
                    {item.kind === 'mm_payment' ? 'Mobile money charge' : 'SMS receipt'}
                  </Text>
                  <Text className="text-[11px] text-zinc-500">
                    {formatDateTime(item.created_at)} · {item.attempts} attempt(s)
                  </Text>
                </View>
                <Badge
                  label={item.status.toUpperCase()}
                  tone={item.status === 'pending' ? 'amber' : item.status === 'processed' ? 'green' : 'red'}
                />
              </View>
            ))}
          </View>
        )}
      </Sheet>
    </ScrollView>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</Text>
        {action}
      </View>
      {children}
    </Card>
  );
}

interface FieldSpec {
  key: keyof Settings;
  label: string;
  value: string;
  long?: boolean;
}

/** Auto-saving text fields: persisted to SQLite on every keystroke. */
function MmFields({
  settings,
  onSave,
  fields,
}: {
  settings: Settings;
  onSave: (p: Partial<Settings>) => void;
  fields: FieldSpec[];
}) {
  return (
    <View className="gap-3">
      {fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          value={String((settings[f.key] as string) ?? '')}
          onChangeText={(t) => onSave({ [f.key]: t } as Partial<Settings>)}
          placeholder="—"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={f.long ? 200 : 32}
        />
      ))}
    </View>
  );
}

function SettingsFields({
  fields,
  settings,
  onSave,
}: {
  fields: FieldSpec[];
  settings: Settings;
  onSave: (p: Partial<Settings>) => void;
}) {
  return (
    <View className="gap-3">
      {fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          value={String((settings[f.key] as string) ?? '')}
          onChangeText={(t) => onSave({ [f.key]: t } as Partial<Settings>)}
          autoCapitalize="words"
          autoCorrect
        />
      ))}
    </View>
  );
}
