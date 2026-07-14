import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Gate page routes via the edge-safe config's `authorized` callback.
// API routes enforce their own auth (requireUser -> 401), and the cron route is
// secret-guarded, so the matcher below intentionally excludes /api.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)"],
};
