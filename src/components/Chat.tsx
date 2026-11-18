"use client";
/**
 * The Chat tab — person-to-person messages, end-to-end encrypted.
 *
 * Everything that arrives from the API is ciphertext; this component decrypts
 * it with the device key held in IndexedDB (see lib/e2ee.ts) and keeps the
 * plaintext in memory only. Nothing decrypted is ever written back.
 *
 * Anyone on PayTrack can message anyone else — admin to payer, payer to the
 * person who raised a request, any pair. Payment threads stay where they were,
 * inside the payment, because they are also that payment's audit log.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, colorFor, initials, fmtTime, fmtListStamp, dayLabel, fmtPaise, isoDay,
  type ChatMessageLite, type ChatThreadLite, type MeUser,
} from "@/lib/client";
import { parseTransfers, type ParsedTransfer } from "@/lib/transfer-parse";
import {
  ensureDevice, encryptMessage, decryptMessage, decryptMedia,
  type MediaInfo, type PeerDevice,
} from "@/lib/e2ee";

/* ── icons ─────────────────────────────────────────────────────────── */
const IcSend = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>);
const IcClip = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>);
const IcMic = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M19 12a1 1 0 00-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7 7 0 006 6.92V21h-2a1 1 0 000 2h6a1 1 0 000-2h-2v-2.08A7 7 0 0019 12z" /></svg>);
const IcPlay = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>);
const IcPause = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>);
const IcLock = () => (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6a5 5 0 00-10 0v2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V10a2 2 0 00-2-2zM9 6a3 3 0 016 0v2H9V6z" /></svg>);
const IcBack = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg>);
const IcDoc = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>);
const IcRupee = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12M6 9h12M16 4c0 4-3.5 5-7 5l7 10" /></svg>);
const IcArrow = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>);
const IcNewChat = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>);

/* ── device enrolment ──────────────────────────────────────────────── */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS"
    : /Mac/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows" : "Device";
  const br = /Edg\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera"
    : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari"
    : /Firefox\//i.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${br}`;
}

/**
 * Enrol this browser's public key. Runs at app load, not when the Chat tab is
 * opened — a browser that has never visited the tab still needs a key on file,
 * or messages sent to it meanwhile would arrive with no envelope to open.
 */
export function useChatDevice(me: MeUser | null): { deviceId: string | null; error: string | null } {
  // Keyed by user: a device id earned by one account must not be handed to the
  // next one that signs in on this browser.
  const [enrolled, setEnrolled] = useState<{ userId: string; deviceId: string | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!me) return;
    let live = true;
    const userId = me.id;
    ensureDevice(userId, async (publicKey, knownDeviceId) => {
      const res = await api.chatRegisterDevice({
        publicKey: JSON.stringify(publicKey),
        label: deviceLabel(),
        deviceId: knownDeviceId,
      });
      return res.deviceId;
    })
      .then((d) => { if (live) setEnrolled({ userId, deviceId: d.deviceId, error: null }); })
      .catch((e: Error) => { if (live) setEnrolled({ userId, deviceId: null, error: e.message }); });
    return () => { live = false; };
  }, [me]);

  const mine = me && enrolled?.userId === me.id ? enrolled : null;
  return { deviceId: mine?.deviceId ?? null, error: mine?.error ?? null };
}

/* ── decryption cache ──────────────────────────────────────────────── */
interface Opened {
  text: string;
  media?: MediaInfo;
  contentKey?: CryptoKey;
  /** Set when there is no envelope for this device, or it won't open. */
  sealed?: string;
}

/**
 * Decrypts messages as they arrive and remembers the plaintext for this
 * session. A message with no envelope for this device cannot be opened here —
 * that is the deliberate cost of the server holding no keys.
 */
