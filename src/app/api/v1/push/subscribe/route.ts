import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { pushSubscribeSchema } from "@/lib/validation";
import { deviceLabel } from "@/lib/device-label";

// Save this browser's push subscription for the current user.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const sub = pushSubscribeSchema.parse(await readJson(req));
  // Dedupe: one row per endpoint, owned by whoever subscribed most recently.
  await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
  await prisma.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      // Label the device so the notification check can name it.
      device: deviceLabel(req.headers.get("user-agent")),
    },
  });
  return json({ ok: true });
});
