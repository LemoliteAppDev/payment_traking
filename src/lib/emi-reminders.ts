// EMI reminders — a standalone list from Payment. Jignesh (the manager) adds
// rows manually or by uploading a CSV; Jignesh, Jagat and Mahesh (manager /
// approver / payer) see them, get the pushes, and any one of them can mark a
// row paid.
//
// Firing rule: D-3, D-2, D-1 and D — and then daily past the due date until
// somebody marks it paid. Two sends a day (11:00 and 21:00 IST), deliberately
// independent of WORK_HOURS, which stops at 21:00 and would swallow the
// evening send.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { sendPushToUser } from "@/lib/push";
import { formatINR } from "@/lib/money";
import { hourInTz, ymdInTz } from "@/lib/time";
import type { SessionUser } from "@/lib/session";

/**
 * Fallback lead: reminders start this many days before the due date
 * (due the 6th → 3rd, 4th, 5th, 6th). Overridden by the ReminderSetting row,
 * and per-EMI by Reminder.leadDays.
 */
export const LEAD_DAYS = 3;
export const MAX_LEAD_DAYS = 60;

/**
 * Parse "11,21" into [11, 21]. Invalid entries are dropped; null if none
 * survive. Matches digits explicitly rather than leaning on Number(), because
 * Number("") is 0 — a blank cell would otherwise silently mean midnight.
 */
export function parseHours(raw: string): number[] | null {
  const hours = [
    ...new Set(
      raw
        .split(",")
        .map((h) => h.trim())
        .filter((h) => /^\d{1,2}$/.test(h))
        .map(Number)
        .filter((h) => h <= 23),
    ),
  ].sort((a, b) => a - b);
  return hours.length ? hours : null;
}

export const formatHours = (hours: number[]): string => hours.join(",");

/** Last-resort hours when neither the settings row nor a valid env var exists. */
function envHours(): number[] {
  return parseHours(process.env.EMI_REMINDER_HOURS ?? "11,21") ?? [11, 21];
}

export interface ReminderDefaults {
  sendHours: number[];
  leadDays: number;
}

/** The house default, from the singleton settings row. */
export async function getReminderDefaults(): Promise<ReminderDefaults> {
  const row = await prisma.reminderSetting.findUnique({ where: { id: "default" } });
  if (!row) return { sendHours: envHours(), leadDays: LEAD_DAYS };
  return {
    sendHours: parseHours(row.sendHours) ?? envHours(),
    leadDays: row.leadDays,
  };
}

/** Manager only, enforced at the route. */
export async function setReminderDefaults(
  input: { sendHours: number[]; leadDays: number },
  user: SessionUser,
): Promise<ReminderDefaults> {
  const row = await prisma.reminderSetting.upsert({
    where: { id: "default" },
    update: { sendHours: formatHours(input.sendHours), leadDays: input.leadDays, updatedById: user.id },
    create: {
      id: "default",
      sendHours: formatHours(input.sendHours),
      leadDays: input.leadDays,
      updatedById: user.id,
    },
  });
  return { sendHours: parseHours(row.sendHours) ?? envHours(), leadDays: row.leadDays };
}

/** What applies to one reminder before any person's own preference. */
export function effectiveTiming(
  r: { sendHours: string | null; leadDays: number | null },
  defaults: ReminderDefaults,
): ReminderDefaults & { custom: boolean } {
  const own = r.sendHours ? parseHours(r.sendHours) : null;
  return {
    sendHours: own ?? defaults.sendHours,
    leadDays: r.leadDays ?? defaults.leadDays,
    custom: !!own || r.leadDays !== null,
  };
}

export interface PersonPreference {
  sendHours: string | null;
  leadDays: number | null;
}

/**
 * Timing for one person on one reminder.
 *
 * Lead days: the **longer** of the person's own lead and the EMI's, so nobody
 * gets less warning than the EMI demands, and anyone who asked for more still
 * gets more. Jignesh on 4 days and a group on 2 means he hears first.
 *
 * Hours: the person's own times, plus any the EMI insists on. Union for the
 * same reason — an EMI pinned to 07:00 still lands at 07:00 for everyone.
 */
