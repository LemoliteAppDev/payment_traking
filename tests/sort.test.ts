import { describe, it, expect } from "vitest";
import { listSortKey, isoDay, type Status } from "../src/lib/client";

const p = (status: Status, dueDate: string) => ({ status, dueDate });

describe("list sort key — today first", () => {
  it("puts anything due today in tier 0, approval-pending included", () => {
    expect(listSortKey(p("REQUESTED", isoDay(0)))[0]).toBe(0);
    expect(listSortKey(p("AWAITING_APPROVAL", isoDay(0)))[0]).toBe(0);
    expect(listSortKey(p("RETURNED", isoDay(0)))[0]).toBe(0);
    expect(listSortKey(p("SCHEDULED", isoDay(0)))[0]).toBe(0);
  });

  it("ranks today above overdue, future, awaiting-approval and done", () => {
    const today = listSortKey(p("REQUESTED", isoDay(0)))[0];
    expect(today).toBeLessThan(listSortKey(p("REQUESTED", isoDay(-3)))[0]);
    expect(today).toBeLessThan(listSortKey(p("REQUESTED", isoDay(5)))[0]);
    expect(today).toBeLessThan(listSortKey(p("AWAITING_APPROVAL", isoDay(5)))[0]);
    expect(today).toBeLessThan(listSortKey(p("PAID", isoDay(0)))[0]);
  });

  it("keeps paid/cancelled last even when dated today", () => {
    expect(listSortKey(p("PAID", isoDay(0)))[0]).toBe(3);
    expect(listSortKey(p("CONFIRMED", isoDay(0)))[0]).toBe(3);
    expect(listSortKey(p("CANCELLED", isoDay(0)))[0]).toBe(3);
  });

  it("orders the non-today active tier by due date, overdue first", () => {
    const overdue = listSortKey(p("REQUESTED", isoDay(-2)));
    const soon = listSortKey(p("REQUESTED", isoDay(1)));
    const later = listSortKey(p("REQUESTED", isoDay(9)));
    expect(overdue[0]).toBe(1);
    expect(overdue[1]).toBeLessThan(soon[1]);
    expect(soon[1]).toBeLessThan(later[1]);
  });
});
