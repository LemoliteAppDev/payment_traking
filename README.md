# PayTrack — Go DinDin

Internal payment-coordination tool. 3 requesters raise payments; 1 payer pays and uploads proof. One shared source of truth, a full audit trail, and 15-minute reminders so nothing slips.

- **Product docs:** [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ACCEPTANCE-CHECKLIST.md`](docs/ACCEPTANCE-CHECKLIST.md)
- **Build spec (source of truth):** [`paytrack-handoff-spec.md`](paytrack-handoff-spec.md)
- **Guardrails:** [`CLAUDE.md`](CLAUDE.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Prisma 6 + **MySQL** · Auth.js (magic-link) · Telegram notifications · local-disk uploads.

Money is stored end-to-end as integer **paise** (`BigInt`) and formatted only at the UI edge.

## The two hard rules (enforced server-side in `src/lib/status.ts`)

1. A payment can never become **PAID** without a proof attachment.
2. A payment can never become **SCHEDULED** without a date.

Every status change goes through the single guarded `transition()`. Nothing mutates `payment.status` directly.

## Local setup

```bash
# 1. MySQL (Homebrew). Or use Docker: `docker compose up -d` and update DATABASE_URL.
brew services start mysql
mysql -u root -e "CREATE DATABASE IF NOT EXISTS paytrack CHARACTER SET utf8mb4;"

# 2. Env + deps
cp .env.example .env        # defaults work for local dev
npm install

# 3. Schema + seed the 4 users (with a temporary password)
npx prisma migrate dev
npm run db:seed

# 4. Run
npm run dev                 # http://localhost:3000
```

## Users & login

Login is **login ID + password** (no magic link, no self-signup). The 4 users are seeded with the login IDs below and a **temporary password `paytrack123`** — change each before real use.

| Login ID | Role |
|---|---|
| `mahesh@payment.com` | Payer |
| `jignesh@payment.com` · `jagat@payment.com` · `bhadresh@payment.com` | Requesters |

```bash
# Rotate a password (admin only — the only way to change one):
npm run set-password -- mahesh@payment.com "a-strong-password"
```

The `@payment.com` IDs are internal login handles, not real mailboxes — change them (and `AUTH_WHITELIST`) if you prefer. Seed sample data with `SEED_DEMO=1 npm run db:seed`.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests — the state machine + money (56 tests) |
| `npm run build` | Production build |
| `npm run set-password -- <id> "<pw>"` | Set/rotate a user's password |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma |

## Verifying the core (bypassing the UI)

The two hard rules and the state machine hold on raw API calls, not just in the UI:

```bash
# reject pay without proof (payment stays put). In non-production, the
# x-dev-user header impersonates a user for API testing (never works in prod).
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "x-dev-user: mahesh@payment.com" \
  http://localhost:3000/api/v1/payments/<id>/pay      # => 409

# the 15-min reminder digest (secret-guarded, working-hours gated)
curl -s -X POST -H "x-cron-secret: <CRON_SECRET from .env>" \
  http://localhost:3000/api/cron/reminders
```

## Notifications in dev

Telegram sends are **stubbed to the console** until `TELEGRAM_BOT_TOKEN` is set in `.env`. Watch the dev server log for `[notify:stub]` lines. (Login is password-based, so no email/SMTP is needed.)

## Deploy

Deployment to Hostinger (PM2 + Nginx + SSL + cron) is a later, separate step — see the appendix in [`paytrack-handoff-spec.md`](paytrack-handoff-spec.md). Develop locally until then.
