import type { NextRequest } from "next/server";
import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createPaymentSchema } from "@/lib/validation";
import { saveUpload } from "@/lib/upload";
import { createPayment, listPayments, serializePayment } from "@/lib/payments";

export const GET = route(async (req: NextRequest) => {
  const user = await requireUser();
  const filter = req.nextUrl.searchParams.get("filter") ?? "all";
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rows = await listPayments(user, filter, q);
  return json({ payments: rows });
});

export const POST = route(async (req: NextRequest) => {
  const user = await requireUser();
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

  const payment = await createPayment(parsed, user, file);
  return json({ payment: serializePayment(payment) }, { status: 201 });
});
