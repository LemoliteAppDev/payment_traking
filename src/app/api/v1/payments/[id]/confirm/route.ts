import type { NextRequest } from "next/server";
import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const idempotencyKey = req.headers.get("idempotency-key");
  const payment = await applyTransition({
    paymentId: id,
    to: "CONFIRMED",
    actor: user,
    message: `${user.name} confirmed receipt.`,
    idempotencyKey,
  });
  return json({ payment: serializePayment(payment) });
});
