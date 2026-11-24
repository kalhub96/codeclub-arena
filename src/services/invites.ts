import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, type DB } from '../db/client.js';
import { invites } from '../db/schema.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const INVITE_DAYS = 30;
export const INVITE_USES = 2000;

export async function createInvite(createdBy: number, days = INVITE_DAYS, maxUses = INVITE_USES) {
  // 16 random bytes = 128 bits (22 chars): unguessable, and keeps the QR code simple to scan.
  const token = randomBytes(16).toString('base64url');
  await db.insert(invites).values({
    tokenHash: hash(token),
    createdBy,
    maxUses,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  return token;
}

export async function revokeAllInvites() {
  await db.update(invites).set({ revokedAt: new Date() }).where(isNull(invites.revokedAt));
}

export async function findValidInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hash(token)),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
        lt(invites.uses, invites.maxUses),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Atomically consume one use. Returns the invite id, or null if it just ran out. */
export async function consumeInvite(tx: Tx, inviteId: number) {
  const [row] = await tx
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(
      and(eq(invites.id, inviteId), isNull(invites.revokedAt), gt(invites.expiresAt, new Date()), lt(invites.uses, invites.maxUses)),
    )
    .returning({ id: invites.id });
  return row?.id ?? null;
}