export function timingFor(
  r: { sendHours: string | null; leadDays: number | null },
  pref: PersonPreference | undefined,
  group: ReminderDefaults,
): ReminderDefaults {
  const personLead = pref?.leadDays ?? group.leadDays;
  const personHours = (pref?.sendHours ? parseHours(pref.sendHours) : null) ?? group.sendHours;

  const emiLead = r.leadDays;
  const emiHours = r.sendHours ? parseHours(r.sendHours) : null;

  return {
    leadDays: emiLead === null ? personLead : Math.max(personLead, emiLead),
    sendHours: emiHours
      ? [...new Set([...personHours, ...emiHours])].sort((a, b) => a - b)
      : personHours,
  };
}

/** Everyone's saved preference, keyed by user id. */
export async function getPreferences(): Promise<Map<string, PersonPreference>> {
  const rows = await prisma.reminderPreference.findMany();
  return new Map(rows.map((r) => [r.userId, { sendHours: r.sendHours, leadDays: r.leadDays }]));
}

/** One person's own row, plus what it resolves to against the group setting. */
export async function getMyTiming(user: SessionUser) {
  const [pref, group] = await Promise.all([
    prisma.reminderPreference.findUnique({ where: { userId: user.id } }),
    getReminderDefaults(),
  ]);
  const own = pref ? { sendHours: pref.sendHours, leadDays: pref.leadDays } : undefined;
  return {
    group,
    followsGroup: !pref || (pref.sendHours === null && pref.leadDays === null),
    mine: {
      sendHours: (own?.sendHours ? parseHours(own.sendHours) : null) ?? group.sendHours,
      leadDays: own?.leadDays ?? group.leadDays,
    },
  };
}

