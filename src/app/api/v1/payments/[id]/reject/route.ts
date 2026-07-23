import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { reasonSchema } from "@/lib/validation";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { reason } = reasonSchema.parse(await readJson(req));
  const payment = await applyTransition({
    paymentId: id,
    to: "RETURNED",
    actor: user,
    message: reason ? `Returned for changes: ${reason}` : `${user.name} returned this for changes.`,
  });
  return json({ payment: serializePayment(payment) });
});
