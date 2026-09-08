import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { updateReminderSchema } from "@/lib/validation";
import { updateReminder, deleteReminder, requireReminderManager, ymdToDate } from "@/lib/emi-reminders";

// Manager only: edit a reminder's description, amount or due date.
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireReminderManager(user);
  const { id } = await ctx.params;
  const body = updateReminderSchema.parse(await readJson(req));
  const reminder = await updateReminder(id, {
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.amount !== undefined ? { amount: body.amount } : {}),
    ...(body.dueDate !== undefined ? { dueDate: ymdToDate(body.dueDate) } : {}),
  });
  return json({ reminder });
});

// Manager only: remove a reminder for good.
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireReminderManager(user);
  const { id } = await ctx.params;
  await deleteReminder(id);
  return json({ ok: true });
});
