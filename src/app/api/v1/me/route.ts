import { json, route } from "@/lib/api";
import { currentUser } from "@/lib/session";

// The current signed-in user, with capability flags for the UI.
export const GET = route(async () => {
  const me = await currentUser();
  return json({ me });
});
