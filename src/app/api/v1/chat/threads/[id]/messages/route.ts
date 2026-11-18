import { json, route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { listMessages } from "@/lib/chat";

// Messages in a thread, each carrying the envelope for the asking device only.
// Everything in the payload is ciphertext.
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId) throw new ApiError(400, "NO_DEVICE", "This device isn't set up for chat yet.");
  const messages = await listMessages(user, id, deviceId);
  return json({ messages });
});
