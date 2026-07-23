// lib/status.ts — the heart of PayTrack.
// The state machine + the two hard rules + the actor (role/ownership) checks.
// EVERY status change must go through `transition()`. Nothing else may mutate
// payment.status. UI checks are convenience only; this is the authority.
//
// Kept dependency-free (no DB, no Prisma runtime) so it is pure and fast to
// unit-test. The string-literal types below are structurally identical to the
// Prisma enums, so route handlers can pass Prisma enum values directly.

export type Status =
  | "AWAITING_APPROVAL"
  | "RETURNED"
  | "REQUESTED"
  | "SCHEDULED"
  | "PAID"
  | "CONFIRMED"
  | "HOLD"
  | "CANCELLED";

export type Role = "ADMIN" | "USER";

export type EventType =
  | "REQUEST"
  | "APPROVE"
  | "RETURN"
  | "RESUBMIT"
  | "EDIT"
  | "SCHEDULE"
  | "PAY"
  | "CONFIRM"
  | "HOLD"
  | "CANCEL"
  | "NUDGE"
  | "REMINDER"
  | "NOTE";

export type EffectiveStatus = Status | "OVERDUE";

/** Allowed transitions. Anything not listed here is rejected. */
export const TRANSITIONS: Record<Status, Status[]> = {
  AWAITING_APPROVAL: ["REQUESTED", "RETURNED", "CANCELLED"],
  RETURNED: ["AWAITING_APPROVAL", "CANCELLED"],
  REQUESTED: ["SCHEDULED", "PAID", "HOLD", "CANCELLED"],
  SCHEDULED: ["PAID", "HOLD"],
  HOLD: ["SCHEDULED", "PAID"],
  PAID: ["CONFIRMED"],
  CONFIRMED: [],
  CANCELLED: [],
};

export const TERMINAL: ReadonlySet<Status> = new Set<Status>(["CONFIRMED", "CANCELLED"]);

/** EventType logged for a transition (depends on where it comes from). */
function eventFor(from: Status, to: Status): EventType {
  switch (to) {
    case "REQUESTED": return "APPROVE"; // reached (via transition) only by approving
    case "RETURNED": return "RETURN";
    case "AWAITING_APPROVAL": return "RESUBMIT";
    case "SCHEDULED": return "SCHEDULE";
    case "PAID": return "PAY";
    case "HOLD": return "HOLD";
    case "CANCELLED": return "CANCEL";
    case "CONFIRMED": return "CONFIRM";
    default: return "NOTE";
  }
}

export type TransitionErrorCode =
  | "ILLEGAL_TRANSITION"
  | "TERMINAL"
  | "FORBIDDEN_ACTOR"
  | "MISSING_DATE"
  | "MISSING_PROOF";

export class TransitionError extends Error {
  code: TransitionErrorCode;
  httpStatus: number;
  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = "TransitionError";
    this.code = code;
    this.httpStatus = code === "FORBIDDEN_ACTOR" ? 403 : 409;
  }
}

export interface PaymentLike {
  status: Status;
  requestedById: string;
  scheduledFor?: Date | null;
  dueDate?: Date | null;
}

export interface Actor {
  id: string;
  isPayer?: boolean;
  isApprover?: boolean;
  isAdmin?: boolean;
}

export interface TransitionContext {
  /** The date being scheduled for (required for -> SCHEDULED). */
  scheduledFor?: Date | null;
  /** Whether a PROOF attachment is present (required for -> PAID). */
  hasProof?: boolean;
}

export interface TransitionResult {
  from: Status;
  to: Status;
  eventType: EventType;
  /** Field patch to persist alongside the status change. */
  patch: {
    status: Status;
    scheduledFor?: Date;
    approvedById?: string;
    approvedAt?: Date;
    paidById?: string;
    paidAt?: Date;
    confirmedById?: string;
    confirmedAt?: Date;
  };
}

function isRaiser(payment: PaymentLike, actor: Actor): boolean {
  return actor.id === payment.requestedById;
}

/** Actor authorization per target status. Throws on failure. Capability-based:
 *  isPayer schedules/pays/holds; isApprover approves/returns; the raiser
 *  resubmits and confirms; payer or raiser cancels. */
