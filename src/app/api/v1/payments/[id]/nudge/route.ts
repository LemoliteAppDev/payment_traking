import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { nudgePayment, serializePayment } from "@/lib/payments";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const payment = await nudgePayment(id, user);
  return json({ payment: serializePayment(payment) });
});
