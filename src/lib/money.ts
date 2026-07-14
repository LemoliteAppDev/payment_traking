// Money is stored end-to-end as integer paise (BigInt). Format only here, at
// the UI edge. ₹45,000 == 4_500_000 paise.

/** Rupees (whole number from the UI) -> integer paise. */
export function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

/** Integer paise -> rupees as a number (may have 2 decimals). */
export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

/**
 * Format integer paise as an Indian-grouped rupee string, e.g. 12000000n ->
 * "₹1,20,000". Shows paise only when there is a non-zero remainder.
 */
export function formatINR(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const paiseRem = Number(abs % 100n);
  const grouped = groupIndian(rupees);
  const body = paiseRem ? `${grouped}.${String(paiseRem).padStart(2, "0")}` : grouped;
  return `${neg ? "-" : ""}₹${body}`;
}

/** Indian digit grouping (2,2,3 from the right) for a non-negative BigInt. */
export function groupIndian(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${withCommas},${last3}`;
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function two(n: number): string {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
}
function three(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return (h ? ONES[h] + " hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
}

/**
 * Amount-in-words with Indian units (thousand / lakh / crore). Operates on the
 * whole-rupee part of the given paise. Ported from paytrack.html's wordsINR.
 */
export function wordsINR(paise: bigint): string {
  let num = Number(paise / 100n); // whole rupees
  num = Math.floor(num);
  if (!num) return "";
  let out = "";
  const cr = Math.floor(num / 10000000);
  num %= 10000000;
  const la = Math.floor(num / 100000);
  num %= 100000;
  const th = Math.floor(num / 1000);
  num %= 1000;
  if (cr) out += three(cr) + " crore ";
  if (la) out += three(la) + " lakh ";
  if (th) out += three(th) + " thousand ";
  if (num) out += three(num);
  out = out.trim();
  return out.charAt(0).toUpperCase() + out.slice(1) + " rupees only";
}
