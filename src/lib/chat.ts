/**
 * Chat — the server half. Deliberately dumb about content.
 *
 * Everything here moves opaque base64 around: ciphertext bodies, wrapped keys
 * and encrypted file names. There is no decrypt function in this file and no
 * key for one to use. What the server does own is the routing — who may read a
 * thread, who gets an envelope, who has unread messages — and that is enforced
 * here rather than in React.
 *
 * See lib/e2ee.ts for the browser half, which holds the only keys.
 */
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { saveEncryptedBlob, readUpload, deleteUpload } from "@/lib/upload";
import type { SessionUser } from "@/lib/session";
import type { ChatKind } from "@/generated/prisma";

/** A thread's participants are stored in a fixed order, so a pair has one row. */
function pair(x: string, y: string): { aId: string; bId: string } {
  return x < y ? { aId: x, bId: y } : { aId: y, bId: x };
}

/* ── devices ────────────────────────────────────────────────────────── */

/**
 * Register (or refresh) the calling browser's public key.
 *
 * `knownDeviceId` is what the browser believes its row is. Re-posting the same
 * public key is how a device says "still me" — it refreshes lastSeenAt instead
 * of piling up rows. A public key that doesn't match any row gets a new one.
 */
export async function registerDevice(
  me: SessionUser,
  publicKey: string,
  label: string | null,
  knownDeviceId: string | null,
): Promise<{ deviceId: string }> {
  if (knownDeviceId) {
    const existing = await prisma.chatDevice.findUnique({ where: { id: knownDeviceId } });
    // Only the owner can refresh a row, and only if the key still matches —
    // otherwise a stolen device id would let someone re-point it at their key.
    if (existing && existing.userId === me.id && existing.publicKey === publicKey) {
      await prisma.chatDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), active: true, label: label ?? existing.label },
      });
      return { deviceId: existing.id };
    }
  }

  const sameKey = await prisma.chatDevice.findFirst({ where: { userId: me.id, publicKey } });
  if (sameKey) {
    await prisma.chatDevice.update({
      where: { id: sameKey.id },
      data: { lastSeenAt: new Date(), active: true, label: label ?? sameKey.label },
    });
    return { deviceId: sameKey.id };
  }

  const created = await prisma.chatDevice.create({
    data: { userId: me.id, publicKey, label },
  });
  return { deviceId: created.id };
}

/** Confirm a device id really belongs to the caller before trusting it. */
async function ownDevice(me: SessionUser, deviceId: string) {
  const device = await prisma.chatDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.userId !== me.id || !device.active) {
    throw new ApiError(400, "UNKNOWN_DEVICE", "This device isn't registered for chat. Reload the page.");
  }
  return device;
}

/**
 * Public keys for every active device of the two people in a conversation.
 * The sender's own devices are included on purpose: without an envelope for
 * itself, a device could not read back what it just sent.
 */
export async function devicesForThread(me: SessionUser, threadId: string) {
  const thread = await requireThread(me, threadId);
  const devices = await prisma.chatDevice.findMany({
    where: { userId: { in: [thread.aId, thread.bId] }, active: true },
    select: { id: true, userId: true, publicKey: true },
    orderBy: { createdAt: "asc" },
  });
  return devices;
}

/* ── threads ────────────────────────────────────────────────────────── */

/** The people the caller may start a conversation with: everyone else active. */
export async function chatPeople(me: SessionUser) {
  const users = await prisma.user.findMany({
    where: { active: true, id: { not: me.id } },
    select: { id: true, name: true, email: true, role: true, isPayer: true, isApprover: true, isManager: true },
    orderBy: { name: "asc" },
  });
  return users;
}

export async function getOrCreateThread(me: SessionUser, otherId: string) {
  if (otherId === me.id) {
    throw new ApiError(400, "SELF_CHAT", "You can't start a chat with yourself.");
  }
  const other = await prisma.user.findUnique({ where: { id: otherId } });
  if (!other || !other.active) {
    throw new ApiError(404, "NO_USER", "That person isn't on PayTrack.");
  }
  const key = pair(me.id, otherId);
  const existing = await prisma.chatThread.findUnique({ where: { aId_bId: key } });
  if (existing) return existing;
  return prisma.chatThread.create({ data: key });
}

async function requireThread(me: SessionUser, threadId: string) {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) throw new ApiError(404, "NO_THREAD", "That conversation doesn't exist.");
  if (thread.aId !== me.id && thread.bId !== me.id) {
    // Being an admin does not open someone else's messages — and even if this
    // check were removed, there would be no envelope here to read them with.
    throw new ApiError(403, "NOT_IN_THREAD", "This conversation isn't yours.");
  }
  return thread;
}

