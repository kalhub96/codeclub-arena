import { createHash } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(10),
  DATABASE_URL: z.string().min(1),
  ADMIN_IDS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n)),
    ),
  PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\/+$/, '') : undefined)),
  REQUIRE_APPROVAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().default(3000),
  // Batch years in the Ethiopian calendar, "oldest-newest". The newest is the latest batch shown at sign-up.
  BATCH_YEARS: z
    .string()
    .regex(/^\d{4}-\d{4}$/, 'BATCH_YEARS must look like 2005-2014')
    .default('2005-2014')
    .transform((v) => {
      const [a, b] = v.split('-').map(Number) as [number, number];
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }),
  TIMEZONE: z.string().default('Africa/Addis_Ababa'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  // Derived, stable secret Telegram echoes back on every webhook call.
  WEBHOOK_SECRET: createHash('sha256').update(`wh:${parsed.data.BOT_TOKEN}`).digest('hex').slice(0, 48),
};

/** Owners are the IDs in ADMIN_IDS. They can add and remove other admins from inside the bot. */
export const isOwner = (telegramId: number) => config.ADMIN_IDS.includes(telegramId);
