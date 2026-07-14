import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export const metadata = { title: "Sign in — PayTrack" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const cardStyle: React.CSSProperties = { width: "100%", maxWidth: 380, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 24, boxShadow: "var(--shadow)" };
  const inputStyle: React.CSSProperties = { width: "100%", fontSize: 15, padding: "12px 13px", border: "1px solid var(--line)", borderRadius: 11, background: "var(--surface-2)", marginBottom: 11 };

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        loginId: String(formData.get("loginId") ?? "").toLowerCase(),
        password: String(formData.get("password") ?? ""),
        redirectTo: "/",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/signin?error=1");
      throw e; // let Next's redirect propagate
    }
  }

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--bg)", padding: 20 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,var(--brand),#0FA391)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700 }}>₹</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>PayTrack <span style={{ color: "var(--ink-3)", fontWeight: 500, fontSize: 11 }}>Go DinDin</span></div>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 16 }}>
          Sign in with your login ID and password. Access is limited to the team.
        </p>
        {sp.error && (
          <p style={{ fontSize: 12.5, color: "var(--over)", marginBottom: 12, fontWeight: 600 }}>
            Wrong login ID or password. Try again.
          </p>
        )}
        <form action={login}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>Login ID</label>
          <input name="loginId" type="text" autoComplete="username" required placeholder="you@payment.com" style={inputStyle} />
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>Password</label>
          <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" style={inputStyle} />
          <button type="submit" style={{ width: "100%", background: "var(--brand)", color: "#fff", fontWeight: 600, fontSize: 14.5, padding: 13, borderRadius: 11, border: "none", cursor: "pointer", marginTop: 5 }}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
