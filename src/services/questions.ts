import { and, desc, eq, gt, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  badgesLog,
  languages,
  questions,
  studentLanguageProgress as slp,
  students,
  submissions,
  type Question,
  type Student,
  type Submission,
} from '../db/schema.js';
import { todayStr, yesterdayStr } from '../util.js';
import { badgeForXp, levelForXp, tierForXp } from './badges.js';
import { awardXp, HINT_PENALTY, MAX_ATTEMPTS, MAX_HINTS } from './xp.js';

export async function getLanguageXp(studentId: number, languageId: number): Promise<number> {
  const [row] = await db
    .select({ xp: slp.xp })
    .from(slp)
    .where(and(eq(slp.studentId, studentId), eq(slp.languageId, languageId)));
  return row?.xp ?? 0;
}

export async function getQuestion(id: number): Promise<Question | null> {
  const [q] = await db.select().from(questions).where(eq(questions.id, id));
  return q ?? null;
}

/**
 * Returns the student's unfinished question in this language, or picks a new unseen one.
 * Difficulty follows the student's XP in THAT language; falls back to lower, then higher tiers
 * so a student is never stuck on an empty slot.
 */
export async function nextQuestion(
  student: Pick<Student, 'id'>,
  languageId: number,
): Promise<{ question: Question; submission: Submission } | null> {
  const [open] = await db
    .select({ q: questions, s: submissions })
    .from(submissions)
    .innerJoin(questions, eq(submissions.questionId, questions.id))
    .where(
      and(
        eq(submissions.studentId, student.id),
        isNull(submissions.solvedAt),
        eq(questions.languageId, languageId),
        eq(questions.status, 'approved'),
      ),
    )
    .limit(1);
  if (open) return { question: open.q, submission: open.s };

  const tier = tierForXp(await getLanguageXp(student.id, languageId));
  const seen = db.select({ id: submissions.questionId }).from(submissions).where(eq(submissions.studentId, student.id));
  const pool = and(eq(questions.languageId, languageId), eq(questions.status, 'approved'), notInArray(questions.id, seen));

  let [q] = await db.select().from(questions).where(and(pool, eq(questions.difficulty, tier))).orderBy(sql`random()`).limit(1);
  if (!q) {
    [q] = await db
      .select()
      .from(questions)
      .where(and(pool, lte(questions.difficulty, tier)))
      .orderBy(desc(questions.difficulty), sql`random()`)
      .limit(1);
  }
  if (!q) {
    [q] = await db
      .select()
      .from(questions)
      .where(and(pool, gt(questions.difficulty, tier)))
      .orderBy(questions.difficulty, sql`random()`)
      .limit(1);
  }
  if (!q) return null;

  await db
    .insert(submissions)
    .values({ studentId: student.id, questionId: q.id, questionVersion: q.version })
    .onConflictDoNothing();
  const [s] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.studentId, student.id), eq(submissions.questionId, q.id)));
  return s ? { question: q, submission: s } : null;
}

export type AnswerResult =
  | { kind: 'missing' }
  | { kind: 'already_done' }
  | { kind: 'retry'; attemptsLeft: number }
  | {
      kind: 'done';
      correct: boolean;
      xpGain: number;
      attempt: number;
      question: Question;
      newGlobalXp: number;
      levelBefore: number;
      levelAfter: number;
      languageId: number;
      languageXp: number;
      oldBadge: string;
      newBadge: string;
      badgeUp: boolean;
      streak: number;
    };

