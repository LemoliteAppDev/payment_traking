// Timezone-correct date helpers. Overdue and the reminder working-hours gate
// are evaluated in APP_TZ (IST), independent of the server's local timezone.

export function appTz(): string {
  return process.env.APP_TZ ?? "Asia/Kolkata";
}

/** 'YYYY-MM-DD' for a Date, as seen in the given timezone. */
export function ymdInTz(d: Date, tz = appTz()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour (0-23) of a Date in the given timezone. */
export function hourInTz(d: Date, tz = appTz()): number {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return parseInt(s, 10) % 24;
}

/** dueDate is strictly before today (date-granularity) in APP_TZ. */
export function isPastDateTz(due: Date, now: Date = new Date(), tz = appTz()): boolean {
  return ymdInTz(due, tz) < ymdInTz(now, tz);
}
