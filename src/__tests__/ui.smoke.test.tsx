/**
 * UI smoke test: renders the key touch widgets inside the real AppProvider
 * (with the in-memory SQLite mock) to catch render-time crashes before
 * they reach a device.
 */
import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { mockSqliteDb } from './helpers/mockSqlite';
import { DDL_V1 } from '../db/schema';

jest.mock('expo-sqlite', () => require('./helpers/mockSqlite').default);
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('expo-linking', () => ({
  openURL: jest.fn(async () => undefined),
  canOpenURL: jest.fn(async () => true),
}));

import { AppProvider, useApp } from '../state/AppProvider';
import { TypeCard } from '../components/pos/TypeCard';
import { ProfitPreview } from '../components/pos/ProfitPreview';
import { PaymentPanel } from '../components/pos/PaymentPanel';
import { KeypadOverlay } from '../components/pos/KeypadOverlay';
import { ReceiptSheet } from '../components/pos/ReceiptSheet';
import { CustomerSearch } from '../components/pos/CustomerSearch';
import { BatchCard } from '../components/stock/BatchCard';
import { LedgerList } from '../components/buyers/LedgerList';
import { AddTypeSheet } from '../components/AddTypeSheet';
import { WastageSheet } from '../components/stock/WastageSheet';
import { createBatch, stockByType, listBundles } from '../db/repositories/batchRepo';
import { listTypes } from '../db/repositories/khatTypeRepo';
import { createCustomer } from '../db/repositories/customerRepo';
import { createSale } from '../db/repositories/saleRepo';
import { recordPayment } from '../db/repositories/paymentRepo';
import { initDatabase } from '../db/database';
import type { BatchBundle, CreditEvent, SaleDetail, TypeStockSummary } from '../types';

beforeEach(() => {
  mockSqliteDb.__reset(DDL_V1);
  initDatabase();
});

/** Render inside the provider, let effects settle, then unmount. */
async function renderWithApp(ui: React.ReactNode): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<AppProvider>{ui}</AppProvider>);
  });
  await act(async () => {
    // let async effects (queries, DB init) settle
    await new Promise((r) => setTimeout(r, 25));
  });
  return renderer;
}

const stockSummary: TypeStockSummary = {
  type_id: 1,
  name: 'Miro',
  cogs_price_per_kg: 13642.86,
  sell_price_per_kg: 22000,
  total_kg: 400,
  stock_value: 5_457_144,
  oldest_arrived_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  batch_count: 1,
  is_active: 1,
};

test('POS type card + profit preview + keypad render', async () => {
  const renderer = await renderWithApp(
    <View>
      <TypeCard stock={stockSummary} selected={false} onPress={() => {}} freshHours={12} agingHours={24} now={Date.now()} />
      <ProfitPreview kg={12.5} total={275_000} preview={{ allocations: [], totalKg: 12.5, totalCogs: 170_535.75, cogsPerKg: 13_642.86 }} />
      <KeypadOverlay visible kgStr="12.5" maxKg={400} onChange={() => {}} onClose={() => {}} />
    </View>,
  );
  expect(renderer.toJSON()).not.toBeNull();
  await act(async () => renderer.unmount());
});

test('payment panel, customer search and add-type sheet render', async () => {
  const customer = {
    id: 1,
    name: 'Ahmed Ware',
    phone: '+252 63 412 3456',
    credit_limit: 1_000_000,
    outstanding: 100_000,
    last_purchased_at: null,
    created_at: new Date().toISOString(),
  };
  const renderer = await renderWithApp(
    <>
      <CustomerSearch selected={customer} onSelect={() => {}} />
      <PaymentPanel
        total={275_000}
        method="evc_plus"
        onMethod={() => {}}
        paidStr=""
        onPaid={() => {}}
        paidEdited={false}
        balanceDue={0}
        customerName={customer.name}
        creditLimit={customer.credit_limit}
        outstanding={customer.outstanding}
      />
      <AddTypeSheet visible onClose={() => {}} />
    </>,
  );
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toContain('EVC+');
  expect(json).toContain('Ahmed Ware');
  expect(json).toContain('Add New Khat Type');
  await act(async () => renderer.unmount());
});

