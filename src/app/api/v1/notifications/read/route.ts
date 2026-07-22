import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { markNotificationsRead } from "@/lib/notifications";

export const POST = route(async () => {
  const user = await requireUser();
  await markNotificationsRead(user);
  return json({ ok: true });
});
