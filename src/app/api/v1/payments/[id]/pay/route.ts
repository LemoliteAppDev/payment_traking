import type { NextRequest } from "next/server";
import { json, route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { paidNoteSchema } from "@/lib/validation";
import { saveUpload } from "@/lib/upload";
import { applyTransition, serializePayment } from "@/lib/payments";

export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  // Proof is required for PAID. A missing/empty multipart body means no proof;
  // the guard in lib/status.ts is the authority, but we short-circuit cleanly.
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const fileEntry = form?.get("file");
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    throw new ApiError(409, "MISSING_PROOF", "A payment cannot be marked paid without a proof file.");
  }
  const { note } = paidNoteSchema.parse({ note: form?.get("note") ?? undefined });
  const file = await saveUpload(fileEntry);

  const idempotencyKey = req.headers.get("idempotency-key");
  const payment = await applyTransition({
    paymentId: id,
    to: "PAID",
    actor: user,
    file,
    fileKind: "PROOF",
    message: note || "Paid, proof attached.",
    idempotencyKey,
  });
  return json({ payment: serializePayment(payment) });
});
