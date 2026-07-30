// AES-256-GCM encryption for OTP message bodies, so they're never stored in
// plaintext (protects DB backups / at-rest). Key is derived from a server
// secret — OTP_SECRET if set, otherwise the existing AUTH_SECRET.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function key(): Buffer {
  const secret = process.env.OTP_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    // Dev fallback only — real deployments always have AUTH_SECRET set.
    console.warn("[otp] no OTP_SECRET/AUTH_SECRET set — using an insecure dev key");
    return createHash("sha256").update("paytrack-dev-otp-key").digest();
  }
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

/** Encrypt a plaintext OTP → "iv:tag:cipher" (all base64). */
export function encryptOtp(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt "iv:tag:cipher"; returns "" if it can't be read (tampered/old key). */
export function decryptOtp(payload: string): string {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return "";
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
