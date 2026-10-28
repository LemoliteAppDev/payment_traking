// "Is everyone actually getting notifications?" — the answer, in two parts.
//
// 1. Routing: who is *meant* to be pinged about what, derived from their role
//    flags. Someone with no duties only ever hears about their own payments,
//    which is easy to miss when you add a person and wonder why they're quiet.
// 2. Delivery: whether their devices are registered and still accepting pushes.
//    A device that has never succeeded, or keeps failing, is a silent phone.
import { prisma } from "@/lib/db";
import { sendPushToUser, pushConfigured, type DeliveryResult } from "@/lib/push";
import type { Role } from "@/lib/status";

/** A device has gone quiet once it fails this many times in a row. */
const FAILING_AT = 3;

export interface DeviceInfo {
  id: string;
  device: string | null;
  addedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureCount: number;
  healthy: boolean;
}

/** on = at least one healthy device · failing = registered but erroring · off = no device. */
export type AlertState = "on" | "failing" | "off";

export interface PersonAlerts {
  id: string;
  name: string;
  role: Role;
  isPayer: boolean;
  isApprover: boolean;
  isManager: boolean;
  state: AlertState;
  devices: DeviceInfo[];
  lastDeliveredAt: Date | null;
  /** Plain-language list of what this person gets pinged about. */
  alertsFor: string[];
}

export interface AlertsOverview {
  /** False means no VAPID keys — nothing is really being sent to anyone. */
  configured: boolean;
  people: PersonAlerts[];
  on: number;
  failing: number;
  off: number;
}

/** What this person's flags mean they'll be notified about. */
export function alertsFor(u: { isPayer: boolean; isApprover: boolean }): string[] {
  const list = ["Payments they raise"];
  if (u.isApprover) list.push("Requests needing approval", "Resubmissions", "Payments once paid");
  if (u.isPayer) list.push("Payments to pay", "Nudges", "Receipt confirmations", "The reminder digest");
  if (u.isPayer || u.isApprover) list.push("Chat messages");
  return list;
}

function stateOf(devices: DeviceInfo[]): AlertState {
  if (devices.length === 0) return "off";
  return devices.some((d) => d.healthy) ? "on" : "failing";
}

/** Every active person, whether their alerts are on, and what they cover. */
export async function alertsOverview(): Promise<AlertsOverview> {
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { pushSubscriptions: { orderBy: { createdAt: "desc" } } },
  });

  const people: PersonAlerts[] = users.map((u) => {
    const devices: DeviceInfo[] = u.pushSubscriptions.map((s) => ({
      id: s.id,
      device: s.device,
      addedAt: s.createdAt,
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
      failureCount: s.failureCount,
      healthy: s.failureCount < FAILING_AT,
    }));
    const delivered = devices
      .map((d) => d.lastSuccessAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime());
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      isPayer: u.isPayer,
      isApprover: u.isApprover,
      isManager: u.isManager,
      state: stateOf(devices),
      devices,
      lastDeliveredAt: delivered[0] ?? null,
      alertsFor: alertsFor(u),
    };
  });

  return {
    configured: pushConfigured(),
    people,
    on: people.filter((p) => p.state === "on").length,
    failing: people.filter((p) => p.state === "failing").length,
    off: people.filter((p) => p.state === "off").length,
  };
}

export interface TestResult extends DeliveryResult {
  name: string;
}

/**
 * Send a real test notification — the only way to know a phone still buzzes.
 * `byName` appears in the message so nobody wonders who set it off.
 */
export async function sendTestPush(userIds: string[], byName: string): Promise<TestResult[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, active: true },
    select: { id: true, name: true },
  });
  // Unique tag per run, so a repeat test isn't collapsed into the last one.
  const tag = `test-${Date.now()}`;
  return Promise.all(
    users.map(async (u) => ({
      ...(await sendPushToUser(u.id, {
        title: "🔔 PayTrack test",
        body: `Test alert from ${byName}. If this buzzed and chimed, notifications work on this device.`,
        url: "/",
        tag,
      })),
      name: u.name,
    })),
  );
}
