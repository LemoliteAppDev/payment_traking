import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { listNotifications } from "@/lib/notifications";

export const GET = route(async () => {
  const user = await requireUser();
  return json(await listNotifications(user));
});
