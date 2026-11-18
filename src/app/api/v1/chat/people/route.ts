import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { chatPeople } from "@/lib/chat";

// Everyone on PayTrack can start a conversation with anyone else, so this is
// simply the active roster minus the caller.
export const GET = route(async () => {
  const user = await requireUser();
  return json({ people: await chatPeople(user) });
});
