import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { reminderSettingsSchema } from "@/lib/validation";
import {
  getReminderDefaults, setReminderDefaults, requireReminderViewer, requireReminderManager,
} from "@/lib/emi-reminders";

// The three can read the house timing (the panel shows it); only Jignesh sets it.
export const GET = route(async () => {
  const user = await requireUser();
  requireReminderViewer(user);
  return json({ defaults: await getReminderDefaults() });
});

// Manager only. Changing this moves every reminder that hasn't overridden it.
export const PUT = route(async (req: Request) => {
  const user = await requireUser();
  requireReminderManager(user);
  const body = reminderSettingsSchema.parse(await readJson(req));
  return json({ defaults: await setReminderDefaults(body, user) });
});
