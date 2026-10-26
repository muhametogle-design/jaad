import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as NetInfo from 'expo-network';

import { AGING_DEFAULTS, MM_DEFAULTS, SMS_DEFAULTS } from '../config';
import { initDatabase } from '../db/database';
import { getSettings, type Settings } from '../db/settingsRepo';
import { processQueue } from '../integrations/mobileMoney';

interface AppContextValue {
  /** Database opened + migrated. */
  ready: boolean;
  /** Bump after any mutation; useAsync subscriptions re-run. */
  version: number;
  bump: () => void;
  /** Ticking clock (30s) driving the freshness/aging timers. */
  now: number;
  settings: Settings;
  refreshSettings: () => void;
  /** Items currently waiting in the offline outbox. */
  pendingCount: number;
  refreshPendingCount: () => void;
  /** Manually drain the outbox (Settings → Data). */
  runQueueNow: () => Promise<{ retried: number; ok: number; failed: number } | null>;
  online: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Config-derived defaults used before the settings table is readable. */
function fallbackSettings(): Settings {
  return {
    businessName: 'Jaad Khat Distribution',
    smsFromNote: 'Jaad',
    agingFreshHours: AGING_DEFAULTS.freshHours,
    agingAgingHours: AGING_DEFAULTS.agingHours,
    evcMode: MM_DEFAULTS.evc.mode,
    evcBaseUrl: MM_DEFAULTS.evc.baseUrl,
    evcMerchantId: '',
    evcApiKey: '',
    evcSecret: '',
    evcCallbackUrl: '',
    evcStkScheme: MM_DEFAULTS.evc.stkScheme,
    zaadMode: MM_DEFAULTS.zaad.mode,
    zaadBaseUrl: MM_DEFAULTS.zaad.baseUrl,
    zaadMerchantCode: '',
    zaadSecret: '',
    zaadStkScheme: MM_DEFAULTS.zaad.stkScheme,
    smsGatewayUrl: SMS_DEFAULTS.gatewayUrl,
    smsGatewayToken: SMS_DEFAULTS.gatewayToken,
  };
}

const DEFAULT_SETTINGS = fallbackSettings();

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  const queueRunning = useRef(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const refreshSettings = useCallback(() => setSettings(getSettings()), []);

  const refreshPendingCount = useCallback(() => {
    import('../db/repositories/syncQueueRepo')
      .then((m) => m.listPending())
      .then((items) => setPendingCount(items.length))
      .catch(() => setPendingCount(0));
  }, []);

  // 1 — bootstrap the local database (offline-first: no network needed).
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        initDatabase();
        setSettings(getSettings());
      } catch (e) {
        console.error('[jaad] database init failed', e);
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  // 2 — freshness clock: refresh aging badges every 30s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const runQueueNow = useCallback(async () => {
    if (queueRunning.current) return null;
    queueRunning.current = true;
    try {
      const res = await processQueue();
      refreshPendingCount();
      setVersion((v) => v + 1);
      return res;
    } finally {
      queueRunning.current = false;
    }
  }, [refreshPendingCount]);

  // 3 — connectivity watcher: drain the outbox when signal returns.
  useEffect(() => {
    if (!ready) return;
    refreshPendingCount();
    void runQueueNow();
    const sub = NetInfo.addNetworkStateListener((state) => {
      setOnline(Boolean(state.isConnected));
      if (state.isConnected) void runQueueNow();
    });
    return () => sub.remove();
  }, [ready, refreshPendingCount, runQueueNow]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      version,
      bump,
      now,
      settings,
      refreshSettings,
      pendingCount,
      refreshPendingCount,
      runQueueNow,
      online,
    }),
    [
      ready,
      version,
      bump,
      now,
      settings,
      refreshSettings,
      pendingCount,
      refreshPendingCount,
      runQueueNow,
      online,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
