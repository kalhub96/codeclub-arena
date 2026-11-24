import { and, count, eq } from 'drizzle-orm';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import QRCode from 'qrcode';
import { config } from './config.js';
import { registerAdmin } from './adminCommands.js';
import { isAdmin } from './services/admins.js';
import { db } from './db/client.js';
import { languages, questions, studentLanguageProgress as slp, students, tracks, type Student } from './db/schema.js';
import { badgeEmoji, badgeForXp, badgeBandProgress, BADGES, levelForXp, progressBar, tierForXp, xpToNextBadge } from './services/badges.js';
import { createInvite, findValidInvite, INVITE_DAYS, INVITE_USES, revokeAllInvites } from './services/invites.js';
import { answerQuestion, getLanguageXp, getQuestion, nextQuestion, useHint, type AnswerResult } from './services/questions.js';
import { aheadBehind, leaderboard, myLanguageLevels, peerLabel, peersBehind, solvedCount } from './services/stats.js';
import { MENU, mainMenu } from './menu.js';
import { makeNotify } from './notify.js';
import {
  contactOf,
  correctCount,
  describeResult,
  friendPromptDue,
  notifyAfterRequest,
  notifyAfterRespond,
  overview,
  respond,
  sendRequest,
  suggestions,
} from './services/friends.js';
import { cooldown, esc, seededShuffle } from './util.js';

export type Ctx = Context & { student: Student | null };
const H = { parse_mode: 'HTML' as const };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const HELP = `<b>CodeClub Arena</b>
Answer questions, earn XP, climb from Bronze to Adamantium.

/context — choose what to learn (track → language)
/next — get a question
/progress — your badge, XP, streak, languages
/behind — club members behind you (same gender only)
/leaderboard — top students (same gender only)
/help — this guide

<b>How it works</b>
• You choose the context. Difficulty follows your level in that language.
• 3 attempts per question: XP drops to 60% on the 2nd and 30% on the 3rd.
• 💡 Tip explains the concept (free). 🔍 Hint costs XP (−10% / −20% / −40%).
• After each question you get a code example showing how it is used for real.
• Anonymous counts show how many students are ahead or behind you.`;

