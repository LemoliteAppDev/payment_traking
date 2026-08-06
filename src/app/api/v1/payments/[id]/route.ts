import type { NextRequest } from "next/server";
import { json, route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createPaymentSchema } from "@/lib/validation";
import { saveUpload } from "@/lib/upload";
import { loadPayment, editPayment, deletePayment, serializePayment } from "@/lib/payments";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const payment = await loadPayment(id);
  // Private payments are only for the approver/payer.
  const canSeePrivate = user.isApprover || user.isPayer;
  if (payment.isPrivate && !canSeePrivate) {
    throw new ApiError(404, "NOT_FOUND", "Payment not found.");
  }
  // Visibility: admins see all; a user may only see what they raised.
  if (!payment.isPrivate && !user.isAdmin && payment.requestedById !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "You don't have access to this payment.");
  }
  return json({ payment: serializePayment(payment) });
});

// Edit a payment (raiser only, while awaiting approval or returned).
export const PUT = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const form = await req.formData();
  const parsed = createPaymentSchema.parse({
    amount: form.get("amount"),
    payee: form.get("payee"),
    payFrom: form.get("payFrom"),
    purpose: form.get("purpose") ?? undefined,
    upi: form.get("upi") ?? undefined,
    dueDate: form.get("dueDate"),
  });
  const fileEntry = form.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? await saveUpload(fileEntry) : undefined;
  const payment = await editPayment(id, user, parsed, file);
  return json({ payment: serializePayment(payment) });
});

// Delete a payment (raiser or admin, until it's paid).
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deletePayment(id, user);
  return json({ ok: true });
});
