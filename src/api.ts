import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyInitData } from './auth/initData.js';
import { config } from './config.js';
import { db } from './db/client.js';
import { languages, questions, students, tracks, type Student } from './db/schema.js';
import { canUse, FEATURE_MIN_BADGE, type Feature } from './services/access.js';
import { BADGES, badgeBandProgress, badgeForXp, levelForXp, xpToNextBadge } from './services/badges.js';
import { answerQuestion, getLanguageXp, getQuestion, nextQuestion, useHint } from './services/questions.js';
import { aheadBehind, leaderboard, myLanguageLevels, myRank, peersBehind, solvedCount } from './services/stats.js';
import {
  correctCount,
  describeResult,
  friendPromptDue,
  incomingCount,
  notifyAfterRequest,
  notifyAfterRespond,
  overview,
  removeFriend,
  respond,
  sendRequest,
  suggestions,
  type Notify,
} from './services/friends.js';
import { cooldown, seededShuffle } from './util.js';

declare module 'fastify' {
  interface FastifyRequest {
    student?: Student;
  }
}

const FEATURE_LABEL: Record<Feature, string> = {
  lobby: 'Multiplayer lobby',
  duel: 'Quiz duels',
  ranked: 'Ranked ladder',
  boss: 'Team boss',
  hosted: 'Hosted rooms',
};

const badgeMinXp = (name: string) => BADGES.find((b) => b.name === name)?.minXp ?? 0;
const featureKeys = Object.keys(FEATURE_MIN_BADGE) as Feature[];

async function mePayload(s: Student) {
  const langs = await myLanguageLevels(s.id);
  let active: { id: number; name: string; xp: number } | null = null;
  if (s.activeLanguageId) {
    const [l] = await db.select().from(languages).where(eq(languages.id, s.activeLanguageId));
    if (l) active = { id: l.id, name: l.name, xp: await getLanguageXp(s.id, l.id) };
  }
  return {
    name: s.fullName,
    batchYear: s.batchYear,
    badge: s.badge,
    xp: s.xp,
    level: levelForXp(s.xp),
    band: badgeBandProgress(s.xp),
    next: xpToNextBadge(s.xp),
    streak: s.streak,
    incomingFriends: await incomingCount(s),
    privacy: { showName: s.privacyShowName, allowDm: s.privacyAllowDm },
    active,
    languages: langs.map((l) => ({ name: l.name, xp: l.xp, badge: badgeForXp(l.xp), level: levelForXp(l.xp) })),
    badges: BADGES.map((b) => ({ name: b.name, minXp: b.minXp })),
    features: featureKeys.map((k) => ({
      key: k,
      label: FEATURE_LABEL[k],
      minBadge: FEATURE_MIN_BADGE[k],
      unlocked: canUse(s, k),
      xpToUnlock: Math.max(0, badgeMinXp(FEATURE_MIN_BADGE[k]) - s.xp),
    })),
  };
}

const bad = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error = 'bad_request') => reply.code(400).send({ error });

/**
 * Mini App API. Every request carries Telegram-signed initData in the Authorization header
 * ("tma <initData>"); identity is verified on each call. Every endpoint that returns other
 * people goes through the gender rule in services/stats.ts (visiblePeers / visibleGroup).
 */
