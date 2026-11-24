import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { languages, studentLanguageProgress as slp, students, submissions } from '../db/schema.js';
import { visibleGroup, visiblePeers } from '../db/visibility.js';

type Me = { id: number; gender: 'male' | 'female' };

/** Anonymous totals only (no identities), so they may span both genders. */
export async function aheadBehind(languageId: number, myLanguageXp: number) {
  const base = and(eq(slp.languageId, languageId), eq(students.status, 'active'));
  const [a] = await db
    .select({ n: count() })
    .from(slp)
    .innerJoin(students, eq(students.id, slp.studentId))
    .where(and(base, gt(slp.xp, myLanguageXp)));
  const [b] = await db
    .select({ n: count() })
    .from(slp)
    .innerJoin(students, eq(students.id, slp.studentId))
    .where(and(base, lt(slp.xp, myLanguageXp)));
  return { ahead: a?.n ?? 0, behind: b?.n ?? 0 };
}

export async function solvedCount(questionId: number) {
  const [r] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.questionId, questionId), eq(submissions.isCorrect, true)));
  return r?.n ?? 0;
}

export const peerLabel = (s: { fullName: string; batchYear: number; privacyShowName: boolean }) =>
  `${s.privacyShowName ? s.fullName : 'Anonymous'} · Batch ${s.batchYear}`;

/** Same-gender leaderboard (includes the viewer). */
export async function leaderboard(me: Me, limit = 10) {
  return db
    .select({
      id: students.id,
      fullName: students.fullName,
      batchYear: students.batchYear,
      privacyShowName: students.privacyShowName,
      badge: students.badge,
      xp: students.xp,
    })
    .from(students)
    .where(visibleGroup(me))
    .orderBy(desc(students.xp))
    .limit(limit);
}

/** My position among students of my own group (anonymous totals, no identities). */
export async function myRank(me: Me & { xp: number }) {
  const [above] = await db.select({ n: count() }).from(students).where(and(visibleGroup(me), gt(students.xp, me.xp)));
  const [total] = await db.select({ n: count() }).from(students).where(visibleGroup(me));
  return { rank: (above?.n ?? 0) + 1, size: total?.n ?? 1 };
}

/** Same-gender peers who are behind me in a language. */
export async function peersBehind(me: Me, languageId: number, myLanguageXp: number, limit = 10) {
  return db
    .select({
      fullName: students.fullName,
      batchYear: students.batchYear,
      privacyShowName: students.privacyShowName,
      badge: students.badge,
      languageXp: slp.xp,
    })
    .from(slp)
    .innerJoin(students, eq(students.id, slp.studentId))
    .where(and(eq(slp.languageId, languageId), lt(slp.xp, myLanguageXp), visiblePeers(me)))
    .orderBy(desc(slp.xp))
    .limit(limit);
}

export async function myLanguageLevels(studentId: number) {
  return db
    .select({ name: languages.name, xp: slp.xp })
    .from(slp)
    .innerJoin(languages, eq(languages.id, slp.languageId))
    .where(eq(slp.studentId, studentId))
    .orderBy(desc(slp.xp));
}
