import { json, route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { alertsOverview } from "@/lib/notify-check";

// Who has notifications on, which devices, and what each person is pinged
// about. Admin-only: it lists everyone's devices.
export const GET = route(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can see the notification check.");
  return json(await alertsOverview());
});
