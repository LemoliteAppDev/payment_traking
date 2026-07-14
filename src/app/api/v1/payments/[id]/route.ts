import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { loadPayment, serializePayment } from "@/lib/payments";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const payment = await loadPayment(id);
  return json({ payment: serializePayment(payment) });
});
