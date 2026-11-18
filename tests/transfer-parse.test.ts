/**
 * The shorthand parser, tested against the messages people really send.
 *
 * The block in the first test is copied verbatim from a real chat, dividers
 * and typos included — if that stops parsing, the feature is broken no matter
 * what the synthetic cases say.
 */
import { describe, it, expect } from "vitest";
import { parseTransfers } from "../src/lib/transfer-parse";

// The Pay-from list this workspace actually has.
const SOURCES = ["Shivam", "Peliswan", "Bm roadlines", "Zenith", "Lemolite", "Shakti", "Jagat", "Jignesh"];

const L = (n: number) => BigInt(n * 100_000) * 100n; // n lakh, in paise

describe("transfer shorthand — the real message", () => {
  const MESSAGE = `Peliswan to shvam : 15 lakhs

------------
Peliswan thi Shivam : 15L
------------------
Jignesh yes bank to jagat  axis

Transfer 12 L
-------------------
Shivam to bhagyraj 30 lc
-------------------
Shivam to parth rasayan ( meghnagar) 10 lc
-------------------
Peliswan to kutch Petrochem 38 lc`;

  const got = parseTransfers(MESSAGE, SOURCES);

  it("finds all six transfers", () => {
    expect(got).toHaveLength(6);
  });

  it("reads 'Peliswan to shvam : 15 lakhs'", () => {
    expect(got[0].from).toBe("Peliswan");
    expect(got[0].payee).toBe("shvam");
    expect(got[0].amount).toBe(L(15));
  });

  it("reads the Gujarati 'thi' as 'from'", () => {
    expect(got[1].from).toBe("Peliswan");
    expect(got[1].payee).toBe("Shivam");
    expect(got[1].amount).toBe(L(15));
  });

  it("picks up an amount left on the next line", () => {
    // "Jignesh yes bank to jagat  axis" / "Transfer 12 L"
    expect(got[2].payee).toBe("jagat axis");
    expect(got[2].amount).toBe(L(12));
    expect(got[2].raw).toContain("Transfer 12 L");
  });

  it("treats 'lc' as lakh", () => {
    expect(got[3].from).toBe("Shivam");
    expect(got[3].payee).toBe("bhagyraj");
    expect(got[3].amount).toBe(L(30));
  });

  it("keeps a bracketed place in the payee", () => {
    expect(got[4].payee).toBe("parth rasayan (meghnagar)");
    expect(got[4].amount).toBe(L(10));
  });

  it("keeps the payee's own capitals", () => {
    expect(got[5].payee).toBe("kutch Petrochem");
    expect(got[5].amount).toBe(L(38));
  });

  it("recognises every source as a real Pay-from account", () => {
    expect(got.every((t) => t.fromKnown)).toBe(true);
  });

  it("matches 'Jignesh yes bank' to the Jignesh source", () => {
    expect(got[2].from).toBe("Jignesh");
    expect(got[2].fromRaw).toBe("Jignesh yes bank");
  });
});

describe("transfer shorthand — units and amounts", () => {
  const one = (s: string) => parseTransfers(s, SOURCES)[0];

  it("handles every spelling of lakh", () => {
    for (const u of ["L", "l", "lc", "lk", "lac", "lacs", "lakh", "lakhs"]) {
      expect(one(`Shivam to Acme 5 ${u}`)?.amount).toBe(L(5));
    }
  });

  it("handles crore and thousand", () => {
    expect(one("Shivam to Acme 2 cr")?.amount).toBe(BigInt(2 * 10_000_000) * 100n);
    expect(one("Shivam to Acme 50 k")?.amount).toBe(BigInt(50 * 1_000) * 100n);
  });

  it("handles a plain rupee figure with grouping", () => {
    expect(one("Shivam to Acme 12,00,000")?.amount).toBe(BigInt(1_200_000) * 100n);
    expect(one("Shivam to Acme ₹45000")?.amount).toBe(BigInt(45_000) * 100n);
  });

  it("handles a decimal lakh", () => {
    expect(one("Shivam to Acme 1.5 L")?.amount).toBe(BigInt(150_000) * 100n);
  });

  it("stores money as integer paise", () => {
    // 15 lakh rupees = 1,50,00,000 paise. Never a float.
    expect(one("Peliswan to Acme 15L")?.amount).toBe(1_500_000_00n);
    expect(typeof one("Peliswan to Acme 15L")?.amount).toBe("bigint");
  });
});

