import type { Bot } from 'grammy';
import type { Ctx } from './bot.js';
import { config, isOwner } from './config.js';
import { addAdmin, isAdmin, listAdmins, removeAdmin, resolveTarget } from './services/admins.js';
import { retireQuestion, saveQuestion } from './services/questionAdmin.js';
import { describeIssues, parseTemplate, QuestionItem, TEMPLATE } from './services/questionTemplate.js';
import { esc } from './util.js';

const H = { parse_mode: 'HTML' as const };
const WAIT_MS = 10 * 60_000;
const waiting = new Map<number, number>(); // admin telegram id -> expiry (ms)

/** Replaceable in tests. */
export const deps = { download: async (url: string): Promise<string> => (await fetch(url)).text() };

const ADMIN_HELP = `<b>Admin commands</b>
/addquestion — add one question (you fill in a short template)
/removequestion <code>id</code> — stop serving a question
Send a <b>.json file</b> — add many questions at once
/qr — new club QR code, /qr new — also revokes old codes
/approve <code>telegram_id</code> — approve a pending sign-up
/stats — students and question pools
/admins — list admins
/addadmin <code>id or @username</code> — owners only
/removeadmin <code>id or @username</code> — owners only`;

async function saveFromTemplate(ctx: Ctx, text: string) {
  const parsed = parseTemplate(text);
  if (!parsed.item) {
    await ctx.reply(`Could not read that:\n${parsed.errors.map((e) => `• ${e}`).join('\n')}\n\nSend the corrected version, or /cancel.`);
    return;
  }
  const v = QuestionItem.safeParse(parsed.item);
  if (!v.success) {
    await ctx.reply(`Check this:\n${describeIssues(v.error).map((e) => `• ${e}`).join('\n')}\n\nSend the corrected version, or /cancel.`);
    return;
  }
  const r = await saveQuestion(v.data, { approve: true, source: 'admin' });
  if ('error' in r) {
    await ctx.reply(`${r.error}\n\nSend the corrected version, or /cancel.`);
    return;
  }
  waiting.delete(ctx.from!.id);
  await ctx.reply(`✅ Added to ${r.language}, level ${v.data.difficulty}. Question id ${r.id}.\nRemove it any time with /removequestion ${r.id}.\nSend /addquestion to add another.`);
}

