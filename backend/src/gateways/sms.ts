import { config } from '../config.js';
import { logger } from '../logger.js';

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  message?: string;
}

/**
 * SMS receipt gateway. Providers:
 *  - africastalking (default) — Africa's Talking Messaging v1 API
 *  - telesom          — Telesom bulk SMS HTTP gateway
 *  - hormuud          — local Hormuud bulk SMS endpoint
 *  - disabled         — log-only (dev/test)
 *
 * All providers POST to an HTTPS endpoint with a bearer/token header;
 * message content is UTF-8.
 */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const p = config.sms;
  switch (p.provider) {
    case 'africastalking':
      return sendAfricaTalking(to, message);
    case 'telesom':
      return sendTelesom(to, message);
    case 'hormuud':
      return sendHormuud(to, message);
    case 'disabled':
      logger.info({ to, message }, 'SMS disabled in config — message not sent');
      return { ok: false, message: 'SMS provider disabled' };
    default:
      return { ok: false, message: 'Unknown SMS provider' };
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  what: string,
): Promise<SmsResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const json = (safeJson(text) ?? {}) as Record<string, any>;
    if (!res.ok) {
      logger.warn({ what, status: res.status, body: text.slice(0, 300) }, 'SMS gateway error');
      return { ok: false, message: `${what} gateway error ${res.status}` };
    }
    const messageId =
      json.message_id ?? json.messageId ?? json.messageStatus?.messageId ?? json.id ?? undefined;
    return { ok: true, messageId: typeof messageId === 'string' ? messageId : undefined };
  } catch (err) {
    logger.error({ err, what }, 'SMS gateway request failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function sendAfricaTalking(to: string, message: string): Promise<SmsResult> {
  const at = config.sms.at;
  if (!at.apiKey || !at.username) {
    logger.warn('Africa’s Talking configured but missing credentials');
    return Promise.resolve({ ok: false, message: 'Africa’s Talking credentials missing' });
  }
  return postJson(
    `${at.baseUrl}/messaging`,
    { username: at.username, to: to.replace(/[^\d+]/g, ''), message, fromNumber: at.from || undefined },
    { apiKey: at.apiKey },
    'AfricaTalking',
  );
}

function sendTelesom(to: string, message: string): Promise<SmsResult> {
  const t = config.sms.telesom;
  if (!t.url || !t.token) {
    logger.warn('Telesom SMS configured but missing url/token');
    return Promise.resolve({ ok: false, message: 'Telesom SMS credentials missing' });
  }
  return postJson(
    t.url,
    { destination: to.replace(/[^\d+]/g, ''), text: message, sender: t.sender },
    { Authorization: `Bearer ${t.token}` },
    'TelesomSMS',
  );
}

function sendHormuud(to: string, message: string): Promise<SmsResult> {
  const h = config.sms.hormuud;
  if (!h.url || !h.token) {
    logger.warn('Hormuud SMS configured but missing url/token');
    return Promise.resolve({ ok: false, message: 'Hormuud SMS credentials missing' });
  }
  return postJson(
    h.url,
    { to: to.replace(/[^\d+]/g, ''), body: message },
    { Authorization: `Bearer ${h.token}` },
    'HormuudSMS',
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
