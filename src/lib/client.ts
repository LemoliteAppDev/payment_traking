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

export interface Card {
  id: string;
  amount: string; // paise
  payee: string;
  payFrom: string;
  purpose: string;
  status: Status;
  effective: Effective;
  overdue: boolean;
  dueDate: string;
  scheduledFor: string | null;
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
  approve: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) =>
    req<{ payment: Detail }>(`/api/v1/payments/${id}/reject`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }),
    }),
  resubmit: (id: string) => req<{ payment: Detail }>(`/api/v1/payments/${id}/resubmit`, { method: "POST" }),
  edit: (id: string, form: FormData) => req<{ payment: Detail }>(`/api/v1/payments/${id}`, { method: "PUT", body: form }),
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

export const fmtShort = (dateISO: string): string =>
  new Date(dateISO).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function isoDay(offset = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