export function registerAdmin(bot: Bot<Ctx>) {
  // Only people who are admins ever get a reply from these commands.
  const guard = async (ctx: Ctx) => !!ctx.from && (await isAdmin(ctx.from.id));

  bot.command('admin', async (ctx) => {
    if (await guard(ctx)) await ctx.reply(ADMIN_HELP, H);
  });

  bot.command('addquestion', async (ctx) => {
    if (!(await guard(ctx))) return;
    const text = ctx.message?.text ?? '';
    if (text.trim().split('\n').length > 1) return saveFromTemplate(ctx, text);
    waiting.set(ctx.from!.id, Date.now() + WAIT_MS);
    await ctx.reply(
      `Copy this, change it, and send it back as one message.\n"+" marks the correct option, "-" the wrong ones. Hints, tip and note are optional. Level 1 is Bronze, 6 is Adamantium.\n\n<pre>${esc(TEMPLATE)}</pre>\nSend /cancel to stop.`,
      H,
    );
  });

  bot.command('cancel', async (ctx) => {
    if (!(await guard(ctx))) return;
    waiting.delete(ctx.from!.id);
    await ctx.reply('Cancelled.');
  });

  // The admin's next plain message is the filled-in template.
  bot.on('message:text', async (ctx, next) => {
    const id = ctx.from?.id;
    const until = id ? waiting.get(id) : undefined;
    if (!id || !until || ctx.message.text.startsWith('/')) return next();
    if (Date.now() > until) {
      waiting.delete(id);
      return next();
    }
    return saveFromTemplate(ctx, ctx.message.text);
  });

  bot.command('removequestion', async (ctx) => {
    if (!(await guard(ctx))) return;
    const id = Number(ctx.match.trim());
    if (!Number.isInteger(id) || id < 1) return ctx.reply('Usage: /removequestion <id>. The id is shown when you add a question.');
    const q = await retireQuestion(id);
    if (!q) return ctx.reply(`No question with id ${id}.`);
    return ctx.reply(`Removed: "${q.prompt.slice(0, 80)}". Students who already answered it keep their XP.`);
  });

  // Bulk add: admin sends a .json file.
  bot.on('message:document', async (ctx, next) => {
    if (!(await guard(ctx))) return next();
    const doc = ctx.message.document;
    if (!/\.json$/i.test(doc.file_name ?? '')) return ctx.reply('Send a .json file with a list of questions, or use /addquestion for one question.');
    if ((doc.file_size ?? 0) > 1_000_000) return ctx.reply('That file is too large. The limit is 1 MB.');
    let items: unknown[];
    try {
      const file = await ctx.api.getFile(doc.file_id);
      const text = await deps.download(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`);
      const json = JSON.parse(text);
      if (!Array.isArray(json)) throw new Error('not a list');
      items = json;
    } catch {
      return ctx.reply('I could not read that file. It must be a JSON list of questions, like the sample in data/questions/sample.json.');
    }
    let ok = 0;
    const problems: string[] = [];
    for (const [i, item] of items.entries()) {
      const v = QuestionItem.safeParse(item);
      if (!v.success) { problems.push(`#${i + 1}: ${describeIssues(v.error).join('; ')}`); continue; }
      const r = await saveQuestion(v.data, { approve: true, source: 'admin' });
      if ('error' in r) problems.push(`#${i + 1}: ${r.error}`);
      else ok++;
    }
    const shown = problems.slice(0, 8).map((p) => `• ${p}`).join('\n');
    return ctx.reply(`✅ Added ${ok} of ${items.length} questions.${problems.length ? `\n\nProblems:\n${shown}${problems.length > 8 ? `\n…and ${problems.length - 8} more` : ''}` : ''}`);
  });

  // ---- manage admins ----
  bot.command('admins', async (ctx) => {
    if (!(await guard(ctx))) return;
    const { owners, added } = await listAdmins();
    const lines = [
      '<b>Owners</b> (set in .env)',
      ...owners.map((o) => `• ${o}`),
      '',
      '<b>Admins</b> (added in the bot)',
      ...(added.length ? added.map((a) => `• ${a.telegramId}${a.username ? ` @${esc(a.username)}` : ''}`) : ['• none']),
    ];
    await ctx.reply(lines.join('\n'), H);
  });

  const manage = (name: 'addadmin' | 'removeadmin') =>
    bot.command(name, async (ctx) => {
      if (!(await guard(ctx))) return;
      if (!isOwner(ctx.from!.id)) return ctx.reply('Only owners can add or remove admins. Owners are the IDs in ADMIN_IDS in .env.');
      if (!ctx.match.trim()) return ctx.reply(`Usage: /${name} <telegram id or @username>`);
      const t = await resolveTarget(ctx.match);
      if ('error' in t) return ctx.reply(t.error);
      if (name === 'addadmin') {
        const r = await addAdmin(t, ctx.from!.id);
        if (r === 'owner') return ctx.reply(`${t.label} is already an owner.`);
        if (r === 'already') return ctx.reply(`${t.label} is already an admin.`);
        bot.api.sendMessage(t.telegramId, 'You are now an admin of CodeClub Arena. Send /admin to see what you can do.').catch(() => {});
        return ctx.reply(`✅ ${t.label} is now an admin.`);
      }
      const r = await removeAdmin(t);
      if (r === 'owner') return ctx.reply('Owners can only be removed by editing ADMIN_IDS in .env.');
      if (r === 'not_admin') return ctx.reply(`${t.label} is not an admin.`);
      return ctx.reply(`✅ ${t.label} is no longer an admin.`);
    });
  manage('addadmin');
  manage('removeadmin');
}
