import { describe, it, expect } from "vitest";
import {
  transition,
  isOverdue,
  effectiveStatus,
  TransitionError,
  TRANSITIONS,
  type Status,
  type PaymentLike,
  type Actor,
} from "@/lib/status";

const PAYER: Actor = { id: "mahesh", isPayer: true };
const APPROVER: Actor = { id: "jagat", isApprover: true };
const RAISER: Actor = { id: "payal" }; // raised the payment (requestedById below)
const OTHER: Actor = { id: "umang" }; // unrelated user
// Raiser with every capability — used for the table/terminal matrix so only
// the transition graph (not actor rules) can reject.
const SUPER: Actor = { id: "payal", isPayer: true, isApprover: true };

function payment(status: Status, over: Partial<PaymentLike> = {}): PaymentLike {
  return { status, requestedById: "payal", ...over };
}

const ALL: Status[] = ["AWAITING_APPROVAL", "RETURNED", "REQUESTED", "SCHEDULED", "PAID", "CONFIRMED", "HOLD", "CANCELLED"];
const tomorrow = new Date(Date.now() + 86400000);

describe("approval flow transitions", () => {
  it("AWAITING_APPROVAL -> REQUESTED = approve (approver), records approver", () => {
    const r = transition(payment("AWAITING_APPROVAL"), "REQUESTED", APPROVER);
    expect(r.patch.status).toBe("REQUESTED");
    expect(r.eventType).toBe("APPROVE");
    expect(r.patch.approvedById).toBe("jagat");
    expect(r.patch.approvedAt).toBeInstanceOf(Date);
  });
  it("AWAITING_APPROVAL -> RETURNED = reject (approver)", () => {
    const r = transition(payment("AWAITING_APPROVAL"), "RETURNED", APPROVER);
    expect(r.patch.status).toBe("RETURNED");
    expect(r.eventType).toBe("RETURN");
  });
  it("RETURNED -> AWAITING_APPROVAL = resubmit (raiser)", () => {
    const r = transition(payment("RETURNED"), "AWAITING_APPROVAL", RAISER);
    expect(r.patch.status).toBe("AWAITING_APPROVAL");
    expect(r.eventType).toBe("RESUBMIT");
  });
  it("AWAITING_APPROVAL -> CANCELLED (raiser)", () => {
    expect(transition(payment("AWAITING_APPROVAL"), "CANCELLED", RAISER).patch.status).toBe("CANCELLED");
  });
});

describe("payer/raiser transitions", () => {
  it("REQUESTED -> SCHEDULED (payer, with date)", () => {
    const r = transition(payment("REQUESTED"), "SCHEDULED", PAYER, { scheduledFor: tomorrow });
    expect(r.patch.status).toBe("SCHEDULED");
    expect(r.eventType).toBe("SCHEDULE");
  });
  it("REQUESTED -> PAID (payer, with proof)", () => {
    const r = transition(payment("REQUESTED"), "PAID", PAYER, { hasProof: true });
    expect(r.patch.status).toBe("PAID");
    expect(r.patch.paidById).toBe("mahesh");
  });
  it("REQUESTED -> HOLD (payer)", () => {
    expect(transition(payment("REQUESTED"), "HOLD", PAYER).patch.status).toBe("HOLD");
  });
  it("REQUESTED -> CANCELLED (payer or raiser)", () => {
    expect(transition(payment("REQUESTED"), "CANCELLED", PAYER).patch.status).toBe("CANCELLED");
    expect(transition(payment("REQUESTED"), "CANCELLED", RAISER).patch.status).toBe("CANCELLED");
  });
  it("SCHEDULED -> PAID / HOLD (payer)", () => {
    expect(transition(payment("SCHEDULED"), "PAID", PAYER, { hasProof: true }).patch.status).toBe("PAID");
    expect(transition(payment("SCHEDULED"), "HOLD", PAYER).patch.status).toBe("HOLD");
  });
  it("HOLD -> SCHEDULED / PAID (payer)", () => {
    expect(transition(payment("HOLD"), "SCHEDULED", PAYER, { scheduledFor: tomorrow }).patch.status).toBe("SCHEDULED");
    expect(transition(payment("HOLD"), "PAID", PAYER, { hasProof: true }).patch.status).toBe("PAID");
  });
  it("PAID -> CONFIRMED (raiser)", () => {
    const r = transition(payment("PAID"), "CONFIRMED", RAISER);
    expect(r.patch.status).toBe("CONFIRMED");
    expect(r.patch.confirmedById).toBe("payal");
  });
});

