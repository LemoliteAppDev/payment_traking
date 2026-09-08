import { json, route } from "@/lib/api";
import { prisma } from "@/lib/db";

// Unauthenticated probe for the container healthcheck and the post-deploy
// checks. Reports database reachability and nothing else — no counts, no ids.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, database: "connected" });
  } catch {
    return json({ ok: false, database: "unreachable" }, { status: 503 });
  }
});
