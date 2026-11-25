// Vercel entry. Serves the same Fastify app as src/index.ts (webhook mode only).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBot } from '../src/bot.js';
import { createServer } from '../src/server.js';

let ready: ReturnType<typeof boot> | undefined;
async function boot() {
  const bot = createBot();
  const app = await createServer(bot);
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= boot();
  const app = await ready;
  app.server.emit('request', req, res);
}