describe("transfer shorthand — what it must NOT turn into a payment", () => {
  it("ignores ordinary chat", () => {
    expect(parseTransfers("ok will do", SOURCES)).toHaveLength(0);
    expect(parseTransfers("talk to Jagat about the invoice", SOURCES)).toHaveLength(0);
    expect(parseTransfers("Sent the file to Shivam", SOURCES)).toHaveLength(0);
  });

  it("ignores a line with no amount at all", () => {
    expect(parseTransfers("Peliswan to Shivam", SOURCES)).toHaveLength(0);
  });

  it("ignores a trailing word that is not a unit", () => {
    // "2 ltd" is part of the name, not two of something.
    expect(parseTransfers("Shivam to Parth 2 ltd", SOURCES)).toHaveLength(0);
  });

  it("ignores a zero amount", () => {
    expect(parseTransfers("Shivam to Acme 0 L", SOURCES)).toHaveLength(0);
  });

  it("reads a dash before the amount as a separator, not a minus", () => {
    // People write "Acme - 5 L" and "Acme -5 L" to mean the same thing, and a
    // negative transfer is not a thing anyone asks for.
    expect(parseTransfers("Shivam to Acme - 5 L", SOURCES)[0].amount).toBe(L(5));
    expect(parseTransfers("Shivam to Acme -5 L", SOURCES)[0].amount).toBe(L(5));
    expect(parseTransfers("Shivam to Acme : 5 L", SOURCES)[0].payee).toBe("Acme");
  });

  it("drops a dangling line when the next line is not an amount", () => {
    const got = parseTransfers("Peliswan to Shivam\nthanks mate", SOURCES);
    expect(got).toHaveLength(0);
  });

  it("refuses an absurdly long message", () => {
    expect(parseTransfers("x".repeat(6000), SOURCES)).toHaveLength(0);
  });
});

describe("transfer shorthand — unknown sources", () => {
  it("keeps an unrecognised source but flags it", () => {
    const got = parseTransfers("Qwerty Bank to Acme 3 L", SOURCES)[0];
    expect(got.from).toBe("Qwerty Bank");
    expect(got.fromKnown).toBe(false);
  });

  it("forgives a small typo in a known source", () => {
    expect(parseTransfers("Peliswn to Acme 3 L", SOURCES)[0].fromKnown).toBe(true);
    expect(parseTransfers("Peliswn to Acme 3 L", SOURCES)[0].from).toBe("Peliswan");
  });
});

describe("transfer shorthand — pasted into a single-line box", () => {
  // A one-line input strips the newlines, so the dividers are all that is
  // left to separate the requests. It still has to work.
  const FLAT =
    "Peliswan to shvam : 15 lakhs ------------ Peliswan thi Shivam : 15L " +
    "------------------ Jignesh yes bank to jagat  axis Transfer 12 L " +
    "------------------- Shivam to bhagyraj 30 lc ------------------- " +
    "Shivam to parth rasayan ( meghnagar) 10 lc ------------------- " +
    "Peliswan to kutch Petrochem 38 lc";

  const got = parseTransfers(FLAT, SOURCES);

  it("still finds all six", () => {
    expect(got).toHaveLength(6);
  });

  it("keeps the amounts right", () => {
    expect(got.map((t) => t.amount)).toEqual([L(15), L(15), L(12), L(30), L(10), L(38)]);
  });

  it("does not leave 'Transfer' stuck on the payee", () => {
    expect(got[2].payee).toBe("jagat axis");
  });

  it("reads the same payees as the multi-line version", () => {
    expect(got.map((t) => t.payee)).toEqual([
      "shvam", "Shivam", "jagat axis", "bhagyraj", "parth rasayan (meghnagar)", "kutch Petrochem",
    ]);
  });
});
