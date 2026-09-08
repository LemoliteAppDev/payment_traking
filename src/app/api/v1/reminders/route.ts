import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createReminderSchema } from "@/lib/validation";
import {
  listReminders, createReminder, requireReminderViewer, requireReminderManager, ymdToDate,
  getReminderDefaults, getMyTiming,
} from "@/lib/emi-reminders";

// The three (manager / approver / payer) read the list. Nobody else — this is
// enforced here, not just hidden in the UI.
export const GET = route(async () => {
  const user = await requireUser();
  requireReminderViewer(user);
  const [reminders, defaults, my] = await Promise.all([
    listReminders(), getReminderDefaults(), getMyTiming(user),
  ]);
  return json({ reminders, defaults, my });
});

// Manager only: add one reminder by hand.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  requireReminderManager(user);
  const body = createReminderSchema.parse(await readJson(req));
  const reminder = await createReminder(
    {
      description: body.description,
      amount: body.amount,
      dueDate: ymdToDate(body.dueDate),
      repeatMonths: body.repeatMonths,
      sendHours: body.sendHours,
      leadDays: body.leadDays,
    },
    user,
  );
  return json({ reminder }, { status: 201 });
});
