import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createPrivateMemberSchema } from "@/lib/validation";
import { createPrivateMember, listPrivateMembers } from "@/lib/private-members";

// Jagat/payer can read the active individual list for the picker.
export const GET = route(async () => {
  const user = await requireUser();
  if (!user.isApprover && !user.isPayer && !user.isAdmin) return json({ members: [] });
  return json({ members: await listPrivateMembers(user.isApprover || user.isAdmin) });
});

// Jagat/admin can add a new individual member.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { name } = createPrivateMemberSchema.parse(await readJson(req));
  const member = await createPrivateMember(name, user);
  return json({ member }, { status: 201 });
});
