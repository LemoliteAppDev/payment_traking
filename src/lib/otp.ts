// Secure OTP thread for a payment — approver <-> payer only.
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

/** Only the approver(s) and payer(s) may use the OTP thread. */
export function canUseOtp(actor: SessionUser): boolean {
  return !!actor.isApprover || !!actor.isPayer;
}
function requireOtpAccess(actor: SessionUser): void {
  if (!canUseOtp(actor)) throw new ApiError(403, "FORBIDDEN", "Only the approver and payer can use the secure OTP thread.");
}

async function purgeExpired(paymentId: string): Promise<void> {
  await prisma.otpMessage.deleteMany({ where: { paymentId, expiresAt: { lte: new Date() } } });
}

export async function listOtpMessages(paymentId: string, actor: SessionUser): Promise<OtpMsg[]> {
  requireOtpAccess(actor);
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
  if (!payment) throw new ApiError(404, "NOT_FOUND", "Payment not found.");
  await purgeExpired(paymentId);
  // Once paid/done there's nothing left to share — keep the thread empty.
  if (payment.status === "PAID" || payment.status === "CONFIRMED" || payment.status === "CANCELLED") {
    await prisma.otpMessage.deleteMany({ where: { paymentId } });
    return [];
  }
  const rows = await prisma.otpMessage.findMany({
    where: { paymentId },
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

export async function postOtpMessage(paymentId: string, actor: SessionUser, message: string): Promise<OtpMsg[]> {
  requireOtpAccess(actor);
  const text = message.trim();
  if (!text) throw new ApiError(400, "EMPTY", "Type a message first.");
  if (text.length > 200) throw new ApiError(400, "TOO_LONG", "That's too long for an OTP note.");
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true, payee: true } });
  if (!payment) throw new ApiError(404, "NOT_FOUND", "Payment not found.");
  if (payment.status === "PAID" || payment.status === "CONFIRMED" || payment.status === "CANCELLED") {
    throw new ApiError(409, "CLOSED", "This payment is closed — the secure thread is off.");
  }

  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
  await prisma.otpMessage.create({
    data: { paymentId, senderId: actor.id, body: encryptOtp(text), expiresAt },
  });

  // Notify the counterpart(s) — the OTHER role — with NO message content.
  const counterparts = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: actor.id },
      OR: [{ isApprover: true }, { isPayer: true }],
    },
    select: { id: true },
  });
  await Promise.all(
    counterparts.map((u) =>
      sendPushToUser(u.id, { title: "🔒 New secure message", body: `On ${payment.payee}`, url: "/" }),
    ),
  ).catch((e) => console.error("[otp] notify failed", e));

  return listOtpMessages(paymentId, actor);
}
