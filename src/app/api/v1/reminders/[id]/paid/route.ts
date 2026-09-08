import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { markReminderPaidSchema } from "@/lib/validation";
import {
  markReminderPaid, unmarkReminderPaid, requireReminderViewer, requireReminderManager, ymdToDate,
} from "@/lib/emi-reminders";

// Any of the three marks it paid — reminders stop the moment this lands.
// Marking an already-paid reminder is a no-op, so two phones tapping at once
// can't fight over it.
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireReminderViewer(user);
  const { id } = await ctx.params;
  const body = markReminderPaidSchema.parse(await readJson(req));
  const reminder = await markReminderPaid(
    id,
    { paidOn: body.paidOn ? ymdToDate(body.paidOn) : undefined, note: body.note },
    user,
  );
  return json({ reminder });
});

// Manager only: undo a wrong "paid" mark and put it back in the reminder queue.
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireReminderManager(user);
  const { id } = await ctx.params;
  return json({ reminder: await unmarkReminderPaid(id) });
});
