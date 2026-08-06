# AGENTS.md — PayTrack

Internal payment-coordination tool for **Go DinDin**. 4 users: 3 requesters (Priya, Rahul, Sneha) raise payments; 1 payer (Amit) pays and uploads proof. Self-hosted on **Hostinger**, **₹0 beyond the existing plan**.

**Read `paytrack-handoff-spec.md` first — it is the source of truth. `paytrack.html` is the finished UI to port. This file is the guardrails.**

---

## Non-negotiables (never violate)

1. **No `PAID` without a proof file attached.** Enforce in `lib/status.ts`, server-side.
2. **No `SCHEDULED` without a `scheduledFor` date.** Enforce in `lib/status.ts`, server-side.
3. **Every status change goes through the guarded transition function** in `lib/status.ts`. Nothing mutates `payment.status` directly — not in a route, not in the UI.
4. **UI checks are convenience only.** Server is the authority.
5. **No paid / external services.** No AWS, no Vercel, no S3/Blob, no WhatsApp API, no Atlas paid tier. If a task seems to need one, stop and ask — there is a free Hostinger-native or self-hosted answer.

---

## Stack (locked — do not swap without asking)

- **Next.js 14 (App Router) + TypeScript** — one app, UI + `/api` route handlers. No separate backend.
- **MySQL** via **Prisma**. (Money stored as integer **paise** / `BigInt`.)
- **File storage:** local disk at `UPLOAD_DIR`, outside the web root. **Never write uploads into `/public`.** Serve only through an auth-gated `GET /api/v1/attachments/:id`.
- **Auth:** Auth.js (NextAuth) email magic-link over Hostinger SMTP; **4 whitelisted emails only**, no public signup.
- **Reminders:** Hostinger cron → `POST /api/cron/reminders` every 15 min, guarded by `x-cron-secret`.
- **Notifications:** Telegram Bot API (free). Swap to WhatsApp later only if explicitly asked.
- **Deploy:** PM2 + Nginx + free Hostinger SSL. Deploy is the **last** step; develop locally.

---

## Build order (do this sequentially, test each step)

1. Scaffold Next.js + TS + Prisma. Add the schema from the spec. Run `prisma migrate dev` against local MySQL.
2. **`lib/status.ts`** — the state machine + the two hard rules + actor checks. Write unit tests for the transition table **before** moving on.
3. **API route handlers** (`app/api/v1/…`) on top of `lib/status.ts`. Zod-validate every body. Each write appends a `PaymentEvent` and calls the (stubbed) notifier.
4. **Port `paytrack.html`** to React components. Replace the in-memory `payments` array with calls to the API. Keep the existing design: status colours (icon + word + colour), plain language, Pay-From, amount-in-words, web + phone layouts.
5. **Auth**, then **Telegram** + **SMTP** — behind env vars. Stub the sends with `console.log` first so everything runs without real credentials.
6. **Seed** the 4 users; add the **cron** endpoint.
7. Only then, deploy to Hostinger.

---

## Conventions

- **Money:** integer paise end-to-end (`4500000` = ₹45,000). Format with `en-IN` grouping **only at the UI edge**.
- **`overdue` is derived, never stored:** `status ∈ {REQUESTED, SCHEDULED} AND dueDate < today`.
- **`PaymentEvent`** is both the chat thread and the audit log — append one on every meaningful action.
- **Roles:** only `payer` may schedule / pay / hold; only the **raising `requester`** may confirm receipt. Everyone can view everything.
- **Uploads:** validate mime (`image/*`, `application/pdf`) and size (≤10 MB); random stored filename; keep the original name for display.
- **Idempotency** keys on `pay` and `confirm`.
- **Secrets** in `.env` (gitignored), never committed. `UPLOAD_DIR` is gitignored.

---

## Reminder logic (get this right)

- Runs only inside working hours (`WORK_HOURS`, e.g. 09–21 IST) — no 3am pings.
- Payer gets one digest per 15-min tick; use `lastRemindedAt` to avoid double-sends.
- Overdue (`dueDate < today`) → also notify the raising requester.
- **Stop reminders the instant a payment is `PAID`.** Never remind on PAID / CONFIRMED / CANCELLED.
- Status-change pings (new request, paid→confirm, nudge) fire immediately on the action, not via cron.

---

## Don't

- Don't build or run against the Hostinger production server during development — local only until deploy.
- Don't put this in the Go DinDin marketplace repo — it's a **standalone** repo.
- Don't add a service that costs money or introduces AWS. Ask first.
- Don't enforce the hard rules only in React.
- Don't generate everything in one pass — build and test section by section.
