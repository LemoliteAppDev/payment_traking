// Web Push (browser notifications). Free, no external service — VAPID keys in
// env. Falls back to a console stub if keys aren't configured.
//
// Every send reports back who it reached. That is what makes "did everyone get
// it?" answerable: each device row keeps its last success/failure, so a phone
// that quietly stopped receiving shows up instead of looking fine.
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

/** Test seam: forget the cached VAPID check (env changes between tests). */
export function resetPushConfig(): void {
  configured = null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Why a user wasn't reached, when they weren't. */
export type DeliveryMiss = "no-device" | "not-configured";

export interface DeliveryResult {
  userId: string;
  /** Devices we attempted. */
  devices: number;
  /** Devices that accepted the push. */
  delivered: number;
  /** Devices that rejected it but are still registered. */
  failed: number;
  /** Devices removed because the subscription is gone (404/410). */
  dropped: number;
  miss?: DeliveryMiss;
}

const emptyResult = (userId: string, miss: DeliveryMiss): DeliveryResult => ({
  userId, devices: 0, delivered: 0, failed: 0, dropped: 0, miss,
});

/** Send a push to every device a user has registered; prune dead subscriptions. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<DeliveryResult> {
  if (!ensureConfigured()) {
    console.log(`[push:stub] -> ${userId}: ${payload.title} — ${payload.body}`);
    return emptyResult(userId, "not-configured");
  }
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return emptyResult(userId, "no-device");

  const data = JSON.stringify(payload);
  const result: DeliveryResult = { userId, devices: subs.length, delivered: 0, failed: 0, dropped: 0 };
  const now = new Date();

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        result.delivered++;
        await prisma.pushSubscription
          .update({
            where: { id: s.id },
            data: { lastSuccessAt: now, failureCount: 0, lastError: null },
          })
          .catch(() => {});
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Subscription expired/unsubscribed — remove it.
          result.dropped++;
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          return;
        }
        result.failed++;
        console.error("[push] send failed", code ?? e);
        const reason = `${code ?? "error"}: ${String((e as Error)?.message ?? e)}`.slice(0, 180);
        await prisma.pushSubscription
          .update({
            where: { id: s.id },
            data: { lastFailureAt: now, failureCount: { increment: 1 }, lastError: reason },
          })
          .catch(() => {});
      }
    }),
  );
  return result;
}

/** Send the same push to a set of users (duplicates collapsed). */
export async function sendPushToUsers(userIds: Iterable<string>, payload: PushPayload): Promise<DeliveryResult[]> {
  const ids = [...new Set(userIds)];
  return Promise.all(ids.map((id) => sendPushToUser(id, payload)));
}

async function idsWhere(where: { isPayer?: boolean; isApprover?: boolean }): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { ...where, active: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Send a push to all payers (there is one, but future-proof). */
export async function sendPushToPayers(payload: PushPayload): Promise<DeliveryResult[]> {
  return sendPushToUsers(await idsWhere({ isPayer: true }), payload);
}

/** Send a push to all approvers. */
export async function sendPushToApprovers(payload: PushPayload): Promise<DeliveryResult[]> {
  return sendPushToUsers(await idsWhere({ isApprover: true }), payload);
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** Whether real pushes can be sent at all (VAPID keys present). */
export function pushConfigured(): boolean {
  return ensureConfigured();
}
