import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { webhookCallback, type Bot } from 'grammy';
import { z } from 'zod';
import { verifyInitData } from './auth/initData.js';
import { config } from './config.js';
import { db } from './db/client.js';
import { students } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { consumeInvite, findValidInvite } from './services/invites.js';
import { cooldown } from './util.js';
import type { Ctx } from './bot.js';
import { mainMenu } from './menu.js';
import { registerApi } from './api.js';
import { makeNotify } from './notify.js';

const signupSchema = z.object({
  initData: z.string().min(10),
  token: z.string().min(20).max(64),
  fullName: z.string().trim().min(2).max(60),
  batchYear: z.number().int().min(config.BATCH_YEARS.min).max(config.BATCH_YEARS.max),
  gender: z.enum(['male', 'female']),
  showName: z.boolean().default(true),
  allowDm: z.boolean().default(false),
});

export async function createServer(bot: Bot<Ctx>) {
  const app = Fastify({ logger: true, bodyLimit: 100_000, trustProxy: true });

  await app.register(fastifyStatic, {
    root: path.resolve('webapp'),
    prefix: '/static/',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // always fetch the latest Mini App files
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/api/batch-years', async () => config.BATCH_YEARS);
  app.get('/signup', (_req, reply) => reply.sendFile('signup.html'));
  app.get('/app', (_req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('app/index.html'));
  await registerApi(app, makeNotify(bot));

  // Telegram -> bot (verified by secret token header)
  // Only in webhook mode: grammY refuses long polling once webhookCallback has been created.
  if (config.PUBLIC_URL) {
    const handleUpdate = webhookCallback(bot, 'fastify', { secretToken: config.WEBHOOK_SECRET });
    app.post('/webhook', async (req, reply) => {
      await handleUpdate(req, reply);
      return reply; // tell Fastify the response was already sent by the adapter
    });
  }

  app.post('/api/signup', async (req, reply) => {
    const body = signupSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Please fill in every field correctly.' });

    // Identity comes ONLY from the signed initData.
    const user = verifyInitData(body.data.initData, config.BOT_TOKEN);
    if (!user) return reply.code(401).send({ error: 'Could not verify your Telegram account. Reopen sign-up from the bot.' });
    if (!cooldown(user.id, 2000)) return reply.code(429).send({ error: 'Too fast. Try again in a moment.' });

    const invite = await findValidInvite(body.data.token);
    if (!invite) return reply.code(410).send({ error: 'This invite expired. Ask an admin for a new QR code.' });

    const [existing] = await db.select({ id: students.id }).from(students).where(eq(students.telegramId, user.id));
    if (existing) return reply.code(409).send({ error: 'You are already registered.' });

    const status = config.REQUIRE_APPROVAL ? 'pending' : 'active';
    try {
      await db.transaction(async (tx) => {
        const used = await consumeInvite(tx, invite.id);
        if (!used) throw new Error('invite_exhausted');
        await tx.insert(students).values({
          telegramId: user.id,
          username: user.username ?? null,
          fullName: body.data.fullName,
          batchYear: body.data.batchYear,
          gender: body.data.gender,
          status,
          privacyShowName: body.data.showName,
          privacyAllowDm: body.data.allowDm,
          inviteId: invite.id,
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'invite_exhausted') return reply.code(410).send({ error: 'This invite has no uses left.' });
      if (/duplicate key|unique/i.test(msg)) return reply.code(409).send({ error: 'You are already registered.' });
      req.log.error(e);
      return reply.code(500).send({ error: 'Something went wrong. Try again.' });
    }

    // Fire-and-forget: the student is already registered, so never block the response on Telegram.
    void bot.api
      .sendMessage(
        user.id,
        status === 'active'
          ? '🎉 You are in! Use /context to choose what to learn, then /next for your first question. /help for the guide.'
          : '✅ Sign-up received. An admin will approve you soon.',
        status === 'active' ? { reply_markup: mainMenu } : undefined,
      )
      .catch((e) => req.log.warn({ err: e }, 'welcome DM failed'));
    return { ok: true, status };
  });

  return app;
}
