import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { devicesForThread } from "@/lib/chat";

// Public keys of every active device in this conversation — both people's, so
// the sender can wrap the content key for the other side and for their own
// other browsers. Fetched fresh before each send: a device enrolled a minute
// ago should still receive the next message.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json({ devices: await devicesForThread(user, id) });
});
