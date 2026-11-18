/**
 * Reads the shorthand people actually type when they ask for a transfer, and
 * turns it into the fields a payment needs.
 *
 * The real messages look like this:
 *
 *   Peliswan to shvam : 15 lakhs
 *   Peliswan thi Shivam : 15L
 *   Jignesh yes bank to jagat  axis
 *   Transfer 12 L
 *   Shivam to bhagyraj 30 lc
 *   Shivam to parth rasayan ( meghnagar) 10 lc
 *   Peliswan to kutch Petrochem 38 lc
 *
 * So the parser has to cope with: "to" and the Gujarati "thi", "L" / "lc" /
 * "lakhs" for the same unit, the amount sometimes sitting on the next line
 * behind the word "Transfer", names with brackets and stray spaces, and
 * misspelled account names ("shvam").
 *
 * This runs in the browser, not on the server — chat messages are end-to-end
 * encrypted, so the server never sees the text to parse it. See lib/e2ee.ts.
 *
 * Nothing here creates a payment. It only proposes one, which a person then
 * confirms; a misread line must never become money moving on its own.
 */

export interface ParsedTransfer {
  /** The source, snapped to a known Pay-from name when one matches. */
  from: string;
  /** What the sender typed for the source, before matching. */
  fromRaw: string;
  /** True when `from` matched a real Pay-from account. */
  fromKnown: boolean;
  /** Who gets paid. */
  payee: string;
  /** Integer paise, as the rest of the app stores money. */
  amount: bigint;
  /** The line(s) this came from, kept for the payment's purpose field. */
  raw: string;
}

/** "to", the Gujarati "thi" (= from), and the arrows people type. */
const SEPARATORS = /\s+(?:to|thi|se|ne|->|=>|→|–>)\s+/i;

/** Multipliers. "lc" and "lk" are the common typos for lakh. */
const UNITS: [RegExp, number][] = [
  [/^(?:cr|crore|crores|cror)$/i, 10_000_000],
  [/^(?:l|lc|lk|lac|lacs|lakh|lakhs|lakhh|lakhs?\.?)$/i, 100_000],
  [/^(?:k|thousand|hazar|hjr)$/i, 1_000],
];

/** A trailing amount: "15 lakhs", "15L", ": 38 lc", "₹12,00,000". */
const AMOUNT_TAIL =
  /[\s:\-–—=]*(?:rs\.?|inr|₹)?\s*([0-9][0-9,.\s]*?)\s*([a-z.]{0,8})\s*$/i;

/** A line that is only an amount, e.g. "Transfer 12 L" or "amount 5 lakh". */
const AMOUNT_ONLY =
  /^(?:transfer|amount|amt|rs\.?|inr|₹|pay|payment|total)?[\s:\-–—]*([0-9][0-9,.\s]*?)\s*([a-z.]{0,8})\s*$/i;

/** Rows of dashes / underscores people use to separate one request from the next. */
const DIVIDER = /^[\s\-–—_=*.]+$/;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Levenshtein distance, capped — only used to forgive small typos. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = t;
    }
  }
  return prev[b.length];
}

/**
 * Snap a typed source to a real Pay-from name. Exact first, then a contained
 * match ("jignesh yes bank" → "Jignesh"), then a near-miss ("shvam" → "Shivam").
 */
function matchSource(typed: string, known: string[]): { name: string; known: boolean } {
  const t = normalise(typed);
  if (!t) return { name: typed.trim(), known: false };

  for (const k of known) if (normalise(k) === t) return { name: k, known: true };

  // Longest containment wins, so "Bm roadlines" beats a stray "Bm".
  let best: string | null = null;
  for (const k of known) {
    const n = normalise(k);
    if (!n) continue;
    if (t.includes(n) || n.includes(t)) {
      if (!best || n.length > normalise(best).length) best = k;
    }
  }
  if (best) return { name: best, known: true };

  for (const k of known) {
    if (distance(t, normalise(k)) <= 2) return { name: k, known: true };
  }
  return { name: typed.trim(), known: false };
}

function cleanName(s: string): string {
  return s
    // A flattened paste leaves the next line's lead-in glued to the payee
    // ("jagat axis Transfer"), so drop a trailing keyword like that.
    .replace(/\s+(?:transfer|amount|amt|pay|payment|total|rs\.?)\s*$/i, "")
    .replace(/[\s:,\-–—]+$/g, "")
    .replace(/^[\s:,\-–—]+/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Turn "15" + "lakhs" into integer paise. Returns null if it isn't a number. */
function toPaise(digits: string, unit: string): bigint | null {
  const cleaned = digits.replace(/[,\s]/g, "");
  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;

  let multiplier = 1;
  const u = unit.replace(/\./g, "").trim();
  if (u) {
    const hit = UNITS.find(([re]) => re.test(u));
    // A trailing word that isn't a unit means the "amount" was really part of
    // the name ("parth rasayan 2 ltd"), so this is not a transfer line.
    if (!hit) return null;
    multiplier = hit[1];
  }
  const rupees = Math.round(value * multiplier);
  if (rupees <= 0) return null;
  return BigInt(rupees) * 100n;
}

interface Pending {
  fromRaw: string;
  payee: string;
  raw: string;
}

/**
 * Pull every transfer instruction out of a chat message.
 * `sources` is the Pay-from list, used to recognise and correct the source.
 */
export function parseTransfers(text: string, sources: string[] = []): ParsedTransfer[] {
  if (!text || text.length > 5000) return [];
  const out: ParsedTransfer[] = [];
  // A single-line input strips newlines when this is pasted, leaving the
  // dividers as the only thing separating one request from the next — so a
  // run of dashes counts as a line break too.
  const lines = text.replace(/\s*[-–—_=]{3,}\s*/g, "\n").split(/\r?\n/);
  let pending: Pending | null = null;

  const settle = (p: Pending, amount: bigint, raw: string) => {
    const src = matchSource(p.fromRaw, sources);
    const payee = cleanName(p.payee);
    if (!payee) return;
    out.push({
      from: src.name,
      fromRaw: p.fromRaw.trim(),
      fromKnown: src.known,
      payee,
      amount,
      raw,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || DIVIDER.test(trimmed)) continue;

    // An amount on its own completes the line above it ("Transfer 12 L").
    if (pending) {
      const solo = trimmed.match(AMOUNT_ONLY);
      if (solo) {
        const amount = toPaise(solo[1], solo[2] ?? "");
        if (amount !== null) {
          settle(pending, amount, `${pending.raw}\n${trimmed}`);
          pending = null;
          continue;
        }
      }
      // Anything else means that line never had an amount; drop it.
      pending = null;
    }

    const parts = trimmed.split(SEPARATORS);
    if (parts.length < 2) continue;
    // Only the first separator splits source from the rest, so a payee may
    // contain one ("Shivam to parth rasayan to be paid").
    const fromRaw = parts[0];
    const rest = trimmed.slice(fromRaw.length).replace(SEPARATORS, "").trim();
    if (!fromRaw.trim() || !rest) continue;

    const tail = rest.match(AMOUNT_TAIL);
    const amount = tail ? toPaise(tail[1], tail[2] ?? "") : null;
    if (amount === null) {
      // No amount yet — it may be on the next line.
      pending = { fromRaw, payee: rest, raw: trimmed };
      continue;
    }
    settle({ fromRaw, payee: rest.slice(0, tail!.index), raw: trimmed }, amount, trimmed);
  }

  return out;
}