export async function registerApi(app: FastifyInstance, notify: Notify) {
  await app.register(
    async (api) => {
      api.addHook('preHandler', async (req, reply) => {
        const header = req.headers.authorization ?? '';
        if (!header.startsWith('tma ')) return reply.code(401).send({ error: 'unauthorized' });
        const user = verifyInitData(header.slice(4), config.BOT_TOKEN);
        if (!user) return reply.code(401).send({ error: 'unauthorized' });
        const [s] = await db.select().from(students).where(eq(students.telegramId, user.id));
        if (!s) return reply.code(403).send({ error: 'not_registered' });
        if (s.status === 'banned') return reply.code(403).send({ error: 'banned' });
        if (s.status === 'pending') return reply.code(403).send({ error: 'pending' });
        req.student = s;
      });

      api.get('/me', async (req) => mePayload(req.student!));

      api.get('/catalog', async (req) => {
        const s = req.student!;
        const trs = await db.select().from(tracks).orderBy(tracks.id);
        const langs = await db.select().from(languages).orderBy(languages.trackId, languages.orderNo);
        const mine = new Map((await myLanguageLevels(s.id)).map((l) => [l.name, l.xp]));
        const pools = await db
          .select({ languageId: questions.languageId, n: count() })
          .from(questions)
          .where(eq(questions.status, 'approved'))
          .groupBy(questions.languageId);
        const poolOf = new Map(pools.map((p) => [p.languageId, p.n]));
        return {
          tracks: trs.map((t) => ({
            id: t.id,
            name: t.name,
            languages: langs
              .filter((l) => l.trackId === t.id)
              .map((l) => {
                const xp = mine.get(l.name) ?? 0;
                return { id: l.id, name: l.name, xp, level: levelForXp(xp), badge: badgeForXp(xp), questions: poolOf.get(l.id) ?? 0 };
              }),
          })),
        };
      });

      api.post('/context', async (req, reply) => {
        const body = z.object({ languageId: z.number().int() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        const [lang] = await db.select().from(languages).where(eq(languages.id, body.data.languageId));
        if (!lang) return reply.code(404).send({ error: 'unknown_language' });
        await db.update(students).set({ activeLanguageId: lang.id }).where(eq(students.id, req.student!.id));
        return { ok: true, language: { id: lang.id, name: lang.name } };
      });

      api.get('/question', async (req) => {
        const s = req.student!;
        if (!s.activeLanguageId) return { question: null, reason: 'no_context' };
        const [lang] = await db.select().from(languages).where(eq(languages.id, s.activeLanguageId));
        const next = await nextQuestion(s, s.activeLanguageId);
        if (!next) return { question: null, reason: 'empty', language: lang ? { id: lang.id, name: lang.name } : null };
        const { question: q, submission: sub } = next;
        const order = seededShuffle(
          q.options.map((_, i) => i),
          s.id * 100_003 + q.id,
        );
        return {
          language: lang ? { id: lang.id, name: lang.name } : null,
          question: {
            id: q.id,
            prompt: q.prompt,
            tier: BADGES[Math.min(q.difficulty, BADGES.length) - 1]?.name ?? 'Bronze',
            xpReward: q.xpReward,
            options: order.map((i) => ({ idx: i, text: q.options[i]! })),
            attemptsLeft: 3 - sub.attempts,
            hintsUsed: sub.hintsUsed,
            hintsTotal: Math.min(3, q.hints.length),
            hintsShown: q.hints.slice(0, sub.hintsUsed),
            hasTip: q.conceptTip.length > 0,
          },
        };
      });

      api.get('/question/:id/tip', async (req, reply) => {
        const id = Number((req.params as { id: string }).id);
        const q = Number.isInteger(id) ? await getQuestion(id) : null;
        if (!q || !q.conceptTip) return reply.code(404).send({ error: 'no_tip' });
        return { tip: q.conceptTip };
      });

      api.post('/hint', async (req, reply) => {
        const body = z.object({ questionId: z.number().int() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        const r = await useHint(req.student!.id, body.data.questionId);
        if (r.kind !== 'ok') return { ok: false, reason: r.kind };
        return { ok: true, number: r.number, total: r.total, text: r.text, penaltyPct: r.penaltyPct };
      });

      api.post('/answer', async (req, reply) => {
        const body = z.object({ questionId: z.number().int(), choiceIdx: z.number().int().min(0).max(9) }).safeParse(req.body);
        if (!body.success) return bad(reply);
        const s = req.student!;
        if (!cooldown(s.id, 1500)) return reply.code(429).send({ error: 'slow_down' });

        const r = await answerQuestion(s, body.data.questionId, body.data.choiceIdx);
        if (r.kind === 'missing' || r.kind === 'already_done') return reply.code(409).send({ error: 'finished' });
        if (r.kind === 'retry') return { status: 'retry', attemptsLeft: r.attemptsLeft };

        const q = r.question;
        const [lang] = await db.select().from(languages).where(eq(languages.id, r.languageId));
        const [ab, solved] = await Promise.all([aheadBehind(r.languageId, r.languageXp), solvedCount(q.id)]);
        const due = r.correct && friendPromptDue({ correctCount: await correctCount(s.id), levelUp: r.levelAfter > r.levelBefore, badgeUp: r.badgeUp });
        const friendPrompt = due ? await suggestions(s, 3) : [];
        return {
          status: 'done',
          correct: r.correct,
          xpGain: r.xpGain,
          attempt: r.attempt,
          answer: q.answerKey, // revealed only now: correct, or out of attempts
          language: lang?.name ?? '',
          xp: r.newGlobalXp,
          level: r.levelAfter,
          levelBefore: r.levelBefore,
          badge: r.newBadge,
          badgeUp: r.badgeUp,
          band: badgeBandProgress(r.newGlobalXp),
          next: xpToNextBadge(r.newGlobalXp),
          streak: r.streak,
          ahead: ab.ahead,
          behind: ab.behind,
          solved,
          snippet: q.snippet ? { code: q.snippet, lang: q.snippetLang, note: q.integrationNote } : null,
          friendPrompt,
          unlocked: r.badgeUp ? featureKeys.filter((k) => FEATURE_MIN_BADGE[k] === r.newBadge).map((k) => FEATURE_LABEL[k]) : [],
        };
      });

      api.get('/leaderboard', async (req) => {
        const s = req.student!;
        const rows = await leaderboard(s, 20);
        const { rank, size } = await myRank(s);
        return {
          rank,
          size,
          rows: rows.map((r, i) => ({
            rank: i + 1,
            name: r.id === s.id || r.privacyShowName ? r.fullName : 'Anonymous',
            batchYear: r.batchYear,
            badge: r.badge,
            xp: r.xp,
            me: r.id === s.id,
          })),
        };
      });

      api.get('/behind', async (req) => {
        const s = req.student!;
        if (!s.activeLanguageId) return { rows: [], reason: 'no_context' };
        const xp = await getLanguageXp(s.id, s.activeLanguageId);
        const rows = await peersBehind(s, s.activeLanguageId, xp, 20);
        return {
          rows: rows.map((r) => ({
            name: r.privacyShowName ? r.fullName : 'Anonymous',
            batchYear: r.batchYear,
            badge: r.badge,
            xp: r.languageXp,
          })),
        };
      });

      // ---- friends (every call is limited to the viewer's own group, see services/friends.ts) ----
      api.get('/friends', async (req) => overview(req.student!));

      api.get('/friends/suggestions', async (req) => ({ rows: await suggestions(req.student!, 6) }));

      api.post('/friends/request', async (req, reply) => {
        const body = z.object({ studentId: z.number().int() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        const s = req.student!;
        const r = await sendRequest(s, body.data.studentId);
        if (r.status === 'not_found') return reply.code(404).send({ error: 'not_found' });
        notifyAfterRequest(s, r, notify);
        return { status: r.status, message: describeResult(r.status) };
      });

      api.post('/friends/respond', async (req, reply) => {
        const body = z.object({ requestId: z.number().int(), accept: z.boolean() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        const s = req.student!;
        const res = await respond(s, body.data.requestId, body.data.accept);
        if (res.status === 'not_found') return reply.code(404).send({ error: 'not_found' });
        notifyAfterRespond(s, res, notify);
        return { status: res.status };
      });

      api.post('/friends/remove', async (req, reply) => {
        const body = z.object({ friendshipId: z.number().int() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        return { ok: await removeFriend(req.student!, body.data.friendshipId) };
      });

      api.post('/privacy', async (req, reply) => {
        const body = z.object({ showName: z.boolean(), allowDm: z.boolean() }).safeParse(req.body);
        if (!body.success) return bad(reply);
        await db
          .update(students)
          .set({ privacyShowName: body.data.showName, privacyAllowDm: body.data.allowDm })
          .where(eq(students.id, req.student!.id));
        return { ok: true };
      });
    },
    { prefix: '/api/v1' },
  );
}
