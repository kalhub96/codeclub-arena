# CodeClub Arena (MVP)

Telegram bot + sign-up Mini App. Students scan a club QR, sign up (name, batch year, gender), choose a
context (track → language), answer questions, earn XP and badges (Bronze → Adamantium), and see a code
example after every answer. Men and women never see each other's names, lists, or leaderboards.

## Deploy on your VPS (Ubuntu + Docker + a domain pointing at the VPS)
```bash
cp .env.example .env        # fill BOT_TOKEN, ADMIN_IDS, PUBLIC_URL, DOMAIN, POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec bot npm run seed
docker compose exec bot npm run import -- data/questions/sample.json --approve
```
Migrations run automatically on start. Firewall: allow only 22, 80, 443.

## Admin flow
1. Message the bot `/qr` → get the club QR image (valid 7 days, 500 uses). `/qr new` revokes old codes.
2. Students scan it → bot → **Complete sign-up** (Mini App) → game unlocks.
3. `REQUIRE_APPROVAL=true` puts sign-ups in `pending`; approve with `/approve <telegram_id>`.
4. `/stats` shows active/pending students and approved question pools.

## Mini App (the game UI)
Opens inside Telegram at `/app` (button "Open app" in the keyboard, plus the chat Menu button "Play").
Screens: Home (badge plate, XP, streak), Learn (track → language), Question (tip, hints, 3 attempts),
Result (XP, ahead/behind counts, code example), Play (tier-locked modes), Ranks (same-gender only), Profile.
Colors follow the user's Telegram theme; the accent changes with the student's badge tier.
Files: `webapp/app/` (no build step) and `src/api.ts` (every call verified with Telegram-signed initData).

## Admins (inside the bot)
Owners are the IDs in `ADMIN_IDS` (.env). They can add and remove other admins; those admins can add questions.
- `/admin` lists the admin commands. `/admins` lists everyone.
- `/addadmin <id or @username>` and `/removeadmin <id or @username>` (owners only). `@username` works for members who signed up.
- `/addquestion` sends a short template; fill it in and send it back (one question, goes live immediately).
- `/removequestion <id>` stops serving a question (history is kept).
- Send a `.json` file (same format as `data/questions/sample.json`) to add many questions at once.
Non-admins get no reply to any of these.

## Batch years
Ethiopian calendar. Set the range in `.env`: `BATCH_YEARS=2005-2014` (oldest-newest). The sign-up page and the server both use it.

## Student commands
`/context /next /progress /behind /leaderboard /help`

## Adding questions
`npm run import -- file.json [--approve]` — upsert by `external_id` (edits bump `version`).
Every question needs: options, answer (must match an option), up to 3 hints, concept tip, **snippet**.
Without `--approve` they stay `pending_review` and are not served.

## Rules implemented
- XP: 100% / 60% / 30% by attempt; hints cost 10% / 20% / 40%. 3 attempts max. Enforced server-side.
- Badge by total XP: 500 / 1,500 / 3,500 / 7,000 / 12,000. Level = XP/100 + 1.
- Difficulty follows your XP in the chosen language; you are never served a question twice.
- Gender rule lives in `src/db/visibility.ts`; every people-returning query uses it.
  Ahead/behind counts are anonymous totals.
- Sign-up identity comes only from Telegram-signed `initData` (HMAC verified), never from form input.
- Webhook verified by secret-token header.

## Not in the MVP yet (designed, next phases)
Duels/ranked/boss (the `canUse` badge gate is ready in `src/services/access.ts`), peer help `/ask`,
LLM question generation and nightly top-up, streak reminders, Redis rate limiting, full Mini App game UI.

## Dev
`npm test` (unit tests), `npm run typecheck`, `npm run db:generate` after schema edits.
No `PUBLIC_URL` → long polling (the sign-up Mini App then cannot open; Telegram requires HTTPS).

## Backups
`scripts/backup.sh` (cron nightly). Test a restore monthly.

## Friends

- Prompt appears after every 5th correct answer, on level-up and on badge-up (bot and Mini App).
- Request goes to the other student with Accept / Decline buttons. Until accepted they see only first name (or "A member"), batch year and badge.
- Gender rule applies to suggestions, requests, lists and callbacks; cross-gender ids answer "not found".
- Username is shown only to accepted friends whose "allow DM" privacy is on.
- Limits: 10 pending requests; 14-day cooldown after a decline; mutual requests connect at once.
- Commands: `/friends`. Test resets: delete from `friendships` before `students`.
