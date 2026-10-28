import { getDb } from './database';
import { AGING_DEFAULTS, MM_DEFAULTS, SMS_DEFAULTS } from '../config';

export interface Settings {
  businessName: string;
  smsFromNote: string;

  agingFreshHours: number;
  agingAgingHours: number;

  evcMode: 'simulated' | 'live';
  evcBaseUrl: string;
  evcMerchantId: string;
  evcApiKey: string;
  evcSecret: string;
  evcCallbackUrl: string;
  evcStkScheme: string;

  zaadMode: 'simulated' | 'live';
  zaadBaseUrl: string;
  zaadMerchantCode: string;
  zaadSecret: string;
  zaadStkScheme: string;

  smsGatewayUrl: string;
  smsGatewayToken: string;
}

const DEFAULTS: Settings = {
  businessName: 'Jaad Khat Distribution',
  smsFromNote: 'Jaad',
  agingFreshHours: AGING_DEFAULTS.freshHours,
  agingAgingHours: AGING_DEFAULTS.agingHours,
  evcMode: MM_DEFAULTS.evc.mode,
  evcBaseUrl: MM_DEFAULTS.evc.baseUrl,
  evcMerchantId: MM_DEFAULTS.evc.merchantId,
  evcApiKey: MM_DEFAULTS.evc.apiKey,
  evcSecret: MM_DEFAULTS.evc.secret,
  evcCallbackUrl: MM_DEFAULTS.evc.callbackUrl,
  evcStkScheme: MM_DEFAULTS.evc.stkScheme,
  zaadMode: MM_DEFAULTS.zaad.mode,
  zaadBaseUrl: MM_DEFAULTS.zaad.baseUrl,
  zaadMerchantCode: MM_DEFAULTS.zaad.merchantCode,
  zaadSecret: MM_DEFAULTS.zaad.secret,
  zaadStkScheme: MM_DEFAULTS.zaad.stkScheme,
  smsGatewayUrl: SMS_DEFAULTS.gatewayUrl,
  smsGatewayToken: SMS_DEFAULTS.gatewayToken,
};

const KEY_MAP: Record<keyof Settings, string> = {
  businessName: 'business.name',
  smsFromNote: 'business.sms_note',
  agingFreshHours: 'aging.fresh_hours',
  agingAgingHours: 'aging.aging_hours',
  evcMode: 'mm.evc.mode',
  evcBaseUrl: 'mm.evc.base_url',
  evcMerchantId: 'mm.evc.merchant_id',
  evcApiKey: 'mm.evc.api_key',
  evcSecret: 'mm.evc.secret',
  evcCallbackUrl: 'mm.evc.callback_url',
  evcStkScheme: 'mm.evc.stk_scheme',
  zaadMode: 'mm.zaad.mode',
  zaadBaseUrl: 'mm.zaad.base_url',
  zaadMerchantCode: 'mm.zaad.merchant_code',
  zaadSecret: 'mm.zaad.secret',
  zaadStkScheme: 'mm.zaad.stk_scheme',
  smsGatewayUrl: 'sms.gateway_url',
  smsGatewayToken: 'sms.gateway_token',
};

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.getAllSync<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${Object.values(KEY_MAP)
      .map(() => '?')
      .join(',')})`,
    Object.values(KEY_MAP),
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const get = (k: keyof Settings): string => KEY_MAP[k] in map ? map[KEY_MAP[k]] : '';
  const num = (k: keyof Settings, fallback: number): number => {
    const v = parseFloat(get(k));
    return Number.isFinite(v) ? v : fallback;
  };

  return {
    businessName: get('businessName') || DEFAULTS.businessName,
    smsFromNote: get('smsFromNote') || DEFAULTS.smsFromNote,
    agingFreshHours: num('agingFreshHours', DEFAULTS.agingFreshHours),
    agingAgingHours: num('agingAgingHours', DEFAULTS.agingAgingHours),
    evcMode: get('evcMode') === 'live' ? 'live' : 'simulated',
    evcBaseUrl: get('evcBaseUrl') || DEFAULTS.evcBaseUrl,
    evcMerchantId: get('evcMerchantId'),
    evcApiKey: get('evcApiKey'),
    evcSecret: get('evcSecret'),
    evcCallbackUrl: get('evcCallbackUrl'),
    evcStkScheme: get('evcStkScheme') || DEFAULTS.evcStkScheme,
    zaadMode: get('zaadMode') === 'live' ? 'live' : 'simulated',
    zaadBaseUrl: get('zaadBaseUrl') || DEFAULTS.zaadBaseUrl,
    zaadMerchantCode: get('zaadMerchantCode'),
    zaadSecret: get('zaadSecret'),
    zaadStkScheme: get('zaadStkScheme') || DEFAULTS.zaadStkScheme,
    smsGatewayUrl: get('smsGatewayUrl'),
    smsGatewayToken: get('smsGatewayToken'),
  };
}

export function saveSettings(patch: Partial<Settings>): void {
  const db = getDb();
  db.withTransactionSync(() => {
    for (const key of Object.keys(patch) as Array<keyof Settings>) {
      const value = patch[key];
      if (value === undefined) continue;
      const v = typeof value === 'number' ? String(value) : String(value);
      db.runSync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [KEY_MAP[key], v],
      );
    }
  });
}
