import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { myTimingSchema } from "@/lib/validation";
import { getMyTiming, setMyTiming, requireReminderViewer } from "@/lib/emi-reminders";

// Each of the three reads and sets their OWN timing — no manager check here,
// and no way to address anyone else's row: the user comes from the session.
export const GET = route(async () => {
  const user = await requireUser();
  requireReminderViewer(user);
  return json(await getMyTiming(user));
});

export const PUT = route(async (req: Request) => {
  const user = await requireUser();
  requireReminderViewer(user);
  const body = myTimingSchema.parse(await readJson(req));
  return json(await setMyTiming(user, body));
});
