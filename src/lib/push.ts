// Web Push (browser notifications). Free, no external service — VAPID keys in
// env. Falls back to a console stub if keys aren't configured.
import webpush from "web-push";
import { prisma } from "@/lib/db";

let configured: boolean | null = null;
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a push to every device a user has registered; prune dead subscriptions. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.log(`[push:stub] -> ${userId}: ${payload.title} — ${payload.body}`);
    return;
  }
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Subscription expired/unsubscribed — remove it.
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        } else {
          console.error("[push] send failed", code ?? e);
        }
      }
    }),
  );
}

/** Send a push to all payers (there is one, but future-proof). */
export async function sendPushToPayers(payload: PushPayload): Promise<void> {
  const payers = await prisma.user.findMany({ where: { role: "PAYER" }, select: { id: true } });
  await Promise.all(payers.map((p) => sendPushToUser(p.id, payload)));
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}
