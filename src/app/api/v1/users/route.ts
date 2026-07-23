import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createUserSchema } from "@/lib/validation";
import { requireManager, listUsers, createUser } from "@/lib/users";

export const GET = route(async () => {
  const user = await requireUser();
  requireManager(user);
  return json({ users: await listUsers() });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  requireManager(user);
  const input = createUserSchema.parse(await readJson(req));
  const created = await createUser(input);
  return json({ user: created }, { status: 201 });
});
