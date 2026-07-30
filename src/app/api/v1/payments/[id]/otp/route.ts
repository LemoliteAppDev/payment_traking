import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { z } from "zod";
import { listOtpMessages, postOtpMessage } from "@/lib/otp";

const bodySchema = z.object({ message: z.string().min(1).max(200) });

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json({ messages: await listOtpMessages(id, user) });
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { message } = bodySchema.parse(await readJson(req));
  return json({ messages: await postOtpMessage(id, user, message) });
});
