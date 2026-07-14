import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { cancelSchema } from "@/lib/validation";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { reason } = cancelSchema.parse(await readJson(req));
  const payment = await applyTransition({
    paymentId: id,
    to: "CANCELLED",
    actor: user,
    message: reason ? `Cancelled: ${reason}` : `${user.name} cancelled this payment.`,
  });
  return json({ payment: serializePayment(payment) });
});
