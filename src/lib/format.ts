import { appTz } from "@/lib/time";

/** "13 Jul" style short date in APP_TZ. */
export function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: appTz(),
    day: "numeric",
    month: "short",
  }).format(d);
}
