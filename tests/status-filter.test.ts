/**
 * The All tab's status dropdown. It replaced the Waiting / Paid / All / Mine
 * chips, so the first thing to pin down is that the two tabs people used most
 * still select exactly what they used to.
 */
import { describe, it, expect } from "vitest";
import { matchesStatus, STATUS_FILTERS, type Card, type Status, type Effective } from "../src/lib/client";

function card(status: Status, over = false, mine = false): Card {
  return {
    id: "p1",
    amount: "4500000",
    payee: "Acme",
    payFrom: "HDFC",
    payFromType: "ACCOUNT",
    purpose: "stock",
    status,
    effective: (over ? "OVERDUE" : status) as Effective,
    overdue: over,
    dueDate: "2026-11-20",
    scheduledFor: null,
    createdAt: "2026-11-17T09:00:00.000Z",
    editedAt: null,
    paidAt: null,
    isPrivate: false,
    mine,
    requestedBy: { id: "u1", name: "Priya", role: "USER" },
    hasProof: false,
  };
}

describe("status filter — the old tabs still mean the same thing", () => {
  it("'Waiting on someone' keeps everything the Waiting tab showed", () => {
    // The old tab was: REQUESTED, AWAITING_APPROVAL, RETURNED, OVERDUE.
    expect(matchesStatus(card("REQUESTED"), "waiting")).toBe(true);
    expect(matchesStatus(card("AWAITING_APPROVAL"), "waiting")).toBe(true);
    expect(matchesStatus(card("RETURNED"), "waiting")).toBe(true);
    expect(matchesStatus(card("REQUESTED", true), "waiting")).toBe(true);
  });

  it("'Waiting on someone' leaves out anything finished or parked", () => {
    expect(matchesStatus(card("PAID"), "waiting")).toBe(false);
    expect(matchesStatus(card("CONFIRMED"), "waiting")).toBe(false);
    expect(matchesStatus(card("SCHEDULED"), "waiting")).toBe(false);
    expect(matchesStatus(card("HOLD"), "waiting")).toBe(false);
    expect(matchesStatus(card("CANCELLED"), "waiting")).toBe(false);
  });

  it("'Raised by me' follows the card's own `mine` flag", () => {
    expect(matchesStatus(card("PAID", false, true), "mine")).toBe(true);
    expect(matchesStatus(card("PAID", false, false), "mine")).toBe(false);
  });

  it("'Every status' lets everything through", () => {
    const every: Status[] = [
      "AWAITING_APPROVAL", "RETURNED", "REQUESTED", "SCHEDULED",
      "PAID", "CONFIRMED", "HOLD", "CANCELLED",
    ];
    for (const s of every) expect(matchesStatus(card(s), "all")).toBe(true);
  });
});

describe("status filter — one option per real status", () => {
  it("matches each status on its own option and no other", () => {
    const pairs: [Status, string][] = [
      ["AWAITING_APPROVAL", "awaiting"],
      ["RETURNED", "returned"],
      ["REQUESTED", "requested"],
      ["SCHEDULED", "scheduled"],
      ["PAID", "paid"],
      ["CONFIRMED", "confirmed"],
      ["HOLD", "hold"],
      ["CANCELLED", "cancelled"],
    ];
    for (const [status, option] of pairs) {
      const c = card(status);
      expect(matchesStatus(c, option as never)).toBe(true);
      for (const [otherStatus, otherOption] of pairs) {
        if (otherStatus === status) continue;
        expect(matchesStatus(c, otherOption as never)).toBe(false);
      }
    }
  });

  it("'Late' is derived from the effective status, never stored", () => {
    // An overdue payment is still REQUESTED underneath — that is the rule in
    // CLAUDE.md, and the dropdown must not contradict it.
    const late = card("REQUESTED", true);
    expect(matchesStatus(late, "overdue")).toBe(true);
    expect(matchesStatus(late, "requested")).toBe(true);
    expect(matchesStatus(card("REQUESTED", false), "overdue")).toBe(false);
  });

  it("offers every option exactly once", () => {
    const keys = STATUS_FILTERS.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    // Waiting is the default, so it leads the list.
    expect(keys[0]).toBe("waiting");
  });
});
