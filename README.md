# CodeClub Arena (MVP)

Telegram bot + sign-up Mini App. Students scan a club QR, sign up (name, batch year, gender), choose a
context (track → language), answer questions, earn XP and badges (Bronze → Adamantium), and see a code
example after every answer. Men and women never see each other's names, lists, or leaderboards.

## Hosting overview

| | Test | Launch |
|---|---|---|
| Server | Vercel (`api/index.ts`, webhook only) | VPS (`src/index.ts` in Docker) |
| Database | Supabase Postgres | Postgres in Docker on the VPS |
| URL | `https://<project>.vercel.app` | `https://<your domain>` |

The same code runs in both. Only `.env` values differ.

## Deploy on a VPS (launch)

### Handover: who does what (the VPS is run by someone else)
`.env` holds secrets and is **not in GitHub** (blocked by `.gitignore`). The repo only has `.env.example`, a
template with no secrets. So the host creates their own `.env` on the server from the values below.

**The club owner gives the host** (send privately, e.g. Telegram direct message; never in GitHub, a group or an issue):

| Value | Where it comes from |
|---|---|
| `BOT_TOKEN` | @BotFather → the bot → API Token (revoke and re-issue it if it was ever shared publicly) |
| `ADMIN_IDS` | owner's Telegram numeric ID (@userinfobot) |
| `BATCH_YEARS` | e.g. `2014-2019` (Ethiopian calendar) |
| Repo access | GitHub repo → Settings → Collaborators → invite the host (read access), **or** the host sends a deploy key (step 3) |

**The host decides or creates:**

| Value | How |
|---|---|
| `DOMAIN` / `PUBLIC_URL` | domain with an A record to the VPS IP, e.g. `arena.example.com` / `https://arena.example.com` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24`, kept only on the server |

**The host then:** installs Docker (step 2), clones the repo (step 3), creates `.env` (step 4), starts it, and
sets up backups (step 6). Afterwards the host tells the owner the domain; the owner sends `/qr new` to the bot.

**Rules for the host:** never commit `.env`; never change `POSTGRES_PASSWORD` after the first start (the
database keeps the old one); keep ports 80/443 open and 5432 closed.

### What you need
- A VPS: Ubuntu 22.04 or 24.04, 1 vCPU, 1 GB RAM minimum (2 GB is comfortable), 10 GB disk.
- A domain (or subdomain, e.g. `arena.example.com`) with an **A record** pointing to the VPS IP.
- Ports **80 and 443** open. Port 5432 (Postgres) is never published.
- Your bot token (@BotFather) and your Telegram numeric ID (@userinfobot).
- A **private** GitHub repository with this project.

### 1. Put the code in a private GitHub repo (on your PC, once)
```bash
cd codeclub-arena
git init && git add . && git commit -m "CodeClub Arena"
# create an EMPTY private repo on github.com first (no README), then:
git branch -M main
git remote add origin git@github.com:<you>/codeclub-arena.git
git push -u origin main
```
`.env` is in `.gitignore`: **never commit secrets** (bot token, passwords).

### 2. Prepare the server
```bash
ssh root@<vps-ip>
adduser deploy && usermod -aG sudo deploy      # work as a normal user, not root
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```
Install Docker Engine and the **compose plugin** (Ubuntu's own `docker.io` package has no `docker compose`):
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy                 # log out and in again
docker compose version                         # must print a version
sudo apt install -y git
```

### 3. Let the server read the private repo (read-only deploy key, or use a GitHub invite)
```bash
ssh-keygen -t ed25519 -C "vps-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```
GitHub repo → **Settings → Deploy keys → Add deploy key** → paste it, leave "Allow write access" **off**.
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/deploy_key\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:<you>/codeclub-arena.git && cd codeclub-arena
```

### 4. Configure and start
```bash
cp .env.example .env && nano .env     # .env is not in GitHub: create it here from the handover table
```
| Key | Value |
|---|---|
| `BOT_TOKEN` | token from @BotFather |
| `ADMIN_IDS` | your Telegram numeric ID (owners; comma-separated) |
| `DOMAIN` | `arena.example.com` (Caddy gets the HTTPS certificate for it) |
| `PUBLIC_URL` | `https://arena.example.com` |
| `POSTGRES_PASSWORD` | long random string (`openssl rand -hex 24`) |
| `BATCH_YEARS` | e.g. `2014-2019` (Ethiopian calendar) |

`DATABASE_URL` in `.env` is ignored here: compose builds it from `POSTGRES_PASSWORD`.
```bash
docker compose up -d --build
docker compose exec bot npm run seed
docker compose exec bot npm run import -- data/questions/sample.json --approve
docker compose logs -f bot        # "Webhook mode: https://..." means it works
```
Migrations and the Telegram webhook are set automatically on start. Then message the bot `/qr new`.

### 5. Update later
```bash
cd ~/codeclub-arena && git pull && docker compose up -d --build
```

### 6. Backups (do this before real students join)
```bash
chmod +x scripts/backup.sh && crontab -e
# add:  0 2 * * *  /home/deploy/codeclub-arena/scripts/backup.sh
```
Copy backups off the server too (`RCLONE_REMOTE`, see the script).

### Troubleshooting
- HTTPS certificate fails: the domain's A record must already point to the VPS, and ports 80/443 must be open.
- Mini App shows "no tunnel" or a blank page: `PUBLIC_URL` is wrong or does not match `DOMAIN`.
- `docker compose logs bot` and `docker compose logs caddy` show the reason for most problems.

## Test hosting: Vercel + Supabase (fixed URL, no tunnel)
1. **Supabase**: create a project (region near you) → **Connect → Transaction pooler** → copy the URI
   (port `6543`) and put your DB password in it.
2. **On your PC**, in `.env` use that URI as `DATABASE_URL`, then:
   ```bash
   npm run db:migrate && npm run seed && npm run import -- data/questions/sample.json --approve
   ```
3. **Vercel**: push the repo to GitHub → **Add New Project** → import it. Add environment variables:
   `BOT_TOKEN`, `DATABASE_URL` (the pooler URI), `ADMIN_IDS`, `BATCH_YEARS`, `PUBLIC_URL`
   (`https://<project>.vercel.app`, known after the first deploy: set it, then redeploy).
4. **On your PC**, with `PUBLIC_URL` set in `.env`, run once: `npm run setup:telegram`
   (registers webhook, menu button and commands). Repeat only if `PUBLIC_URL` changes.
5. Message the bot `/qr new`.

Notes: Vercel runs only webhook mode; migrations are run from your PC, not at startup; the 2-second
sign-up cooldown is per function instance (fine for testing). Moving to the VPS later: `pg_dump` the
Supabase DB into the VPS database (or start fresh), then follow the VPS steps above.

## Admin flow
1. Message the bot `/qr` → get the club QR image (valid 7 days, 500 uses). `/qr new` revokes old codes.
2. Students scan it → bot → **Complete sign-up** (Mini App) → game unlocks.
3. **Sign-up without the QR code:** anyone who opens the bot and sends `/start` gets a **Sign up** button. Those
   sign-ups wait as `pending`; admins are notified and use `/pending` (Approve / Reject buttons) or
   `/approve <telegram_id>`. Set `OPEN_SIGNUP=false` in `.env` to allow QR sign-ups only.
4. `REQUIRE_APPROVAL=true` also puts QR sign-ups in `pending`.
5. `/stats` shows active/pending students and approved question pools.

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
