import { badgeRank } from './badges.js';

// Feature gates (multiplayer lands in phase 3; the gate is ready now).
export const FEATURE_MIN_BADGE = {
  lobby: 'Silver',
  duel: 'Gold',
  ranked: 'Platinum',
  boss: 'Diamond',
  hosted: 'Adamantium',
} as const;

export type Feature = keyof typeof FEATURE_MIN_BADGE;

export const canUse = (student: { badge: string }, feature: Feature): boolean =>
  badgeRank(student.badge) >= badgeRank(FEATURE_MIN_BADGE[feature]);
