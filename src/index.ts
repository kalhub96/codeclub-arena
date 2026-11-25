import { createBot } from './bot.js';
import { BOT_COMMANDS } from './commands.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createServer } from './server.js';

await runMigrations();

const bot = createBot();
await bot.init();
await bot.api.setMyCommands(BOT_COMMANDS);

const app = await createServer(bot);
await app.listen({ port: config.PORT, host: '0.0.0.0' });

if (config.PUBLIC_URL) {
  await bot.api
    .setChatMenuButton({ menu_button: { type: 'web_app', text: 'Play', web_app: { url: `${config.PUBLIC_URL}/app` } } })
    .catch((e) => console.warn('setChatMenuButton failed', e));
  await bot.api.setWebhook(`${config.PUBLIC_URL}/webhook`, {
    secret_token: config.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
  console.log(`Webhook mode: ${config.PUBLIC_URL}/webhook`);
} else {
  await bot.api.deleteWebhook();
  void bot.start({ allowed_updates: ['message', 'callback_query'] });
  console.log('Long polling mode (no PUBLIC_URL). The sign-up Mini App needs HTTPS and will not open.');
}

const shutdown = async () => {
  await bot.stop().catch(() => {});
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
