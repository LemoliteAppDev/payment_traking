# PayTrack — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | PayTrack *(working name)* |
| **Owner** | Dharmik — Go DinDin |
| **Status** | Draft v1 — for MVP build |
| **Last updated** | 13 Jul 2026 |
| **Related** | `paytrack-handoff-spec.md` (build spec) · `ARCHITECTURE.md` · `CLAUDE.md` · `paytrack.html` (design prototype) |

---

## 1. Summary

PayTrack gives a small team **one shared, always-current view of every payment** — who asked for it, whether it's been paid, the proof — and **reminds the payer** so nothing slips. It replaces scattered WhatsApp messages and memory with a single source of truth.

## 2. Problem

Three people raise payment instructions in mixed formats (text, PDF, image, invoice). One person pays them all and uploads proof somewhere. Two failures result:

1. **Confusion** — nobody can reliably tell whether a given payment is done.
2. **Forgetting** — a verbal "I'll do it tomorrow" isn't recorded anywhere, so payments slip and everyone forgets.

## 3. Goals & non-goals

**Goals**
- A single source of truth for payment status.
- Make "is it done?" answerable in seconds.
- Guarantee no committed payment is forgotten.
- Keep proof + a full audit trail for every payment.

**Non-goals (MVP)**
- Not executing payments — no bank/UPI/CashFree integration. This tracks status only; a human still pays.
- Not accounting/ledger/GST software.
- No OCR auto-reading of invoices (Phase 3).
- No public users — internal, 4 people only.

## 4. Users & personas

| Persona | Who | Needs |
|---|---|---|
| **Requester** | Priya, Rahul, Sneha | Raise payments, track their own, know when theirs is paid, confirm receipt, nudge the payer |
| **Payer** | Amit | See the full queue by urgency, schedule with a date, pay + upload proof, put on hold, be reminded of pending items |

Fixed set of 4 internal users. No signup; access is a 4-email whitelist.

## 5. Success metrics

- **100%** of `PAID` payments have a proof file attached (hard requirement).
- Near-zero "did we pay X?" questions in team chat (qualitative signal).
- **Overdue count trends to ~0** week over week.
- Low **time-to-confirm** (paid → requester confirmed).
- All 4 users active weekly.

## 6. User stories

**Requester**
- As a requester I can **raise a payment** with amount, pay-from account, payee, purpose, due date, and an optional file, so the payer has everything needed.
- As a requester I can see **only my raised payments** and their status, so I can track mine without noise.
- As a requester I'm **notified when mine is scheduled or paid**, so I'm not chasing.
- As a requester I **confirm receipt** once it's paid, so the loop is closed.
- As a requester I can **nudge the payer** on a late payment, instead of pinging on WhatsApp.

**Payer**
- As the payer I see **everything to pay, sorted by urgency**, so I act on the right one first.
- As the payer I **schedule a payment for a concrete date** (date required), so it's a real commitment, not a vague "tomorrow".
- As the payer I **mark a payment paid and upload proof** (proof required), so everyone can trust it's done.
- As the payer I **put a payment on hold** when info is missing.
- As the payer I'm **reminded every 15 minutes** while payments are pending, so nothing is forgotten.

**Shared**
- Search and filter payments (All / Mine / Waiting / Planned / Late / Paid).
- See a payment's **full history** — the instruction, the schedule, the proof, confirmations — as one thread.
- **Colour-coded status** (icon + word + colour) everywhere, readable at a glance.

## 7. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Status lifecycle: Requested → Scheduled → Paid → Confirmed, with Hold and Cancelled branches. `Overdue` is derived, not a stored state. |
| FR-2 | **Hard rule:** a payment cannot become `Paid` without a proof file attached. |
| FR-3 | **Hard rule:** a payment cannot become `Scheduled` without a concrete date. |
| FR-4 | Upload of instruction files and proof (image/PDF), stored privately, viewable only to signed-in users. |
| FR-5 | Automatic reminder to the payer every 15 min while payments are pending; overdue items also notify the requester. |
| FR-6 | Role-aware behaviour: only the payer schedules/pays/holds; only the raising requester confirms receipt. |
| FR-7 | Search + filter across all payments. |
| FR-8 | Notifications on key events (new request, scheduled, paid→confirm, overdue, nudge) via Telegram. |
| FR-9 | Full audit trail / activity thread per payment (who did what, when). |
| FR-10 | Capture **Pay-From** account (Peliswan / Lemolite / Shivam / Zenith) and show the **amount in words** with Indian comma formatting on entry. |
| FR-11 | Works on **web (desktop)** and **phone (PWA)** with layouts tuned to each. |

## 8. Non-functional requirements

- **Cost:** ₹0 beyond the existing Hostinger plan. No paid/managed cloud services.
- **Scale:** 4 users, low volume (tens of payments/week). Single-node is fine.
- **Availability:** business-hours-critical; brief downtime is tolerable.
- **Security:** email whitelist auth; proof/instruction files are private (auth-gated); secrets never in the repo.
- **Accessibility:** plain, spoken language; status conveyed by icon + word + colour (not colour alone).
- **Devices:** responsive web + installable PWA on phone.
- **Data safety:** nightly DB dump + uploads backup; tested restore.

## 9. Scope & roadmap

| Phase | Contents |
|---|---|
| **MVP (Phase 0–1)** | Full lifecycle, both hard rules, file upload, roles, colour-coded status, search/filter, web + phone, 15-min payer reminder + overdue escalation, Telegram notifications, confirm loop. |
| **Phase 2** | Daily digest, comment threads, CSV export for accounting, richer reminder settings, optional Hindi/Gujarati UI. |
| **Phase 3** | WhatsApp Business API notifications, OCR to auto-fill from invoices, recurring payments, accounting/ledger hook. |

## 10. Assumptions & open decisions

Defaults chosen so the build isn't blocked — **please confirm or override**:

| # | Decision | Default assumed |
|---|---|---|
| 1 | Is requester **confirmation mandatory** to fully close a payment? | **Yes** — "done" = paid + proof + requester confirmed. |
| 2 | **Working hours** for reminders | 09:00–21:00 IST; no pings outside. |
| 3 | **Amounts** — paise allowed? | Whole rupees in the UI (stored as paise internally). |
| 4 | **Language** | English for MVP; Hindi/Gujarati in Phase 2 (noted for older users). |
| 5 | **Who can cancel/edit** a raised payment | Payer, or the requester who raised it, while not yet Paid; edits logged. |
| 6 | **Accounting export** | Deferred to Phase 2 (CSV). |

## 11. Out of scope (explicitly)

Executing real payments; multi-company/multi-team; public accounts; approval hierarchies beyond the single payer; mobile native apps (the PWA covers phone).
