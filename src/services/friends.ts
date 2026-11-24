import { and, count, eq, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { friendships, students, submissions, type Student } from '../db/schema.js';
import { visiblePeers } from '../db/visibility.js';

/**
 * Friends. Every function below only ever touches people returned by visiblePeers(me),
 * i.e. active members of the viewer's own gender. A request to anyone else answers
 * "not_found", exactly like an ID that does not exist, so nothing about other groups leaks.
 */

export const MAX_PENDING = 10;
export const DECLINE_COOLDOWN_MS = 14 * 86_400_000;

type Btn = { text: string; data: string };
export type Notify = (telegramId: number, text: string, buttons?: Btn[][]) => void;

/** What other members may see before a request is accepted: no username, no contact. */
export const card = (s: Pick<Student, 'id' | 'fullName' | 'batchYear' | 'badge' | 'privacyShowName'>) => ({
  id: s.id,
  name: s.privacyShowName ? s.fullName : 'A member',
  batchYear: s.batchYear,
  badge: s.badge,
});

/** Contact is shared only with accepted friends, and only if the person allows it. */
export const contactOf = (s: Pick<Student, 'privacyAllowDm' | 'username'>) => (s.privacyAllowDm && s.username ? s.username : null);

/** Ask after every 5th correct answer, and on any level-up or badge-up. */
export const friendPromptDue = (o: { correctCount: number; levelUp: boolean; badgeUp: boolean }) =>
  o.correctCount > 0 && (o.correctCount % 5 === 0 || o.levelUp || o.badgeUp);

export async function correctCount(studentId: number) {
  const [r] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.studentId, studentId), eq(submissions.isCorrect, true)));
  return r?.n ?? 0;
}

export async function suggestions(me: Student, limit = 3) {
  const rel = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)));
  const skip = new Set<number>();
  for (const r of rel) {
    const other = r.requesterId === me.id ? r.addresseeId : r.requesterId;
    if (r.status !== 'declined') skip.add(other);
    else if (r.addresseeId === me.id || Date.now() - (r.respondedAt?.getTime() ?? 0) < DECLINE_COOLDOWN_MS) skip.add(other);
  }
  const rows = await db
    .select()
    .from(students)
    .where(and(visiblePeers(me), skip.size ? notInArray(students.id, [...skip]) : undefined))
    .orderBy(sql`(${students.activeLanguageId} = ${me.activeLanguageId ?? -1}) desc nulls last`, sql`random()`)
    .limit(limit);
  return rows.map(card);
}

export type RequestResult =
  | { status: 'sent' | 'accepted' | 'already' | 'friends' | 'limit' | 'cooldown' | 'not_found'; target?: Student; requestId?: number };

export async function sendRequest(me: Student, targetId: number): Promise<RequestResult> {
  if (targetId === me.id) return { status: 'not_found' };
  const [t] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, targetId), visiblePeers(me)));
  if (!t) return { status: 'not_found' };

  return db.transaction(async (tx): Promise<RequestResult> => {
    const [ex] = await tx
      .select()
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, t.id)),
          and(eq(friendships.requesterId, t.id), eq(friendships.addresseeId, me.id)),
        ),
      )
      .limit(1);
    if (ex) {
      if (ex.status === 'accepted') return { status: 'friends', target: t };
      if (ex.status === 'pending') {
        if (ex.requesterId === me.id) return { status: 'already', target: t, requestId: ex.id };
        // They already asked me: both want it, so connect right away.
        await tx.update(friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendships.id, ex.id));
        return { status: 'accepted', target: t, requestId: ex.id };
      }
      if (ex.requesterId === me.id && Date.now() - (ex.respondedAt?.getTime() ?? 0) < DECLINE_COOLDOWN_MS) return { status: 'cooldown' };
      await tx
        .update(friendships)
        .set({ requesterId: me.id, addresseeId: t.id, status: 'pending', respondedAt: null, createdAt: new Date() })
        .where(eq(friendships.id, ex.id));
      return { status: 'sent', target: t, requestId: ex.id };
    }
    const [pend] = await tx
      .select({ n: count() })
      .from(friendships)
      .where(and(eq(friendships.requesterId, me.id), eq(friendships.status, 'pending')));
    if ((pend?.n ?? 0) >= MAX_PENDING) return { status: 'limit' };
    const [row] = await tx.insert(friendships).values({ requesterId: me.id, addresseeId: t.id }).returning({ id: friendships.id });
    return { status: 'sent', target: t, requestId: row!.id };
  });
}

