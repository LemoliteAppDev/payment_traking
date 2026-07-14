import { json, route } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/db";

// Current signed-in user + the roster (for the dev user-switcher).
export const GET = route(async () => {
  const me = await currentUser();
  const users = await prisma.user.findMany({
    orderBy: { role: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });
  return json({ me, users });
});
