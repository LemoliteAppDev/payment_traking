// The 15-minute reminder digest — the only cron-driven piece.
// Working-hours gated, de-duplicated via lastRemindedAt, escalates overdue
// items to the raising requester, and stops the instant a payment is PAID
// (PAID/CONFIRMED/CANCELLED are excluded by the status filter).
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/notify";
import { formatINR } from "@/lib/money";
import { hourInTz } from "@/lib/time";
import { overdueFor } from "@/lib/payments";

const WINDOW_MS = 14 * 60 * 1000; // just under one 15-min tick

export interface ReminderResult {
  ok: true;
  skipped?: string;
  remindedPayments?: number;
  digestsSent?: number;
  requesterPings?: number;
}

export async function runReminders(now: Date = new Date()): Promise<ReminderResult> {
  const start = Number(process.env.WORK_HOURS_START ?? "9");
  const end = Number(process.env.WORK_HOURS_END ?? "21");
  const hour = hourInTz(now);
  if (hour < start || hour >= end) {
    return { ok: true, skipped: "outside-working-hours" };
  }

  // Pending only — never PAID/CONFIRMED/CANCELLED (reminders stop at PAID).
  const pending = await prisma.payment.findMany({
    where: { status: { in: ["REQUESTED", "SCHEDULED", "HOLD"] } },
    include: { requestedBy: true },
  });

  const cutoff = new Date(now.getTime() - WINDOW_MS);
  // De-dupe overlapping runs: skip anything reminded within this tick window.
  const fresh = pending.filter((p) => !p.lastRemindedAt || p.lastRemindedAt < cutoff);
  if (fresh.length === 0) return { ok: true, remindedPayments: 0, digestsSent: 0, requesterPings: 0 };

  // One digest to each payer listing everything still to pay.
  const payers = await prisma.user.findMany({ where: { role: "PAYER" } });
  const total = fresh.reduce((s, p) => s + p.amount, 0n);
  const lines = fresh
    .map((p) => `• ${formatINR(p.amount)} to ${p.payee}${overdueFor(p) ? " (LATE)" : ""}`)
    .join("\n");
  const digest = `⏰ ${fresh.length} payment${fresh.length > 1 ? "s" : ""} to pay — ${formatINR(total)} total:\n${lines}`;
  for (const payer of payers) {
    await sendTelegram(payer.telegramChatId, digest);
  }

  // Overdue items additionally ping the requester who raised them.
  const overdue = fresh.filter((p) => overdueFor(p));
  for (const p of overdue) {
    await sendTelegram(
      p.requestedBy.telegramChatId,
      `⚠️ Your payment ${formatINR(p.amount)} to ${p.payee} is overdue and still unpaid.`,
    );
  }

  // Mark reminded so the next tick (and any overlapping run) doesn't double-send.
  await prisma.payment.updateMany({
    where: { id: { in: fresh.map((p) => p.id) } },
    data: { lastRemindedAt: now },
  });

  return { ok: true, remindedPayments: fresh.length, digestsSent: payers.length, requesterPings: overdue.length };
}
