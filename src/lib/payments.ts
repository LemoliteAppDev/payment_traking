// Service layer over lib/status.ts. Every write goes through applyTransition,
// which loads the payment, runs the guarded transition, persists the patch +
// a PaymentEvent (+ optional attachment) atomically, and fires an event ping.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { sendPushToUser, sendPushToPayers } from "@/lib/push";
import { formatINR } from "@/lib/money";
import { isPastDateTz } from "@/lib/time";
import {
  transition,
  effectiveStatus,
  type Status,
  type EffectiveStatus,
  type PaymentLike,
} from "@/lib/status";
import type { SessionUser } from "@/lib/session";
import type { Prisma, EventType, AttachmentKind } from "@/generated/prisma";

const paymentInclude = {
  requestedBy: true,
  paidBy: true,
  confirmedBy: true,
  attachments: { orderBy: { createdAt: "asc" } },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: true, attachment: true },
  },
} satisfies Prisma.PaymentInclude;

type FullPayment = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

/** Derived overdue in APP_TZ (never stored). */
export function overdueFor(p: { status: Status; dueDate: Date }): boolean {
  if (p.status !== "REQUESTED" && p.status !== "SCHEDULED") return false;
  return isPastDateTz(p.dueDate);
}

export function effectiveFor(p: { status: Status; dueDate: Date }): EffectiveStatus {
  return overdueFor(p) ? "OVERDUE" : p.status;
}

/** Shape a payment for the API (BigInt handled by api.json). */
export function serializePayment(p: FullPayment) {
  const overdue = overdueFor(p);
  return {
    id: p.id,
    amount: p.amount, // paise (BigInt -> string at serialization)
    payee: p.payee,
    payFrom: p.payFrom,
    purpose: p.purpose,
    upi: p.upi,
    status: p.status,
    effective: overdue ? "OVERDUE" : p.status,
    overdue,
    dueDate: p.dueDate,
    scheduledFor: p.scheduledFor,
    paidAt: p.paidAt,
    confirmedAt: p.confirmedAt,
    createdAt: p.createdAt,
    requestedBy: userLite(p.requestedBy),
    paidBy: p.paidBy ? userLite(p.paidBy) : null,
    confirmedBy: p.confirmedBy ? userLite(p.confirmedBy) : null,
    attachments: p.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
    })),
    events: p.events.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      actor: e.actor ? userLite(e.actor) : null,
      attachment: e.attachment
        ? { id: e.attachment.id, kind: e.attachment.kind, originalName: e.attachment.originalName, mimeType: e.attachment.mimeType }
        : null,
      createdAt: e.createdAt,
    })),
  };
}

function userLite(u: { id: string; name: string; email: string; role: string }) {
  return { id: u.id, name: u.name, role: u.role };
}

export interface ApplyOptions {
  paymentId: string;
  to: Status;
  actor: SessionUser;
  scheduledFor?: Date | null;
  message?: string;
  /** A file to attach as part of this action (e.g. proof for pay). */
  file?: { originalName: string; storedName: string; mimeType: string; size: number };
  fileKind?: AttachmentKind;
  meta?: Prisma.InputJsonValue;
  /** Idempotency key for pay/confirm. */
  idempotencyKey?: string | null;
}

/**
 * Load → guard (lib/status.ts) → persist patch + event (+ attachment) in one
 * transaction → notify. Returns the fresh full payment.
 */
export async function applyTransition(opts: ApplyOptions): Promise<FullPayment> {
  const { paymentId, to, actor } = opts;

  // Idempotency replay: if this key was already used, return current state.
  if (opts.idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({ where: { key: opts.idempotencyKey } });
    if (existing) {
      return loadPayment(paymentId);
    }
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { attachments: { where: { kind: "PROOF" } } },
  });
  if (!payment) throw new ApiError(404, "NOT_FOUND", "Payment not found.");

  const hasProof = payment.attachments.length > 0 || (opts.fileKind === "PROOF" && !!opts.file);

  const like: PaymentLike = {
    status: payment.status,
    requestedById: payment.requestedById,
    scheduledFor: payment.scheduledFor,
    dueDate: payment.dueDate,
  };

  // The guarded transition — throws TransitionError on any violation.
  const result = transition(like, to, { id: actor.id, role: actor.role }, {
    scheduledFor: opts.scheduledFor,
    hasProof,
  });

  const message = opts.message?.trim() || defaultMessage(to, actor.name);

  try {
    await prisma.$transaction(async (tx) => {
      if (opts.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: { key: opts.idempotencyKey, scope: `${to}:${paymentId}` },
        });
      }

      let attachmentId: string | undefined;
      if (opts.file) {
        const att = await tx.attachment.create({
          data: {
            paymentId,
            kind: opts.fileKind ?? "PROOF",
            originalName: opts.file.originalName,
            storedName: opts.file.storedName,
            mimeType: opts.file.mimeType,
            size: opts.file.size,
            uploadedById: actor.id,
          },
        });
        attachmentId = att.id;
      }

      await tx.payment.update({ where: { id: paymentId }, data: result.patch });

      await tx.paymentEvent.create({
        data: {
          paymentId,
          actorId: actor.id,
          type: result.eventType as EventType,
          message,
          attachmentId,
          meta: opts.meta,
        },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Concurrent idempotent replay won the race — return current state.
      return loadPayment(paymentId);
    }
    throw e;
  }

  const fresh = await loadPayment(paymentId);
  await notifyForTransition(to, fresh).catch((e) => console.error("[notify] failed", e));
  return fresh;
}

export async function loadPayment(id: string): Promise<FullPayment> {
  const p = await prisma.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!p) throw new ApiError(404, "NOT_FOUND", "Payment not found.");
  return p;
}

