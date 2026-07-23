import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { setActiveSchema } from "@/lib/validation";
import { requireManager, setUserActive } from "@/lib/users";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireManager(user);
  const { id } = await ctx.params;
  const { active } = setActiveSchema.parse(await readJson(req));
  await setUserActive(id, active, user);
  return json({ ok: true });
});
