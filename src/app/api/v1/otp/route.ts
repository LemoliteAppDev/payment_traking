import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { z } from "zod";
import { listOtpMessages, postOtpMessage } from "@/lib/otp";

const bodySchema = z.object({ message: z.string().min(1).max(200) });

// Standalone secure OTP channel (approver <-> payer). Not tied to a payment.
export const GET = route(async () => {
  const user = await requireUser();
  return json({ messages: await listOtpMessages(user) });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { message } = bodySchema.parse(await readJson(req));
  return json({ messages: await postOtpMessage(user, message) });
});