export function createBot() {
  const bot = new Bot<Ctx>(config.BOT_TOKEN);
  const notify = makeNotify(bot);

  // Private chats only.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    await next();
  });

  // Load the student for every update.
  bot.use(async (ctx, next) => {
    ctx.student = null;
    if (ctx.from) {
      const [s] = await db.select().from(students).where(eq(students.telegramId, ctx.from.id));
      ctx.student = s ?? null;
    }
    await next();
  });

  // ---------- Admin (works before sign-up) ----------
  registerAdmin(bot);

  bot.command('qr', async (ctx) => {
    if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
    if (ctx.match.trim() === 'new') await revokeAllInvites();
    const token = await createInvite(ctx.from.id);
    const link = `https://t.me/${bot.botInfo.username}?start=${token}`;
    const png = await QRCode.toBuffer(link, { width: 640, margin: 2 });
    await ctx.replyWithPhoto(new InputFile(png, 'club-qr.png'), {
      caption: `Club QR — valid ${INVITE_DAYS} days, ${INVITE_USES} sign-ups.\n${ctx.match.trim() === 'new' ? 'All older QR codes are now revoked.\n' : ''}${link}`,
    });
  });

  bot.command('approve', async (ctx) => {
    if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
    const tgId = Number(ctx.match.trim());
    if (!Number.isFinite(tgId)) return ctx.reply('Usage: /approve <telegram_id>');
    const [s] = await db
      .update(students)
      .set({ status: 'active' })
      .where(and(eq(students.telegramId, tgId), eq(students.status, 'pending')))
      .returning();
    if (!s) return ctx.reply('No pending student with that ID.');
    await bot.api.sendMessage(tgId, '✅ You are approved! Use /context to pick what to learn.').catch(() => {});
    return ctx.reply(`Approved ${s.fullName}.`);
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.from || !(await isAdmin(ctx.from.id))) return;
    const [st] = await db.select({ n: count() }).from(students).where(eq(students.status, 'active'));
    const [pe] = await db.select({ n: count() }).from(students).where(eq(students.status, 'pending'));
    const pools = await db
      .select({ lang: languages.name, n: count() })
      .from(questions)
      .innerJoin(languages, eq(languages.id, questions.languageId))
      .where(eq(questions.status, 'approved'))
      .groupBy(languages.name);
    const lines = pools.map((p) => `• ${p.lang}: ${p.n} approved`).join('\n') || '(no approved questions)';
    return ctx.reply(`Active students: ${st?.n ?? 0}\nPending: ${pe?.n ?? 0}\n\nQuestion pools:\n${lines}`);
  });

  // ---------- Entry: QR deep link ----------
  bot.command('start', async (ctx) => {
    const payload = ctx.match.trim();
    const s = ctx.student;
    if (s?.status === 'active') {
      return ctx.reply('Welcome back! Use the buttons below to pick what to learn and get a question.', { reply_markup: mainMenu });
    }
    if (s?.status === 'pending') return ctx.reply('Your sign-up is waiting for admin approval. Hang tight!');
    if (s?.status === 'banned') return;
    if (!payload) return ctx.reply('Scan the club QR code to join.');

    const invite = await findValidInvite(payload);
    if (!invite) return ctx.reply('This invite is invalid or expired. Ask an admin for a fresh QR code.');
    if (!config.PUBLIC_URL) return ctx.reply('Sign-up is not configured yet (PUBLIC_URL missing). Tell an admin.');

    const kb = new InlineKeyboard().webApp('Complete sign-up', `${config.PUBLIC_URL}/signup?t=${payload}`);
    return ctx.reply('Welcome to CodeClub Arena! Tap below to finish sign-up (name, batch year, gender).', { reply_markup: kb });
  });

  // ---------- Gate: everything below needs an active student ----------
  bot.use(async (ctx, next) => {
    const s = ctx.student;
    if (!s || s.status === 'banned') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      else if (!s) await ctx.reply('Scan the club QR code to join.');
      return;
    }
    if (s.status === 'pending') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      else await ctx.reply('Your sign-up is waiting for admin approval.');
      return;
    }
    await next();
  });

  const showHelp = (ctx: Ctx) => ctx.reply(HELP, { ...H, reply_markup: mainMenu });
  bot.command('help', showHelp);
  bot.hears(MENU.help, showHelp);

  // ---------- Context picker ----------
  const showTracks = async (ctx: Ctx) => {
    const all = await db.select().from(tracks).orderBy(tracks.id);
    const kb = new InlineKeyboard();
    for (const t of all) kb.text(t.name, `t:${t.id}`).row();
    return ctx.reply('What do you want to learn? Pick a track:', { reply_markup: kb });
  };
  bot.command('context', showTracks);
  bot.hears(MENU.context, showTracks);

  bot.callbackQuery(/^t:(\d+)$/, async (ctx) => {
    const trackId = Number(ctx.match[1]);
    const langs = await db.select().from(languages).where(eq(languages.trackId, trackId)).orderBy(languages.orderNo);
    const mine = new Map((await myLanguageLevels(ctx.student!.id)).map((l) => [l.name, l.xp]));
    const kb = new InlineKeyboard();
    langs.forEach((l, i) => {
      const xp = mine.get(l.name);
      kb.text(xp !== undefined ? `${l.name} · Lv ${levelForXp(xp)}` : l.name, `l:${l.id}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('⬅️ Tracks', 'tracks');
    await ctx.editMessageText('Pick a language / topic:', { reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('tracks', async (ctx) => {
    const all = await db.select().from(tracks).orderBy(tracks.id);
    const kb = new InlineKeyboard();
    for (const t of all) kb.text(t.name, `t:${t.id}`).row();
    await ctx.editMessageText('What do you want to learn? Pick a track:', { reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^l:(\d+)$/, async (ctx) => {
    const langId = Number(ctx.match[1]);
    const [lang] = await db.select().from(languages).where(eq(languages.id, langId));
    if (!lang) return ctx.answerCallbackQuery({ text: 'Unknown language.' });
    await db.update(students).set({ activeLanguageId: langId }).where(eq(students.id, ctx.student!.id));
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`✅ Context set: <b>${esc(lang.name)}</b>`, H).catch(() => {});
    await sendQuestion(ctx, { ...ctx.student!, activeLanguageId: langId });
  });

  // ---------- Questions ----------
  const showNext = (ctx: Ctx) => sendQuestion(ctx, ctx.student!);
  bot.command('next', showNext);
  bot.hears(MENU.next, showNext);
  bot.callbackQuery('n', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendQuestion(ctx, ctx.student!);
  });

  bot.callbackQuery(/^a:(\d+):(\d+)$/, async (ctx) => {
    const s = ctx.student!;
    if (!cooldown(s.id, 3000)) return ctx.answerCallbackQuery({ text: 'Slow down: one answer every 3 seconds.' });
    const r = await answerQuestion(s, Number(ctx.match[1]), Number(ctx.match[2]));
    switch (r.kind) {
      case 'missing':
      case 'already_done':
        return ctx.answerCallbackQuery({ text: 'This question is already finished.' });
      case 'retry':
        return ctx.answerCallbackQuery({ text: `Not quite. ${r.attemptsLeft} attempt(s) left.`, show_alert: true });
      case 'done':
        await ctx.answerCallbackQuery({ text: r.correct ? 'Correct!' : 'Out of attempts' });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});
        return sendResult(ctx, s, r);
    }
  });

  bot.callbackQuery(/^h:(\d+)$/, async (ctx) => {
    const r = await useHint(ctx.student!.id, Number(ctx.match[1]));
    if (r.kind === 'ok') {
      await ctx.answerCallbackQuery();
      return ctx.reply(`🔍 <b>Hint ${r.number}/${r.total}</b> (−${r.penaltyPct}% XP)\n${esc(r.text)}`, H);
    }
    return ctx.answerCallbackQuery({ text: r.kind === 'exhausted' ? 'No more hints.' : 'No hints for this question.' });
  });

  bot.callbackQuery(/^c:(\d+)$/, async (ctx) => {
    const q = await getQuestion(Number(ctx.match[1]));
    if (!q?.conceptTip) return ctx.answerCallbackQuery({ text: 'No tip for this one.' });
    await ctx.answerCallbackQuery();
    return ctx.reply(`💡 <b>Concept</b>\n${esc(q.conceptTip)}`, H);
  });

  // ---------- Progress / social ----------
  const showProgress = async (ctx: Ctx) => {
    const s = ctx.student!;
    const next = xpToNextBadge(s.xp);
    const langs = await myLanguageLevels(s.id);
    const langLines = langs.length
      ? langs.map((l) => `• ${esc(l.name)} — ${badgeEmoji(badgeForXp(l.xp))} ${badgeForXp(l.xp)} (${l.xp} XP)`).join('\n')
      : 'No language started yet. Use /context.';
    return ctx.reply(
      `${badgeEmoji(s.badge)} <b>${s.badge}</b> · Level ${levelForXp(s.xp)}\n` +
        `${progressBar(badgeBandProgress(s.xp))} ${s.xp} XP` +
        `${next ? ` — ${next.remaining} XP to ${next.next}` : ' — max tier!'}\n` +
        `🔥 Streak: ${s.streak} day(s)\n\n<b>Languages</b>\n${langLines}`,
      H,
    );
  };
  bot.command('progress', showProgress);
  bot.hears(MENU.progress, showProgress);

  const showBehind = async (ctx: Ctx) => {
    const s = ctx.student!;
    if (!s.activeLanguageId) return ctx.reply('Choose a context first: /context');
    const xp = await getLanguageXp(s.id, s.activeLanguageId);
    const peers = await peersBehind(s, s.activeLanguageId, xp);
    if (!peers.length) return ctx.reply('Nobody from your group is behind you in this language yet.');
    const lines = peers.map((p) => `• ${esc(peerLabel(p))} ${badgeEmoji(p.badge)}`).join('\n');
    return ctx.reply(`<b>Behind you in this language</b>\n${lines}`, H);
  };
  bot.command('behind', showBehind);
  bot.hears(MENU.behind, showBehind);

  const showLeaderboard = async (ctx: Ctx) => {
    const s = ctx.student!;
    const rows = await leaderboard(s, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map(
      (r, i) => `${medals[i] ?? `${i + 1}.`} ${esc(peerLabel(r))} ${badgeEmoji(r.badge)} ${r.xp} XP${r.id === s.id ? ' ← you' : ''}`,
    );
    return ctx.reply(`<b>Leaderboard</b>\n${lines.join('\n') || 'No one yet.'}`, H);
  };
  bot.command('leaderboard', showLeaderboard);
  bot.hears(MENU.leaderboard, showLeaderboard);

  // ---------- Friends (same group only; see services/friends.ts) ----------
  bot.command('friends', async (ctx) => {
    const o = await overview(ctx.student!);
    const lines = o.friends.map((f) => `• ${f.name}, Batch ${f.batchYear}${f.contact ? `, @${f.contact}` : ''}`);
    await ctx.reply(
      o.friends.length
        ? `Your friends:\n${lines.join('\n')}`
        : 'No friends yet. Keep answering questions and the game will offer people from your group to add.',
    );
    for (const r of o.incoming) {
      await ctx.reply(`${r.name} (Batch ${r.batchYear}, ${r.badge}) wants to connect with you.`, {
        reply_markup: new InlineKeyboard().text('Accept', `fr:a:${r.requestId}`).text('Decline', `fr:d:${r.requestId}`),
      });
    }
  });

  bot.callbackQuery(/^fr:(a|d):(\d+)$/, async (ctx) => {
    const res = await respond(ctx.student!, Number(ctx.match[2]), ctx.match[1] === 'a');
    if (res.status === 'not_found') return ctx.answerCallbackQuery({ text: 'This request is no longer available.' });
    notifyAfterRespond(ctx.student!, res, notify);
    await ctx.answerCallbackQuery({ text: res.status === 'accepted' ? 'Connected' : 'Declined' });
    const c = res.requester ? contactOf(res.requester) : null;
    await ctx
      .editMessageText(
        res.status === 'accepted'
          ? `You are now connected with ${res.requester!.fullName}.\n${c ? `Contact: @${c}` : 'They keep their contact private for now.'}`
          : 'Request declined.',
      )
      .catch(() => {});
  });

  bot.callbackQuery(/^fr:s:(\d+)$/, async (ctx) => {
    const r = await sendRequest(ctx.student!, Number(ctx.match[1]));
    notifyAfterRequest(ctx.student!, r, notify);
    return ctx.answerCallbackQuery({ text: describeResult(r.status), show_alert: r.status === 'limit' });
  });

  bot.catch((err) => console.error('Bot error:', err.error));
  return bot;
}

// ---------- helpers ----------
async function sendQuestion(ctx: Ctx, student: Student) {
  if (!student.activeLanguageId) return ctx.reply('Choose what to learn first: /context');
  const [lang] = await db.select().from(languages).where(eq(languages.id, student.activeLanguageId));
  const next = await nextQuestion(student, student.activeLanguageId);
  if (!next) {
    return ctx.reply(`No new questions in ${lang?.name ?? 'this language'} right now. Try another context with /context. New questions are added regularly.`);
  }
  const { question: q, submission: sub } = next;
  const order = seededShuffle(
    q.options.map((_, i) => i),
    student.id * 100_003 + q.id,
  );
  const body = order.map((orig, pos) => `${LETTERS[pos]}. ${esc(q.options[orig]!)}`).join('\n');
  const kb = new InlineKeyboard();
  order.forEach((orig, pos) => kb.text(LETTERS[pos]!, `a:${q.id}:${orig}`));
  kb.row().text('💡 Tip', `c:${q.id}`).text('🔍 Hint', `h:${q.id}`);

  const tierName = BADGES[Math.min(q.difficulty, BADGES.length) - 1]?.name ?? '';
  return ctx.reply(
    `<b>${esc(lang?.name ?? '')} · ${tierName} · up to ${q.xpReward} XP</b>\n` +
      `Attempts left: ${3 - sub.attempts} · Hints used: ${sub.hintsUsed}\n\n${esc(q.prompt)}\n\n${body}`,
    { ...H, reply_markup: kb },
  );
}

async function sendResult(ctx: Ctx, student: Student, r: Extract<AnswerResult, { kind: 'done' }>) {
  const q = r.question;
  const [lang] = await db.select().from(languages).where(eq(languages.id, r.languageId));
  const [{ ahead, behind }, solved] = await Promise.all([aheadBehind(r.languageId, r.languageXp), solvedCount(q.id)]);

  const verdict = r.correct
    ? `✅ <b>Correct!</b> +${r.xpGain} XP`
    : `❌ <b>Out of attempts.</b> Correct answer: <b>${esc(q.answerKey)}</b>`;
  const next = xpToNextBadge(r.newGlobalXp);
  const summary =
    `${verdict}\n\n` +
    `${badgeEmoji(r.newBadge)} ${r.newBadge} · Level ${r.levelAfter}\n` +
    `${progressBar(badgeBandProgress(r.newGlobalXp))} ${r.newGlobalXp} XP${next ? ` (${next.remaining} to ${next.next})` : ''}\n` +
    (r.correct ? `🔥 Streak: ${r.streak} day(s)\n` : '') +
    `\n📊 In ${esc(lang?.name ?? 'this language')}: you're ahead of <b>${behind}</b> student(s), <b>${ahead}</b> are ahead of you. ` +
    `${solved} student(s) solved this question.`;
  await ctx.reply(summary, H);

  if (q.snippet) {
    const code = q.snippet.length > 3000 ? `${q.snippet.slice(0, 3000)}\n…` : q.snippet;
    await ctx.reply(
      `<b>See it in code</b>\n<pre><code class="language-${esc(q.snippetLang)}">${esc(code)}</code></pre>` +
        (q.integrationNote ? `\n<b>How it fits:</b> ${esc(q.integrationNote)}` : ''),
      { ...H, reply_markup: new InlineKeyboard().text('Next question ▶', 'n') },
    );
  } else {
    await ctx.reply('Ready for the next one?', { reply_markup: new InlineKeyboard().text('Next question ▶', 'n') });
  }

  if (r.correct && friendPromptDue({ correctCount: await correctCount(student.id), levelUp: r.levelAfter > r.levelBefore, badgeUp: r.badgeUp })) {
    const people = await suggestions(student, 3);
    if (people.length) {
      const kb = new InlineKeyboard();
      for (const p of people) kb.text(`Add ${p.name}, Batch ${p.batchYear}`, `fr:s:${p.id}`).row();
      await ctx.reply(
        '<b>Meet people in your group</b>\nSend a request. If they accept, you can see each other\'s contact when they allow it.',
        { ...H, reply_markup: kb },
      );
    }
  }

  if (r.badgeUp) {
    await ctx.reply(`🎉 <b>Badge up!</b> You are now ${badgeEmoji(r.newBadge)} <b>${r.newBadge}</b>.`, H);
  }
}
