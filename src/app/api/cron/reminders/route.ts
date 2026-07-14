import { json, route, ApiError } from "@/lib/api";
import { runReminders } from "@/lib/reminders";

// Cron endpoint — secret-guarded, NOT session-guarded. Hostinger cron hits this
// every 15 min with the x-cron-secret header.
export const POST = route(async (req: Request) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    throw new ApiError(401, "BAD_CRON_SECRET", "Missing or invalid cron secret.");
  }
  const result = await runReminders();
  return json(result);
});
