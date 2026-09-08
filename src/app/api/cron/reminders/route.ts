import { json, route, ApiError } from "@/lib/api";
import { runReminders } from "@/lib/reminders";
import { runEmiReminders } from "@/lib/emi-reminders";

// Cron endpoint — secret-guarded, NOT session-guarded. Hostinger cron hits this
// every 15 min with the x-cron-secret header.
//
// Two independent jobs ride the same tick: the payment digest (working-hours
// gated) and the EMI reminders (their own 11:00 / 21:00 gate), so no second
// cron entry is needed on the server.
export const POST = route(async (req: Request) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    throw new ApiError(401, "BAD_CRON_SECRET", "Missing or invalid cron secret.");
  }
  const payments = await runReminders();
  const emi = await runEmiReminders();
  return json({ ...payments, payments, emi });
});
