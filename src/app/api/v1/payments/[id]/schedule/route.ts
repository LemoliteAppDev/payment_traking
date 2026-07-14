import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { scheduleSchema } from "@/lib/validation";
import { applyTransition, serializePayment } from "@/lib/payments";
import { fmtDate } from "@/lib/format";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { scheduledFor } = scheduleSchema.parse(await readJson(req));
  const payment = await applyTransition({
    paymentId: id,
    to: "SCHEDULED",
    actor: user,
    scheduledFor,
    message: `${user.name} scheduled this for ${fmtDate(scheduledFor)}.`,
    meta: { scheduledFor: scheduledFor.toISOString() },
  });
  return json({ payment: serializePayment(payment) });
});
