// Browser-side API client + UI helpers for the React app.
import { formatINR, wordsINR } from "@/lib/money";

export type Status = "REQUESTED" | "SCHEDULED" | "PAID" | "CONFIRMED" | "HOLD" | "CANCELLED";
export type Effective = Status | "OVERDUE";
export type Role = "PAYER" | "REQUESTER";

export interface UserLite { id: string; name: string; role: Role }
export interface UserWithEmail extends UserLite { email: string }
export interface Me { me: UserLite | null; users: UserWithEmail[] }

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
};

// ── UI helpers ───────────────────────────────────────────────────────
export const PEOPLE: Record<string, string> = {
  Mahesh: "#0B7A6E", Jignesh: "#DE3C7A", Jagat: "#2F6FED", Bhadresh: "#7A6CE0",
};
export const colorFor = (name: string): string => PEOPLE[name] ?? "#94A3B2";

export const initials = (s: string): string =>
  s.replace("@", "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export const STATUS: Record<Effective, { lab: string; cls: string; ic: string }> = {
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
