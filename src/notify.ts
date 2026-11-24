import type { Bot } from 'grammy';
import type { Ctx } from './bot.js';
import type { Notify } from './services/friends.js';

/** Fire-and-forget direct messages from the bot. Never blocks or fails the caller. */
export const makeNotify =
  (bot: Bot<Ctx>): Notify =>
  (telegramId, text, buttons) => {
    bot.api
      .sendMessage(telegramId, text, buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : undefined)
      .catch(() => {});
  };
