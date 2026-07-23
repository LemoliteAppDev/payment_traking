// Account management (manager only). Create users, reset passwords, toggle active.
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";
import type { Role } from "@/lib/status";

export function requireManager(user: SessionUser): void {
  if (!user.isManager) throw new ApiError(403, "FORBIDDEN", "Only the account manager can do this.");
}

function shape(u: {
  id: string; name: string; email: string; role: string; active: boolean;
  isPayer: boolean; isApprover: boolean; isManager: boolean;
}) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
    isPayer: u.isPayer, isApprover: u.isApprover, isManager: u.isManager,
  };
}

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
  return users.map(shape);
}

export async function createUser(input: { name: string; loginId: string; password: string; role: Role }) {
  const email = input.loginId.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "TAKEN", "That login ID is already in use.");
  const passwordHash = await bcrypt.hash(input.password, 10);
  const u = await prisma.user.create({
    data: { name: input.name, email, role: input.role, passwordHash, active: true },
  });
  return shape(u);
}

export async function setUserPassword(id: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } }).catch(() => {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  });
}

export async function setUserActive(id: string, active: boolean, manager: SessionUser) {
  if (id === manager.id && !active) throw new ApiError(400, "SELF", "You can't deactivate your own account.");
  await prisma.user.update({ where: { id }, data: { active } }).catch(() => {
    throw new ApiError(404, "NOT_FOUND", "User not found.");
  });
}
