import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useApp } from '@/state/AppProvider';
import { useAsync } from '@/state/useAsync';
import { stockByType, stockLedger } from '@/db/repositories/batchRepo';
import { createSale, getSaleDetail, saleNeedsCharge } from '@/db/repositories/saleRepo';
import { getCustomer } from '@/db/repositories/customerRepo';
import { chargeSale } from '@/integrations/mobileMoney';
import { sendReceipt } from '@/integrations/sms';
import type { ChargeOutcome } from '@/integrations/mobileMoney';
import type { SmsSendResult } from '@/integrations/sms';

import { CustomerSearch } from '@/components/pos/CustomerSearch';
import { TypeCard } from '@/components/pos/TypeCard';
import { KgControls } from '@/components/pos/KgControls';
import { KeypadOverlay } from '@/components/pos/KeypadOverlay';
import { ProfitPreview } from '@/components/pos/ProfitPreview';
import { PaymentPanel } from '@/components/pos/PaymentPanel';
import { ReceiptSheet, type ReceiptState } from '@/components/pos/ReceiptSheet';
import { AddTypeSheet } from '@/components/AddTypeSheet';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FAB } from '@/components/ui/FAB';
import { Spinner } from '@/components/ui/Spinner';

import type { Customer, PayMethod } from '@/types';
import { parseAmount, formatMoney } from '@/lib/money';
import { EPS, previewAllocation, round2 } from '@/lib/cogs';

/**
 * Module 2 — touch-optimized POS.
 *
 * Flow: pick buyer → tap type card → tap KGs (or keypad) → pick payment
 * method → Confirm. Confirmation atomically deducts FIFO stock, snapshots
 * revenue/COGS/profit, opens the STK charge (EVC+/Zaad) and the SMS
 * receipt.
 */
