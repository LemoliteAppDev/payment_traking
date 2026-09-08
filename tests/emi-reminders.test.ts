import { describe, it, expect } from "vitest";
import {
  parseDueDate,
  parseAmountToPaise,
  parseReminderCsv,
  daysUntilDue,
  isDueForReminder,
  ymdToDate,
  dueHeadline,
  reminderPush,
  addMonthsYmd,
  expandMonthly,
  parseRepeat,
  LEAD_DAYS,
  MAX_REPEAT_MONTHS,
} from "@/lib/emi-reminders";

describe("parseDueDate", () => {
  it("reads day-first formats", () => {
    expect(parseDueDate("06/09/2026")).toBe("2026-09-06");
    expect(parseDueDate("6-9-2026")).toBe("2026-09-06");
    expect(parseDueDate("06.09.2026")).toBe("2026-09-06");
    expect(parseDueDate("06/09/26")).toBe("2026-09-06");
  });

  it("reads ISO and named months", () => {
    expect(parseDueDate("2026-09-06")).toBe("2026-09-06");
    expect(parseDueDate("6 Sep 2026")).toBe("2026-09-06");
    expect(parseDueDate("6 September 2026")).toBe("2026-09-06");
  });

  it("is day-first, not month-first", () => {
    // 09/06 is 9 June, not 6 September — these sheets are Indian.
    expect(parseDueDate("09/06/2026")).toBe("2026-06-09");
  });

  it("rejects junk and impossible dates", () => {
    expect(parseDueDate("")).toBeNull();
    expect(parseDueDate("next friday")).toBeNull();
    expect(parseDueDate("31/02/2026")).toBeNull();
    expect(parseDueDate("06/13/2026")).toBeNull();
  });
});

describe("parseAmountToPaise", () => {
  it("handles rupee signs, commas and decimals", () => {
    expect(parseAmountToPaise("45000")).toBe(4500000n);
    expect(parseAmountToPaise("₹45,000")).toBe(4500000n);
    expect(parseAmountToPaise("Rs. 45000")).toBe(4500000n);
    expect(parseAmountToPaise("45000.50")).toBe(4500050n);
    expect(parseAmountToPaise("45000.5")).toBe(4500050n);
  });

  it("rejects zero, negatives and words", () => {
    expect(parseAmountToPaise("0")).toBeNull();
    expect(parseAmountToPaise("-500")).toBeNull();
    expect(parseAmountToPaise("forty five thousand")).toBeNull();
  });
});

