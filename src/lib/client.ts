// Browser-side API client + UI helpers for the React app.
import { formatINR, wordsINR } from "@/lib/money";

export type Status = "AWAITING_APPROVAL" | "RETURNED" | "REQUESTED" | "SCHEDULED" | "PAID" | "CONFIRMED" | "HOLD" | "CANCELLED";
export type Effective = Status | "OVERDUE";
export type Role = "ADMIN" | "USER";

export interface UserLite { id: string; name: string; role: Role }
export interface MeUser extends UserLite {
  email: string;
  isAdmin: boolean;
  isPayer: boolean;
  isApprover: boolean;
  isManager: boolean;
}
export interface TeamUser {
  id: string; name: string; email: string; role: Role; active: boolean;
  isPayer: boolean; isApprover: boolean; isManager: boolean;
}
export interface Me { me: MeUser | null }

export interface PayAccountLite { id: string; name: string; active: boolean }
export interface PrivateMemberLite { id: string; name: string; active: boolean }

export interface OtpMsg { id: string; fromMe: boolean; senderName: string; body: string; createdAt: string; expiresAt: string }

export interface Card {
  id: string;
  amount: string; // paise
  payee: string;
  payFrom: string;
  payFromType: "ACCOUNT" | "INDIVIDUAL";
  purpose: string;
  status: Status;
  effective: Effective;
  overdue: boolean;
  dueDate: string;
  scheduledFor: string | null;
  createdAt: string;
  editedAt: string | null;
  paidAt: string | null;
  isPrivate: boolean;
  mine: boolean;
  requestedBy: UserLite;
  hasProof: boolean;
}

