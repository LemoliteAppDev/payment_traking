import { route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { readMedia } from "@/lib/chat";

/**
 * The ciphertext of a chat attachment. Served as octet-stream because that is
 * genuinely all it is — the browser decrypts it before showing anything. The
 * membership check is a second lock on a door that has no handle: without the
 * message's envelope these bytes are noise.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const bytes = await readMedia(user, id);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
    },
  });
});
