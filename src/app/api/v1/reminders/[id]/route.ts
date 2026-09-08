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
    ...(body.sendHours !== undefined ? { sendHours: body.sendHours } : {}),
    ...(body.leadDays !== undefined ? { leadDays: body.leadDays } : {}),
  });
  return json({ reminder });
});

// Manager only: remove a reminder for good. `?scope=series` also removes every
// later unpaid month of the same monthly run.
export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  requireReminderManager(user);
  const { id } = await ctx.params;
  const scope = new URL(req.url).searchParams.get("scope") === "series" ? "series" : "one";
  const deleted = await deleteReminder(id, scope);
  return json({ ok: true, deleted });
});
