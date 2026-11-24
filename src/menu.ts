import { Keyboard } from 'grammy';
import { config } from './config.js';

export const MENU = {
  context: '🎯 Choose context',
  next: '▶️ Next question',
  progress: '📊 Progress',
  leaderboard: '🏆 Leaderboard',
  behind: '👥 Behind me',
  help: '❓ Help',
} as const;

/** Persistent button keyboard shown under the chat input. */
const kb = new Keyboard();
if (config.PUBLIC_URL) kb.webApp('🎮 Open app', `${config.PUBLIC_URL}/app`).row();

export const mainMenu = kb
  .text(MENU.context)
  .text(MENU.next)
  .row()
  .text(MENU.progress)
  .text(MENU.leaderboard)
  .row()
  .text(MENU.behind)
  .text(MENU.help)
  .resized()
  .persistent();
