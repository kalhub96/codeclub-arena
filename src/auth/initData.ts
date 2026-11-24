import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = { id: number; username?: string; firstName?: string };

/**
 * Verifies Telegram Mini App `initData` (HMAC-SHA256 with key derived from the bot token).
 * Returns the verified user, or null. Identity must ONLY come from here, never from form input.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86_400,
  nowMs = Date.now(),
): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (calc.length !== given.length || !timingSafeEqual(calc, given)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec) return null;

  try {
    const u = JSON.parse(params.get('user') ?? 'null') as { id?: number; username?: string; first_name?: string } | null;
    if (!u || typeof u.id !== 'number') return null;
    return { id: u.id, username: u.username, firstName: u.first_name };
  } catch {
    return null;
  }
}
