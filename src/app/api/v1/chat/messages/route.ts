import { json, route, ApiError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { postChatMessageSchema } from "@/lib/validation";
import { postMessage } from "@/lib/chat";
import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";

/**
 * Send one message. Multipart, because an attachment arrives as an opaque
 * encrypted blob next to the JSON envelope set.
 *
 * Nothing here can read what it is storing: `body`, `mediaMeta` and the blob
 * are all ciphertext, and the wrapped keys are only openable by the recipient
 * devices they were sealed for.
 */
export const POST = route(async (req: Request) => {
  const user = await requireUser();

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    throw new ApiError(415, "EXPECT_MULTIPART", "Send the message as multipart/form-data.");
  }
  const form = await req.formData();

  const raw = form.get("payload");
  if (typeof raw !== "string") throw new ApiError(400, "NO_PAYLOAD", "Message payload is missing.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "BAD_JSON", "Message payload is not valid JSON.");
  }
  const input = postChatMessageSchema.parse(parsed);

  const media = form.get("media");
  const blob = typeof media === "object" && media !== null ? (media as Blob) : undefined;

  const message = await postMessage(user, {
    threadId: input.threadId,
    deviceId: input.deviceId,
    kind: input.kind,
    body: input.body,
    iv: input.iv,
    envelopes: input.envelopes,
    media: blob,
    mediaMeta: input.mediaMeta,
    mediaIv: input.mediaIv,
    durationMs: input.durationMs,
  });

  // Ping the other person — with no content in it. The server couldn't put the
  // message text in this notification if it wanted to, and the kind is as much
  // as it may fairly say.
  void notifyOther(user.id, input.threadId, user.name, input.kind).catch((e) =>
    console.error("[chat] push failed", e),
  );

  return json({ message }, { status: 201 });
});

const KIND_WORD: Record<string, string> = {
  TEXT: "sent you a message",
  IMAGE: "sent you a photo",
  FILE: "sent you a file",
  AUDIO: "sent you a voice note",
};

async function notifyOther(meId: string, threadId: string, myName: string, kind: string) {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) return;
  const otherId = thread.aId === meId ? thread.bId : thread.aId;
  await sendPushToUser(otherId, {
    title: myName,
    body: KIND_WORD[kind] ?? KIND_WORD.TEXT,
    url: "/?tab=chat",
    tag: `chat-${threadId}`,
  });
}
