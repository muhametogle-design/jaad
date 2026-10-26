/**
 * Global app configuration.
 *
 * Values here are compile-time defaults. Anything the warehouse manager may
 * tweak at runtime (prices, thresholds, provider credentials) lives in the
 * local SQLite `settings` table and is read through `src/db/settingsRepo.ts`.
 */

export const APP = {
  name: 'Jaad',
  subtitle: 'Khat Distribution OS',
  version: '1.0.0',
};

/** Currency used across the business (Somali Shilling). */
export const CURRENCY = 'So';

/**
 * Freshness thresholds (hours since flight landing).
 * - fresh:  age <  freshHours
 * - aging:  freshHours <= age <= agingHours
 * - stale:  age >  agingHours  (rotate / discount / discard)
 * Overridable at runtime in Settings → Freshness.
 */
export const AGING_DEFAULTS = {
  freshHours: 12,
  agingHours: 24,
};

/**
 * Default khat varieties seeded on first launch.
 * `cogs` is the baseline landing cost per KG (purchase price paid to the
 * supplier) used when a batch does not override it.
 */
export const DEFAULT_TYPES = [
  { name: 'Miro', cogs: 11_000, sell: 22_000 },
  { name: 'Jebis', cogs: 8_000, sell: 16_000 },
] as const;

/** Mobile Money provider defaults (simulated mode by default — see ARCHITECTURE.md §7). */
export const MM_DEFAULTS = {
  evc: {
    mode: 'simulated' as 'simulated' | 'live',
    baseUrl: 'https://api.evcplus.com',
    merchantId: '',
    apiKey: '',
    secret: '',
    callbackUrl: '',
    /** Deep-link scheme that opens the EVC Plus STK prompt on the buyer's phone. */
    stkScheme: 'evcstk://',
  },
  zaad: {
    mode: 'simulated' as 'simulated' | 'live',
    baseUrl: 'https://api.zaad.com',
    merchantCode: '',
    secret: '',
    stkScheme: 'zaad://',
  },
};

export const SMS_DEFAULTS = {
  /** Optional outbound SMS gateway (Twilio-style). Empty = use the device SMS app. */
  gatewayUrl: '',
  gatewayToken: '',
};
