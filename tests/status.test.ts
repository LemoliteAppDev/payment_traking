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

const PAYER: Actor = { id: "amit", role: "PAYER" };
const RAISER: Actor = { id: "priya", role: "REQUESTER" }; // raised the payment
const OTHER_REQ: Actor = { id: "rahul", role: "REQUESTER" }; // someone else

function payment(status: Status, over: Partial<PaymentLike> = {}): PaymentLike {
  return { status, requestedById: "priya", ...over };
}

const ALL: Status[] = ["REQUESTED", "SCHEDULED", "PAID", "CONFIRMED", "HOLD", "CANCELLED"];
const tomorrow = new Date(Date.now() + 86400000);

describe("allowed transitions succeed", () => {
  it("REQUESTED -> SCHEDULED (payer, with date)", () => {
    const r = transition(payment("REQUESTED"), "SCHEDULED", PAYER, { scheduledFor: tomorrow });
    expect(r.patch.status).toBe("SCHEDULED");
    expect(r.patch.scheduledFor).toBeInstanceOf(Date);
    expect(r.eventType).toBe("SCHEDULE");
  });
  it("REQUESTED -> PAID (payer, with proof)", () => {
    const r = transition(payment("REQUESTED"), "PAID", PAYER, { hasProof: true });
    expect(r.patch.status).toBe("PAID");
    expect(r.patch.paidById).toBe("amit");
    expect(r.patch.paidAt).toBeInstanceOf(Date);
  });
  it("REQUESTED -> HOLD (payer)", () => {
    expect(transition(payment("REQUESTED"), "HOLD", PAYER).patch.status).toBe("HOLD");
  });
  it("REQUESTED -> CANCELLED (payer)", () => {
    expect(transition(payment("REQUESTED"), "CANCELLED", PAYER).patch.status).toBe("CANCELLED");
  });
  it("REQUESTED -> CANCELLED (raising requester)", () => {
    expect(transition(payment("REQUESTED"), "CANCELLED", RAISER).patch.status).toBe("CANCELLED");
  });
  it("SCHEDULED -> PAID (payer, with proof)", () => {
    expect(transition(payment("SCHEDULED"), "PAID", PAYER, { hasProof: true }).patch.status).toBe("PAID");
  });
  it("SCHEDULED -> HOLD (payer)", () => {
    expect(transition(payment("SCHEDULED"), "HOLD", PAYER).patch.status).toBe("HOLD");
  });
  it("HOLD -> SCHEDULED (payer, with date)", () => {
    expect(transition(payment("HOLD"), "SCHEDULED", PAYER, { scheduledFor: tomorrow }).patch.status).toBe("SCHEDULED");
  });
  it("HOLD -> PAID (payer, with proof)", () => {
    expect(transition(payment("HOLD"), "PAID", PAYER, { hasProof: true }).patch.status).toBe("PAID");
  });
  it("PAID -> CONFIRMED (raising requester)", () => {
    const r = transition(payment("PAID"), "CONFIRMED", RAISER);
    expect(r.patch.status).toBe("CONFIRMED");
    expect(r.patch.confirmedById).toBe("priya");
  });
});

describe("every transition NOT in the table is rejected", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      const allowed = TRANSITIONS[from].includes(to);
      if (allowed) continue;
      it(`${from} -> ${to} is rejected`, () => {
        // Give it every possible context so only the table/terminal rule can reject it.
        expect(() =>
          transition(payment(from), to, PAYER, { scheduledFor: tomorrow, hasProof: true }),
        ).toThrow(TransitionError);
      });
    }
  }
  it("CONFIRMED and CANCELLED are terminal", () => {
    expect(() => transition(payment("CONFIRMED"), "PAID", PAYER, { hasProof: true })).toThrowError(/cannot change/i);
    expect(() => transition(payment("CANCELLED"), "SCHEDULED", PAYER, { scheduledFor: tomorrow })).toThrowError(/cannot change/i);
  });
});

describe("hard rule 1: no PAID without proof", () => {
  it("rejects pay with no proof", () => {
    try {
      transition(payment("REQUESTED"), "PAID", PAYER, { hasProof: false });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      expect((e as TransitionError).code).toBe("MISSING_PROOF");
    }
  });
  it("rejects pay with proof omitted entirely", () => {
    expect(() => transition(payment("SCHEDULED"), "PAID", PAYER, {})).toThrowError(/proof/i);
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
  it("rejects schedule with an invalid date", () => {
    expect(() =>
      transition(payment("REQUESTED"), "SCHEDULED", PAYER, { scheduledFor: new Date("nonsense") }),
    ).toThrowError(/without a date/i);
  });
});

describe("actor rules", () => {
  it("a requester cannot schedule", () => {
    expect(() => transition(payment("REQUESTED"), "SCHEDULED", RAISER, { scheduledFor: tomorrow })).toThrowError(/only the payer/i);
  });
  it("a requester cannot pay", () => {
    expect(() => transition(payment("REQUESTED"), "PAID", RAISER, { hasProof: true })).toThrowError(/only the payer/i);
  });
  it("a requester cannot hold", () => {
    expect(() => transition(payment("REQUESTED"), "HOLD", RAISER)).toThrowError(/only the payer/i);
  });
  it("the payer cannot confirm", () => {
    expect(() => transition(payment("PAID"), "CONFIRMED", PAYER)).toThrowError(/only the requester/i);
  });
  it("a non-raising requester cannot confirm", () => {
    expect(() => transition(payment("PAID"), "CONFIRMED", OTHER_REQ)).toThrowError(/only the requester/i);
  });
  it("a non-raising requester cannot cancel", () => {
    expect(() => transition(payment("REQUESTED"), "CANCELLED", OTHER_REQ)).toThrowError(/only the payer or the requester/i);
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
  it("REQUESTED + past due is overdue", () => {
    expect(isOverdue(payment("REQUESTED", { dueDate: yesterday }), now)).toBe(true);
    expect(effectiveStatus(payment("REQUESTED", { dueDate: yesterday }), now)).toBe("OVERDUE");
  });
  it("SCHEDULED + past due is overdue", () => {
    expect(isOverdue(payment("SCHEDULED", { dueDate: yesterday }), now)).toBe(true);
  });
  it("REQUESTED + future due is not overdue", () => {
    expect(isOverdue(payment("REQUESTED", { dueDate: tomorrow }), now)).toBe(false);
    expect(effectiveStatus(payment("REQUESTED", { dueDate: tomorrow }), now)).toBe("REQUESTED");
  });
  it("PAID is never overdue even if past due", () => {
    expect(isOverdue(payment("PAID", { dueDate: yesterday }), now)).toBe(false);
  });
  it("updates automatically as the date passes", () => {
    const p = payment("SCHEDULED", { dueDate: new Date("2026-07-13T00:00:00") });
    expect(isOverdue(p, new Date("2026-07-13T10:00:00"))).toBe(false); // same day, not yet
    expect(isOverdue(p, new Date("2026-07-14T10:00:00"))).toBe(true); // next day, now late
  });
});
