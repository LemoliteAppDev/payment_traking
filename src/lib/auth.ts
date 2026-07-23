import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";

// Login ID + password. Accounts are created by the manager (no self-signup).
// The gate is "an active user with this login ID exists and the password
// matches" — accounts live in the DB, so new users work with no env change.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        loginId: { label: "Login ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const loginId = String(creds?.loginId ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!loginId || !password) return null;
        const user = await prisma.user.findUnique({ where: { email: loginId } });
        if (!user || !user.active || !user.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
