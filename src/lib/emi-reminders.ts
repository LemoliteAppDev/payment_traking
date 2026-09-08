// EMI reminders — a standalone list from Payment. Jignesh (the manager) adds
// rows manually or by uploading a CSV; Jignesh, Jagat and Mahesh (manager /
// approver / payer) see them, get the pushes, and any one of them can mark a
// row paid.
//
// Firing rule: D-3, D-2, D-1 and D — and then daily past the due date until
// somebody marks it paid. Two sends a day (11:00 and 21:00 IST), deliberately
// independent of WORK_HOURS, which stops at 21:00 and would swallow the
// evening send.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { sendPushToUser } from "@/lib/push";
import { formatINR } from "@/lib/money";
import { hourInTz, ymdInTz } from "@/lib/time";
import type { SessionUser } from "@/lib/session";

/** Reminders start this many days before the due date (6th → 3rd, 4th, 5th, 6th). */
export const LEAD_DAYS = 3;

/** Hours (APP_TZ) at which the digest goes out. */
function reminderHours(): number[] {
  const raw = process.env.EMI_REMINDER_HOURS ?? "11,21";
  const hours = raw
    .split(",")
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return hours.length ? hours : [11, 21];
}

// Long enough to collapse the four cron ticks inside one hour into a single
// send, short enough that 11:00 and 21:00 stay separate sends.
const DEDUPE_MS = 5 * 60 * 60 * 1000;

// ── access ──────────────────────────────────────────────────────────
/** The three people this feature is for: Jignesh, Jagat, Mahesh. */
export function canViewReminders(user: SessionUser): boolean {
  return user.isManager || user.isApprover || user.isPayer;
}

export function requireReminderViewer(user: SessionUser): void {
  if (!canViewReminders(user)) {
    throw new ApiError(403, "FORBIDDEN", "Reminders are for Jignesh, Jagat and Mahesh only.");
  }
}

/** Only the manager may add, edit, import or delete. */
export function requireReminderManager(user: SessionUser): void {
  if (!user.isManager) {
    throw new ApiError(403, "FORBIDDEN", "Only Jignesh can add or change reminders.");
  }
}

// ── dates ───────────────────────────────────────────────────────────
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' of a stored due date (kept at UTC midnight). */
export function dueYmd(d: Date): string {
  return ymdInTz(d, "UTC");
}

/** Whole days from `fromYmd` to `toYmd` — negative once the due date has passed. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS);
}

/** Days until due, evaluated in APP_TZ. 0 = due today, negative = late. */
export function daysUntilDue(due: Date, now: Date = new Date()): number {
  return daysBetweenYmd(ymdInTz(now), dueYmd(due));
}

/** In the reminder window: due within LEAD_DAYS, or already past due. */
export function isDueForReminder(due: Date, now: Date = new Date()): boolean {
  return daysUntilDue(due, now) <= LEAD_DAYS;
}

/** 'YYYY-MM-DD' -> the UTC-midnight Date we store. */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

// ── shaping ─────────────────────────────────────────────────────────
type ReminderRow = {
  id: string; description: string; amount: bigint; dueDate: Date; status: "PENDING" | "PAID";
  paidOn: Date | null; paidAt: Date | null; paidNote: string | null; createdAt: Date;
  createdBy: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
};

function shape(r: ReminderRow) {
  const days = daysUntilDue(r.dueDate);
  return {
    id: r.id,
    description: r.description,
    amount: r.amount.toString(),
    dueDate: dueYmd(r.dueDate),
    status: r.status,
    daysUntilDue: days,
    late: r.status === "PENDING" && days < 0,
    inWindow: r.status === "PENDING" && days <= LEAD_DAYS,
    paidOn: r.paidOn ? dueYmd(r.paidOn) : null,
    paidAt: r.paidAt?.toISOString() ?? null,
    paidNote: r.paidNote ?? "",
    paidBy: r.paidBy ? { id: r.paidBy.id, name: r.paidBy.name } : null,
    createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name } : null,
    createdAt: r.createdAt.toISOString(),
  };
}
export type ReminderDTO = ReturnType<typeof shape>;

const include = {
  createdBy: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
} as const;

// ── CRUD ────────────────────────────────────────────────────────────
export async function listReminders(): Promise<ReminderDTO[]> {
  const rows = await prisma.reminder.findMany({
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    include,
  });
  return rows.map(shape);
}

export interface ReminderInput {
  description: string;
  amount: bigint;
  dueDate: Date;
}

