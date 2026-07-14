import { z } from "zod";

export const ACCOUNTS = ["PELISWAN", "LEMOLITE", "SHIVAM", "ZENITH"] as const;

// amount arrives as an integer-paise string (JSON has no BigInt).
const paise = z
  .string()
  .regex(/^\d+$/, "must be integer paise")
  .transform((s) => BigInt(s))
  .refine((v) => v > 0n, "amount must be greater than zero");

export const createPaymentSchema = z.object({
  amount: paise,
  payee: z.string().trim().min(1, "payee is required").max(120),
  payFrom: z.enum(ACCOUNTS),
  purpose: z.string().trim().max(500).optional().default(""),
  upi: z.string().trim().max(120).optional().default(""),
  dueDate: z.coerce.date(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const scheduleSchema = z.object({
  scheduledFor: z.coerce.date(),
});

export const holdSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const paidNoteSchema = z.object({
  note: z.string().trim().max(500).optional().default(""),
});

export const LIST_FILTERS = ["all", "mine", "requested", "scheduled", "overdue", "paid"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