function defaultMessage(to: Status, actorName: string): string {
  switch (to) {
    case "SCHEDULED": return `${actorName} scheduled this payment.`;
    case "PAID": return "Paid, proof attached.";
    case "HOLD": return `${actorName} put this on hold.`;
    case "CANCELLED": return `${actorName} cancelled this payment.`;
    case "CONFIRMED": return `${actorName} confirmed receipt.`;
    default: return `${actorName} updated this payment.`;
  }
}

async function notifyForTransition(to: Status, p: FullPayment): Promise<void> {
  const amt = formatINR(p.amount);
  if (to === "SCHEDULED") {
    await sendPushToUser(p.requestedById, {
      title: "Payment scheduled",
      body: `${amt} to ${p.payee} is scheduled${p.scheduledFor ? ` for ${p.scheduledFor.toDateString()}` : ""}.`,
      url: "/",
      tag: `pay-${p.id}`,
    });
  } else if (to === "PAID") {
    await sendPushToUser(p.requestedById, {
      title: "Paid — please confirm",
      body: `${amt} to ${p.payee} is paid. Tap to confirm you received it.`,
      url: "/",
      tag: `pay-${p.id}`,
    });
  } else if (to === "CONFIRMED") {
    if (p.paidById) {
      await sendPushToUser(p.paidById, {
        title: "Receipt confirmed",
        body: `${p.requestedBy.name} confirmed ${amt} to ${p.payee}.`,
        url: "/",
        tag: `pay-${p.id}`,
      });
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// ── Raise a new payment ──────────────────────────────────────────────
export interface CreateInput {
  amount: bigint;
  payee: string;
  payFrom: "PELISWAN" | "LEMOLITE" | "SHIVAM" | "ZENITH";
  purpose: string;
  upi: string;
  dueDate: Date;
}

export async function createPayment(
  input: CreateInput,
  actor: SessionUser,
  file?: { originalName: string; storedName: string; mimeType: string; size: number },
): Promise<FullPayment> {
  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        amount: input.amount,
        payee: input.payee,
        payFrom: input.payFrom,
        purpose: input.purpose,
        upi: input.upi || null,
        dueDate: input.dueDate,
        status: "REQUESTED",
        requestedById: actor.id,
      },
    });
    let attachmentId: string | undefined;
    if (file) {
      const att = await tx.attachment.create({
        data: {
          paymentId: payment.id,
          kind: "INSTRUCTION",
          originalName: file.originalName,
          storedName: file.storedName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedById: actor.id,
        },
      });
      attachmentId = att.id;
    }
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        actorId: actor.id,
        type: "REQUEST",
        message: input.purpose ? `${input.purpose}.` : "Payment request raised.",
        attachmentId,
      },
    });
    return payment;
  });

  const fresh = await loadPayment(created.id);
  // Ping the payer(s) that a new request arrived.
  await sendPushToPayers({
    title: "New payment request",
    body: `${actor.name} raised ${formatINR(fresh.amount)} to ${fresh.payee}.`,
    url: "/",
  }).catch((e) => console.error("[notify] failed", e));
  return fresh;
}

// ── Nudge (no status change) ─────────────────────────────────────────
export async function nudgePayment(paymentId: string, actor: SessionUser): Promise<FullPayment> {
  const payment = await loadPayment(paymentId);
  await prisma.paymentEvent.create({
    data: { paymentId, actorId: actor.id, type: "NUDGE", message: `${actor.name} sent a reminder.` },
  });
  await sendPushToPayers({
    title: "Reminder",
    body: `${actor.name} nudged: ${formatINR(payment.amount)} to ${payment.payee} is waiting.`,
    url: "/",
  }).catch((e) => console.error("[notify] failed", e));
  return loadPayment(paymentId);
}

// ── List with server-side filter + search ────────────────────────────
const RANK: Record<string, number> = { OVERDUE: 0, REQUESTED: 1, SCHEDULED: 2, HOLD: 3, PAID: 4, CONFIRMED: 5, CANCELLED: 6 };

export async function listPayments(actor: SessionUser, filter: string, q: string) {
  const all = await prisma.payment.findMany({
    include: { requestedBy: true, attachments: true },
    orderBy: { createdAt: "desc" },
  });

  const query = q.trim().toLowerCase();
  const rows = all
    .filter((p) => {
      const eff = effectiveFor(p);
      if (filter === "mine" && p.requestedById !== actor.id) return false;
      if (filter === "requested" && eff !== "REQUESTED") return false;
      if (filter === "scheduled" && eff !== "SCHEDULED") return false;
      if (filter === "overdue" && eff !== "OVERDUE") return false;
      if (filter === "paid" && p.status !== "PAID" && p.status !== "CONFIRMED") return false;
      if (query) {
        const hay = `${p.payee} ${p.purpose} ${p.amount} ${p.requestedBy.name} ${p.payFrom}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const ra = RANK[effectiveFor(a)] ?? 9;
      const rb = RANK[effectiveFor(b)] ?? 9;
      return ra - rb || a.dueDate.getTime() - b.dueDate.getTime();
    });

  return rows.map((p) => ({
    id: p.id,
    amount: p.amount,
    payee: p.payee,
    payFrom: p.payFrom,
    purpose: p.purpose,
    status: p.status,
    effective: effectiveFor(p),
    overdue: overdueFor(p),
    dueDate: p.dueDate,
    scheduledFor: p.scheduledFor,
    mine: p.requestedById === actor.id,
    requestedBy: { id: p.requestedBy.id, name: p.requestedBy.name, role: p.requestedBy.role },
    hasProof: p.attachments.some((a) => a.kind === "PROOF"),
  }));
}
