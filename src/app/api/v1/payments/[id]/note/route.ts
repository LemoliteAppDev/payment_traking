import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { noteMessageSchema } from "@/lib/validation";
import { postNote, serializePayment } from "@/lib/payments";

// Post a chat message on a payment. Anyone signed in can post (all can view).
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { message } = noteMessageSchema.parse(await readJson(req));
  const payment = await postNote(id, user, message);
  return json({ payment: serializePayment(payment) });
});
