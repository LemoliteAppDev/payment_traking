# PayTrack — Acceptance Checklist (Definition of Done)

Every item must pass before MVP is considered shipped. Grouped by area. The **hard-rule** and **state-machine** sections are the ones that protect the product's whole purpose — treat failures there as blockers.

---

## A. The two hard rules (blockers)

- [ ] A `pay` request **without a proof file is rejected** by the API (not just the UI), and the payment stays in its prior status.
- [ ] A `schedule` request **without a date is rejected** by the API.
- [ ] Both rules hold even when called directly (bypassing the UI) — verified with a raw API call.
- [ ] A payment can never show `Paid` unless a proof `Attachment` exists on it.

## B. State machine

- [ ] Only these transitions succeed: Requested→Scheduled/Paid/Hold/Cancelled, Scheduled→Paid/Hold, Hold→Scheduled/Paid, Paid→Confirmed.
- [ ] Every other transition is rejected.
- [ ] `Confirmed` and `Cancelled` are terminal — no further changes.
- [ ] `Overdue` is computed (Requested/Scheduled + past due date), never stored, and updates automatically as the date passes.
- [ ] Every successful transition writes a `PaymentEvent`.

## C. Roles & permissions

- [ ] A **requester cannot** schedule, mark paid, or hold any payment.
- [ ] Only the **payer** can schedule / pay / hold.
- [ ] Only the **requester who raised** a payment can confirm receipt on it.
- [ ] A requester viewing someone else's payment gets a read-only view.
- [ ] Sign-in is refused for any email outside the 4-person whitelist.

## D. Reminders

- [ ] Cron endpoint rejects any request without the correct `x-cron-secret`.
- [ ] No reminders fire outside configured working hours.
- [ ] The payer receives at most one digest per 15-min tick (no duplicates from overlapping runs).
- [ ] Overdue payments additionally notify the requester who raised them.
- [ ] Reminders **stop immediately** once a payment is `Paid`; nothing fires for Paid/Confirmed/Cancelled.
- [ ] Event pings (new request → payer, paid → requester, nudge → payer) fire on the action, not only via cron.

## E. Files / uploads

- [ ] Only `image/*` and `application/pdf` accepted; other types rejected.
- [ ] Files larger than 10 MB rejected.
- [ ] Uploaded files are **not** reachable via a public URL / `/public`.
- [ ] Files are viewable only through the authenticated attachment route.
- [ ] Original filename shown in UI; stored filename is randomised.

## F. Data integrity

- [ ] Amounts stored as integer paise; `₹1,20,000` renders with correct Indian grouping.
- [ ] Amount-in-words on the entry form matches the number (thousands/lakhs/crores).
- [ ] `Pay From` is one of the allowed accounts and is shown on the card and detail.
- [ ] `PaymentEvent` history reflects the true order of actions with correct actor + time.

## G. UI — web & phone

- [ ] Web shows the two-pane layout (list + detail); phone shows single-column with full-screen detail + back button.
- [ ] Status is shown as icon + word + colour everywhere (not colour alone).
- [ ] Filters (All / Mine / Waiting / Planned / Late / Paid) and search work and match server data.
- [ ] Phone dashboard cards are the compact swipeable row with working position dots.
- [ ] "Add a payment" is reachable (top bar on web, bottom bar on phone); forms are bottom sheets on phone.
- [ ] A requester sees "You asked for this" and the "confirm" prompt on their own paid items.

## H. Auth & session

- [ ] Magic-link login works end-to-end via Hostinger SMTP.
- [ ] Session persists; role is available server-side on every request.
- [ ] All app pages and `/api/v1/*` require a valid session (cron route excepted, secret-guarded).

## I. Deployment & ops

- [ ] App runs under PM2 behind Nginx with valid SSL on the real domain.
- [ ] `prisma migrate deploy` creates the schema on Hostinger MySQL.
- [ ] The 15-min cron job is installed and confirmed firing.
- [ ] `UPLOAD_DIR` is persistent and writable by the app.
- [ ] Nightly MySQL dump + uploads backup configured; **a restore has been tested once**.
- [ ] No secrets in the repo; all in server `.env`.

---

## Definition of Done (MVP)

All boxes above checked, the 4 real users seeded and able to log in, at least one payment taken through the **full** lifecycle (raised → scheduled → paid with proof → confirmed) in production, and the payer verified to receive the 15-minute reminder.
