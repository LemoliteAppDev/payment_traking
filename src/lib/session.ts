// Resolves the acting user for a request.
//
// Real magic-link auth is wired in Step 5 (see getAuthedEmail). Until then —
// and for local curl testing / the dev user-switcher — a dev override is
// honoured OUTSIDE production only: the `x-dev-user` header or the `dev_user`
// cookie carrying a whitelisted email.
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { Role } from "@/lib/status";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isAdmin: boolean;
  isPayer: boolean;
  isApprover: boolean;
  isManager: boolean;
}

/** Real authenticated email from Auth.js. Filled in Step 5; null for now. */
async function getAuthedEmail(): Promise<string | null> {
  try {
    // Lazy import so this module works before auth is configured.
    const mod = await import("@/lib/auth");
    const session = await mod.auth();
    return session?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function getDevEmail(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  const h = await headers();
  const fromHeader = h.get("x-dev-user");
  if (fromHeader) return fromHeader;
  const c = await cookies();
  return c.get("dev_user")?.value ?? null;
}

export async function currentUser(): Promise<SessionUser | null> {
  const email = (await getAuthedEmail()) ?? (await getDevEmail());
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isAdmin: user.role === "ADMIN",
    isPayer: user.isPayer,
    isApprover: user.isApprover,
    isManager: user.isManager,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return user;
}