export async function createReminder(input: ReminderInput, user: SessionUser): Promise<ReminderDTO> {
  const r = await prisma.reminder.create({
    data: {
      description: input.description,
      amount: input.amount,
      dueDate: input.dueDate,
      createdById: user.id,
    },
    include,
  });
  return shape(r);
}

export async function updateReminder(id: string, input: Partial<ReminderInput>): Promise<ReminderDTO> {
  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Reminder not found.");
  const r = await prisma.reminder.update({
    where: { id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      // Editing the due date reopens the reminder window, so clear the stamp.
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate, lastRemindedAt: null } : {}),
    },
    include,
  });
  return shape(r);
}

export async function deleteReminder(id: string): Promise<void> {
  await prisma.reminder.delete({ where: { id } }).catch(() => {
    throw new ApiError(404, "NOT_FOUND", "Reminder not found.");
  });
}

/** Any of the three marks it paid; reminders stop the instant this lands. */
export async function markReminderPaid(
  id: string,
  input: { paidOn?: Date; note?: string },
  user: SessionUser,
): Promise<ReminderDTO> {
  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Reminder not found.");
  if (existing.status === "PAID") {
    // Idempotent: a second tap from another phone shouldn't overwrite the first.
    const r = await prisma.reminder.findUnique({ where: { id }, include });
    return shape(r as ReminderRow);
  }
  const r = await prisma.reminder.update({
    where: { id },
    data: {
      status: "PAID",
      paidOn: input.paidOn ?? ymdToDate(ymdInTz(new Date())),
      paidAt: new Date(),
      paidById: user.id,
      paidNote: input.note?.trim() || null,
    },
    include,
  });
  return shape(r);
}

/** Undo a wrong "paid" mark — manager only, enforced at the route. */
export async function unmarkReminderPaid(id: string): Promise<ReminderDTO> {
  const r = await prisma.reminder
    .update({
      where: { id },
      data: { status: "PENDING", paidOn: null, paidAt: null, paidById: null, paidNote: null, lastRemindedAt: null },
      include,
    })
    .catch(() => {
      throw new ApiError(404, "NOT_FOUND", "Reminder not found.");
    });
  return shape(r);
}

// ── CSV import ──────────────────────────────────────────────────────
export interface ParsedRow {
  line: number;
  dueDate: string; // YYYY-MM-DD
  description: string;
  amount: string; // paise
}
export interface RowError {
  line: number;
  raw: string;
  message: string;
}
export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
}

/** Split one CSV line, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "," || c === "\t") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Accepts DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD and "6 Sep 2026".
 * Day-first, not month-first — these sheets are Indian.
 */
export function parseDueDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) return buildYmd(+iso[1], +iso[2], +iso[3]);

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    let year = +dmy[3];
    if (year < 100) year += 2000;
    return buildYmd(year, +dmy[2], +dmy[1]);
  }

  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2}|\d{4})$/.exec(s);
  if (named) {
    const m = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (!m) return null;
    let year = +named[3];
    if (year < 100) year += 2000;
    return buildYmd(year, m, +named[1]);
  }
  return null;
}

function buildYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31 Feb and friends, which Date would silently roll over.
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "₹45,000", "45000.50", "45 000" -> integer paise. */
export function parseAmountToPaise(raw: string): bigint | null {
  const cleaned = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [rupees, paise = ""] = cleaned.split(".");
  const value = BigInt(rupees) * 100n + BigInt(paise.padEnd(2, "0"));
  return value > 0n ? value : null;
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return /due|date/.test(joined) && /amount|amt/.test(joined);
}

/**
 * Parse the sheet: three columns, in order — DUE DATE, EMI DESCRIPTION, AMOUNT.
 * A header row is detected and skipped. Bad rows are reported, not thrown, so
 * the good ones can still be imported.
 */
export function parseReminderCsv(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw);
    if (cells.every((c) => !c)) return;
    if (i === 0 && looksLikeHeader(cells)) return;

    if (cells.length < 3) {
      errors.push({ line, raw, message: "Needs 3 columns: due date, description, amount." });
      return;
    }
    const [dateCell, descCell, amountCell] = cells;
    const dueDate = parseDueDate(dateCell);
    if (!dueDate) {
      errors.push({ line, raw, message: `Can't read the date "${dateCell}". Use DD/MM/YYYY.` });
      return;
    }
    const description = descCell.trim();
    if (!description) {
      errors.push({ line, raw, message: "Description is empty." });
      return;
    }
    if (description.length > 500) {
      errors.push({ line, raw, message: "Description is longer than 500 characters." });
      return;
    }
    const amount = parseAmountToPaise(amountCell);
    if (amount === null) {
      errors.push({ line, raw, message: `Can't read the amount "${amountCell}".` });
      return;
    }
    rows.push({ line, dueDate, description, amount: amount.toString() });
  });

  return { rows, errors };
}