function assertActor(payment: PaymentLike, to: Status, actor: Actor): void {
  switch (to) {
    case "SCHEDULED":
    case "PAID":
    case "HOLD":
      if (actor.isPayer) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the payer can schedule, pay, or hold a payment.");
    case "REQUESTED": // approve (AWAITING_APPROVAL -> REQUESTED)
      if (actor.isApprover) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the approver can approve a payment.");
    case "RETURNED": // reject
      if (actor.isApprover) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the approver can return a payment.");
    case "AWAITING_APPROVAL": // resubmit
      if (isRaiser(payment, actor)) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the person who raised it can resubmit.");
    case "CANCELLED":
      if (actor.isPayer || isRaiser(payment, actor)) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the payer or the person who raised it can cancel.");
    case "CONFIRMED":
      if (isRaiser(payment, actor)) return;
      throw new TransitionError("FORBIDDEN_ACTOR", "Only the person who raised this payment can confirm receipt.");
    default:
      throw new TransitionError("ILLEGAL_TRANSITION", `Unsupported target status: ${to}`);
  }
}

/**
 * Validate and compute a status change. Pure — does not touch the DB. Returns
 * the patch + event to persist, or throws a TransitionError.
 *
 * The two hard rules live here: -> SCHEDULED requires a date, -> PAID requires
 * a proof attachment. Enforced server-side, so they hold even on a raw API call.
 */
export function transition(
  payment: PaymentLike,
  to: Status,
  actor: Actor,
  ctx: TransitionContext = {},
): TransitionResult {
  const from = payment.status;

  if (TERMINAL.has(from)) {
    throw new TransitionError("TERMINAL", `A ${from.toLowerCase()} payment cannot change.`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new TransitionError("ILLEGAL_TRANSITION", `Cannot move a payment from ${from} to ${to}.`);
  }

  assertActor(payment, to, actor);

  const patch: TransitionResult["patch"] = { status: to };

  // Hard rule 2: no SCHEDULED without a concrete date.
  if (to === "SCHEDULED") {
    if (!ctx.scheduledFor || Number.isNaN(new Date(ctx.scheduledFor).getTime())) {
      throw new TransitionError("MISSING_DATE", "A payment cannot be scheduled without a date.");
    }
    patch.scheduledFor = new Date(ctx.scheduledFor);
  }

  // Hard rule 1: no PAID without a proof attachment.
  if (to === "PAID") {
    if (!ctx.hasProof) {
      throw new TransitionError("MISSING_PROOF", "A payment cannot be marked paid without a proof file.");
    }
    patch.paidById = actor.id;
    patch.paidAt = new Date();
  }

  // Approve = AWAITING_APPROVAL -> REQUESTED: record the approver.
  if (to === "REQUESTED") {
    patch.approvedById = actor.id;
    patch.approvedAt = new Date();
  }

  if (to === "CONFIRMED") {
    patch.confirmedById = actor.id;
    patch.confirmedAt = new Date();
  }

  return { from, to, eventType: eventFor(from, to), patch };
}

/** Whether this payment can be transitioned to `to` by `actor` (no throw). */
export function canTransition(
  payment: PaymentLike,
  to: Status,
  actor: Actor,
  ctx: TransitionContext = {},
): boolean {
  try {
    transition(payment, to, actor, ctx);
    return true;
  } catch {
    return false;
  }
}

/** Start of `now`'s calendar day (local to the provided Date). */
function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * `overdue` is DERIVED, never stored: status ∈ {REQUESTED, SCHEDULED} AND
 * dueDate < today. Callers pass a `now` already in the app timezone (IST).
 */
export function isOverdue(payment: PaymentLike, now: Date = new Date()): boolean {
  if (payment.status !== "REQUESTED" && payment.status !== "SCHEDULED") return false;
  if (!payment.dueDate) return false;
  return new Date(payment.dueDate) < startOfDay(now);
}

/** The status to show in the UI, folding in the derived OVERDUE state. */
export function effectiveStatus(payment: PaymentLike, now: Date = new Date()): EffectiveStatus {
  return isOverdue(payment, now) ? "OVERDUE" : payment.status;
}
