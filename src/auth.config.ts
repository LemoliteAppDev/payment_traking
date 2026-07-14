import type { NextAuthConfig } from "next-auth";

// Edge-safe base config (no Prisma adapter, no nodemailer) — imported by
// middleware. The full config with the adapter + email provider lives in
// lib/auth.ts. Session strategy is JWT so middleware can verify on the edge.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", verifyRequest: "/signin?sent=1", error: "/signin" },
  providers: [],
  callbacks: {
    // Gate page routes — a valid session is required everywhere except the
    // sign-in page and the auth endpoints.
    authorized({ auth, request }) {
      const p = request.nextUrl.pathname;
      if (p.startsWith("/signin") || p.startsWith("/api/auth")) return true;
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
