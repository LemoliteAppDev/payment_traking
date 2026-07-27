import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { setActiveSchema } from "@/lib/validation";
import { setPayAccountActive } from "@/lib/pay-accounts";

// Admin: activate / deactivate a pay-from account (hides it from the picker).
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { active } = setActiveSchema.parse(await readJson(req));
  await setPayAccountActive(id, active, user);
  return json({ ok: true });
});