export interface ThreadRow {
  id: string;
  other: { id: string; name: string; role: string; isPayer: boolean; isApprover: boolean; isManager: boolean };
  lastMessageAt: string;
  unread: number;
  last: MessageRow | null;
}

/**
 * Every conversation the caller is in, newest first, each with the last
 * message already enveloped for `deviceId` so the list can show a preview.
 * People with no thread yet come back from `chatPeople` instead.
 */
export async function listThreads(me: SessionUser, deviceId: string | null): Promise<ThreadRow[]> {
  if (deviceId) await ownDevice(me, deviceId);
  const threads = await prisma.chatThread.findMany({
    where: { OR: [{ aId: me.id }, { bId: me.id }] },
    orderBy: { lastMessageAt: "desc" },
    include: {
      a: { select: { id: true, name: true, role: true, isPayer: true, isApprover: true, isManager: true } },
      b: { select: { id: true, name: true, role: true, isPayer: true, isApprover: true, isManager: true } },
      reads: { where: { userId: me.id } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        where: { deletedAt: null },
        include: {
          sender: { select: { id: true, name: true } },
          envelopes: deviceId ? { where: { deviceId } } : false,
        },
      },
    },
  });

  const rows: ThreadRow[] = [];
  for (const t of threads) {
    const other = t.aId === me.id ? t.b : t.a;
    const readAt = t.reads[0]?.readAt ?? new Date(0);
    const unread = await prisma.chatMessage.count({
      where: { threadId: t.id, deletedAt: null, senderId: { not: me.id }, createdAt: { gt: readAt } },
    });
    rows.push({
      id: t.id,
      other,
      lastMessageAt: t.lastMessageAt.toISOString(),
      unread,
      last: t.messages[0] ? shapeMessage(t.messages[0], me.id) : null,
    });
  }
  return rows;
}

/* ── messages ───────────────────────────────────────────────────────── */

export interface MessageRow {
  id: string;
  threadId: string;
  kind: ChatKind;
  mine: boolean;
  sender: { id: string; name: string };
  senderDeviceId: string;
  body: string;
  iv: string;
  mediaMeta: string | null;
  mediaIv: string | null;
  mediaSize: number | null;
  durationMs: number | null;
  hasMedia: boolean;
  createdAt: string;
  /** This device's envelope, or null when the device wasn't enrolled yet. */
  envelope: { deviceId: string; wrappedKey: string; iv: string; ephemeral: string } | null;
}

type DbMessage = {
  id: string;
  threadId: string;
  kind: ChatKind;
  senderId: string;
  senderDeviceId: string;
  body: string;
  iv: string;
  storedName: string | null;
  mediaMeta: string | null;
  mediaIv: string | null;
  mediaSize: number | null;
  durationMs: number | null;
  createdAt: Date;
  sender: { id: string; name: string };
  envelopes?: { deviceId: string; wrappedKey: string; iv: string; ephemeral: string }[] | false;
};

function shapeMessage(m: DbMessage, meId: string): MessageRow {
  const env = Array.isArray(m.envelopes) ? m.envelopes[0] : undefined;
  return {
    id: m.id,
    threadId: m.threadId,
    kind: m.kind,
    mine: m.senderId === meId,
    sender: m.sender,
    senderDeviceId: m.senderDeviceId,
    body: m.body,
    iv: m.iv,
    mediaMeta: m.mediaMeta,
    mediaIv: m.mediaIv,
    mediaSize: m.mediaSize,
    durationMs: m.durationMs,
    hasMedia: !!m.storedName,
    createdAt: m.createdAt.toISOString(),
    envelope: env
      ? { deviceId: env.deviceId, wrappedKey: env.wrappedKey, iv: env.iv, ephemeral: env.ephemeral }
      : null,
  };
}

export async function listMessages(
  me: SessionUser,
  threadId: string,
  deviceId: string,
  limit = 200,
): Promise<MessageRow[]> {
  await requireThread(me, threadId);
  await ownDevice(me, deviceId);
  const msgs = await prisma.chatMessage.findMany({
    where: { threadId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 500),
    include: {
      sender: { select: { id: true, name: true } },
      envelopes: { where: { deviceId } },
    },
  });
  return msgs.reverse().map((m) => shapeMessage(m, me.id));
}

export interface PostMessageInput {
  threadId: string;
  deviceId: string;
  kind: ChatKind;
  body: string;
  iv: string;
  envelopes: { deviceId: string; wrappedKey: string; iv: string; ephemeral: string }[];
  media?: File | Blob;
  mediaMeta?: string;
  mediaIv?: string;
  durationMs?: number;
}

