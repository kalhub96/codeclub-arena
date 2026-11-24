import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      BOT_TOKEN: '9132064114:AAGeY6ft6Dt5IMUPllNOF3S70WorfpeZh4A',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    },
  },
});
