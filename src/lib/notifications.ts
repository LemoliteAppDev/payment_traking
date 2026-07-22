// In-app notification centre. Derived from the PaymentEvent audit log (no
// duplicated table) + a single per-user "read up to" timestamp.
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma";

// The payer cares about incoming requests, nudges and confirmations.
const PAYER_TYPES = ["REQUEST", "NUDGE", "CONFIRM"] as const;

function whereFor(user: SessionUser): Prisma.PaymentEventWhereInput {
  const or: Prisma.PaymentEventWhereInput[] = [
    // Anything that happens on a payment this user raised.
    { payment: { requestedById: user.id } },
  ];
  if (user.role === "PAYER") {
    or.push({ type: { in: [...PAYER_TYPES] } });
  }
  return {
    actorId: { not: user.id }, // never notify someone about their own action
    OR: or,
  };
}

export async function listNotifications(user: SessionUser, take = 30) {
  const [rows, me] = await Promise.all([
    prisma.paymentEvent.findMany({
      where: whereFor(user),
      orderBy: { createdAt: "desc" },
      take,
      include: {
        actor: { select: { id: true, name: true, role: true } },
        payment: { select: { id: true, payee: true, amount: true, status: true } },
      },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { notificationsReadAt: true } }),
  ]);

  const since = me?.notificationsReadAt ?? new Date(0);
  const items = rows.map((e) => ({
    id: e.id,
    type: e.type,
    message: e.message,
    createdAt: e.createdAt,
    unread: e.createdAt > since,
    actor: e.actor ? { id: e.actor.id, name: e.actor.name, role: e.actor.role } : null,
    payment: {
      id: e.payment.id,
      payee: e.payment.payee,
      amount: e.payment.amount,
      status: e.payment.status,
    },
  }));

  return { items, unread: items.filter((i) => i.unread).length };
}

export async function markNotificationsRead(user: SessionUser): Promise<void> {
  await prisma.user.update({
    where: { id: user.id },
    data: { notificationsReadAt: new Date() },
  });
}