export interface ImportResult {
  parsed: number;
  imported: number;
  duplicates: ParsedRow[];
  errors: RowError[];
  rows: ParsedRow[]; // what would be / was saved
  dryRun: boolean;
}

/**
 * Import parsed rows. `dryRun` returns the preview without writing, so the UI
 * can show the sheet back before committing. Rows identical to an existing
 * reminder (same date + description + amount) are skipped, which makes
 * re-uploading a corrected sheet safe.
 */
export async function importReminders(text: string, user: SessionUser, dryRun: boolean): Promise<ImportResult> {
  const { rows, errors } = parseReminderCsv(text);

  const existing = await prisma.reminder.findMany({ select: { description: true, amount: true, dueDate: true } });
  const seen = new Set(existing.map((e) => `${dueYmd(e.dueDate)}|${e.description}|${e.amount}`));

  const fresh: ParsedRow[] = [];
  const duplicates: ParsedRow[] = [];
  for (const r of rows) {
    const key = `${r.dueDate}|${r.description}|${r.amount}`;
    if (seen.has(key)) { duplicates.push(r); continue; }
    seen.add(key); // also de-dupes repeated rows inside the same file
    fresh.push(r);
  }

  if (!dryRun && fresh.length) {
    await prisma.reminder.createMany({
      data: fresh.map((r) => ({
        description: r.description,
        amount: BigInt(r.amount),
        dueDate: ymdToDate(r.dueDate),
        createdById: user.id,
      })),
    });
  }

  return {
    parsed: rows.length,
    imported: dryRun ? 0 : fresh.length,
    duplicates,
    errors,
    rows: fresh,
    dryRun,
  };
}

// ── the reminder tick ───────────────────────────────────────────────
export interface EmiReminderResult {
  ok: true;
  skipped?: string;
  reminders?: number;
  recipients?: number;
  pushes?: number; // reminders x recipients — one notification each
}

/** Headline for one EMI: how late or how close it is. */
export function dueHeadline(days: number): string {
  if (days < 0) return `EMI ${-days} day${days === -1 ? "" : "s"} LATE`;
  if (days === 0) return "EMI due TODAY";
  if (days === 1) return "EMI due tomorrow";
  return `EMI due in ${days} days`;
}

/**
 * The push for one EMI. A per-reminder `tag` matters: with a shared tag the
 * phone collapses them into one and you only ever see the last EMI.
 */
export function reminderPush(
  r: { id: string; description: string; amount: bigint; dueDate: Date },
  now: Date = new Date(),
) {
  return {
    title: dueHeadline(daysUntilDue(r.dueDate, now)),
    body: `${formatINR(r.amount)} — ${r.description}\nTap "Paid" once it's done.`,
    url: "/?tab=reminders",
    tag: `emi-${r.id}`,
  };
}

/**
 * One notification per EMI, to each of the three. Called from the 15-min cron;
 * it decides for itself whether this tick is a send tick.
 */
export async function runEmiReminders(now: Date = new Date()): Promise<EmiReminderResult> {
  if (!reminderHours().includes(hourInTz(now))) {
    return { ok: true, skipped: "not-a-reminder-hour" };
  }

  const pending = await prisma.reminder.findMany({
    where: { status: "PENDING" },
    orderBy: { dueDate: "asc" },
  });

  const cutoff = new Date(now.getTime() - DEDUPE_MS);
  const due = pending.filter(
    (r) => isDueForReminder(r.dueDate, now) && (!r.lastRemindedAt || r.lastRemindedAt < cutoff),
  );
  if (due.length === 0) return { ok: true, reminders: 0, recipients: 0, pushes: 0 };

  const recipients = await prisma.user.findMany({
    where: { active: true, OR: [{ isManager: true }, { isApprover: true }, { isPayer: true }] },
    select: { id: true },
  });

  // Soonest first, so the most urgent EMI is the last one to land on the phone
  // (newest notification sits on top).
  const ordered = [...due].sort((a, b) => daysUntilDue(b.dueDate, now) - daysUntilDue(a.dueDate, now));
  let pushes = 0;
  for (const r of ordered) {
    const payload = reminderPush(r, now);
    for (const u of recipients) {
      await sendPushToUser(u.id, payload);
      pushes++;
    }
  }

  await prisma.reminder.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { lastRemindedAt: now },
  });

  return { ok: true, reminders: due.length, recipients: recipients.length, pushes };
}
