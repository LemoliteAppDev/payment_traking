import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { setPasswordSchema } from "@/lib/validation";
import { requireManager, setUserPassword } from "@/lib/users";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireManager(user);
  const { id } = await ctx.params;
  const { password } = setPasswordSchema.parse(await readJson(req));
  await setUserPassword(id, password);
  return json({ ok: true });
});