export interface AttachmentLite { id: string; kind: "INSTRUCTION" | "PROOF"; originalName: string; mimeType: string }
export interface EventLite {
  id: string;
  type: string;
  message: string;
  actor: UserLite | null;
  attachment: AttachmentLite | null;
  createdAt: string;
}
export interface Detail extends Omit<Card, "mine"> {
  upi: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  requestedBy: UserLite;
  paidBy: UserLite | null;
  confirmedBy: UserLite | null;
  attachments: AttachmentLite[];
  events: EventLite[];
}

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  unread: boolean;
  actor: { id: string; name: string; role: Role } | null;
  payment: { id: string; payee: string; amount: string; status: Status };
}
export interface NotificationsResponse {
  items: NotificationItem[];
  unread: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  me: () => req<Me>("/api/v1/me"),
  list: (filter: string, q: string) =>
    req<{ payments: Card[] }>(`/api/v1/payments?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(q)}`),
  get: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}`),
  create: (form: FormData) => req<{ payment: Detail }>(`/api/v1/payments`, { method: "POST", body: form }),
  schedule: (id: string, scheduledFor: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledFor }),
    }),
  pay: (id: string, form: FormData, idempotencyKey: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/pay`, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: form,
    }),
  hold: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/hold`, { method: "POST" }),
  cancel: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/cancel`, { method: "POST" }),
  confirm: (id: string, idempotencyKey: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/confirm`, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    }),
  nudge: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/nudge`, { method: "POST" }),
  postNote: (id: string, message: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/note`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
    }),
  approve: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/reject`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }),
    }),
  resubmit: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/resubmit`, { method: "POST" }),
  edit: (id: string, form: FormData) => req<{ payment: Detail }>(`/api/v1/payments/${id}`, { method: "PUT", body: form }),
  remove: (id: string) => req<{ ok: true }>(`/api/v1/payments/${id}`, { method: "DELETE" }),
  notifications: () => req<NotificationsResponse>("/api/v1/notifications"),
  markNotificationsRead: () => req<{ ok: true }>("/api/v1/notifications/read", { method: "POST" }),
  // team management (manager only)
  teamList: () => req<{ users: TeamUser[] }>("/api/v1/users"),
  teamCreate: (body: { name: string; loginId: string; password: string; role: Role }) =>
    req<{ user: TeamUser }>("/api/v1/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  teamSetPassword: (id: string, password: string) =>
    req<{ ok: true }>(`/api/v1/users/${id}/password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }),
  teamSetActive: (id: string, active: boolean) =>
    req<{ ok: true }>(`/api/v1/users/${id}/active`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }),
  // pay-from accounts
  payAccounts: () => req<{ accounts: PayAccountLite[] }>("/api/v1/pay-accounts"),
  payAccountCreate: (name: string) =>
    req<{ account: PayAccountLite }>("/api/v1/pay-accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
  payAccountSetActive: (id: string, active: boolean) =>
    req<{ ok: true }>(`/api/v1/pay-accounts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }),
  payAccountRename: (id: string, name: string) =>
    req<{ ok: true }>(`/api/v1/pay-accounts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
  payAccountDelete: (id: string) =>
    req<{ ok: true }>(`/api/v1/pay-accounts/${id}`, { method: "DELETE" }),
  payAccountMove: (id: string, move: "up" | "down") =>
    req<{ ok: true }>(`/api/v1/pay-accounts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ move }) }),
  // individual members
  privateMembers: () => req<{ members: PrivateMemberLite[] }>("/api/v1/private-members"),
  privateMemberCreate: (name: string) =>
    req<{ member: PrivateMemberLite }>("/api/v1/private-members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
  privateMemberSetActive: (id: string, active: boolean) =>
    req<{ ok: true }>(`/api/v1/private-members/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) }),
  privateMemberRename: (id: string, name: string) =>
    req<{ ok: true }>(`/api/v1/private-members/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
  privateMemberDelete: (id: string) =>
    req<{ ok: true }>(`/api/v1/private-members/${id}`, { method: "DELETE" }),
  privateMemberMove: (id: string, move: "up" | "down") =>
    req<{ ok: true }>(`/api/v1/private-members/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ move }) }),
  // standalone secure OTP channel (approver <-> payer)
  otpList: () => req<{ messages: OtpMsg[] }>(`/api/v1/otp`),
  otpSend: (message: string) =>
    req<{ messages: OtpMsg[] }>(`/api/v1/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) }),
};

// ── UI helpers ───────────────────────────────────────────────────────
export const PEOPLE: Record<string, string> = {
  Mahesh: "#0B7A6E", Jignesh: "#DE3C7A", Jagat: "#2F6FED", Bhadresh: "#7A6CE0",
};
export const colorFor = (name: string): string => PEOPLE[name] ?? "#94A3B2";

export const initials = (s: string): string =>
  s.replace("@", "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export const STATUS: Record<Effective, { lab: string; cls: string; ic: string }> = {
  AWAITING_APPROVAL: { lab: "Needs approval", cls: "st-appr", ic: "🕵️" },
  RETURNED: { lab: "Returned", cls: "st-ret", ic: "↩️" },
  REQUESTED: { lab: "Waiting", cls: "st-new", ic: "⏳" },
  SCHEDULED: { lab: "Planned", cls: "st-sched", ic: "📅" },
  PAID: { lab: "Paid", cls: "st-paid", ic: "✓" },
  CONFIRMED: { lab: "Done", cls: "st-confirmed", ic: "✅" },
  HOLD: { lab: "Needs info", cls: "st-hold", ic: "❓" },
  CANCELLED: { lab: "Cancelled", cls: "st-hold", ic: "✕" },
  OVERDUE: { lab: "Late", cls: "st-over", ic: "⚠️" },
};

export const fmtPaise = (paise: string): string => formatINR(BigInt(paise));
export const wordsFromRupees = (rupees: number): string => wordsINR(BigInt(Math.round(rupees)) * 100n);

const DAY = 86400000;
export function relDue(dateISO: string): { t: string; c: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dt = new Date(dateISO);
  dt.setHours(0, 0, 0, 0);
  const days = Math.round((dt.getTime() - today.getTime()) / DAY);
  if (days < 0) return { t: `${-days}d overdue`, c: "var(--over)" };
  if (days === 0) return { t: "due today", c: "var(--sched)" };
  if (days === 1) return { t: "due tomorrow", c: "var(--sched)" };
  return { t: `due in ${days}d`, c: "var(--ink-3)" };
}

/** "just now" / "5m" / "3h" / "2d" — compact relative time for the bell. */
export function timeAgo(dateISO: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(dateISO).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d ago` : new Date(dateISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "27 Jul 2026, 05:10 PM" — full date + 12-hour time (India) for the timestamp. */
export const fmtStamp = (dateISO: string): string =>
  new Date(dateISO)
    .toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
    .replace(/\bam\b/i, "AM")
    .replace(/\bpm\b/i, "PM");

export const fmtShort = (dateISO: string): string =>
  new Date(dateISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * List sort key: [tier, dueDays]. Lower tier shows first.
 *  0 = due today · 1 = other active (ordered by due date) · 2 = waiting for approval · 3 = paid/done
 * Within tier 1 sort by dueDays asc; elsewhere newest-first (handled at the call site).
 */
export function listSortKey(p: { status: Status; dueDate: string }): [number, number] {
  if (p.status === "PAID" || p.status === "CONFIRMED" || p.status === "CANCELLED") return [3, 0];
  if (p.status === "AWAITING_APPROVAL" || p.status === "RETURNED") return [2, 0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(p.dueDate);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / DAY);
  return days === 0 ? [0, 0] : [1, days];
}

export function isoDay(offset = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
