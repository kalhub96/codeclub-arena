import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../src/auth/initData.js';
import { badgeForXp, levelForXp, tierForXp, xpToNextBadge } from '../src/services/badges.js';
import { canUse } from '../src/services/access.js';
import { awardXp } from '../src/services/xp.js';
import { canSee } from '../src/db/visibility.js';
import { seededShuffle } from '../src/util.js';

describe('badges', () => {
  it('maps XP to tiers at the boundaries', () => {
    expect(badgeForXp(0)).toBe('Bronze');
    expect(badgeForXp(499)).toBe('Bronze');
    expect(badgeForXp(500)).toBe('Silver');
    expect(badgeForXp(1500)).toBe('Gold');
    expect(badgeForXp(3500)).toBe('Platinum');
    expect(badgeForXp(7000)).toBe('Diamond');
    expect(badgeForXp(12000)).toBe('Adamantium');
    expect(badgeForXp(999999)).toBe('Adamantium');
  });
  it('computes level, tier and remaining XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(250)).toBe(3);
    expect(tierForXp(0)).toBe(1);
    expect(tierForXp(12000)).toBe(6);
    expect(xpToNextBadge(420)).toEqual({ next: 'Silver', remaining: 80 });
    expect(xpToNextBadge(12000)).toBeNull();
  });
  it('gates features by badge', () => {
    expect(canUse({ badge: 'Silver' }, 'duel')).toBe(false);
    expect(canUse({ badge: 'Gold' }, 'duel')).toBe(true);
    expect(canUse({ badge: 'Bronze' }, 'lobby')).toBe(false);
  });
});

describe('xp', () => {
  it('reduces XP by attempt and hints', () => {
    expect(awardXp({ base: 100, attempt: 1, hintsUsed: 0 })).toBe(100);
    expect(awardXp({ base: 100, attempt: 2, hintsUsed: 0 })).toBe(60);
    expect(awardXp({ base: 100, attempt: 3, hintsUsed: 0 })).toBe(30);
    expect(awardXp({ base: 100, attempt: 1, hintsUsed: 3 })).toBe(60);
    expect(awardXp({ base: 100, attempt: 3, hintsUsed: 3 })).toBe(18);
  });
  it('never awards less than 1 XP for a correct answer and 0 beyond max attempts', () => {
    expect(awardXp({ base: 1, attempt: 3, hintsUsed: 3 })).toBe(1);
    expect(awardXp({ base: 100, attempt: 4, hintsUsed: 0 })).toBe(0);
  });
});

describe('gender visibility', () => {
  it('only lets same-gender students see each other', () => {
    expect(canSee({ id: 1, gender: 'male' }, { gender: 'male' })).toBe(true);
    expect(canSee({ id: 1, gender: 'male' }, { gender: 'female' })).toBe(false);
    expect(canSee({ id: 2, gender: 'female' }, { gender: 'male' })).toBe(false);
  });
});

describe('initData verification', () => {
  const botToken = '123456:TEST_TOKEN';
  const sign = (fields: Record<string, string>) => {
    const dcs = Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
  };
  const now = Date.now();
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 42, username: 'sara' }) };

  it('accepts a correctly signed payload', () => {
    expect(verifyInitData(sign(fields), botToken, 86400, now)).toEqual({ id: 42, username: 'sara', firstName: undefined });
  });
  it('rejects tampered payloads', () => {
    const good = sign(fields);
    const tampered = good.replace('%22id%22%3A42', '%22id%22%3A43');
    expect(verifyInitData(tampered, botToken, 86400, now)).toBeNull();
  });
  it('rejects wrong bot token and expired data', () => {
    expect(verifyInitData(sign(fields), '999:OTHER', 86400, now)).toBeNull();
    expect(verifyInitData(sign(fields), botToken, 86400, now + 2 * 86_400_000)).toBeNull();
  });
});

describe('seededShuffle', () => {
  it('is deterministic and a permutation', () => {
    const a = seededShuffle([0, 1, 2, 3], 7);
    expect(seededShuffle([0, 1, 2, 3], 7)).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
  });
});