/** Grades one answer. Atomic: attempts, XP, badge, streak all commit together. */
export async function answerQuestion(student: Student, questionId: number, choiceIdx: number): Promise<AnswerResult> {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(questions).where(eq(questions.id, questionId));
    if (!q) return { kind: 'missing' } as const;

    // Atomic attempt increment: a double-tap can't award twice, and a finalized row is untouched.
    const [sub] = await tx
      .update(submissions)
      .set({ attempts: sql`${submissions.attempts} + 1` })
      .where(and(eq(submissions.studentId, student.id), eq(submissions.questionId, questionId), isNull(submissions.solvedAt)))
      .returning();
    if (!sub) return { kind: 'already_done' } as const;

    const picked = q.options[choiceIdx];
    const correct = picked !== undefined && picked === q.answerKey;
    const finalized = correct || sub.attempts >= MAX_ATTEMPTS;
    if (!finalized) return { kind: 'retry', attemptsLeft: MAX_ATTEMPTS - sub.attempts } as const;

    const xpGain = correct ? awardXp({ base: q.xpReward, attempt: sub.attempts, hintsUsed: sub.hintsUsed }) : 0;
    await tx
      .update(submissions)
      .set({ solvedAt: new Date(), isCorrect: correct, xpAwarded: xpGain, questionVersion: q.version })
      .where(eq(submissions.id, sub.id));

    let newGlobalXp = student.xp;
    let languageXp = 0;
    let newBadge = student.badge;
    let streak = student.streak;

    if (correct) {
      const today = todayStr();
      if (student.lastActiveDate !== today) {
        streak = student.lastActiveDate === yesterdayStr() ? student.streak + 1 : 1;
      }
      const [updated] = await tx
        .update(students)
        .set({ xp: sql`${students.xp} + ${xpGain}`, streak, lastActiveDate: today })
        .where(eq(students.id, student.id))
        .returning({ xp: students.xp });
      newGlobalXp = updated?.xp ?? student.xp + xpGain;

      const [lp] = await tx
        .insert(slp)
        .values({ studentId: student.id, languageId: q.languageId, xp: xpGain })
        .onConflictDoUpdate({ target: [slp.studentId, slp.languageId], set: { xp: sql`${slp.xp} + ${xpGain}` } })
        .returning({ xp: slp.xp });
      languageXp = lp?.xp ?? xpGain;

      newBadge = badgeForXp(newGlobalXp);
      if (newBadge !== student.badge) {
        await tx.update(students).set({ badge: newBadge }).where(eq(students.id, student.id));
        await tx.insert(badgesLog).values({ studentId: student.id, badge: newBadge });
      }
    } else {
      const [lp] = await tx
        .select({ xp: slp.xp })
        .from(slp)
        .where(and(eq(slp.studentId, student.id), eq(slp.languageId, q.languageId)));
      languageXp = lp?.xp ?? 0;
    }

    return {
      kind: 'done',
      correct,
      xpGain,
      attempt: sub.attempts,
      question: q,
      newGlobalXp,
      levelBefore: levelForXp(student.xp),
      levelAfter: levelForXp(newGlobalXp),
      languageId: q.languageId,
      languageXp,
      oldBadge: student.badge,
      newBadge,
      badgeUp: newBadge !== student.badge,
      streak,
    } as const;
  });
}

/** Reveals the next hint; XP penalty is applied server-side at grading time. */
export async function useHint(studentId: number, questionId: number) {
  const q = await getQuestion(questionId);
  if (!q) return { kind: 'missing' as const };
  const maxHints = Math.min(MAX_HINTS, q.hints.length);
  if (maxHints === 0) return { kind: 'none' as const };

  const [sub] = await db
    .update(submissions)
    .set({ hintsUsed: sql`${submissions.hintsUsed} + 1` })
    .where(
      and(
        eq(submissions.studentId, studentId),
        eq(submissions.questionId, questionId),
        isNull(submissions.solvedAt),
        sql`${submissions.hintsUsed} < ${maxHints}`,
      ),
    )
    .returning();
  if (!sub) return { kind: 'exhausted' as const };
  return {
    kind: 'ok' as const,
    number: sub.hintsUsed,
    total: maxHints,
    text: q.hints[sub.hintsUsed - 1] ?? '',
    penaltyPct: Math.round(HINT_PENALTY[Math.min(sub.hintsUsed, MAX_HINTS)]! * 100),
  };
}

export async function listLanguages() {
  return db.select().from(languages).orderBy(languages.trackId, languages.orderNo);
}
