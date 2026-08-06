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
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
  const last = await prisma.payAccount.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const created = await prisma.payAccount.create({ data: { name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 } });
  return { id: created.id, name: created.name, active: created.active };
}

/** Move an account up or down in the priority order (swap with its neighbour). */
export async function movePayAccount(id: string, dir: "up" | "down", actor: SessionUser): Promise<void> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can reorder the pay-from list.");
  const all = await prisma.payAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) throw new ApiError(404, "NOT_FOUND", "Account not found.");
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) return; // already at the end
  [all[idx], all[swapWith]] = [all[swapWith], all[idx]];
  // Reassign sequential order so it's stable even if two rows shared a value.
  await prisma.$transaction(all.map((a, i) => prisma.payAccount.update({ where: { id: a.id }, data: { sortOrder: i } })));
}

export async function setPayAccountActive(id: string, active: boolean, actor: SessionUser): Promise<void> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can change the pay-from list.");
  const acc = await prisma.payAccount.findUnique({ where: { id } });
  if (!acc) throw new ApiError(404, "NOT_FOUND", "Account not found.");
  await prisma.payAccount.update({ where: { id }, data: { active } });
}

/** Rename an account and carry the new name onto every payment that used it. */
export async function renamePayAccount(id: string, name: string, actor: SessionUser): Promise<PayAccountLite> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can rename a pay-from account.");
  const trimmed = name.trim();
  if (!trimmed) throw new ApiError(400, "INVALID", "Account name is required.");
  const acc = await prisma.payAccount.findUnique({ where: { id } });
  if (!acc) throw new ApiError(404, "NOT_FOUND", "Account not found.");
  const clash = await prisma.payAccount.findFirst({ where: { name: trimmed, id: { not: id } } });
  if (clash) throw new ApiError(409, "DUPLICATE", "Another account already has that name.");
  if (trimmed !== acc.name) {
    await prisma.$transaction([
      prisma.payAccount.update({ where: { id }, data: { name: trimmed } }),
      prisma.payment.updateMany({ where: { payFrom: acc.name }, data: { payFrom: trimmed } }),
    ]);
  }
  return { id, name: trimmed, active: acc.active };
}

/** Permanently remove an account. Existing payments keep the stored name. */
export async function deletePayAccount(id: string, actor: SessionUser): Promise<void> {
  if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only an admin can delete a pay-from account.");
  const acc = await prisma.payAccount.findUnique({ where: { id } });
  if (!acc) throw new ApiError(404, "NOT_FOUND", "Account not found.");
  await prisma.payAccount.delete({ where: { id } });
}
