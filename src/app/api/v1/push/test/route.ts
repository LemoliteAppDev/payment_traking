import { json, route, readJson, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { pushTestSchema } from "@/lib/validation";
import { sendTestPush, alertsOverview } from "@/lib/notify-check";

// Send a real test notification. Anyone may test their own device; only an
// admin may fire one at someone else (or at everyone) to check the whole team.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { scope, userId } = pushTestSchema.parse(await readJson(req));

  if (scope === "me") {
    return json({ results: await sendTestPush([user.id], user.name) });
  }
  if (!user.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can test other people's alerts.");
  if (scope === "user") {
    if (!userId) throw new ApiError(400, "VALIDATION", "userId is required to test one person.");
    return json({ results: await sendTestPush([userId], user.name) });
  }
  // scope === "all"
  const everyone = (await alertsOverview()).people.map((p) => p.id);
  return json({ results: await sendTestPush(everyone, user.name) });
});