describe("parseReminderCsv", () => {
  it("reads the three-column sheet and skips the header", () => {
    const csv = [
      "Due Date,EMI Description,Amount",
      "06/09/2026,Car loan EMI — HDFC,45000",
      "10/09/2026,Office rent,\"1,20,000\"",
    ].join("\n");
    const { rows, errors } = parseReminderCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, dueDate: "2026-09-06", description: "Car loan EMI — HDFC", amount: "4500000", repeatMonths: 1 },
      { line: 3, dueDate: "2026-09-10", description: "Office rent", amount: "12000000", repeatMonths: 1 },
    ]);
  });

  it("keeps good rows and reports bad ones by line", () => {
    const csv = [
      "06/09/2026,Car loan,45000",
      "not a date,Broken row,45000",
      "10/09/2026,,45000",
      "12/09/2026,No amount,abc",
      "15/09/2026,Fine,900",
    ].join("\n");
    const { rows, errors } = parseReminderCsv(csv);
    expect(rows.map((r) => r.description)).toEqual(["Car loan", "Fine"]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });

  it("accepts tab-separated rows pasted from a spreadsheet", () => {
    const { rows } = parseReminderCsv("06/09/2026\tCar loan\t45000");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe("4500000");
  });

  it("ignores blank lines and a BOM", () => {
    const { rows, errors } = parseReminderCsv("﻿06/09/2026,Car loan,45000\n\n\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});

describe("the reminder window", () => {
  // 11:00 IST on 3 September 2026.
  const on = (ymd: string, utcHour = 5, utcMin = 30) =>
    new Date(`${ymd}T${String(utcHour).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}:00Z`);

  it("counts days in IST, not the server's timezone", () => {
    expect(daysUntilDue(ymdToDate("2026-09-06"), on("2026-09-03"))).toBe(3);
    expect(daysUntilDue(ymdToDate("2026-09-06"), on("2026-09-06"))).toBe(0);
    expect(daysUntilDue(ymdToDate("2026-09-06"), on("2026-09-08"))).toBe(-2);
    // 23:00 UTC on the 5th is already the 6th in IST.
    expect(daysUntilDue(ymdToDate("2026-09-06"), on("2026-09-05", 23, 0))).toBe(0);
  });

  it("fires on D-3, D-2, D-1 and D — a due date of the 6th reminds on 3,4,5,6", () => {
    const due = ymdToDate("2026-09-06");
    expect(isDueForReminder(due, on("2026-09-02"))).toBe(false);
    for (const day of ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]) {
      expect(isDueForReminder(due, on(day))).toBe(true);
    }
  });

  it("keeps firing past the due date until it's marked paid", () => {
    const due = ymdToDate("2026-09-06");
    expect(isDueForReminder(due, on("2026-09-07"))).toBe(true);
    expect(isDueForReminder(due, on("2026-10-06"))).toBe(true);
  });

  it("starts exactly LEAD_DAYS out", () => {
    expect(LEAD_DAYS).toBe(3);
  });
});

describe("one notification per EMI", () => {
  const at11 = (ymd: string) => new Date(`${ymd}T05:30:00Z`); // 11:00 IST
  const emi = {
    id: "ckabc123",
    description: "Car loan EMI — HDFC",
    amount: 4500000n,
    dueDate: ymdToDate("2026-09-06"),
  };

  it("names the urgency in the title", () => {
    expect(dueHeadline(3)).toBe("EMI due in 3 days");
    expect(dueHeadline(1)).toBe("EMI due tomorrow");
    expect(dueHeadline(0)).toBe("EMI due TODAY");
    expect(dueHeadline(-1)).toBe("EMI 1 day LATE");
    expect(dueHeadline(-4)).toBe("EMI 4 days LATE");
  });

  it("puts the amount and description in the body", () => {
    const p = reminderPush(emi, at11("2026-09-03"));
    expect(p.title).toBe("EMI due in 3 days");
    expect(p.body).toContain("₹45,000");
    expect(p.body).toContain("Car loan EMI — HDFC");
    expect(p.url).toBe("/?tab=reminders");
  });

  it("tags each EMI separately so phones don't collapse them into one", () => {
    const other = { ...emi, id: "ckxyz789", description: "Office rent" };
    expect(reminderPush(emi, at11("2026-09-03")).tag).toBe("emi-ckabc123");
    expect(reminderPush(other, at11("2026-09-03")).tag).toBe("emi-ckxyz789");
  });

  it("tracks the same EMI across days under one tag", () => {
    // Day-to-day repeats replace the previous card for that EMI, not the others.
    expect(reminderPush(emi, at11("2026-09-04")).tag).toBe(reminderPush(emi, at11("2026-09-06")).tag);
    expect(reminderPush(emi, at11("2026-09-04")).title).toBe("EMI due in 2 days");
    expect(reminderPush(emi, at11("2026-09-06")).title).toBe("EMI due TODAY");
  });
});

describe("monthly EMIs", () => {
  it("keeps the same day each month", () => {
    expect(addMonthsYmd("2026-09-06", 1)).toBe("2026-10-06");
    expect(addMonthsYmd("2026-09-06", 4)).toBe("2027-01-06");
    expect(addMonthsYmd("2026-09-06", 12)).toBe("2027-09-06");
  });

  it("clamps to the end of short months without drifting after", () => {
    // A 31st EMI lands on 28 Feb, then returns to the 31st — it must not walk
    // backwards to the 28th for the rest of the loan.
    expect(addMonthsYmd("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsYmd("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsYmd("2027-01-31", 3)).toBe("2027-04-30");
    // Leap year.
    expect(addMonthsYmd("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("expands a run starting at the given date", () => {
    expect(expandMonthly("2026-09-06", 1)).toEqual(["2026-09-06"]);
    expect(expandMonthly("2026-09-06", 4)).toEqual([
      "2026-09-06", "2026-10-06", "2026-11-06", "2026-12-06",
    ]);
    expect(expandMonthly("2026-09-06", 36)).toHaveLength(36);
  });

  it("never generates more than the cap", () => {
    expect(expandMonthly("2026-09-06", 5000)).toHaveLength(MAX_REPEAT_MONTHS);
    expect(expandMonthly("2026-09-06", 0)).toHaveLength(1);
  });

  it("reads the optional 4th column as a count or an end date", () => {
    expect(parseRepeat("", "2026-09-06")).toBe(1);
    expect(parseRepeat("36", "2026-09-06")).toBe(36);
    expect(parseRepeat("36 months", "2026-09-06")).toBe(36);
    // Sep 2026 through Aug 2029 inclusive = 36 installments.
    expect(parseRepeat("06/08/2029", "2026-09-06")).toBe(36);
    expect(parseRepeat("06/09/2026", "2026-09-06")).toBe(1);
  });

  it("rejects an unreadable or out-of-range repeat", () => {
    expect(parseRepeat("lots", "2026-09-06")).toBeNull();
    expect(parseRepeat("999", "2026-09-06")).toBeNull();
    expect(parseRepeat("0", "2026-09-06")).toBeNull();
    // An end date before the start is not a run.
    expect(parseRepeat("06/08/2025", "2026-09-06")).toBeNull();
  });

  it("carries the repeat through CSV parsing", () => {
    const { rows, errors } = parseReminderCsv(
      "06/09/2026,Car loan EMI,45000,36\n10/09/2026,Office rent,120000",
    );
    expect(errors).toEqual([]);
    expect(rows[0].repeatMonths).toBe(36);
    expect(rows[1].repeatMonths).toBe(1); // blank 4th column = one-off
  });
});