test('receipt sheet renders with a confirmed charge', async () => {
  const sale: SaleDetail = {
    id: 1,
    order_code: 'SO-20261016-001',
    customer_id: 1,
    khat_type_id: 1,
    kg_sold: 12.5,
    sell_price_per_kg: 22_000,
    revenue: 275_000,
    cogs_per_kg: 13_642.86,
    item_cogs: 170_535.75,
    gross_profit: 104_464.25,
    amount_paid: 275_000,
    balance_due: 0,
    pay_method: 'evc_plus',
    status: 'completed',
    mm_ref: 'EVC-SIM-ABC123',
    sms_sent: 0,
    created_at: new Date().toISOString(),
    customer_name: 'Ahmed Ware',
    customer_phone: '+252 63 412 3456',
    type_name: 'Miro',
  };
  const renderer = await renderWithApp(
    <ReceiptSheet
      receipt={{ sale, charge: { status: 'charged', reference: 'EVC-SIM-ABC123' }, sms: null, remainingCredit: 0 }}
      onClose={() => {}}
      onNewSale={() => {}}
      onRetryCharge={() => {}}
      onSendSms={() => {}}
      busy={false}
    />,
  );
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toContain('SO-20261016-001');
  expect(json).toContain('CONFIRMED');
  expect(json).toContain('12.5 KG');
  await act(async () => renderer.unmount());
});

test('stock + buyer widgets render with real repository data', async () => {
  // Seed real data through the repositories, then render against it.
  const types = await listTypes();
  const miro = types.find((t) => t.name === 'Miro')!;
  await createBatch({
    flightNumber: 'ET 663',
    airline: 'Ethiopian Airlines',
    supplier: 'Hargeysa Aero Freight',
    arrivalAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    grossWeightKg: 700,
    freightCost: 1_450_000,
    handlingCost: 220_000,
    transportCost: 130_000,
    otherInboundCost: 50_000,
    notes: '',
    items: [{ khatTypeId: miro.id, receivedKg: 400 }],
  });
  const buyer = await createCustomer('Farhan Group Market', '+252 61 777 8899', 2_500_000);
  const sale = await createSale({ customerId: buyer, khatTypeId: miro.id, kg: 20, payMethod: 'cash', amountPaid: 0 });
  await recordPayment(buyer, 50_000, 'cash', null, 'partial');

  const [summary, bundles, ledger] = await Promise.all([
    stockByType(),
    listBundles(),
    mockSqliteDb
      .getAllAsync<CreditEvent>(`SELECT * FROM credit_ledger ORDER BY id`)
      .then((rows) => [...rows].reverse()),
  ]);

  const bundle: BatchBundle = bundles[0];

  // Wrap in a component that grabs the live clock from the provider.
  function Live() {
    const { now, settings } = useApp();
    return (
      <>
        <TypeCard stock={summary[0]} selected onPress={() => {}} freshHours={settings.agingFreshHours} agingHours={settings.agingAgingHours} now={now} />
        <BatchCard bundle={bundle} now={now} freshHours={settings.agingFreshHours} agingHours={settings.agingAgingHours} onPress={() => {}} />
        <LedgerList ledger={ledger} />
        <WastageSheet visible typeId={miro.id} typeName="Miro" onClose={() => {}} />
      </>
    );
  }

  const renderer = await renderWithApp(<Live />);
  const json = JSON.stringify(renderer.toJSON());
  expect(json).toContain(bundle.batch.batch_code);
  expect(json).toContain('ET 663');
  expect(json).toContain('Credit sale'); // ledger entry for the 220,000 So credit portion
  await act(async () => renderer.unmount());
  void sale;
});
