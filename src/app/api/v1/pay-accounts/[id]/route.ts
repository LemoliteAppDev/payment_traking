import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { z } from "zod";
import { setPayAccountActive, renamePayAccount, deletePayAccount } from "@/lib/pay-accounts";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  active: z.boolean().optional(),
});

// Admin: rename (name) and/or hide-show (active) a pay-from account.
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = patchSchema.parse(await readJson(req));
  if (body.name !== undefined) await renamePayAccount(id, body.name, user);
  if (body.active !== undefined) await setPayAccountActive(id, body.active, user);
  return json({ ok: true });
});

// Admin: permanently remove a pay-from account.
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deletePayAccount(id, user);
  return json({ ok: true });
});
