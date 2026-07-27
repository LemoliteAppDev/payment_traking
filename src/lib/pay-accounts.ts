// The admin-managed "Pay from" list. Payments store the account *name*
// (a plain string), so this table is just the source of truth for the picker.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

export interface PayAccountLite {
  id: string;
  name: string;
  active: boolean;
}

/** All accounts (admins) or just the active ones (everyone else / the picker). */
export async function listPayAccounts(includeInactive = false): Promise<PayAccountLite[]> {
  const rows = await prisma.payAccount.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
  });
  return rows.map((a) => ({ id: a.id, name: a.name, active: a.active }));
}

/** True if `name` matches an active account (case-insensitive via DB collation). */
export async function isActiveAccount(name: string): Promise<boolean> {
  const hit = await prisma.payAccount.findFirst({ where: { name, active: true } });
  return !!hit;
}

export async function createPayAccount(name: string, actor: SessionUser): Promise<PayAccountLite> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can add a pay-from account.");
  const trimmed = name.trim();
  if (!trimmed) throw new ApiError(400, "INVALID", "Account name is required.");
  const existing = await prisma.payAccount.findFirst({ where: { name: trimmed } });
  if (existing) {
    // Re-activate a previously removed account instead of erroring on the unique name.
    if (!existing.active) {
      const back = await prisma.payAccount.update({ where: { id: existing.id }, data: { active: true } });
      return { id: back.id, name: back.name, active: back.active };
    }
    throw new ApiError(409, "DUPLICATE", "That account already exists.");
  }
  const created = await prisma.payAccount.create({ data: { name: trimmed } });
  return { id: created.id, name: created.name, active: created.active };
}

export async function setPayAccountActive(id: string, active: boolean, actor: SessionUser): Promise<void> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can change the pay-from list.");
  const acc = await prisma.payAccount.findUnique({ where: { id } });
  if (!acc) throw new ApiError(404, "NOT_FOUND", "Account not found.");
  await prisma.payAccount.update({ where: { id }, data: { active } });
}
