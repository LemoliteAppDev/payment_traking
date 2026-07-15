import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { vapidPublicKey } from "@/lib/push";

// Public VAPID key the browser needs to subscribe.
export const GET = route(async () => {
  await requireUser();
  return json({ key: vapidPublicKey() });
});
