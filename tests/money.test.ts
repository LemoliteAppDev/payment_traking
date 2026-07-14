import { describe, it, expect } from "vitest";
import { formatINR, groupIndian, wordsINR, rupeesToPaise, paiseToRupees } from "@/lib/money";

describe("paise <-> rupees", () => {
  it("converts rupees to paise", () => {
    expect(rupeesToPaise(45000)).toBe(4500000n);
    expect(rupeesToPaise(120000)).toBe(12000000n);
  });
  it("converts paise to rupees", () => {
    expect(paiseToRupees(4500000n)).toBe(45000);
  });
});

describe("Indian grouping", () => {
  it("groups lakhs/crores correctly", () => {
    expect(groupIndian(45000n)).toBe("45,000");
    expect(groupIndian(120000n)).toBe("1,20,000");
    expect(groupIndian(10000000n)).toBe("1,00,00,000");
    expect(groupIndian(100n)).toBe("100");
  });
  it("formats paise as a rupee string", () => {
    expect(formatINR(4500000n)).toBe("₹45,000");
    expect(formatINR(12000000n)).toBe("₹1,20,000");
    expect(formatINR(4500050n)).toBe("₹45,000.50");
  });
});

describe("amount in words (Indian units)", () => {
  it("thousands", () => {
    expect(wordsINR(4500000n)).toBe("Forty-five thousand rupees only");
  });
  it("lakhs", () => {
    expect(wordsINR(12000000n)).toBe("One lakh twenty thousand rupees only");
  });
  it("crores", () => {
    expect(wordsINR(1_00_00_000_00n)).toBe("One crore rupees only");
  });
  it("empty for zero", () => {
    expect(wordsINR(0n)).toBe("");
  });
});
