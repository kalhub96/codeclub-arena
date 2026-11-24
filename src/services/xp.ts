export const MAX_ATTEMPTS = 3;
export const MAX_HINTS = 3;

/** XP multiplier by which attempt got it right (1-based). */
export const ATTEMPT_MULT = [1, 0.6, 0.3] as const;
/** XP penalty by number of hints used (0..3). */
export const HINT_PENALTY = [0, 0.1, 0.2, 0.4] as const;

export function awardXp(opts: { base: number; attempt: number; hintsUsed: number }): number {
  const { base, attempt, hintsUsed } = opts;
  if (attempt < 1 || attempt > MAX_ATTEMPTS) return 0;
  const mult = ATTEMPT_MULT[attempt - 1]!;
  const penalty = HINT_PENALTY[Math.min(Math.max(hintsUsed, 0), MAX_HINTS)]!;
  return Math.max(1, Math.round(base * mult * (1 - penalty)));
}

/** Default reward when a question does not specify one. */
export const defaultReward = (difficulty: number) => 10 * difficulty;
