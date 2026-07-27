import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createPayAccountSchema } from "@/lib/validation";
import { listPayAccounts, createPayAccount } from "@/lib/pay-accounts";

// Everyone signed in can read the list (for the picker). Admins see inactive too.
export const GET = route(async () => {
  const user = await requireUser();
  return json({ accounts: await listPayAccounts(user.isAdmin) });
});

// Admins can add a new account (POST). Re-activates a removed one with the same name.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { name } = createPayAccountSchema.parse(await readJson(req));
  const account = await createPayAccount(name, user);
  return json({ account }, { status: 201 });
});
