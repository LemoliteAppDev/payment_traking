import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { importRemindersSchema } from "@/lib/validation";
import { importReminders, requireReminderManager } from "@/lib/emi-reminders";

// Manager only: bulk-add from a sheet. The UI calls this twice — once with
// dryRun to show the preview, then again to commit what was previewed.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  requireReminderManager(user);
  const { csv, dryRun } = importRemindersSchema.parse(await readJson(req));
  return json(await importReminders(csv, user, dryRun));
});
