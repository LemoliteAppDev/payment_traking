# PayTrack — Handoff / Build Spec

> **Status:** Reconstructed. The original `paytrack-handoff-spec.md` referenced across the PRD/Architecture/CLAUDE.md was never delivered. This document reconstructs the field-level schema, transition table, API surface, env vars, and deploy commands from `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE-CHECKLIST.md`, `CLAUDE.md`, and the `docs/paytrack.html` prototype. Where the source docs disagree, the **ACCEPTANCE-CHECKLIST is authoritative** (it is the Definition of Done). Open questions are flagged inline.

---

## 1. Non-negotiables (from CLAUDE.md — never violate)

1. **No `PAID` without a proof `Attachment`.** Enforced in `lib/status.ts`, server-side.
2. **No `SCHEDULED` without a `scheduledFor` date.** Same.
3. **Every status change goes through the single guarded `transition()`** in `lib/status.ts`. Nothing mutates `payment.status` directly.
4. UI checks are convenience only — the server is the authority.
5. **No paid/external services.** No AWS, Vercel, S3/Blob, WhatsApp API, or Atlas paid tier.

## 2. Stack (locked)

- **Next.js 16 (App Router) + TypeScript** — one app, UI + `/api` route handlers. *(CLAUDE.md literally says "14"; we match Go DinDin's actual repo — Next 16 / React 19 / Tailwind 4 — per the "match existing stack" rationale in ARCHITECTURE §5.)*
- **MySQL 8** via **Prisma 7**. Money stored as integer **paise** in `BigInt`.
- **Files:** local disk at `UPLOAD_DIR`, outside the web root. Never `/public`. Served only via auth-gated `GET /api/v1/attachments/:id`.
- **Auth:** Auth.js (NextAuth v5) **credentials — login ID + password** (bcrypt); 4 whitelisted login IDs only, no self-signup. Passwords rotated by admin via `npm run set-password`. *(Magic-link/SMTP was the original plan; changed to password login so no real emails/SMTP are needed.)*
- **Reminders:** cron → `POST /api/cron/reminders` every 15 min, guarded by `x-cron-secret`.
- **Notifications:** Telegram Bot API. Stubbed with `console.log` until credentials exist.
- **Deploy:** PM2 + Nginx + Let's Encrypt SSL on Hostinger. Last step; develop locally.

---

## 3. Data model (Prisma / MySQL)

### `User`
| field | type | notes |
|---|---|---|
| id | String cuid PK | |
| name | String | display name |
| email | String @unique | must be in `AUTH_WHITELIST` |
| role | Role enum | `PAYER` \| `REQUESTER` |
| telegramChatId | String? | for Telegram pings |
| createdAt | DateTime @default(now()) | |

### `Payment`
| field | type | notes |
|---|---|---|
| id | String cuid PK | |
| amount | BigInt | **integer paise** (₹45,000 → `4500000`) |
| payee | String | shop/person |
| payFrom | Account enum | `PELISWAN` \| `LEMOLITE` \| `SHIVAM` \| `ZENITH` |
| purpose | String | |
| upi | String? | optional payee UPI/bank |
| status | Status enum | see §4 |
| dueDate | DateTime | "pay before" |
| scheduledFor | DateTime? | required to be `SCHEDULED` |
| requestedById | String FK→User | the raising requester |
| paidById | String? FK→User | |
| paidAt | DateTime? | |
| confirmedById | String? FK→User | |
| confirmedAt | DateTime? | |
| lastRemindedAt | DateTime? | reminder de-dupe |
| createdAt / updatedAt | DateTime | |

**`overdue` is NOT stored.** Derived: `status ∈ {REQUESTED, SCHEDULED} AND dueDate < startOfToday(APP_TZ)`.

### `Attachment`
| field | type | notes |
|---|---|---|
| id | String cuid PK | |
| paymentId | String FK→Payment | |
| kind | AttachmentKind enum | `INSTRUCTION` \| `PROOF` |
| originalName | String | shown in UI |
| storedName | String @unique | randomised on disk |
| mimeType | String | `image/*` or `application/pdf` |
| size | Int | bytes, ≤ 10 MB |
| uploadedById | String? FK→User | |
| createdAt | DateTime | |

### `PaymentEvent` (chat thread **and** audit log)
| field | type | notes |
|---|---|---|
| id | String cuid PK | |
| paymentId | String FK→Payment | |
| actorId | String? FK→User | null = system line |
| type | EventType enum | `REQUEST\|SCHEDULE\|PAY\|CONFIRM\|HOLD\|CANCEL\|NUDGE\|REMINDER\|NOTE` |
| message | String @db.Text | human-readable |
| attachmentId | String? FK→Attachment | links a file to its event |
| meta | Json? | structured detail (e.g. scheduledFor) |
| createdAt | DateTime @default(now()) | true action time |

### `IdempotencyKey`
| field | type | notes |
|---|---|---|
| key | String @id | client-supplied `Idempotency-Key` |
| scope | String | e.g. `pay:<paymentId>` |
| createdAt | DateTime | replays return the prior result |

---

## 4. State machine (authoritative — everything not listed is rejected)

Statuses: `REQUESTED, SCHEDULED, PAID, CONFIRMED, HOLD, CANCELLED`. Derived pseudo-status: `OVERDUE`.

| From | To | Actor allowed | Guard |
|---|---|---|---|
| REQUESTED | SCHEDULED | payer | `scheduledFor` present |
| REQUESTED | PAID | payer | ≥1 `PROOF` attachment present |
| REQUESTED | HOLD | payer | — |
| REQUESTED | CANCELLED | payer **or** raising requester | — |
| SCHEDULED | PAID | payer | ≥1 `PROOF` attachment present |
| SCHEDULED | HOLD | payer | — |
| HOLD | SCHEDULED | payer | `scheduledFor` present |
| HOLD | PAID | payer | ≥1 `PROOF` attachment present |
| PAID | CONFIRMED | raising requester only | — |

- `CONFIRMED` and `CANCELLED` are **terminal** — no further transitions.
- Every successful transition appends exactly one `PaymentEvent`.
- **Open question (flagged):** ACCEPTANCE-CHECKLIST §B lists `CANCELLED` only from `REQUESTED`. PRD open-decision #5 hints "cancel while not-yet-Paid" (would allow SCHEDULED/HOLD → CANCELLED). **We implement the checklist strictly (cancel from REQUESTED only).** Change here if the product owner overrides.

### Role model
- `payer` (Amit): schedule / pay / hold. Cannot confirm.
- `requester` (Priya/Rahul/Sneha): raise; confirm receipt **only on their own** raised payment; nudge; cancel own not-yet-paid. Read-only on everyone else's.
- Everyone can **view** everything.

---

## 5. API surface (`/api/v1`, all session-guarded except cron)

Money crosses the wire as a **string of paise** (JSON has no BigInt); the UI formats at the edge.

| Method + path | Who | Body | Effect |
|---|---|---|---|
| `POST /payments` | requester | multipart: amount(paise), payee, payFrom, purpose, dueDate, upi?, file? | Create `REQUESTED` + optional `INSTRUCTION` attachment + `REQUEST` event → ping payer |
| `GET /payments?filter=&q=` | any | — | Server-side filter (`all\|mine\|requested\|scheduled\|overdue\|paid`) + search (payee/purpose/amount/by/from) |
| `GET /payments/:id` | any | — | Detail: payment + ordered events + attachments |
| `POST /payments/:id/schedule` | payer | `{ scheduledFor }` | → `SCHEDULED` (guard date) → ping requester |
| `POST /payments/:id/pay` | payer | multipart: proof file (required) + note? ; `Idempotency-Key` header | → `PAID` (guard proof) → ping requester "please confirm" |
| `POST /payments/:id/hold` | payer | `{ reason? }` | → `HOLD` |
| `POST /payments/:id/confirm` | raising requester | `Idempotency-Key` header | → `CONFIRMED` |
| `POST /payments/:id/cancel` | payer or raising requester | `{ reason? }` | REQUESTED → `CANCELLED` |
| `POST /payments/:id/nudge` | requester | — | Append `NUDGE` event → ping payer (no status change) |
| `GET /attachments/:id` | any signed-in | — | Streams the file from `UPLOAD_DIR` with correct content-type |
| `POST /api/cron/reminders` | cron | header `x-cron-secret` | Runs the digest (see §7). **Not** session-guarded; secret-guarded. |

- Every write is Zod-validated, runs inside `lib/status.ts.transition()`, appends a `PaymentEvent`, and calls the (stubbed) notifier.
- Errors: `400` validation, `401` no session, `403` wrong role/ownership or illegal transition, `409` guard failure (missing proof/date) or idempotency replay conflict, `404` unknown id.

## 6. Uploads

- Accept **only** `image/*` and `application/pdf`. Reject everything else → `415`.
- Reject `> MAX_UPLOAD_MB` (10) → `413`.
- Store under `UPLOAD_DIR` with a **randomised** filename; keep `originalName` for display.
- Files are **never** under `/public`; the only read path is the auth-gated attachment route.

## 7. Reminder subsystem

- `POST /api/cron/reminders` every 15 min (Hostinger cron). Rejects without correct `x-cron-secret`.
- **Working-hours gate:** only inside `WORK_HOURS_START..WORK_HOURS_END` in `APP_TZ` (IST). No pings outside.
- Gather **pending** = status ∈ {REQUESTED, SCHEDULED, HOLD}. One **digest** to the payer per tick; `lastRemindedAt` de-dupes overlapping runs (skip payments reminded within the tick window).
- **Overdue** items (dueDate < today) additionally ping the **raising requester**.
- **Hard stop the instant a payment is `PAID`.** Nothing fires for PAID / CONFIRMED / CANCELLED.
- Event-driven pings (new request → payer, paid → requester, nudge → payer) fire immediately on the action, not via cron.

## 8. Environment variables

See `.env.example`. Keys: `DATABASE_URL`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `AUTH_SECRET`, `AUTH_WHITELIST`, `EMAIL_SERVER_*`, `EMAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `WORK_HOURS_START/END`, `APP_TZ`. Secrets live in `.env` (gitignored), never committed.

## 9. Seed data (the 4 real users)

| name | role | login ID (whitelist) |
|---|---|---|
| Mahesh | PAYER | mahesh@payment.com |
| Jignesh | REQUESTER | jignesh@payment.com |
| Jagat | REQUESTER | jagat@payment.com |
| Bhadresh | REQUESTER | bhadresh@payment.com |

> Login IDs are internal handles (not real mailboxes) on the admin-controlled `@payment.com` domain. Seeded with temp password `paytrack123`; rotate via `npm run set-password`. Keep `.env` `AUTH_WHITELIST` in sync.

## 10. Deploy appendix (Hostinger — run later, not during local dev)

1. Node-capable plan (Cloud/Business or VPS). Install Node LTS, PM2, Nginx.
2. `git clone` → `npm ci` → set server `.env` → `npx prisma migrate deploy`.
3. `npm run build` → `pm2 start npm --name paytrack -- start` → `pm2 save`.
4. Nginx: terminate SSL (Let's Encrypt / certbot), proxy `443 → 127.0.0.1:3000`.
5. Persistent `UPLOAD_DIR` writable by the app user.
6. Cron: `*/15 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://<domain>/api/cron/reminders`.
7. Nightly `mysqldump` + `UPLOAD_DIR` copy; **test one restore**.