describe("every transition NOT in the table is rejected", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      if (TRANSITIONS[from].includes(to)) continue;
      it(`${from} -> ${to} is rejected`, () => {
        expect(() =>
          transition(payment(from), to, SUPER, { scheduledFor: tomorrow, hasProof: true }),
        ).toThrow(TransitionError);
      });
    }
  }
  it("CONFIRMED and CANCELLED are terminal", () => {
    expect(() => transition(payment("CONFIRMED"), "PAID", PAYER, { hasProof: true })).toThrowError(/cannot change/i);
    expect(() => transition(payment("CANCELLED"), "REQUESTED", APPROVER)).toThrowError(/cannot change/i);
  });
});

describe("hard rule 1: no PAID without proof", () => {
  it("rejects pay with no proof", () => {
    try {
      transition(payment("REQUESTED"), "PAID", PAYER, { hasProof: false });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TransitionError).code).toBe("MISSING_PROOF");
    }
  });
});

describe("hard rule 2: no SCHEDULED without a date", () => {
  it("rejects schedule with no date", () => {
    try {
      transition(payment("REQUESTED"), "SCHEDULED", PAYER, {});
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TransitionError).code).toBe("MISSING_DATE");
    }
  });
});

describe("actor (capability) rules", () => {
  it("a non-payer cannot schedule/pay/hold", () => {
    expect(() => transition(payment("REQUESTED"), "SCHEDULED", RAISER, { scheduledFor: tomorrow })).toThrowError(/only the payer/i);
    expect(() => transition(payment("REQUESTED"), "PAID", RAISER, { hasProof: true })).toThrowError(/only the payer/i);
    expect(() => transition(payment("REQUESTED"), "HOLD", RAISER)).toThrowError(/only the payer/i);
  });
  it("a non-approver cannot approve or return", () => {
    expect(() => transition(payment("AWAITING_APPROVAL"), "REQUESTED", PAYER)).toThrowError(/only the approver/i);
    expect(() => transition(payment("AWAITING_APPROVAL"), "RETURNED", RAISER)).toThrowError(/only the approver/i);
  });
  it("only the raiser can resubmit", () => {
    expect(() => transition(payment("RETURNED"), "AWAITING_APPROVAL", OTHER)).toThrowError(/only the person who raised/i);
  });
  it("only the raiser can confirm; payer cannot", () => {
    expect(() => transition(payment("PAID"), "CONFIRMED", PAYER)).toThrowError(/only the person who raised/i);
    expect(() => transition(payment("PAID"), "CONFIRMED", OTHER)).toThrowError(/only the person who raised/i);
  });
  it("an unrelated user cannot cancel", () => {
    expect(() => transition(payment("REQUESTED"), "CANCELLED", OTHER)).toThrowError(/only the payer or the person who raised/i);
  });
  it("forbidden-actor errors are 403", () => {
    try {
      transition(payment("REQUESTED"), "PAID", RAISER, { hasProof: true });
    } catch (e) {
      expect((e as TransitionError).httpStatus).toBe(403);
    }
  });
});

describe("overdue derivation (never stored)", () => {
  const yesterday = new Date(Date.now() - 86400000);
  const now = new Date();
  it("REQUESTED / SCHEDULED + past due is overdue", () => {
    expect(isOverdue(payment("REQUESTED", { dueDate: yesterday }), now)).toBe(true);
    expect(isOverdue(payment("SCHEDULED", { dueDate: yesterday }), now)).toBe(true);
    expect(effectiveStatus(payment("REQUESTED", { dueDate: yesterday }), now)).toBe("OVERDUE");
  });
  it("AWAITING_APPROVAL / PAID are never overdue", () => {
    expect(isOverdue(payment("AWAITING_APPROVAL", { dueDate: yesterday }), now)).toBe(false);
    expect(isOverdue(payment("PAID", { dueDate: yesterday }), now)).toBe(false);
  });
  it("future due is not overdue", () => {
    expect(isOverdue(payment("REQUESTED", { dueDate: tomorrow }), now)).toBe(false);
  });
});