export default function PosScreen() {
  const { bump, now, settings } = useApp();
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [kgStr, setKgStr] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [paidStr, setPaidStr] = useState('');
  const [paidEdited, setPaidEdited] = useState(false);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);

  const { data: stock, loading: stockLoading } = useAsync(() => stockByType(), []);
  const { data: ledger } = useAsync(
    () => (typeId ? stockLedger(typeId) : Promise.resolve([])),
    [typeId],
  );

  const type = stock?.find((t) => t.type_id === typeId) ?? null;
  const kg = parseAmount(kgStr);
  const maxKg = type ? type.total_kg : 0;
  const total = type ? round2(kg * type.sell_price_per_kg) : 0;
  const paid =
    method === 'credit' ? 0 : Math.min(total, paidEdited ? parseAmount(paidStr) : total);
  const balanceDue = round2(Math.max(0, total - paid));

  const creditBlocked = useMemo(() => {
    if (!customer || balanceDue <= EPS) return null;
    if (customer.credit_limit <= 0) return null; // 0 = no limit
    if (customer.outstanding + balanceDue > customer.credit_limit + EPS) {
      return `${customer.name} would owe ${formatMoney(customer.outstanding + balanceDue)} — over the ${formatMoney(customer.credit_limit)} limit.`;
    }
    return null;
  }, [customer, balanceDue]);

  const preview = useMemo(() => {
    if (!ledger || kg <= 0 || !type) return null;
    return previewAllocation(
      ledger.map((r) => ({
        invId: r.id,
        arrivedAt: r.arrived_at,
        cogsPerKg: r.cogs_per_kg,
        remainingKg: r.remaining_kg,
      })),
      kg,
    );
  }, [ledger, kg, type]);

  const canConfirm =
    !!customer && !!type && kg > 0 && kg <= maxKg + EPS && !creditBlocked && !busy;

  const resetSale = () => {
    setCustomer(null);
    setTypeId(null);
    setKgStr('');
    setMethod('cash');
    setPaidStr('');
    setPaidEdited(false);
    setReceipt(null);
  };

  const selectType = (id: number) => {
    setTypeId(id);
    setKgStr('');
    setPaidStr('');
    setPaidEdited(false);
  };

  const confirm = async () => {
    if (!canConfirm || !customer || !type) return;
    setBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const sale = await createSale({
        customerId: customer.id,
        khatTypeId: type.type_id,
        kg,
        payMethod: method,
        amountPaid: paid,
      });
      let charge: ChargeOutcome | null = null;
      if (saleNeedsCharge(method, paid) && customer.phone) {
        charge = await chargeSale(method as 'evc_plus' | 'zaad', sale, customer.phone);
      }
      const freshCustomer = await getCustomer(customer.id);
      setReceipt({
        sale,
        charge,
        sms: null,
        remainingCredit: freshCustomer?.outstanding ?? 0,
      });
      bump();
    } catch (e) {
      // Surface validation/stock errors as an alert on the touch screen.
      Alert.alert('Cannot complete sale', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const retryCharge = async () => {
    if (!receipt || !customer) return;
    setBusy(true);
    try {
      const fresh = await getSaleDetail(receipt.sale.id);
      if (!fresh) return;
      const charge = await chargeSale(fresh.pay_method as 'evc_plus' | 'zaad', fresh, customer.phone);
      const freshCustomer = await getCustomer(customer.id);
      setReceipt({
        ...receipt,
        sale: fresh,
        charge,
        remainingCredit: freshCustomer?.outstanding ?? receipt.remainingCredit,
      });
      bump();
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async () => {
    if (!receipt) return;
    setBusy(true);
    try {
      const result = await sendReceipt(receipt.sale, receipt.remainingCredit);
      const freshCustomer = await getCustomer(customer!.id);
      setReceipt({ ...receipt, sms: result, remainingCredit: freshCustomer?.outstanding ?? receipt.remainingCredit });
      bump();
    } finally {
      setBusy(false);
    }
  };

  const gridCols = isTablet ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 pb-40"
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-2xl font-extrabold text-zinc-100">Sell</Text>
          <Text className="text-xs text-zinc-500">
            {settings.agingFreshHours}h fresh · {settings.agingAgingHours}h aging window
          </Text>
        </View>

        <CustomerSearch selected={customer} onSelect={setCustomer} />

        {/* Khat type cards */}
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Khat type
        </Text>
        {stockLoading && !stock ? (
          <Spinner className="py-8" />
        ) : (
          <View className={`grid ${gridCols} gap-3`}>
            {(stock ?? []).map((t) => (
              <TypeCard
                key={t.type_id}
                stock={t}
                selected={typeId === t.type_id}
                onPress={() => selectType(t.type_id)}
                freshHours={settings.agingFreshHours}
                agingHours={settings.agingAgingHours}
                now={now}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setAddTypeOpen(true)}
              className="flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/40 p-4 active:bg-zinc-800"
            >
              <Ionicons name="add-circle" size={28} color="#34d399" />
              <Text className="mt-1 text-sm font-bold text-emerald-300">+ Add New Type</Text>
            </Pressable>
          </View>
        )}

        {/* Quantity + live profit */}
        {type ? (
          <Card className="mt-4">
            <KgControls
              kgStr={kgStr}
              maxKg={maxKg}
              onAdd={(d) => {
                const next = Math.min(maxKg, round2(parseAmount(kgStr) + d));
                setKgStr(String(next));
                setPaidEdited(false);
                setPaidStr('');
              }}
              onClear={() => {
                setKgStr('');
                setPaidEdited(false);
                setPaidStr('');
              }}
              onKeypad={() => setKeypadOpen(true)}
            />
            <View className="mt-4">
              <ProfitPreview kg={kg} total={total} preview={preview} />
            </View>
          </Card>
        ) : (
          <Card className="mt-4 items-center py-8">
            <Text className="text-sm text-zinc-500">Select a khat type to start the order.</Text>
          </Card>
        )}

        {/* Payment */}
        {type && customer && kg > 0 ? (
          <Card className="mt-4">
            <PaymentPanel
              total={total}
              method={method}
              onMethod={(m) => {
                setMethod(m);
                if (m === 'credit') setPaidStr('');
              }}
              paidStr={paidStr}
              onPaid={(s) => {
                setPaidStr(s);
                setPaidEdited(true);
              }}
              paidEdited={paidEdited}
              balanceDue={balanceDue}
              customerName={customer.name}
              creditLimit={customer.credit_limit}
              outstanding={customer.outstanding}
              creditBlocked={creditBlocked}
            />
          </Card>
        ) : null}
      </ScrollView>

      {/* Sticky confirm bar — thumb zone */}
      <View className="absolute inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <View>
            <Text className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Order total
            </Text>
            <Text className="text-2xl font-extrabold tabular-nums text-zinc-100">
              {formatMoney(total)}
            </Text>
          </View>
          {balanceDue > EPS ? (
            <View className="items-end">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                On credit
              </Text>
              <Text className="text-lg font-bold tabular-nums text-amber-300">
                {formatMoney(balanceDue)}
              </Text>
            </View>
          ) : null}
        </View>
        <Button
          label={
            !customer
              ? 'Select a buyer to continue'
              : !type
                ? 'Select a khat type'
                : kg <= 0
                  ? 'Tap kilograms to continue'
                  : creditBlocked
                    ? 'Over credit limit'
                    : `Confirm & charge`
          }
          size="lg"
          icon="checkmark-circle"
          onPress={confirm}
          loading={busy}
          disabled={!canConfirm}
        />
      </View>

      {/* Add-type FAB (dynamic variety on the fly) */}
      <FAB icon="add" label="Add new khat type" onPress={() => setAddTypeOpen(true)} />

      <KeypadOverlay
        visible={keypadOpen}
        kgStr={kgStr}
        maxKg={maxKg}
        onChange={(s) => {
          setKgStr(s);
          setPaidEdited(false);
          setPaidStr('');
        }}
        onClose={() => setKeypadOpen(false)}
      />
      <AddTypeSheet visible={addTypeOpen} onClose={() => setAddTypeOpen(false)} />
      {receipt ? (
        <ReceiptSheet
          receipt={receipt}
          busy={busy}
          onClose={() => {
            setReceipt(null);
            resetSale();
          }}
          onNewSale={resetSale}
          onRetryCharge={retryCharge}
          onSendSms={sendSms}
        />
      ) : null}
    </View>
  );
}
