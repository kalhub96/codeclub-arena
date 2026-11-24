// Pure progression logic. Thresholds live here in one place.
export const BADGES = [
  { name: 'Bronze', minXp: 0, emoji: '🥉' },
  { name: 'Silver', minXp: 500, emoji: '🥈' },
  { name: 'Gold', minXp: 1500, emoji: '🥇' },
  { name: 'Platinum', minXp: 3500, emoji: '💠' },
  { name: 'Diamond', minXp: 7000, emoji: '💎' },
  { name: 'Adamantium', minXp: 12000, emoji: '🟣' },
] as const;

export type BadgeName = (typeof BADGES)[number]['name'];

export const badgeForXp = (xp: number): BadgeName => {
  let current: BadgeName = BADGES[0].name;
  for (const b of BADGES) if (xp >= b.minXp) current = b.name;
  return current;
};

export const badgeRank = (name: string): number => BADGES.findIndex((b) => b.name === name);

export const badgeEmoji = (name: string): string => BADGES.find((b) => b.name === name)?.emoji ?? '';

/** Difficulty tier 1..6 used to pick question difficulty from XP. */
export const tierForXp = (xp: number): number => badgeRank(badgeForXp(xp)) + 1;

export const levelForXp = (xp: number): number => Math.floor(Math.max(0, xp) / 100) + 1;

/** XP left until the next badge, or null at max tier. */
export const xpToNextBadge = (xp: number): { next: BadgeName; remaining: number } | null => {
  const next = BADGES.find((b) => b.minXp > xp);
  return next ? { next: next.name, remaining: next.minXp - xp } : null;
};

export const progressBar = (value: number, size = 10): string => {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
};

/** Fraction (0..1) of the way through the current badge band. */
export const badgeBandProgress = (xp: number): number => {
  const idx = badgeRank(badgeForXp(xp));
  const cur = BADGES[idx]!;
  const next = BADGES[idx + 1];
  if (!next) return 1;
  return (xp - cur.minXp) / (next.minXp - cur.minXp);
};
