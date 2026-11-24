import { eq } from 'drizzle-orm';
import { config, isOwner } from '../config.js';
import { db } from '../db/client.js';
import { admins, students } from '../db/schema.js';

/** An admin is an owner (ADMIN_IDS in .env) or someone an owner added from the bot. */
export async function isAdmin(telegramId: number): Promise<boolean> {
  if (isOwner(telegramId)) return true;
  const [row] = await db.select({ id: admins.telegramId }).from(admins).where(eq(admins.telegramId, telegramId));
  return !!row;
}

export type Target = { telegramId: number; username: string | null; label: string };

/** Accepts a numeric Telegram ID, or @username of a student who already signed up. */
export async function resolveTarget(input: string): Promise<Target | { error: string }> {
  const raw = input.trim();
  if (/^\d{5,15}$/.test(raw)) {
    const id = Number(raw);
    const [st] = await db.select().from(students).where(eq(students.telegramId, id));
    return { telegramId: id, username: st?.username ?? null, label: st ? st.fullName : `ID ${id}` };
  }
  const name = raw.replace(/^@/, '');
  if (/^[A-Za-z0-9_]{3,32}$/.test(name)) {
    const rows = await db.select().from(students);
    const hit = rows.find((r) => r.username?.toLowerCase() === name.toLowerCase());
    if (hit) return { telegramId: hit.telegramId, username: hit.username, label: hit.fullName };
    return { error: `No signed-up student has the username @${name}. Use their numeric Telegram ID instead.` };
  }
  return { error: 'Give a numeric Telegram ID or the @username of a member who has signed up.' };
}

export async function addAdmin(target: Target, addedBy: number): Promise<'added' | 'already' | 'owner'> {
  if (isOwner(target.telegramId)) return 'owner';
  const [exists] = await db.select().from(admins).where(eq(admins.telegramId, target.telegramId));
  if (exists) return 'already';
  await db.insert(admins).values({ telegramId: target.telegramId, username: target.username, addedBy });
  return 'added';
}

export async function removeAdmin(target: Target): Promise<'removed' | 'not_admin' | 'owner'> {
  if (isOwner(target.telegramId)) return 'owner';
  const gone = await db.delete(admins).where(eq(admins.telegramId, target.telegramId)).returning({ id: admins.telegramId });
  return gone.length ? 'removed' : 'not_admin';
}

export async function listAdmins() {
  const rows = await db.select().from(admins);
  return { owners: [...new Set(config.ADMIN_IDS)], added: rows };
}
