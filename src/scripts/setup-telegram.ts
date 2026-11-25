// Run once after the first deploy, and whenever PUBLIC_URL changes (Vercel hosting).
import { createBot } from '../bot.js';
import { BOT_COMMANDS } from '../commands.js';
import { config } from '../config.js';
import { sql } from '../db/client.js';

if (!config.PUBLIC_URL) throw new Error('Set PUBLIC_URL (https://your-app.vercel.app) first.');
const bot = createBot();
await bot.init();
await bot.api.setMyCommands(BOT_COMMANDS);
await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Play', web_app: { url: `${config.PUBLIC_URL}/app` } } });
await bot.api.setWebhook(`${config.PUBLIC_URL}/webhook`, {
  secret_token: config.WEBHOOK_SECRET,
  allowed_updates: ['message', 'callback_query'],
});
console.log(`Telegram is set up: ${config.PUBLIC_URL}/webhook`);
await sql.end();
