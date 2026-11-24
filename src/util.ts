import { config } from './config.js';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** YYYY-MM-DD in the club's timezone. */
export const todayStr = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: config.TIMEZONE });

export const yesterdayStr = (d = new Date()) => todayStr(new Date(d.getTime() - 86_400_000));

/** Deterministic shuffle so a student sees a stable option order for a question. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** In-memory per-user cooldown (MVP; swap for Redis if you run >1 replica). */
const last = new Map<number, number>();
export function cooldown(userId: number, ms: number): boolean {
  const now = Date.now();
  const prev = last.get(userId) ?? 0;
  if (now - prev < ms) return false;
  last.set(userId, now);
  return true;
}
