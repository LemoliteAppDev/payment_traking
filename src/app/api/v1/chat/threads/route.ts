import { json, route, readJson } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { startThreadSchema } from "@/lib/validation";
import { listThreads, getOrCreateThread, unreadCount } from "@/lib/chat";

// The caller's conversations, newest first. `deviceId` decides which envelopes
// come back — without it the previews stay sealed.
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  const [threads, unread] = await Promise.all([listThreads(user, deviceId), unreadCount(user)]);
  return json({ threads, unread });
});

// Open (or reopen) a conversation with one person.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = startThreadSchema.parse(await readJson(req));
  const thread = await getOrCreateThread(user, body.userId);
  return json({ threadId: thread.id }, { status: 201 });
});