/** Each of the three sets their own. Null on both fields means follow the group. */
export async function setMyTiming(
  user: SessionUser,
  input: { sendHours: number[] | null; leadDays: number | null },
) {
  const sendHours = input.sendHours?.length ? formatHours(input.sendHours) : null;
  const leadDays = input.leadDays ?? null;
  await prisma.reminderPreference.upsert({
    where: { userId: user.id },
    update: { sendHours, leadDays },
    create: { userId: user.id, sendHours, leadDays },
  });
  return getMyTiming(user);
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

/** In the reminder window: due within `leadDays`, or already past due. */
export function isDueForReminder(due: Date, now: Date = new Date(), leadDays = LEAD_DAYS): boolean {
  return daysUntilDue(due, now) <= leadDays;
}

/** 'YYYY-MM-DD' -> the UTC-midnight Date we store. */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Longest a monthly EMI run may be — 10 years of installments. */
export const MAX_REPEAT_MONTHS = 120;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Same day-of-month, `months` later, clamped to the end of short months.
 * An EMI due the 31st lands on 28 Feb but returns to the 31st in March — it
 * stays anchored to the original day instead of drifting earlier each month.
 */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12; // 0-based
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDayOfMonth))}`;
}

/** The full run of due dates for a monthly EMI: month 1 is `ymd` itself. */
export function expandMonthly(ymd: string, months: number): string[] {
  const count = Math.max(1, Math.min(Math.trunc(months), MAX_REPEAT_MONTHS));
  return Array.from({ length: count }, (_, i) => addMonthsYmd(ymd, i));
}

/** Whole months from one due date to another, for "repeat until <date>". */
export function monthsBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm] = fromYmd.split("-").map(Number);
  const [ty, tm] = toYmd.split("-").map(Number);
  const months = (ty * 12 + tm) - (fy * 12 + fm);
  // Inclusive of the first month; a same-month end date is a single installment.
  return months < 0 ? 0 : months + 1;
}

// ── shaping ─────────────────────────────────────────────────────────
type ReminderRow = {
  id: string; description: string; amount: bigint; dueDate: Date; status: "PENDING" | "PAID";
  seriesId: string | null; sendHours: string | null; leadDays: number | null;
  paidOn: Date | null; paidAt: Date | null; paidNote: string | null; createdAt: Date;
  createdBy: { id: string; name: string } | null;
  paidBy: { id: string; name: string } | null;
};

function shape(r: ReminderRow, defaults: ReminderDefaults) {
  const days = daysUntilDue(r.dueDate);
  const timing = effectiveTiming(r, defaults);
  return {
    id: r.id,
    description: r.description,
    amount: r.amount.toString(),
    dueDate: dueYmd(r.dueDate),
    status: r.status,
    seriesId: r.seriesId,
    monthly: !!r.seriesId,
    daysUntilDue: days,
    late: r.status === "PENDING" && days < 0,
    inWindow: r.status === "PENDING" && days <= timing.leadDays,
    sendHours: timing.sendHours,
    leadDays: timing.leadDays,
    customTiming: timing.custom,
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
  const [rows, defaults] = await Promise.all([
    prisma.reminder.findMany({ orderBy: [{ status: "asc" }, { dueDate: "asc" }], include }),
    getReminderDefaults(),
  ]);
  return rows.map((r) => shape(r, defaults));
}

export interface ReminderInput {
  description: string;
  amount: bigint;
  dueDate: Date;
  /** 1 = a one-off. Above that, one dated row per month sharing a seriesId. */
  repeatMonths?: number;
  /** Per-EMI timing. Undefined leaves it inheriting the house default. */
  sendHours?: number[] | null;
  leadDays?: number | null;
}

export async function createReminder(input: ReminderInput, user: SessionUser): Promise<ReminderDTO> {
  const months = input.repeatMonths ?? 1;
  const dates = expandMonthly(dueYmd(input.dueDate), months);
  const seriesId = dates.length > 1 ? randomUUID() : null;

  const rows = dates.map((ymd) => ({
    description: input.description,
    amount: input.amount,
    dueDate: ymdToDate(ymd),
    createdById: user.id,
    seriesId,
    sendHours: input.sendHours?.length ? formatHours(input.sendHours) : null,
    leadDays: input.leadDays ?? null,
  }));

  // Return the first installment — that's the one the UI just added.
  const first = await prisma.reminder.create({ data: rows[0], include });
  if (rows.length > 1) await prisma.reminder.createMany({ data: rows.slice(1) });
  return shape(first, await getReminderDefaults());
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
      // null explicitly clears an override back to the house default.
      ...(input.sendHours !== undefined
        ? { sendHours: input.sendHours?.length ? formatHours(input.sendHours) : null, lastRemindedAt: null }
        : {}),
      ...(input.leadDays !== undefined ? { leadDays: input.leadDays, lastRemindedAt: null } : {}),
    },
    include,
  });
  return shape(r, await getReminderDefaults());
}

/**
 * Delete one reminder, or (scope "series") that one plus every later month of
 * the same monthly run. Months already marked paid are left alone — they're
 * the record of what was actually paid.
 */
export async function deleteReminder(id: string, scope: "one" | "series" = "one"): Promise<number> {
  const existing = await prisma.reminder.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Reminder not found.");

  if (scope === "series" && existing.seriesId) {
    const { count } = await prisma.reminder.deleteMany({
      where: {
        seriesId: existing.seriesId,
        dueDate: { gte: existing.dueDate },
        OR: [{ status: "PENDING" }, { id }],
      },
    });
    return count;
  }
  await prisma.reminder.delete({ where: { id } });
  return 1;
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
    return shape(r as ReminderRow, await getReminderDefaults());
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
  return shape(r, await getReminderDefaults());
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
  return shape(r, await getReminderDefaults());
}

// ── CSV import ──────────────────────────────────────────────────────
export interface ParsedRow {
  line: number;
  dueDate: string; // YYYY-MM-DD
  description: string;
  amount: string; // paise
  repeatMonths: number; // 1 = one-off
  leadDays: number | null; // null = inherit the house default
  sendHours: number[] | null; // null = inherit
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

/**
 * Optional 4th column: how long a monthly EMI runs. Either a count of months
 * ("36") or a date to repeat until ("06/09/2029"). Blank means a one-off.
 * Returns null when the cell is present but unreadable.
 */
export function parseRepeat(raw: string, fromYmd: string): number | null {
  const s = raw.trim();
  if (!s) return 1;

  const plain = s.replace(/\s*(months?|mo|m|times|x)\s*$/i, "").trim();
  if (/^\d{1,3}$/.test(plain)) {
    const n = Number(plain);
    return n >= 1 && n <= MAX_REPEAT_MONTHS ? n : null;
  }

  const until = parseDueDate(s);
  if (until) {
    const months = monthsBetweenYmd(fromYmd, until);
    return months >= 1 && months <= MAX_REPEAT_MONTHS ? months : null;
  }
  return null;
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
    const repeatMonths = parseRepeat(cells[3] ?? "", dueDate);
    if (repeatMonths === null) {
      errors.push({
        line,
        raw,
        message: `Can't read the repeat "${cells[3]}". Use a number of months, or a date to repeat until.`,
      });
      return;
    }

    // Columns 5 and 6 are optional per-row timing; blank inherits the default.
    const leadCell = (cells[4] ?? "").trim();
    let leadDays: number | null = null;
    if (leadCell) {
      const n = Number(leadCell.replace(/\s*days?\s*$/i, "").trim());
      if (!Number.isInteger(n) || n < 0 || n > MAX_LEAD_DAYS) {
        errors.push({ line, raw, message: `Can't read the lead days "${leadCell}". Use 0 to ${MAX_LEAD_DAYS}.` });
        return;
      }
      leadDays = n;
    }

    const hoursCell = (cells[5] ?? "").trim();
    let sendHours: number[] | null = null;
    if (hoursCell) {
      sendHours = parseHours(hoursCell);
      if (!sendHours) {
        errors.push({ line, raw, message: `Can't read the send times "${hoursCell}". Use hours 0-23, e.g. 11,21.` });
        return;
      }
    }

    rows.push({ line, dueDate, description, amount: amount.toString(), repeatMonths, leadDays, sendHours });
  });

  return { rows, errors };
}

