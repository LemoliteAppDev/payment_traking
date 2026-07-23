import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const payment = await applyTransition({
    paymentId: id,
    to: "AWAITING_APPROVAL",
    actor: user,
    message: `${user.name} resubmitted this for approval.`,
  });
  return json({ payment: serializePayment(payment) });
});
