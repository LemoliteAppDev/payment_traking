// Jagat-managed individual names that can be used as a payment source.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

export interface PrivateMemberLite {
  id: string;
  name: string;
  active: boolean;
}

export async function listPrivateMembers(includeInactive = false): Promise<PrivateMemberLite[]> {
  const rows = await prisma.privateMember.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((m) => ({ id: m.id, name: m.name, active: m.active }));
}

export async function isActivePrivateMember(name: string): Promise<boolean> {
  const hit = await prisma.privateMember.findFirst({ where: { name, active: true } });
  return !!hit;
}

export async function createPrivateMember(name: string, actor: SessionUser): Promise<PrivateMemberLite> {
  if (!actor.isApprover && !actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only Jagat can add individual members.");
  const trimmed = name.trim();
  if (!trimmed) throw new ApiError(400, "INVALID", "Member name is required.");
  const existing = await prisma.privateMember.findFirst({ where: { name: trimmed } });
  if (existing) {
    if (!existing.active) {
      const back = await prisma.privateMember.update({ where: { id: existing.id }, data: { active: true } });
      return { id: back.id, name: back.name, active: back.active };
    }
    throw new ApiError(409, "DUPLICATE", "That member already exists.");
  }
  const last = await prisma.privateMember.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const created = await prisma.privateMember.create({ data: { name: trimmed, sortOrder: (last?.sortOrder ?? 0) + 1 } });
  return { id: created.id, name: created.name, active: created.active };
}

export async function movePrivateMember(id: string, dir: "up" | "down", actor: SessionUser): Promise<void> {
  if (!actor.isApprover && !actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only Jagat can reorder individual members.");
  const all = await prisma.privateMember.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const idx = all.findIndex((m) => m.id === id);
  if (idx === -1) throw new ApiError(404, "NOT_FOUND", "Member not found.");
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= all.length) return;
  [all[idx], all[swapWith]] = [all[swapWith], all[idx]];
  await prisma.$transaction(all.map((m, i) => prisma.privateMember.update({ where: { id: m.id }, data: { sortOrder: i } })));
}

export async function setPrivateMemberActive(id: string, active: boolean, actor: SessionUser): Promise<void> {
  if (!actor.isApprover && !actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only Jagat can change individual members.");
  const member = await prisma.privateMember.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "NOT_FOUND", "Member not found.");
  await prisma.privateMember.update({ where: { id }, data: { active } });
}

export async function renamePrivateMember(id: string, name: string, actor: SessionUser): Promise<PrivateMemberLite> {
  if (!actor.isApprover && !actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only Jagat can rename individual members.");
  const trimmed = name.trim();
  if (!trimmed) throw new ApiError(400, "INVALID", "Member name is required.");
  const member = await prisma.privateMember.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "NOT_FOUND", "Member not found.");
  const clash = await prisma.privateMember.findFirst({ where: { name: trimmed, id: { not: id } } });
  if (clash) throw new ApiError(409, "DUPLICATE", "Another member already has that name.");
  if (trimmed !== member.name) {
    await prisma.$transaction([
      prisma.privateMember.update({ where: { id }, data: { name: trimmed } }),
      prisma.payment.updateMany({
        where: { payFrom: member.name, payFromType: "INDIVIDUAL" },
        data: { payFrom: trimmed },
      }),
    ]);
  }
  return { id, name: trimmed, active: member.active };
}

export async function deletePrivateMember(id: string, actor: SessionUser): Promise<void> {
  if (!actor.isApprover && !actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "Only Jagat can delete individual members.");
  const member = await prisma.privateMember.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "NOT_FOUND", "Member not found.");
  await prisma.privateMember.delete({ where: { id } });
}
