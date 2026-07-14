import { route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/upload";

// Files live outside the web root; this authenticated route is the ONLY way to
// read them. The original filename is offered for download; bytes come from disk.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) throw new ApiError(404, "NOT_FOUND", "Attachment not found.");

  const bytes = await readUpload(att.storedName);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": att.mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${encodeURIComponent(att.originalName)}"`,
      "cache-control": "private, no-store",
    },
  });
});