function useDecrypted(userId: string | null, ready: boolean, messages: ChatMessageLite[]) {
  const [opened, setOpened] = useState<Record<string, Opened>>({});
  const busy = useRef<Set<string>>(new Set());

  useEffect(() => {
    // The device key is loaded asynchronously on page load. Starting before it
    // is there would fail every message and, because success is remembered,
    // leave the whole thread looking permanently unreadable.
    if (!userId || !ready) return;
    (async () => {
      for (const m of messages) {
        if (busy.current.has(m.id)) continue;
        busy.current.add(m.id);
        if (!m.envelope) {
          setOpened((p) => ({
            ...p,
            [m.id]: { text: "", sealed: "Sent before this device was added — it can't be opened here." },
          }));
          continue;
        }
        try {
          const res = await decryptMessage(userId, m, m.envelope);
          setOpened((p) => ({ ...p, [m.id]: { text: res.text, media: res.media, contentKey: res.contentKey } }));
        } catch {
          // Show something rather than a stuck spinner, but let the next poll
          // try again — a failure here is far more often a moment's bad timing
          // than a message that can never be opened.
          busy.current.delete(m.id);
          setOpened((p) => ({ ...p, [m.id]: { text: "", sealed: "Couldn't decrypt this message." } }));
        }
      }
    })();
    // Deliberately no cancellation on re-run: a decryption that lands after the
    // poll refetched is still the right plaintext, and discarding it used to
    // leave messages stuck on "Decrypting…" with nothing left to retry them.
  }, [messages, userId, ready]);

  return opened;
}

