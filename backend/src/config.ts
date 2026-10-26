import 'dotenv/config';

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  runMigrations: boolean;

  databaseUrl: string;
  dbPoolMax: number;
  dbSsl: boolean;

  telecomWebhookSecret: string;
  /** apiKey → deviceId map for POS terminal auth. */
  deviceKeys: Record<string, string>;

  evc: {
    baseUrl: string;
    merchantId: string;
    apiKey: string;
    secret: string;
    stkEndpoint: string;
    callbackUrl: string;
    configured: boolean;
  };
  zaad: {
    baseUrl: string;
    merchantCode: string;
    secret: string;
    stkEndpoint: string;
    callbackUrl: string;
    configured: boolean;
  };

  sms: {
    provider: 'africastalking' | 'telesom' | 'hormuud' | 'disabled';
    businessName: string;
    at: { apiKey: string; username: string; from: string; baseUrl: string };
    telesom: { url: string; token: string; sender: string };
    hormuud: { url: string; token: string };
  };
}

function deviceKeyMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const id = pair.slice(idx + 1).trim();
    if (key && id) map[key] = id;
  }
  return map;
}

export function loadConfig(): Config {
  const evc = {
    baseUrl: str('EVC_API_BASE_URL', 'https://api.evcplus.com').replace(/\/$/, ''),
    merchantId: str('EVC_MERCHANT_ID'),
    apiKey: str('EVC_API_KEY'),
    secret: str('EVC_SECRET'),
    stkEndpoint: str('EVC_STK_ENDPOINT', '/merchant/stk/push'),
    callbackUrl: str('EVC_CALLBACK_URL'),
    configured: false,
  };
  evc.configured = Boolean(evc.apiKey && evc.secret);

  const zaad = {
    baseUrl: str('ZAAD_API_BASE_URL', 'https://api.zaad.com').replace(/\/$/, ''),
    merchantCode: str('ZAAD_MERCHANT_CODE'),
    secret: str('ZAAD_SECRET'),
    stkEndpoint: str('ZAAD_STK_ENDPOINT', '/api/merchant/stk'),
    callbackUrl: str('ZAAD_CALLBACK_URL'),
    configured: false,
  };
  zaad.configured = Boolean(zaad.merchantCode && zaad.secret);

  const rawProvider = str('SMS_PROVIDER', 'africastalking').toLowerCase();
  const provider = (['africastalking', 'telesom', 'hormuud', 'disabled'] as const).includes(
    rawProvider as 'africastalking',
  )
    ? (rawProvider as Config['sms']['provider'])
    : 'disabled';

  return {
    nodeEnv: (str('NODE_ENV', 'development') as Config['nodeEnv']),
    port: num('PORT', 8080),
    logLevel: str('LOG_LEVEL', 'info'),
    runMigrations: bool('RUN_MIGRATIONS', str('NODE_ENV') !== 'production'),

    databaseUrl: str('DATABASE_URL', 'postgres://jaad:jaad@localhost:5432/jaad'),
    dbPoolMax: num('DB_POOL_MAX', 10),
    dbSsl: bool('DB_SSL', false),

    telecomWebhookSecret: str('TELECOM_WEBHOOK_SECRET'),
    deviceKeys: deviceKeyMap(str('DEVICE_API_KEYS')),

    evc,
    zaad,

    sms: {
      provider,
      businessName: str('SMS_BUSINESS_NAME', 'KhatHub'),
      at: {
        apiKey: str('AT_API_KEY'),
        username: str('AT_USERNAME'),
        from: str('AT_FROM', 'KhatHub'),
        baseUrl: str('AT_API_BASE_URL', 'https://api.africastalking.com/version1'),
      },
      telesom: {
        url: str('TELESOM_SMS_URL'),
        token: str('TELESOM_SMS_TOKEN'),
        sender: str('TELESOM_SMS_SENDER', 'JAAD'),
      },
      hormuud: {
        url: str('HORMUUD_SMS_URL'),
        token: str('HORMUUD_SMS_TOKEN'),
      },
    },
  };
}

/** Process-wide config (loaded once). */
export const config = loadConfig();
