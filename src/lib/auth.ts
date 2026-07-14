import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";

// Login ID + password. Static IDs, admin-controlled — no self-signup, no
// self-serve password change (rotate with `npm run set-password`).
const whitelist = (process.env.AUTH_WHITELIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

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
        // Only the whitelisted IDs may log in.
        if (whitelist.length && !whitelist.includes(loginId)) return null;
        const user = await prisma.user.findUnique({ where: { email: loginId } });
        if (!user || !user.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
});