/* ── the panel ─────────────────────────────────────────────────────── */
export function ChatPanel({
  me, deviceId, deviceError, openThreadId, onOpenThread, onToast,
}: {
  me: MeUser | null;
  deviceId: string | null;
  deviceError: string | null;
  openThreadId: string | null;
  onOpenThread: (id: string | null) => void;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const threadsQ = useQuery({
    queryKey: ["chatThreads", deviceId],
    queryFn: () => api.chatThreads(deviceId),
    enabled: !!me,
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });
  const threads = useMemo(() => threadsQ.data?.threads ?? [], [threadsQ.data]);

  const peopleQ = useQuery({ queryKey: ["chatPeople"], queryFn: api.chatPeople, enabled: !!me });
  const people = useMemo(() => peopleQ.data?.people ?? [], [peopleQ.data]);

  const mStart = useMutation({
    mutationFn: (userId: string) => api.chatStartThread(userId),
    onSuccess: (d) => {
      setPickerOpen(false);
      qc.invalidateQueries({ queryKey: ["chatThreads"] });
      onOpenThread(d.threadId);
    },
    onError: (e: Error) => onToast(e.message, true),
  });

  // Last messages across the list, so previews decrypt without opening a chat.
  const lastMsgs = useMemo(
    () => threads.map((t) => t.last).filter((m): m is ChatMessageLite => !!m),
    [threads],
  );
  const openedPreviews = useDecrypted(me?.id ?? null, !!deviceId, lastMsgs);

  const open = threads.find((t) => t.id === openThreadId) ?? null;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.other.name.toLowerCase().includes(q));
  }, [threads, search]);

  // People with no conversation yet — offered under the list, so starting one
  // is a tap rather than a hunt through a menu.
  const withoutThread = useMemo(
    () => people.filter((p) => !threads.some((t) => t.other.id === p.id)),
    [people, threads],
  );

  if (deviceError) {
    return (
      <div className="chatguard">
        <IcLock />
        <h3>Encryption isn&apos;t available</h3>
        <p>{deviceError}</p>
      </div>
    );
  }

  return (
    <>
      <div className="chatlistcol">
        <div className="chatsearch">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a name…" />
          <button className="chatnew" onClick={() => setPickerOpen(true)} aria-label="New chat" title="New chat">
            <IcNewChat />
          </button>
        </div>

        <div className="chatrows">
          {!deviceId && <div className="chatsetup">Setting this device up for encrypted chat…</div>}

          {shown.length === 0 && withoutThread.length === 0 && (
            <div className="remempty">
              <div className="big">💬</div>
              <h4>No one to chat with yet</h4>
              <p>Conversations appear here once someone else is on PayTrack.</p>
            </div>
          )}

          {shown.map((t) => (
            <ThreadRow
              key={t.id}
              t={t}
              preview={t.last ? openedPreviews[t.last.id] : undefined}
              active={t.id === openThreadId}
              onClick={() => onOpenThread(t.id)}
            />
          ))}

          {withoutThread.length > 0 && (
            <>
              <div className="chatsec">Start a chat</div>
              {withoutThread.map((p) => (
                <button key={p.id} className="chatrow" onClick={() => mStart.mutate(p.id)}>
                  <div className="chatav" style={{ background: colorFor(p.name) }}>{initials(p.name)}</div>
                  <div className="chatmid">
                    <div className="chattop"><span className="chatname">{p.name}</span></div>
                    <div className="chatprev dim">{roleWord(p)}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="chatconvcol">
        {open && deviceId && me ? (
          <Conversation
            key={open.id}
            me={me}
            deviceId={deviceId}
            thread={open}
            onBack={() => onOpenThread(null)}
            onToast={onToast}
          />
        ) : (
          <div className="chatguard">
            <IcLock />
            <h3>Your messages stay yours</h3>
            <p>
              Pick a conversation to start. Messages, files and voice notes are encrypted on your
              device — the server only ever stores the locked version.
            </p>
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="scrim" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mhead"><h3>New chat</h3><button className="x" onClick={() => setPickerOpen(false)}>✕</button></div>
            <div className="mbody">
              {people.length === 0 && <p>Nobody else is on PayTrack yet.</p>}
              {people.map((p) => (
                <button key={p.id} className="chatpick" onClick={() => mStart.mutate(p.id)} disabled={mStart.isPending}>
                  <div className="chatav" style={{ background: colorFor(p.name) }}>{initials(p.name)}</div>
                  <div><div className="chatname">{p.name}</div><div className="chatprev dim">{roleWord(p)}</div></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function roleWord(p: { isPayer: boolean; isApprover: boolean; isManager: boolean; role: string }): string {
  if (p.isPayer) return "Pays the bills";
  if (p.isApprover) return "Approves requests";
  if (p.isManager) return "Manages the team";
  if (p.role === "ADMIN") return "Admin";
  return "Raises payments";
}

const KIND_PREVIEW: Record<string, string> = { IMAGE: "📷 Photo", FILE: "📎 File", AUDIO: "🎤 Voice note" };

function ThreadRow({ t, preview, active, onClick }: {
  t: ChatThreadLite; preview?: Opened; active: boolean; onClick: () => void;
}) {
  let text = "Say hello";
  if (t.last) {
    if (preview?.sealed) text = "🔒 Encrypted message";
    else if (t.last.kind !== "TEXT") text = KIND_PREVIEW[t.last.kind] ?? "Attachment";
    else text = preview?.text ?? "…";
    if (t.last.mine) text = `You: ${text}`;
  }
  return (
    <button className={`chatrow ${active ? "on" : ""}`} onClick={onClick}>
      <div className="chatav" style={{ background: colorFor(t.other.name) }}>{initials(t.other.name)}</div>
      <div className="chatmid">
        <div className="chattop">
          <span className="chatname">{t.other.name}</span>
          {t.last && <span className={`chatwhen ${t.unread ? "un" : ""}`}>{fmtListStamp(t.lastMessageAt)}</span>}
        </div>
        <div className="chatbot">
          <span className="chatprev">{text}</span>
          {t.unread > 0 && <span className="chatbadge">{t.unread}</span>}
        </div>
      </div>
    </button>
  );
}

/* ── one conversation ──────────────────────────────────────────────── */
function Conversation({ me, deviceId, thread, onBack, onToast }: {
  me: MeUser;
  deviceId: string;
  thread: ChatThreadLite;
  onBack: () => void;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const qc = useQueryClient();
  const scroller = useRef<HTMLDivElement | null>(null);

  const msgsQ = useQuery({
    queryKey: ["chatMessages", thread.id, deviceId],
    queryFn: () => api.chatMessages(thread.id, deviceId),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const messages = useMemo(() => msgsQ.data?.messages ?? [], [msgsQ.data]);
  // A Conversation only renders once `deviceId` exists, so the key is ready.
  const opened = useDecrypted(me.id, true, messages);

  // The Pay-from list, so a shorthand source like "Peliswan" or a mistyped
  // "Peliswn" can be recognised as a real account.
  const accountsQ = useQuery({ queryKey: ["payAccounts"], queryFn: api.payAccounts });
  const membersQ = useQuery({ queryKey: ["privateMembers"], queryFn: api.privateMembers });
  const individuals = useMemo(
    () => new Set((membersQ.data?.members ?? []).filter((m) => m.active).map((m) => m.name)),
    [membersQ.data],
  );
  const sources = useMemo(() => [
    ...(accountsQ.data?.accounts ?? []).filter((a) => a.active).map((a) => a.name),
    ...individuals,
  ], [accountsQ.data, individuals]);

  // Reading a thread clears its badge — but only once per batch of arrivals.
  const lastSeen = useRef<string>("");
  useEffect(() => {
    const newest = messages[messages.length - 1]?.createdAt ?? "";
    if (!newest || newest === lastSeen.current) return;
    lastSeen.current = newest;
    api.chatMarkRead(thread.id)
      .then(() => qc.invalidateQueries({ queryKey: ["chatThreads"] }))
      .catch(() => {});
  }, [messages, thread.id, qc]);

  // Stick to the bottom, as a chat should.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    toBottom();
    // A decrypted photo renders after this runs and makes the thread taller,
    // so follow it down. `load` doesn't bubble — hence capture.
    el.addEventListener("load", toBottom, true);
    return () => el.removeEventListener("load", toBottom, true);
  }, [messages.length, opened]);

  const mSend = useMutation({
    mutationFn: async (payload: { text: string; file?: { blob: Blob; name: string; mime: string; durationMs?: number }; kind: "TEXT" | "IMAGE" | "FILE" | "AUDIO" }) => {
      // Devices are fetched per send: someone who enrolled a minute ago should
      // still be able to read this message.
      const { devices } = await api.chatThreadDevices(thread.id);
      const peers: PeerDevice[] = devices.map((d) => ({ id: d.id, publicKey: d.publicKey }));

      // Keys live on devices, so someone who has never opened PayTrack in a
      // browser has nothing to seal to. Say so plainly instead of letting the
      // message look delivered — there is no way to encrypt it to them later.
      if (!devices.some((d) => d.userId !== me.id)) {
        onToast(`${thread.other.name} hasn't opened PayTrack on any device yet — send this again once they have.`, true);
      }

      const sealed = await encryptMessage(me.id, peers, payload.text, payload.file);

      const form = new FormData();
      form.set("payload", JSON.stringify({
        threadId: thread.id,
        deviceId,
        kind: payload.kind,
        body: sealed.body,
        iv: sealed.iv,
        envelopes: sealed.envelopes,
        mediaMeta: sealed.mediaMeta,
        mediaIv: sealed.mediaIv,
        durationMs: payload.file?.durationMs,
      }));
      if (sealed.mediaBlob) form.set("media", sealed.mediaBlob, "blob.enc");
      return api.chatSend(form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chatMessages", thread.id] });
      qc.invalidateQueries({ queryKey: ["chatThreads"] });
    },
    onError: (e: Error) => onToast(e.message, true),
  });

  return (
    <div className="conv">
      <div className="convhead">
        <button className="convback" onClick={onBack} aria-label="Back"><IcBack /></button>
        <div className="chatav" style={{ background: colorFor(thread.other.name) }}>{initials(thread.other.name)}</div>
        <div className="convwho">
          <div className="convname">{thread.other.name}</div>
          <div className="convsub"><IcLock /> end-to-end encrypted</div>
        </div>
      </div>

      <div className="convbody" ref={scroller}>
        <div className="convnotice">
          <IcLock />
          Messages, files and voice notes in this chat are locked on your device. Nobody
          else — not the server, not an admin — can read them.
        </div>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || dayLabel(new Date(prev.createdAt)) !== dayLabel(new Date(m.createdAt));
          return (
            <div key={m.id}>
              {showDay && <div className="convday"><span>{dayLabel(new Date(m.createdAt))}</span></div>}
              <Bubble
                m={m}
                opened={opened[m.id]}
                sources={sources}
                individuals={individuals}
                canUseIndividuals={!!me.isApprover || !!me.isPayer}
                onToast={onToast}
              />
            </div>
          );
        })}
        {messages.length === 0 && !msgsQ.isLoading && (
          <div className="convempty">No messages yet — say something.</div>
        )}
      </div>

      <Composer busy={mSend.isPending} onSend={(p) => mSend.mutate(p)} onToast={onToast} />
    </div>
  );
}

/* ── turning a shorthand message into payments ─────────────────────── */
/**
 * People type their transfers as a list — "Peliswan to shvam : 15 lakhs" —
 * and someone then re-keys each one into the form. This spots those lines and
 * offers to raise them, so nobody retypes an amount.
 *
 * It only ever *offers*. The amounts are shown in full, in figures, before
 * anything is created, because a misread line must not quietly become money.
 * Parsing happens here in the browser: the server cannot read these messages.
 */
function TransferOffer({ messageId, text, sources, individuals, canUseIndividuals, onToast }: {
  messageId: string;
  text: string;
  sources: string[];
  individuals: Set<string>;
  /** Only the approver and the payer may raise a payment from a person. */
  canUseIndividuals: boolean;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const qc = useQueryClient();
  const transfers = useMemo(() => parseTransfers(text, sources), [text, sources]);
  // Read once, on the first render, rather than in an effect — this component
  // only ever mounts client-side, after a message has been decrypted.
  const [made, setMade] = useState<Record<number, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(`tfmade:${messageId}`);
      return saved ? (JSON.parse(saved) as Record<number, boolean>) : {};
    } catch {
      return {}; // private mode or blocked storage: the buttons simply reset
    }
  });
  const [busy, setBusy] = useState<number | "all" | null>(null);

  // Remember what was already raised from this message. Without it a reload
  // resets the buttons and a second tap quietly raises the same payment
  // twice — the kind of duplicate nobody notices until reconciliation.
  const memoKey = `tfmade:${messageId}`;

  const remember = useCallback((next: Record<number, boolean>) => {
    setMade(next);
    try { localStorage.setItem(memoKey, JSON.stringify(next)); } catch {}
  }, [memoKey]);

  // The server refuses an individual source from anyone but the approver or
  // payer, so don't offer a button here that is certain to be turned down.
  const blocked = useCallback(
    (t: ParsedTransfer) => individuals.has(t.from) && !canUseIndividuals,
    [individuals, canUseIndividuals],
  );

  const create = useCallback(async (t: ParsedTransfer) => {
    const form = new FormData();
    form.set("amount", t.amount.toString());
    form.set("payee", t.payee);
    form.set("payFrom", t.from);
    form.set("payFromType", individuals.has(t.from) ? "INDIVIDUAL" : "ACCOUNT");
    // The original line becomes the purpose, so the thread shows what was asked.
    form.set("purpose", t.raw.replace(/\s*\n\s*/g, " · "));
    form.set("dueDate", isoDay(0));
    await api.create(form);
  }, [individuals]);

  if (transfers.length === 0) return null;

  async function one(i: number) {
    if (busy !== null || made[i]) return;
    setBusy(i);
    try {
      await create(transfers[i]);
      remember({ ...made, [i]: true });
      qc.invalidateQueries({ queryKey: ["payments"] });
      onToast(`Added ${transfers[i].payee}`);
    } catch (e) {
      onToast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  async function all() {
    if (busy !== null) return;
    setBusy("all");
    let added = 0;
    let failed = 0;
    const done: Record<number, boolean> = {};
    for (let i = 0; i < transfers.length; i++) {
      if (made[i] || blocked(transfers[i])) continue;
      try {
        await create(transfers[i]);
        done[i] = true;
        added++;
      } catch {
        // Keep going: one line the server won't take must not block the rest.
        // The row stays un-added so it can be retried or fixed on its own.
        failed++;
      }
    }
    remember({ ...made, ...done });
    setBusy(null);
    qc.invalidateQueries({ queryKey: ["payments"] });
    if (added && failed) onToast(`${added} added · ${failed} couldn't be added`, true);
    else if (failed) onToast(failed === 1 ? "That one couldn't be added" : `${failed} couldn't be added`, true);
    else if (added) onToast(added === 1 ? "1 payment added" : `${added} payments added`);
  }

  const left = transfers.filter((t, i) => !made[i] && !blocked(t)).length;

  return (
    <div className="tfoffer">
      <div className="tfhead">
        <IcRupee />
        {transfers.length === 1 ? "Looks like a payment" : `Looks like ${transfers.length} payments`}
      </div>
      {transfers.map((t, i) => (
        <div key={i} className={`tfrow ${made[i] ? "done" : ""}`}>
          <div className="tfmid">
            <div className="tfpath">
              <b className={t.fromKnown ? "" : "unknown"}>{t.from}</b>
              <IcArrow />
              <span>{t.payee}</span>
            </div>
            <div className="tfamt">{fmtPaise(t.amount.toString())}</div>
            {!t.fromKnown && <div className="tfwarn">“{t.fromRaw}” isn&apos;t a Pay-from account — check it after adding.</div>}
            {blocked(t) && <div className="tfwarn">Only Jagat or the payer can raise a payment from a person.</div>}
          </div>
          <button className="tfbtn" disabled={busy !== null || made[i] || blocked(t)} onClick={() => one(i)}>
            {made[i] ? "Added" : blocked(t) ? "—" : busy === i ? "…" : "Add"}
          </button>
        </div>
      ))}
      {transfers.length > 1 && left > 1 && (
        <button className="tfall" disabled={busy !== null} onClick={all}>
          {busy === "all" ? "Adding…" : `Add all ${left}`}
        </button>
      )}
    </div>
  );
}

/* ── a message bubble ──────────────────────────────────────────────── */
function Bubble({ m, opened, sources, individuals, canUseIndividuals, onToast }: {
  m: ChatMessageLite;
  opened?: Opened;
  sources: string[];
  individuals: Set<string>;
  canUseIndividuals: boolean;
  onToast: (msg: string, err?: boolean) => void;
}) {
  return (
    <div className={`msg ${m.mine ? "mine" : ""}`}>
      <div className="msgb">
        {opened?.sealed ? (
          <div className="msgsealed"><IcLock /> {opened.sealed}</div>
        ) : !opened ? (
          <div className="msgsealed">Decrypting…</div>
        ) : (
          <>
            {m.hasMedia && opened.media && opened.contentKey && (
              <Media messageId={m.id} media={opened.media} contentKey={opened.contentKey}
                kind={m.kind} durationMs={m.durationMs} onToast={onToast} />
            )}
            {opened.text && <div className="msgtxt">{opened.text}</div>}
            {opened.text && (
              <TransferOffer
                messageId={m.id}
                text={opened.text}
                sources={sources}
                individuals={individuals}
                canUseIndividuals={canUseIndividuals}
                onToast={onToast}
              />
            )}
          </>
        )}
        <div className="msgtime">{fmtTime(m.createdAt)}{m.mine && <span className="msgtick">✓✓</span>}</div>
      </div>
    </div>
  );
}

/** Downloads the ciphertext once, decrypts it, and hands back an object URL. */
function useDecryptedBlob(
  messageId: string, media: MediaInfo, contentKey: CryptoKey, enabled: boolean,
): { url: string | null; error: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || url) return;
    let live = true;
    let made: string | null = null;
    api.chatMedia(messageId)
      .then((buf) => decryptMedia(contentKey, media, buf))
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (live) setError("Couldn't open this attachment."); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, messageId]);

  // In flight for as long as it has been asked for and neither finished nor failed.
  return { url, error, loading: enabled && !url && !error };
}

function Media({ messageId, media, contentKey, kind, durationMs, onToast }: {
  messageId: string; media: MediaInfo; contentKey: CryptoKey;
  kind: string; durationMs: number | null; onToast: (msg: string, err?: boolean) => void;
}) {
  // Images and voice notes load straight away; a document waits for a tap.
  const eager = kind === "IMAGE" || kind === "AUDIO";
  const [wanted, setWanted] = useState(eager);
  const { url, error, loading } = useDecryptedBlob(messageId, media, contentKey, wanted);

  if (error) return <div className="msgsealed">{error}</div>;

  if (kind === "IMAGE") {
    if (!url) return <div className="msgimg loading">{loading ? "Decrypting…" : ""}</div>;
    return (
      <a className="msgimg" href={url} target="_blank" rel="noreferrer" title={media.name}>
        { /* eslint-disable-next-line @next/next/no-img-element */ }
        <img src={url} alt={media.name} />
      </a>
    );
  }

  if (kind === "AUDIO") return <VoiceNote url={url} loading={loading} durationMs={durationMs} />;

  return (
    <button
      className="msgfile"
      onClick={() => {
        if (!url) { setWanted(true); onToast("Decrypting the file…"); return; }
        const a = document.createElement("a");
        a.href = url; a.download = media.name || "file";
        document.body.appendChild(a); a.click(); a.remove();
      }}
    >
      <div className="msgfileic"><IcDoc /></div>
      <div className="msgfilemid">
        <div className="msgfilename">{media.name || "File"}</div>
        <div className="msgfilesize">{loading ? "Decrypting…" : url ? "Tap to save" : prettySize(media.size)}</div>
      </div>
    </button>
  );
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function VoiceNote({ url, loading, durationMs }: { url: string | null; loading: boolean; durationMs: number | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = durationMs ?? 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setAt(el.currentTime * 1000);
    const onEnd = () => { setPlaying(false); setAt(0); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => { el.removeEventListener("timeupdate", onTime); el.removeEventListener("ended", onEnd); };
  }, [url]);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
  }

  const pct = total > 0 ? Math.min(100, (at / total) * 100) : 0;

  return (
    <div className="voice">
      <button className="voicebtn" onClick={toggle} disabled={!url} aria-label={playing ? "Pause" : "Play"}>
        {loading ? "…" : playing ? <IcPause /> : <IcPlay />}
      </button>
      <div className="voicewave">
        {/* A fixed set of bars, filled to match progress — a real waveform
            would mean decoding the audio, which isn't worth the battery. */}
        {Array.from({ length: 26 }).map((_, i) => (
          <i key={i} className={(i / 26) * 100 <= pct ? "on" : ""} style={{ height: `${6 + ((i * 7) % 13)}px` }} />
        ))}
      </div>
      <span className="voicetime">{mmss(at > 0 ? at : total)}</span>
      {url && <audio ref={audio} src={url} preload="metadata" />}
    </div>
  );
}

/* ── composer ──────────────────────────────────────────────────────── */
const MAX_MB = 10;

function Composer({ busy, onSend, onToast }: {
  busy: boolean;
  onSend: (p: { text: string; file?: { blob: Blob; name: string; mime: string; durationMs?: number }; kind: "TEXT" | "IMAGE" | "FILE" | "AUDIO" }) => void;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const rec = useRecorder(onToast);

  // Grow with the text, up to a few lines, then scroll inside.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = useCallback(() => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    onSend({ text: t, kind: "TEXT" });
  }, [text, busy, onSend]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { onToast(`Files must be under ${MAX_MB} MB.`, true); return; }
    onSend({
      text: text.trim(),
      file: { blob: f, name: f.name, mime: f.type || "application/octet-stream" },
      kind: f.type.startsWith("image/") ? "IMAGE" : "FILE",
    });
    setText("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function finishRecording() {
    const got = await rec.stop();
    if (!got) return;
    onSend({
      text: "",
      file: { blob: got.blob, name: `voice-${Date.now()}.webm`, mime: got.blob.type || "audio/webm", durationMs: got.durationMs },
      kind: "AUDIO",
    });
  }

  if (rec.recording) {
    return (
      <div className="composer recording">
        <button className="compbtn danger" onClick={() => void rec.cancel()} aria-label="Cancel recording">✕</button>
        <div className="reclive"><i /> Recording {mmss(rec.elapsed)}</div>
        <button className="compsend" onClick={() => void finishRecording()} aria-label="Send voice note"><IcSend /></button>
      </div>
    );
  }

  return (
    <div className="composer">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,audio/*,video/*,.doc,.docx,.xls,.xlsx,.csv,.txt"
        hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button className="compbtn" onClick={() => fileRef.current?.click()} aria-label="Attach a file" title="Attach"><IcClip /></button>
      <textarea
        ref={box}
        className="compin"
        value={text}
        placeholder="Message"
        rows={1}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      {text.trim() ? (
        <button className="compsend" onClick={send} disabled={busy} aria-label="Send"><IcSend /></button>
      ) : (
        <button className="compbtn mic" onClick={() => void rec.start()} aria-label="Record a voice note" title="Hold a conversation out loud"><IcMic /></button>
      )}
    </div>
  );
}

/** Microphone recording, kept in one place so the composer stays readable. */
function useRecorder(onToast: (msg: string, err?: boolean) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    mr.current?.stream.getTracks().forEach((t) => t.stop());
    mr.current = null;
    setRecording(false);
    setElapsed(0);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start();
      mr.current = r;
      started.current = Date.now();
      setRecording(true);
      timer.current = setInterval(() => setElapsed(Date.now() - started.current), 200);
    } catch {
      onToast("PayTrack needs microphone permission to record a voice note.", true);
    }
  }, [onToast]);

  const stop = useCallback(async (): Promise<{ blob: Blob; durationMs: number } | null> => {
    const r = mr.current;
    if (!r) return null;
    const durationMs = Date.now() - started.current;
    const blob = await new Promise<Blob>((resolve) => {
      r.onstop = () => resolve(new Blob(chunks.current, { type: r.mimeType || "audio/webm" }));
      r.stop();
    });
    cleanup();
    if (durationMs < 400) { onToast("That was too short to send.", true); return null; }
    return { blob, durationMs };
  }, [cleanup, onToast]);

  const cancel = useCallback(async () => {
    const r = mr.current;
    if (r) { r.onstop = null; try { r.stop(); } catch {} }
    cleanup();
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  return { recording, elapsed, start, stop, cancel };
}
