// Standalone secure OTP channel — one shared thread between the approver(s) and
// payer(s), not tied to any payment.
// - Access is server-enforced to users who can approve or pay.
// - Bodies are encrypted at rest and auto-expire (and are purged on read).
// - Push carries NO content, so nothing leaks to a lock screen.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";
import { sendPushToUser } from "@/lib/push";
import { encryptOtp, decryptOtp } from "@/lib/otp-crypto";

const TTL_MIN = 10; // messages disappear this many minutes after sending

export interface OtpMsg {
  id: string;
  fromMe: boolean;
  senderName: string;
  body: string;
  createdAt: string;
  expiresAt: string;
}

/** Only the approver(s) and payer(s) may use the OTP channel. */
export function canUseOtp(actor: SessionUser): boolean {
  return !!actor.isApprover || !!actor.isPayer;
}
function requireOtpAccess(actor: SessionUser): void {
  if (!canUseOtp(actor)) throw new ApiError(403, "FORBIDDEN", "Only the approver and payer can use the secure OTP channel.");
}

async function purgeExpired(): Promise<void> {
  await prisma.otpMessage.deleteMany({ where: { paymentId: null, expiresAt: { lte: new Date() } } });
}

export async function listOtpMessages(actor: SessionUser): Promise<OtpMsg[]> {
  requireOtpAccess(actor);
  await purgeExpired();
  const rows = await prisma.otpMessage.findMany({
    where: { paymentId: null },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    fromMe: m.senderId === actor.id,
    senderName: m.sender.name,
    body: decryptOtp(m.body),
    createdAt: m.createdAt.toISOString(),
    expiresAt: m.expiresAt.toISOString(),
  }));
}

export async function postOtpMessage(actor: SessionUser, message: string): Promise<OtpMsg[]> {
  requireOtpAccess(actor);
  const text = message.trim();
  if (!text) throw new ApiError(400, "EMPTY", "Type a message first.");
  if (text.length > 200) throw new ApiError(400, "TOO_LONG", "That's too long for an OTP note.");

  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
  await prisma.otpMessage.create({
    data: { paymentId: null, senderId: actor.id, body: encryptOtp(text), expiresAt },
  });

  // Notify the counterpart(s) — the OTHER approver/payer — with NO message content.
  const counterparts = await prisma.user.findMany({
    where: { active: true, id: { not: actor.id }, OR: [{ isApprover: true }, { isPayer: true }] },
    select: { id: true },
  });
  await Promise.all(
    counterparts.map((u) => sendPushToUser(u.id, { title: "🔒 New secure message", body: "Tap to view", url: "/" })),
  ).catch((e) => console.error("[otp] notify failed", e));

  return listOtpMessages(actor);
}