export async function postMessage(me: SessionUser, input: PostMessageInput): Promise<MessageRow> {
  const thread = await requireThread(me, input.threadId);
  await ownDevice(me, input.deviceId);

  if (!input.body && !input.media) {
    throw new ApiError(400, "EMPTY", "Type something or attach a file.");
  }

  // Envelopes may only address devices that belong to the two people in this
  // thread — otherwise a crafted request could hand a content key to an
  // outsider's device.
  const allowed = new Set(
    (
      await prisma.chatDevice.findMany({
        where: { userId: { in: [thread.aId, thread.bId] }, active: true },
        select: { id: true },
      })
    ).map((d) => d.id),
  );
  const envelopes = input.envelopes.filter((e) => allowed.has(e.deviceId));
  if (envelopes.length === 0) {
    throw new ApiError(400, "NO_RECIPIENTS", "Couldn't find a device to encrypt this for. Reload and try again.");
  }

  let storedName: string | null = null;
  let mediaSize: number | null = null;
  if (input.media) {
    if (!input.mediaMeta || !input.mediaIv) {
      throw new ApiError(400, "BAD_MEDIA", "Attachment metadata is missing.");
    }
    const saved = await saveEncryptedBlob(input.media);
    storedName = saved.storedName;
    mediaSize = saved.size;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          threadId: thread.id,
          senderId: me.id,
          senderDeviceId: input.deviceId,
          kind: input.kind,
          body: input.body,
          iv: input.iv,
          storedName,
          mediaMeta: input.mediaMeta ?? null,
          mediaIv: input.mediaIv ?? null,
          mediaSize,
          durationMs: input.durationMs ?? null,
          envelopes: { create: envelopes },
        },
        include: {
          sender: { select: { id: true, name: true } },
          envelopes: { where: { deviceId: input.deviceId } },
        },
      });
      await tx.chatThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: msg.createdAt },
      });
      // Sending is also reading: don't let your own message look unread.
      await tx.chatRead.upsert({
        where: { threadId_userId: { threadId: thread.id, userId: me.id } },
        create: { threadId: thread.id, userId: me.id, readAt: msg.createdAt },
        update: { readAt: msg.createdAt },
      });
      return msg;
    });
    return shapeMessage(created, me.id);
  } catch (e) {
    // Don't leave an orphaned blob on disk if the row never landed.
    if (storedName) await deleteUpload(storedName);
    throw e;
  }
}

export async function markRead(me: SessionUser, threadId: string): Promise<void> {
  await requireThread(me, threadId);
  const now = new Date();
  await prisma.chatRead.upsert({
    where: { threadId_userId: { threadId, userId: me.id } },
    create: { threadId, userId: me.id, readAt: now },
    update: { readAt: now },
  });
}

/** Total unread across all of the caller's conversations — the tab badge. */
export async function unreadCount(me: SessionUser): Promise<number> {
  const threads = await prisma.chatThread.findMany({
    where: { OR: [{ aId: me.id }, { bId: me.id }] },
    select: { id: true, reads: { where: { userId: me.id }, select: { readAt: true } } },
  });
  let total = 0;
  for (const t of threads) {
    total += await prisma.chatMessage.count({
      where: {
        threadId: t.id,
        deletedAt: null,
        senderId: { not: me.id },
        createdAt: { gt: t.reads[0]?.readAt ?? new Date(0) },
      },
    });
  }
  return total;
}

/**
 * The raw ciphertext of an attachment. Gated on thread membership, but note
 * that the gate is belt-and-braces: without the matching envelope these bytes
 * are noise to whoever downloads them.
 */
export async function readMedia(me: SessionUser, messageId: string): Promise<Buffer> {
  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { thread: true },
  });
  if (!msg || !msg.storedName || msg.deletedAt) {
    throw new ApiError(404, "NOT_FOUND", "Attachment not found.");
  }
  if (msg.thread.aId !== me.id && msg.thread.bId !== me.id) {
    throw new ApiError(403, "NOT_IN_THREAD", "This attachment isn't yours.");
  }
  return readUpload(msg.storedName);
}

/** Delete your own message, and its blob. */
export async function deleteMessage(me: SessionUser, messageId: string): Promise<void> {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.deletedAt) throw new ApiError(404, "NOT_FOUND", "Message not found.");
  if (msg.senderId !== me.id) {
    throw new ApiError(403, "NOT_YOURS", "You can only delete your own messages.");
  }
  await prisma.chatMessage.update({
    where: { id: messageId },
    // Body and envelopes go too: a "deleted" message that still holds its
    // ciphertext and keys is not deleted.
    data: { deletedAt: new Date(), body: "", mediaMeta: null, storedName: null },
  });
  await prisma.chatEnvelope.deleteMany({ where: { messageId } });
  if (msg.storedName) await deleteUpload(msg.storedName);
}
