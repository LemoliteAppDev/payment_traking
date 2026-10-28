// A short, human label for the device a push subscription belongs to, so the
// notification check reads "Android · Chrome" instead of an opaque endpoint.
// Deliberately coarse: it only needs to tell one of someone's phones from the
// other, and it keeps no fingerprinting detail.

const PLATFORMS: [RegExp, string][] = [
  [/iPhone/i, "iPhone"],
  [/iPad/i, "iPad"],
  [/Android/i, "Android"],
  [/Windows/i, "Windows"],
  [/Macintosh|Mac OS X/i, "Mac"],
  [/CrOS/i, "Chromebook"],
  [/Linux/i, "Linux"],
];

// Order matters: the impostors (Edge, Brave-ish, Samsung) all claim Chrome,
// and Chrome claims Safari, so the specific names have to win first.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//i, "Edge"],
  [/OPR\/|Opera/i, "Opera"],
  [/SamsungBrowser/i, "Samsung Internet"],
  [/Firefox|FxiOS/i, "Firefox"],
  [/CriOS|Chrome/i, "Chrome"],
  [/Safari/i, "Safari"],
];

function match(pairs: [RegExp, string][], ua: string): string | null {
  for (const [re, name] of pairs) if (re.test(ua)) return name;
  return null;
}

/** "Android · Chrome", "iPhone", "Chrome", or null when the UA tells us nothing. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? "").trim();
  if (!ua) return null;
  const parts = [match(PLATFORMS, ua), match(BROWSERS, ua)].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(" · ").slice(0, 120);
}
