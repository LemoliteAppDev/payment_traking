import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { markRead } from "@/lib/chat";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await markRead(user, id);
  return json({ ok: true });
});
