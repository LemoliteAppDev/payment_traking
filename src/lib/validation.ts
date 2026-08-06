import { z } from "zod";

// amount arrives as an integer-paise string (JSON has no BigInt).
const paise = z
  .string()
  .regex(/^\d+$/, "must be integer paise")
  .transform((s) => BigInt(s))
  .refine((v) => v > 0n, "amount must be greater than zero");

export const createPaymentSchema = z.object({
  amount: paise,
  payee: z.string().trim().min(1, "payee is required").max(120),
  payFrom: z.string().trim().min(1, "pay-from account is required").max(60),
  payFromType: z.enum(["ACCOUNT", "INDIVIDUAL"]).optional().default("ACCOUNT"),
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

export const reasonSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  loginId: z.string().trim().toLowerCase().min(3).max(120),
  password: z.string().min(6).max(200),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});

export const setPasswordSchema = z.object({ password: z.string().min(6).max(200) });
export const setActiveSchema = z.object({ active: z.boolean() });

export const createPayAccountSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(60),
});

export const createPrivateMemberSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(60),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const paidNoteSchema = z.object({
  note: z.string().trim().max(500).optional().default(""),
});

export const noteMessageSchema = z.object({
  message: z.string().trim().min(1, "Type a message first.").max(1000),
});

export const LIST_FILTERS = ["all", "mine", "requested", "scheduled", "overdue", "paid"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(512),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});
