import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { z } from "zod";
import {
  deletePrivateMember,
  movePrivateMember,
  renamePrivateMember,
  setPrivateMemberActive,
} from "@/lib/private-members";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  active: z.boolean().optional(),
  move: z.enum(["up", "down"]).optional(),
});

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = patchSchema.parse(await readJson(req));
  if (body.name !== undefined) await renamePrivateMember(id, body.name, user);
  if (body.active !== undefined) await setPrivateMemberActive(id, body.active, user);
  if (body.move !== undefined) await movePrivateMember(id, body.move, user);
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deletePrivateMember(id, user);
  return json({ ok: true });
});