export async function respond(me: Student, requestId: number, accept: boolean) {
  const [fr] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.id, requestId), eq(friendships.addresseeId, me.id), eq(friendships.status, 'pending')));
  if (!fr) return { status: 'not_found' as const };
  const [req] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, fr.requesterId), visiblePeers(me)));
  if (!req) return { status: 'not_found' as const };
  const changed = await db
    .update(friendships)
    .set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date() })
    .where(and(eq(friendships.id, fr.id), eq(friendships.status, 'pending')))
    .returning({ id: friendships.id });
  if (!changed.length) return { status: 'not_found' as const };
  return { status: accept ? ('accepted' as const) : ('declined' as const), requester: req };
}

export async function overview(me: Student) {
  const friendCols = { id: friendships.id, other: students };
  const mine = (who: 'requesterId' | 'addresseeId') => and(eq(friendships[who], me.id), eq(friendships.status, 'accepted'), visiblePeers(me));
  const a = await db.select(friendCols).from(friendships).innerJoin(students, eq(students.id, friendships.addresseeId)).where(mine('requesterId'));
  const b = await db.select(friendCols).from(friendships).innerJoin(students, eq(students.id, friendships.requesterId)).where(mine('addresseeId'));
  const friends = [...a, ...b].map((r) => ({
    friendshipId: r.id,
    name: r.other.fullName, // friends see each other's real name
    batchYear: r.other.batchYear,
    badge: r.other.badge,
    contact: contactOf(r.other),
  }));
  const inc = await db
    .select({ id: friendships.id, other: students })
    .from(friendships)
    .innerJoin(students, eq(students.id, friendships.requesterId))
    .where(and(eq(friendships.addresseeId, me.id), eq(friendships.status, 'pending'), visiblePeers(me)));
  const [out] = await db
    .select({ n: count() })
    .from(friendships)
    .where(and(eq(friendships.requesterId, me.id), eq(friendships.status, 'pending')));
  return {
    friends,
    incoming: inc.map((r) => ({ requestId: r.id, ...card(r.other) })),
    outgoingCount: out?.n ?? 0,
  };
}

export async function incomingCount(me: Student) {
  const [r] = await db
    .select({ n: count() })
    .from(friendships)
    .innerJoin(students, eq(students.id, friendships.requesterId))
    .where(and(eq(friendships.addresseeId, me.id), eq(friendships.status, 'pending'), visiblePeers(me)));
  return r?.n ?? 0;
}

export async function removeFriend(me: Student, friendshipId: number) {
  const gone = await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.id, friendshipId),
        eq(friendships.status, 'accepted'),
        or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)),
      ),
    )
    .returning({ id: friendships.id });
  return gone.length > 0;
}

// ---------- messages (shared by the Mini App API and the bot) ----------
const label = (s: Student) => (s.privacyShowName ? s.fullName : 'A member');
const contactLine = (s: Student) => {
  const c = contactOf(s);
  return c ? `Contact: @${c}` : 'They keep their contact private for now.';
};

export function notifyAfterRequest(me: Student, r: RequestResult, notify: Notify) {
  if (!r.target) return;
  if (r.status === 'sent' && r.requestId) {
    notify(
      r.target.telegramId,
      `${label(me)} (Batch ${me.batchYear}, ${me.badge}) wants to connect with you.\nIf you accept, you can see each other's contact details when they allow it.`,
      [[{ text: 'Accept', data: `fr:a:${r.requestId}` }, { text: 'Decline', data: `fr:d:${r.requestId}` }]],
    );
  } else if (r.status === 'accepted') {
    notify(r.target.telegramId, `You and ${me.fullName} are now connected.\n${contactLine(me)}`);
    notify(me.telegramId, `You and ${r.target.fullName} are now connected.\n${contactLine(r.target)}`);
  }
}

export function notifyAfterRespond(me: Student, res: Awaited<ReturnType<typeof respond>>, notify: Notify) {
  if (res.status !== 'accepted' || !res.requester) return;
  notify(res.requester.telegramId, `${me.fullName} accepted your request.\n${contactLine(me)}`);
}

export const describeResult = (r: RequestResult['status']) =>
  ({
    sent: 'Request sent.',
    accepted: 'You are now connected.',
    already: 'You already sent a request.',
    friends: 'You are already connected.',
    limit: `You have ${MAX_PENDING} requests waiting. Try again after someone answers.`,
    cooldown: 'Try again in a couple of weeks.',
    not_found: 'That person is not available.',
  })[r];