export interface ImportResult {
  parsed: number;
  imported: number; // rows created, counting every month of a repeating line
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
      data: fresh.flatMap((r) => {
        const dates = expandMonthly(r.dueDate, r.repeatMonths);
        const seriesId = dates.length > 1 ? randomUUID() : null;
        return dates.map((ymd) => ({
          description: r.description,
          amount: BigInt(r.amount),
          dueDate: ymdToDate(ymd),
          createdById: user.id,
          seriesId,
          sendHours: r.sendHours?.length ? formatHours(r.sendHours) : null,
          leadDays: r.leadDays,
        }));
      }),
    });
  }

  const installments = fresh.reduce((n, r) => n + Math.max(1, r.repeatMonths), 0);
  return {
    parsed: rows.length,
    imported: dryRun ? 0 : installments,
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
  const hour = hourInTz(now);
  const [pending, group, prefs, recipients] = await Promise.all([
    prisma.reminder.findMany({ where: { status: "PENDING" }, orderBy: { dueDate: "asc" } }),
    getReminderDefaults(),
    getPreferences(),
    prisma.user.findMany({
      where: { active: true, OR: [{ isManager: true }, { isApprover: true }, { isPayer: true }] },
      select: { id: true },
    }),
  ]);
  if (pending.length === 0) return { ok: true, reminders: 0, recipients: 0, pushes: 0 };

  // Who was last told what. Per person, because the three can be on different
  // schedules for the same EMI.
  const sent = await prisma.reminderNotification.findMany({
    where: { reminderId: { in: pending.map((r) => r.id) } },
  });
  const lastSent = new Map(sent.map((n) => [`${n.reminderId}:${n.userId}`, n.sentAt]));
  const cutoff = new Date(now.getTime() - DEDUPE_MS);

  // Soonest-due last, so the most urgent EMI lands on top of the stack.
  const ordered = [...pending].sort((a, b) => daysUntilDue(b.dueDate, now) - daysUntilDue(a.dueDate, now));

  const toSend: { reminder: (typeof pending)[number]; userId: string }[] = [];
  for (const r of ordered) {
    for (const u of recipients) {
      const timing = timingFor(r, prefs.get(u.id), group);
      if (!timing.sendHours.includes(hour)) continue;
      if (!isDueForReminder(r.dueDate, now, timing.leadDays)) continue;
      const last = lastSent.get(`${r.id}:${u.id}`);
      if (last && last >= cutoff) continue;
      toSend.push({ reminder: r, userId: u.id });
    }
  }

  if (toSend.length === 0) {
    // Tell "nothing is scheduled for this hour" apart from "nothing is due".
    const anyHour = pending.some((r) =>
      recipients.some((u) => timingFor(r, prefs.get(u.id), group).sendHours.includes(hour)),
    );
    if (!anyHour) return { ok: true, skipped: "not-a-reminder-hour" };
    return { ok: true, reminders: 0, recipients: 0, pushes: 0 };
  }

  for (const { reminder, userId } of toSend) {
    await sendPushToUser(userId, reminderPush(reminder, now));
    await prisma.reminderNotification.upsert({
      where: { reminderId_userId: { reminderId: reminder.id, userId } },
      update: { sentAt: now },
      create: { reminderId: reminder.id, userId, sentAt: now },
    });
  }

  const reminderIds = [...new Set(toSend.map((t) => t.reminder.id))];
  await prisma.reminder.updateMany({ where: { id: { in: reminderIds } }, data: { lastRemindedAt: now } });

  return {
    ok: true,
    reminders: reminderIds.length,
    recipients: new Set(toSend.map((t) => t.userId)).size,
    pushes: toSend.length,
  };
}
