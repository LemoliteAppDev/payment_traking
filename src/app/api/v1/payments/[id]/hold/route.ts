import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { holdSchema } from "@/lib/validation";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { reason } = holdSchema.parse(await readJson(req));
  const payment = await applyTransition({
    paymentId: id,
    to: "HOLD",
    actor: user,
    message: reason ? `On hold: ${reason}` : `${user.name} put this on hold.`,
  });
  return json({ payment: serializePayment(payment) });
});
