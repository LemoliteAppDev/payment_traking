"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, STATUS, STATUS_FILTERS, matchesStatus, PEOPLE, colorFor, initials, fmtPaise, wordsFromRupees, relDue, fmtShort, fmtStamp, fmtTime, dayLabel, isoDay, timeAgo, listSortKey,
  type Card, type Detail, type Effective, type EventLite, type UserLite, type MeUser, type TeamUser, type Role, type NotificationItem, type OtpMsg, type PayAccountLite, type PrivateMemberLite, type PersonAlerts, type TestResult, type StatusFilter,
} from "@/lib/client";
import { signOutAction } from "@/app/actions";
import { enablePush, isPushEnabled, pushSupported, pushBlocked } from "@/lib/push-client";
import { notifyFx, primeAlertFx } from "@/lib/alert-fx";
import { RemindersPanel } from "@/components/Reminders";
import { ChatPanel, useChatDevice } from "@/components/Chat";

/* ── tiny inline icons (match the prototype) ───────────────────────── */
const IcSearch = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>);
const IcPlus = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>);
const IcBack = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg>);
const IcInfo = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>);
const IcCheck = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>);
const IcClock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>);
const IcUpload = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>);
const IcEdit = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></svg>);
const IcTrash = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></svg>);
const IcBell = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>);
const IcCalendar = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>);
const IcReturn = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-4" /></svg>);
const IcMore = () => (<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>);
const IcResubmit = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V7m0 0l-5 5m5-5l5 5" /><path d="M5 4h14" /></svg>);

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));

// Opens the full-screen image lightbox (provided at the app root).
const ImageViewerCtx = createContext<(src: string, name: string) => void>(() => {});

export function PayTrackApp() {
  const qc = useQueryClient();
  // Three tabs now: All (payments), Chat, Reminders. Inside All, the old
  // Waiting/Paid/Mine chips became one status dropdown.
  const [tab, setTab] = useState<TabKey>("all");
  const [status, setStatus] = useState<StatusFilter>("waiting");
  const [chatThread, setChatThread] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [schedFor, setSchedFor] = useState<string | null>(null);
  const [paidFor, setPaidFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<Detail | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  const showToast = (msg: string, err = false) => setToast({ msg, err });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  // On narrow screens, selecting a payment shows the full-screen detail overlay
  // (CSS only reacts to `viewing` under the mobile breakpoint).
  useEffect(() => {
    const viewing = tab === "chat" ? !!chatThread : !!selected;
    document.body.classList.toggle("viewing", viewing);
    return () => document.body.classList.remove("viewing");
  }, [selected, tab, chatThread]);

  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me });
  const me = meQ.data?.me ?? null;
  const isPayer = me?.isPayer ?? false;
  const isApprover = me?.isApprover ?? false;
  const isManager = me?.isManager ?? false;
  const isAdmin = me?.isAdmin ?? false;
  // EMI reminders: Jignesh (manager), Jagat (approver), Mahesh (payer).
  const canSeeReminders = isManager || isApprover || isPayer;

  // When the acting user changes (e.g. after login), land everyone on the Waiting
  // tab, reset the selection, and drop any query cache from the previous user.
  // Tapping an EMI reminder push opens /?tab=reminders — honour that instead.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    if (me && me.id !== lastUserId.current) {
      const switched = lastUserId.current !== null;
      lastUserId.current = me.id;
      const wanted = new URLSearchParams(window.location.search).get("tab");
      const canRemind = me.isManager || me.isApprover || me.isPayer;
      // Tapping a reminder or chat push lands on that tab.
      const deep = !switched && (wanted === "reminders" ? (canRemind ? "reminders" : null) : wanted === "chat" ? "chat" : null);
      setTab((deep as TabKey) ?? "all");
      setStatus("waiting");
      setSelected(null);
      setChatThread(null);
      if (switched) qc.invalidateQueries();
    }
  }, [me, qc]);

  // Poll every 10s so new requests / status changes appear without a refresh.
  const listQ = useQuery({
    queryKey: ["payments"],
    queryFn: () => api.list("all", ""),
    enabled: !!me,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const all = useMemo(() => listQ.data?.payments ?? [], [listQ.data]);

  // Badge count for the Reminders tab: how many are inside their window.
  const remindersQ = useQuery({
    queryKey: ["reminders"],
    queryFn: api.reminders,
    enabled: !!me && canSeeReminders,
    refetchInterval: 30000,
  });
  const remindersDue = (remindersQ.data?.reminders ?? []).filter((r) => r.status === "PENDING" && r.inWindow).length;

  // Enrol this browser's chat key as soon as the app loads — not when the Chat
  // tab is first opened. A browser with no key on file can be written to but
  // not read on, because there would be no envelope for it.
  const { deviceId: chatDeviceId, error: chatDeviceError } = useChatDevice(me);

  // Unread badge for the Chat tab. No deviceId: the count needs no envelopes,
  // so the previews stay sealed for this call.
  const chatUnreadQ = useQuery({
    queryKey: ["chatUnread"],
    queryFn: () => api.chatThreads(null),
    enabled: !!me,
    refetchInterval: 15000,
  });
  const chatUnread = chatUnreadQ.data?.unread ?? 0;

  const detailQ = useQuery({
    queryKey: ["payment", selected],
    queryFn: () => api.get(selected as string),
    enabled: !!selected,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["payments"] }); if (selected) qc.invalidateQueries({ queryKey: ["payment", selected] }); };

  function select(id: string) { setSelected(id); }
  function backToList() { setSelected(null); }

  // ── mutations ──
  const mSchedule = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => api.schedule(id, date),
    onSuccess: (d) => { refresh(); setSchedFor(null); showToast("Saved · will pay on " + fmtShort(d.payment.scheduledFor ?? "")); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mPay = useMutation({
    mutationFn: ({ id, form }: { id: string; form: FormData }) => api.pay(id, form, uuid()),
    onSuccess: (d) => { refresh(); setPaidFor(null); showToast("Marked paid · " + d.payment.requestedBy.name + " will check it"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mConfirm = useMutation({
    mutationFn: (id: string) => api.confirm(id, uuid()),
    onSuccess: () => { refresh(); showToast("Thank you · payment finished"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mHold = useMutation({
    mutationFn: (id: string) => api.hold(id),
    onSuccess: () => { refresh(); showToast("Put on hold"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mNudge = useMutation({
    mutationFn: (id: string) => api.nudge(id),
    onSuccess: () => { refresh(); showToast("Nudge sent to the payer"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mCreate = useMutation({
    mutationFn: (form: FormData) => api.create(form),
    onSuccess: (d) => { setNewOpen(false); refresh(); setSelected(d.payment.id); showToast(isAdmin ? "Payment added" : "Sent to Jagat for approval"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mApprove = useMutation({
    mutationFn: (id: string) => api.approve(id),
    onSuccess: () => { refresh(); showToast("Approved · sent to the payer"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mReject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.reject(id, reason),
    onSuccess: () => { refresh(); setRejectFor(null); showToast("Returned to the person who raised it"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mResubmit = useMutation({
    mutationFn: (id: string) => api.resubmit(id),
    onSuccess: () => { refresh(); showToast("Resubmitted for approval"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mEdit = useMutation({
    mutationFn: ({ id, form }: { id: string; form: FormData }) => api.edit(id, form),
    onSuccess: (d) => { refresh(); setEditFor(null); setSelected(d.payment.id); showToast("Changes saved"); },
    onError: (e: Error) => showToast(e.message, true),
  });
  const mDelete = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["payments"] }); showToast("Payment deleted"); },
    onError: (e: Error) => showToast(e.message, true),
  });

  // ── derived list ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => {
        if (q) {
          const hay = `${p.payee} ${p.purpose} ${p.amount} ${p.requestedBy.name} ${p.payFrom}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return matchesStatus(p, status);
      })
      // Waiting: newest-added first, no priority tiers. Paid/Done: last paid
      // first. Everything else: today → by due date → awaiting → paid/done.
      .sort((a, b) => {
        if (status === "waiting") return +new Date(b.createdAt) - +new Date(a.createdAt);
        if (status === "paid" || status === "confirmed") {
          return +new Date(b.paidAt ?? b.createdAt) - +new Date(a.paidAt ?? a.createdAt);
        }
        const [ta, da] = listSortKey(a), [tb, db] = listSortKey(b);
        if (ta !== tb) return ta - tb;
        if (ta === 1 && da !== db) return da - db;
        return +new Date(b.createdAt) - +new Date(a.createdAt);
      });
  }, [all, status, search]);

  // How many payments sit behind each dropdown option, so the count is visible
  // before you pick it.
  const statusCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key] of STATUS_FILTERS) out[key] = all.filter((p) => matchesStatus(p, key)).length;
    return out;
  }, [all]);

  const tabCounts = useMemo(() => ({
    all: all.filter((p) => matchesStatus(p, "waiting")).length,
    chat: chatUnread,
    reminders: remindersDue,
  }), [all, chatUnread, remindersDue]);

  const detail = detailQ.data?.payment ?? null;
  // Reminders take over the whole pane. Chat keeps the two-pane shape, with
  // the conversation where the payment detail normally sits.
  const showReminders = tab === "reminders" && canSeeReminders;
  const showChat = tab === "chat";

  // Sync the mobile stat-strip dots to scroll position.
  useEffect(() => {
    const strip = document.querySelector<HTMLElement>(".strip");
    const dots = Array.from(document.querySelectorAll<HTMLElement>("#stripDots i"));
    if (!strip || !dots.length) return;
    const update = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const idx = max <= 1 ? 0 : Math.round((strip.scrollLeft / max) * (dots.length - 1));
      dots.forEach((d, i) => d.classList.toggle("on", i === idx));
    };
    strip.addEventListener("scroll", update, { passive: true });
    update();
    return () => strip.removeEventListener("scroll", update);
  }, [all.length, isPayer]);

  return (
    <ImageViewerCtx.Provider value={(src, name) => setLightbox({ src, name })}>
      <div className="frame">
        <div className="screen">
          <TopBar me={me} onSignOut={() => signOutAction()} onAdd={() => setNewOpen(true)} onToast={showToast} onOpenPayment={(id) => setSelected(id)} onTeam={(isManager || isAdmin) ? () => setTeamOpen(true) : undefined} />
          {me && <NotifyPrompt onToast={showToast} />}
          <RemindBanner show={isPayer} all={all} />
          {/* The summary strip is the payer's dashboard — hidden for admins & users. */}
          {isPayer && <>
            <StatStrip all={all} isPayer={isPayer} isApprover={isApprover} isAdmin={isAdmin} />
            <div className="dots" id="stripDots"><i className="on" /><i /><i /><i /></div>
          </>}

          <Tabs
            tab={tab}
            counts={tabCounts}
            showReminders={canSeeReminders}
            onPick={(t) => {
              setTab(t);
              // Leaving a tab drops whatever it had open, so the mobile overlay
              // can't end up sitting on top of the wrong thing.
              if (t !== "all") setSelected(null);
              if (t !== "chat") setChatThread(null);
            }}
          />

          <div className={`body ${showReminders ? "remmode" : ""} ${showChat ? "chatmode" : ""}`}>
            {showChat ? (
              <ChatPanel
                me={me}
                deviceId={chatDeviceId}
                deviceError={chatDeviceError}
                openThreadId={chatThread}
                onOpenThread={setChatThread}
                onToast={showToast}
              />
            ) : (
             <>
              <div className="listcol">
                {!showReminders && (
                  <>
                    <div className="search">
                      <IcSearch />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payee, purpose, amount…" />
                    </div>
                    <StatusSelect value={status} counts={statusCounts} onPick={setStatus} />
                  </>
                )}
              {showReminders ? (
                <RemindersPanel me={me} onToast={showToast} />
              ) : (
                <>
                  <div className="list">
                    {filtered.length === 0 ? (
                      <div className="empty" style={{ height: "100%" }}><div><div className="big">✓</div><h3>Nothing here</h3><p>No payments with this status.</p></div></div>
                    ) : filtered.map((p) => (
                      <PaymentCard key={p.id} p={p} selected={selected === p.id} onClick={() => select(p.id)} />
                    ))}
                  </div>
                  <div className="mobbar"><button className="btn btn-primary" onClick={() => setNewOpen(true)}><IcPlus />Add a payment</button></div>
                </>
              )}
            </div>

            <div className="detailcol">
              <div className="detail">
                <PaymentDetail
                  detail={detail}
                  me={me}
                  loading={!!selected && detailQ.isLoading}
                  onBack={backToList}
                  onSchedule={(id) => setSchedFor(id)}
                  onPay={(id) => setPaidFor(id)}
                  onHold={(id) => mHold.mutate(id)}
                  onConfirm={(id) => mConfirm.mutate(id)}
                  onNudge={(id) => mNudge.mutate(id)}
                  onApprove={(id) => mApprove.mutate(id)}
                  onReject={(id) => setRejectFor(id)}
                  onResubmit={(id) => mResubmit.mutate(id)}
                  onEdit={(p) => setEditFor(p)}
                  onDelete={(id) => { if (window.confirm("Delete this payment permanently? This can't be undone.")) mDelete.mutate(id); }}
                />
              </div>
            </div>
             </>
            )}
          </div>

          {newOpen && <NewSheet onClose={() => setNewOpen(false)} onSubmit={(f) => mCreate.mutate(f)} busy={mCreate.isPending} onError={(m) => showToast(m, true)} canUseIndividuals={isApprover || isPayer} />}
          {editFor && <NewSheet initial={editFor} onClose={() => setEditFor(null)} onSubmit={(f) => mEdit.mutate({ id: editFor.id, form: f })} busy={mEdit.isPending} onError={(m) => showToast(m, true)} canUseIndividuals={isApprover || isPayer} />}
          {schedFor && <ScheduleSheet onClose={() => setSchedFor(null)} onSubmit={(date) => mSchedule.mutate({ id: schedFor, date })} busy={mSchedule.isPending} />}
          {paidFor && <PaidSheet onClose={() => setPaidFor(null)} onSubmit={(f) => mPay.mutate({ id: paidFor, form: f })} busy={mPay.isPending} onError={(m) => showToast(m, true)} />}
          {rejectFor && <RejectSheet onClose={() => setRejectFor(null)} onSubmit={(reason) => mReject.mutate({ id: rejectFor, reason })} busy={mReject.isPending} />}
          {teamOpen && <TeamSheet onClose={() => setTeamOpen(false)} onToast={showToast} isManager={isManager} isAdmin={isAdmin} />}
          {(isApprover || isPayer) && <OtpFab />}

          <div className={`toast ${toast ? "on" : ""} ${toast?.err ? "err" : ""}`}>
            {!toast?.err && <IcCheck />}<span>{toast?.msg}</span>
          </div>
        </div>
      </div>
      <Lightbox img={lightbox} onClose={() => setLightbox(null)} onToast={showToast} />
    </ImageViewerCtx.Provider>
  );
}

/* Full-screen image viewer (WhatsApp-style) with Share + Download. */
function Lightbox({ img, onClose, onToast }: { img: { src: string; name: string } | null; onClose: () => void; onToast: (m: string, err?: boolean) => void }) {
  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [img, onClose]);
  if (!img) return null;
  const name = img.name || "image.png";
  const src = img.src;

  function doDownload() {
    const a = document.createElement("a");
    a.href = src; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function doShare() {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type || "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: name });
      } else {
        doDownload();
        onToast("Downloaded — share it from your files/gallery");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") { doDownload(); }
    }
  }

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lbbar" onClick={(e) => e.stopPropagation()}>
        <button className="lbbtn" onClick={doShare} title="Share">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
          Share
        </button>
        <button className="lbbtn" onClick={doDownload} title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
          Download
        </button>
        <button className="lbbtn lbx" onClick={onClose} title="Close">✕</button>
      </div>
      { /* eslint-disable-next-line @next/next/no-img-element */ }
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} />
      <div className="lbname" onClick={(e) => e.stopPropagation()}>{name}</div>
    </div>
  );
}

/* ── top bar ───────────────────────────────────────────────────────── */
function roleLabel(me: MeUser | null): string {
  if (!me) return "…";
  if (me.isPayer) return "You pay the bills";
  if (me.isApprover) return "You approve requests";
  if (me.isManager) return "You manage the team";
  if (me.isAdmin) return "Admin";
  return "You raise payments";
}
function TopBar({ me, onSignOut, onAdd, onToast, onOpenPayment, onTeam }: { me: MeUser | null; onSignOut: () => void; onAdd: () => void; onToast: (msg: string, err?: boolean) => void; onOpenPayment: (id: string) => void; onTeam?: () => void }) {
  return (
    <header className="topbar">
      <div className="logo"><div className="mark">₹</div><div>PayTrack <small style={{ display: "block" }}>Go DinDin</small></div></div>
      <div className="spacer" />
      {onTeam && (
        <button className="teambtn" onClick={onTeam} title="Manage team">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
          <span>Team</span>
        </button>
      )}
      <button className="btn btn-primary addbtn" onClick={onAdd}><IcPlus />Add a payment</button>
      <NotificationBell onToast={onToast} onOpenPayment={onOpenPayment} />
      <div className="me">
        <div className="avatar" style={{ background: colorFor(me?.name ?? "") }}>{me ? initials(me.name) : "?"}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "12.5px" }}>{me?.name ?? "…"}</div>
          <div className="role">{roleLabel(me)}</div>
        </div>
        <button className="signout" onClick={onSignOut} title="Sign out" aria-label="Sign out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 17l5-5-5-5M21 12H9M12 19H5a2 2 0 01-2-2V7a2 2 0 012-2h7" /></svg>
        </button>
      </div>
    </header>
  );
}

/* One notification row — tap to open, swipe left (or ✕ on desktop) to remove. */
function NotifItem({ n, onOpen, onDismiss }: { n: NotificationItem; onOpen: () => void; onDismiss: () => void }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const swiping = useRef(false);

  function remove() { setGone(true); setTimeout(onDismiss, 200); }

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return;
    const dX = e.touches[0].clientX - startX.current;
    const dY = e.touches[0].clientY - (startY.current ?? 0);
    if (!swiping.current) {
      if (Math.abs(dX) > 8 && Math.abs(dX) > Math.abs(dY)) swiping.current = true;
      else return;
    }
    setDx(Math.max(-160, Math.min(0, dX)));
  }
  function onTouchEnd() {
    if (dx < -80) remove();
    else setDx(0);
    startX.current = null;
  }

  return (
    <div className={`npitemwrap ${gone ? "gone" : ""}`}>
      <div className="npdel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-1 0v14H9V6M10 11v5M14 11v5" /></svg>
        Remove
      </div>
      <button
        className={`npitem ${n.unread ? "un" : ""}`}
        style={{ transform: `translateX(${dx}px)`, transition: startX.current === null ? "transform .18s ease" : "none" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => { if (!swiping.current) onOpen(); }}
      >
        <div className="npav" style={{ background: colorFor(n.actor?.name ?? "") }}>{initials(n.actor?.name ?? "?")}</div>
        <div className="npbody">
          <div className="npmsg">{n.message}</div>
          <div className="npmeta">{n.payment.payee} · {fmtPaise(n.payment.amount)} · {timeAgo(n.createdAt)}</div>
        </div>
        <span className="npx" role="button" aria-label="Remove" onClick={(e) => { e.stopPropagation(); remove(); }}>✕</span>
      </button>
    </div>
  );
}

/* Notification centre: bell + unread badge, opens a panel of recent activity.
   The browser-push toggle lives inside the panel so there's one control. */
function NotificationBell({ onToast, onOpenPayment }: { onToast: (msg: string, err?: boolean) => void; onOpenPayment: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<"loading" | "on" | "off" | "blocked" | "unsupported">("loading");
  const [testing, setTesting] = useState(false);

  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 10000 });
  const allItems = useMemo(() => notifQ.data?.items ?? [], [notifQ.data]);

  // Swipe-dismissed notifications, remembered per device (they're a derived feed,
  // so there's nothing to delete server-side — we just hide them here).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setDismissed(new Set(JSON.parse(localStorage.getItem("dismissedNotifs") || "[]"))); } catch {}
  }, []);
  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem("dismissedNotifs", JSON.stringify([...next].slice(-300))); } catch {}
      return next;
    });
  }

  const items = allItems.filter((n) => !dismissed.has(n.id));
  const unread = items.filter((n) => n.unread).length;

  // Chime + buzz when something new lands. The first poll only seeds the set —
  // opening the app is not "new activity".
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!allItems.length && !notifQ.data) return;
    const seen = seenIds.current;
    if (seen === null) { seenIds.current = new Set(allItems.map((n) => n.id)); return; }
    let fresh = false;
    for (const n of allItems) if (!seen.has(n.id)) { seen.add(n.id); fresh = true; }
    if (fresh) notifyFx();
  }, [allItems, notifQ.data]);

  // Audio needs a user gesture first; and a push arriving while the tab is open
  // is announced by the service worker (the OS often stays silent then).
  useEffect(() => {
    primeAlertFx();
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "paytrack-notify") {
        notifyFx();
        qc.invalidateQueries({ queryKey: ["notifications"] });
        qc.invalidateQueries({ queryKey: ["payments"] });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [qc]);

  const markRead = useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!pushSupported()) { setPush("unsupported"); return; }
    if (pushBlocked()) { setPush("blocked"); return; }
    isPushEnabled().then((v) => setPush(v ? "on" : "off"));
  }, []);

  // Close when clicking outside the bell/panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".notifwrap")) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markRead.mutate();
  }

  async function enablePushNow() {
    setPush("loading");
    const r = await enablePush();
    if (r === "enabled") { setPush("on"); onToast("Browser alerts are on"); }
    else if (r === "denied") { setPush("blocked"); onToast("Alerts blocked in browser settings", true); }
    else if (r === "blocked-service") { setPush("off"); onToast("This browser blocks push. In Brave, enable 'Google services for push messaging'.", true); }
    else { setPush("off"); onToast("Couldn't turn on browser alerts — try Chrome.", true); }
  }

  /* Prove the alert works on *this* device: chime and buzz right away, then
     send a real push so the closed-app banner is checked too. */
  async function testMine() {
    setTesting(true);
    notifyFx(true);
    try {
      const { results } = await api.pushTest({ scope: "me" });
      const r = results[0];
      if (!r || r.miss === "no-device") onToast("Chimed and buzzed. No device registered yet for closed-app alerts.", true);
      else if (r.miss === "not-configured") onToast("Chimed and buzzed. Closed-app alerts aren't set up on the server.", true);
      else if (r.delivered > 0) onToast(`Chimed and buzzed — test alert sent to ${r.delivered} device${r.delivered > 1 ? "s" : ""}.`);
      else onToast("Chimed and buzzed, but the device push failed — turn alerts off and on again.", true);
    } catch (e) {
      onToast((e as Error).message, true);
    }
    setTesting(false);
  }

  return (
    <div className="notifwrap">
      <button className="bell" onClick={toggle} title="Notifications" aria-label="Notifications" data-on={unread > 0 ? "1" : undefined}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {unread > 0 && <span className="badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notifmodal" onClick={() => setOpen(false)}>
        <div className="notifpanel" onClick={(e) => e.stopPropagation()}>
          <div className="nphead">
            <strong>Notifications</strong>
            <div className="npheadr">
              {unread > 0 && <button onClick={() => markRead.mutate()}>Mark all read</button>}
              <button className="npclose" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          {push === "off" && (
            <button className="npush" onClick={enablePushNow}>🔔 Also alert me when the app is closed</button>
          )}
          {push === "blocked" && <div className="npush blocked">Browser alerts are blocked in your browser settings</div>}
          <button className="npush ntest" onClick={testMine} disabled={testing}>
            {testing ? "Testing…" : "🔊 Test sound & vibration"}
          </button>

          <div className="nplist">
            {items.length === 0 ? (
              <div className="npempty">Nothing yet — you&apos;ll see activity here.</div>
            ) : (
              items.map((n) => (
                <NotifItem
                  key={n.id}
                  n={n}
                  onOpen={() => { onOpenPayment(n.payment.id); setOpen(false); }}
                  onDismiss={() => dismiss(n.id)}
                />
              ))
            )}
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

/* ── reminder banner (payer) ───────────────────────────────────────── */
/* Prominent one-click prompt to turn on notifications (shown until enabled). */
function NotifyPrompt({ onToast }: { onToast: (msg: string, err?: boolean) => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pushSupported() || pushBlocked()) return;
    if (sessionStorage.getItem("notifPromptDismissed")) return;
    isPushEnabled().then((on) => { if (!on) setShow(true); });
  }, []);
  if (!show) return null;

  async function enable() {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (r === "enabled") { setShow(false); onToast("Notifications are on"); }
    else if (r === "denied") { setShow(false); onToast("You blocked notifications — allow them in your browser's site settings.", true); }
    else if (r === "blocked-service") { onToast("This browser blocks push. In Brave, enable 'Google services for push messaging'.", true); }
    else { onToast("Couldn't turn on notifications — try Chrome.", true); }
  }
  function dismiss() { sessionStorage.setItem("notifPromptDismissed", "1"); setShow(false); }

  return (
    <div className="notifprompt">
      <span className="np-ic">🔔</span>
      <span className="np-txt">Turn on notifications so you don&apos;t miss a payment — even when PayTrack is closed.</span>
      <button className="btn btn-primary np-enable" onClick={enable} disabled={busy}>{busy ? "…" : "Enable"}</button>
      <button className="np-x" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

function RemindBanner({ show, all }: { show: boolean; all: Card[] }) {
  const pend = all.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status)).length;
  const [cd, setCd] = useState(15 * 60);
  useEffect(() => {
    if (!show || !pend) return;
    const t = setInterval(() => setCd((s) => (s <= 0 ? 15 * 60 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [show, pend]);
  if (!show || !pend) return <div className="remind" />;
  const m = Math.floor(cd / 60), s = cd % 60;
  return (
    <div className="remind show">
      <span>⏰ <b>{pend} payment{pend > 1 ? "s" : ""}</b> still to pay — reminder every 15 min</span>
      <span className="cd">{m}:{String(s).padStart(2, "0")}</span>
    </div>
  );
}

/* ── stat strip ────────────────────────────────────────────────────── */
function sumPaise(cards: Card[]): string {
  return fmtPaise(cards.reduce((s, p) => s + BigInt(p.amount), 0n).toString());
}
function StatStrip({ all, isPayer, isApprover, isAdmin }: { all: Card[]; isPayer: boolean; isApprover: boolean; isAdmin: boolean }) {
  let cards: { lab: string; val: string | number; sub: string; ac: string; tint: string; ic: string }[];
  const toApprove = all.filter((p) => p.status === "AWAITING_APPROVAL");
  if (isPayer) {
    const pend = all.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status));
    const over = all.filter((p) => p.effective === "OVERDUE");
    cards = [
      { lab: "To pay", val: sumPaise(pend), sub: `${pend.length} waiting`, ac: "var(--brand)", tint: "var(--brand-soft)", ic: "💰" },
      { lab: "To approve", val: toApprove.length, sub: toApprove.length ? "awaiting Jagat" : "all clear", ac: "var(--hold)", tint: "var(--hold-soft)", ic: "🕵️" },
      { lab: "Late", val: over.length, sub: over.length ? sumPaise(over) : "none late", ac: "var(--over)", tint: "var(--over-soft)", ic: "⚠️" },
      { lab: "Done", val: all.filter((p) => ["PAID", "CONFIRMED"].includes(p.status)).length, sub: "proof saved", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "✅" },
    ];
  } else if (isApprover) {
    const pend = all.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status));
    cards = [
      { lab: "To approve", val: toApprove.length, sub: toApprove.length ? sumPaise(toApprove) : "all clear", ac: "var(--hold)", tint: "var(--hold-soft)", ic: "🕵️" },
      { lab: "With payer", val: pend.length, sub: "being paid", ac: "var(--brand)", tint: "var(--brand-soft)", ic: "💰" },
      { lab: "Returned", val: all.filter((p) => p.status === "RETURNED").length, sub: "sent back", ac: "var(--over)", tint: "var(--over-soft)", ic: "↩️" },
      { lab: "Done", val: all.filter((p) => ["PAID", "CONFIRMED"].includes(p.status)).length, sub: "finished", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "✅" },
    ];
  } else if (isAdmin) {
    const pend = all.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status));
    const over = all.filter((p) => p.effective === "OVERDUE");
    cards = [
      { lab: "In progress", val: pend.length, sub: pend.length ? sumPaise(pend) : "none", ac: "var(--brand)", tint: "var(--brand-soft)", ic: "💰" },
      { lab: "Awaiting approval", val: toApprove.length, sub: toApprove.length ? "with Jagat" : "all clear", ac: "var(--hold)", tint: "var(--hold-soft)", ic: "🕵️" },
      { lab: "Late", val: over.length, sub: over.length ? "overdue" : "on time", ac: "var(--over)", tint: "var(--over-soft)", ic: "⚠️" },
      { lab: "Done", val: all.filter((p) => ["PAID", "CONFIRMED"].includes(p.status)).length, sub: "finished", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "✅" },
    ];
  } else {
    const mine = all.filter((p) => p.mine);
    const returned = mine.filter((p) => p.status === "RETURNED");
    const toConf = mine.filter((p) => p.status === "PAID");
    cards = [
      { lab: "For approval", val: mine.filter((p) => p.status === "AWAITING_APPROVAL").length, sub: "with Jagat", ac: "var(--hold)", tint: "var(--hold-soft)", ic: "🕵️" },
      { lab: "Fix these", val: returned.length, sub: returned.length ? "edit & resubmit" : "none", ac: "var(--over)", tint: "var(--over-soft)", ic: "↩️" },
      { lab: "Check", val: toConf.length, sub: toConf.length ? "say you got it" : "none to check", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "👀" },
      { lab: "Done", val: mine.filter((p) => p.status === "CONFIRMED").length, sub: "finished", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "✅" },
    ];
  }
  return (
    <section className="strip">
      {cards.map((c, i) => (
        <div key={i} className="stat" style={{ "--ac": c.ac } as React.CSSProperties}>
          <div className="top"><span className="sic" style={{ background: c.tint }}>{c.ic}</span><span className="lab">{c.lab}</span></div>
          <div className="val grotesk">{c.val}</div>
          <div className="sub">{c.sub}</div>
        </div>
      ))}
    </section>
  );
}
const fmtISODate = (iso: string) => iso.slice(0, 10);

/* ── filters ───────────────────────────────────────────────────────── */
/* ── the three tabs ────────────────────────────────────────────────── */
export type TabKey = "all" | "chat" | "reminders";

const TAB_LABELS: [TabKey, string][] = [["all", "All"], ["chat", "Chat"], ["reminders", "Reminders"]];

function Tabs({ tab, counts, onPick, showReminders }: {
  tab: TabKey; counts: Record<string, number>; onPick: (t: TabKey) => void; showReminders: boolean;
}) {
  // Reminders are the manager / approver / payer only — the server enforces
  // that too; this just hides the tab.
  const tabs = TAB_LABELS.filter(([k]) => k !== "reminders" || showReminders);
  return (
    <div className="tabbar" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k}
          className={`tabbtn ${tab === k ? "on" : ""}`} onClick={() => onPick(k)}>
          {l}
          {counts[k] > 0 && <span className="tabn">{counts[k] > 99 ? "99+" : counts[k]}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── status dropdown (was the Waiting / Paid / All / Mine chips) ───── */
function StatusSelect({ value, counts, onPick }: {
  value: StatusFilter; counts: Record<string, number>; onPick: (f: StatusFilter) => void;
}) {
  return (
    <div className="statuspick">
      <select value={value} onChange={(e) => onPick(e.target.value as StatusFilter)} aria-label="Filter by status">
        {STATUS_FILTERS.map(([k, l]) => (
          <option key={k} value={k}>{l} ({counts[k] ?? 0})</option>
        ))}
      </select>
      <span className="statuschev" aria-hidden>▾</span>
    </div>
  );
}

/* ── status pills ──────────────────────────────────────────────────── */
// One line icon per status, drawn on the same 24-grid as the rest of the app
// and inheriting the pill's colour. The design stays what the spec asks for —
// icon + word + colour — the icon is just no longer an emoji, which rendered
// differently on every device.
const STATUS_ICON: Record<Effective, () => React.ReactElement> = {
  // Needs approval — someone has to look at this person's request.
  AWAITING_APPROVAL: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 20v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1" /><circle cx="8" cy="7" r="3.5" /><path d="M16 11.5l2 2 4-4.5" /></svg>),
  RETURNED: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-4" /></svg>),
  REQUESTED: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12M6 22h12" /><path d="M8 2v4a4 4 0 004 4 4 4 0 004-4V2" /><path d="M8 22v-4a4 4 0 014-4 4 4 0 014 4v4" /></svg>),
  SCHEDULED: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>),
  PAID: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>),
  CONFIRMED: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>),
  HOLD: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 014.9.6c0 1.7-2.5 2.1-2.5 3.7" /><path d="M12 17h.01" /></svg>),
  CANCELLED: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg>),
  OVERDUE: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.6L2.6 20h18.8L12 3.6z" /><path d="M12 10v4" /><path d="M12 17.2h.01" /></svg>),
};

function StatusPill({ eff }: { eff: Effective }) {
  const s = STATUS[eff];
  const Ic = STATUS_ICON[eff];
  return <span className={`pill ${s.cls}`}><Ic />{s.lab}</span>;
}
function PaymentCard({ p, selected, onClick }: { p: Card; selected: boolean; onClick: () => void }) {
  const showDue = !(p.effective === "PAID" || p.effective === "CONFIRMED");
  const needsMe = p.mine && p.status === "PAID";
  const due = relDue(p.dueDate);
  return (
    <div className={`card ${selected ? "sel" : ""} ${needsMe ? "flag" : ""}`} onClick={onClick}>
      <div className="av" style={{ background: colorFor(p.requestedBy.name) }}>{initials(p.payee)}</div>
      <div className="mid">
        <div className="row1"><span className="payee">{p.payee}</span><span className="amt grotesk">{fmtPaise(p.amount)}</span></div>
        <div className="row2"><StatusPill eff={p.effective} />{p.payFromType === "INDIVIDUAL" && <span className="sourcetag">Individual</span>}{showDue && <span className="due" style={{ color: due.c }}>{due.t}</span>}</div>
        <div className="meta">{p.purpose}</div>
        <div className="submeta">from <b>{p.payFrom}</b> · {p.mine ? "you asked" : "by " + p.requestedBy.name}</div>
        <div className="cstamp"><IcClock />{fmtStamp(p.createdAt)}{p.editedAt ? ` · edited ${fmtStamp(p.editedAt)}` : ""}</div>
        {needsMe && <div className="flagline">✓ Paid — tap to say you got it</div>}
      </div>
    </div>
  );
}

/** Who may edit or delete this payment. The server enforces this too. */
function detailPerms(p: Detail, me: MeUser | null) {
  const mine = me?.id === p.requestedBy.id;
  return {
    mine,
    canEdit: mine && p.status !== "PAID" && p.status !== "CONFIRMED" && p.status !== "CANCELLED",
    canDelete: (mine || !!me?.isAdmin) && p.status !== "PAID" && p.status !== "CONFIRMED",
  };
}

/* ── detail ────────────────────────────────────────────────────────── */
interface DetailActions {
  onSchedule: (id: string) => void; onPay: (id: string) => void; onHold: (id: string) => void;
  onConfirm: (id: string) => void; onNudge: (id: string) => void;
  onApprove: (id: string) => void; onReject: (id: string) => void; onResubmit: (id: string) => void;
  onEdit: (p: Detail) => void; onDelete: (id: string) => void;
}
function PaymentDetail(props: { detail: Detail | null; me: MeUser | null; loading: boolean; onBack: () => void } & DetailActions) {
  const { detail: p, me } = props;
  const thread = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Open on the newest message, the way a chat does — the latest status and
  // the buttons that act on it are what you came for, not the first line.
  // Declared above the early return so the hook order never changes.
  const id = p?.id;
  const count = p?.events.length ?? 0;
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    toBottom();
    // A proof image arrives after the markup and makes the thread taller, so
    // one scroll on mount lands short. `load` doesn't bubble — hence capture.
    el.addEventListener("load", toBottom, true);
    return () => el.removeEventListener("load", toBottom, true);
  }, [id, count]);

  if (!p) {
    return (
      <div className="empty">
        <div>
          <div className="big"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B2" strokeWidth="1.6"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg></div>
          <h3>{props.loading ? "Loading…" : "Choose a payment"}</h3>
          <p>Pick one to see everything — what it&apos;s for, who paid, and the proof.</p>
        </div>
      </div>
    );
  }
  const eff = p.effective;
  const mine = me?.id === p.requestedBy.id;
  const due = relDue(p.dueDate);
  const showDue = !(eff === "PAID" || eff === "CONFIRMED");
  return (
    <>
      <button className="mobback" onClick={props.onBack}><IcBack />All payments</button>
      <div className="dhead">
        <div className="av" style={{ background: colorFor(p.requestedBy.name) }}>{initials(p.payee)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{p.payee}</h2>
          <div className="sub">{mine ? "You asked for this" : "Asked by " + p.requestedBy.name}</div>
          <div style={{ marginTop: 7, display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill eff={eff} />{p.payFromType === "INDIVIDUAL" && <span className="sourcetag">Individual</span>}{showDue && <span className="due" style={{ color: due.c }}>{due.t}</span>}
          </div>
          <div className="tstamp"><IcClock />Raised {fmtStamp(p.createdAt)}{p.editedAt ? ` · edited ${fmtStamp(p.editedAt)}` : ""}</div>
        </div>
        <div className="dright">
          <button className="dmore" onClick={() => setMenuOpen(true)} aria-label="Details and actions" title="Details and actions"><IcMore /></button>
          <div className="amt grotesk">{fmtPaise(p.amount)}<small>from {p.payFrom}</small></div>
        </div>
      </div>
      {p.upi && (
        <div className="frow">
          <div className="cell"><div className="k">Pay to</div><div className="v">{p.upi}</div></div>
        </div>
      )}
      <div className="thread" ref={thread}>
        {p.events.map((e, i) => {
          const prev = p.events[i - 1];
          const showDay = !prev || dayLabel(new Date(prev.createdAt)) !== dayLabel(new Date(e.createdAt));
          return (
            <div key={e.id}>
              {showDay && <div className="convday"><span>{dayLabel(new Date(e.createdAt))}</span></div>}
              <ThreadMsg ev={e} me={me} />
            </div>
          );
        })}
      </div>
      <ChatBox key={p.id} paymentId={p.id} />
      <Actions p={p} me={me} act={props} />
      {menuOpen && <PaymentMenu p={p} me={me} act={props} onClose={() => setMenuOpen(false)} />}
    </>
  );
}

function DRow({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="drow"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

/* The ⋯ menu. Holds the full details and the Edit / Delete actions, so neither
   the header nor the action bar has to carry them. */
function PaymentMenu({ p, me, act, onClose }: { p: Detail; me: MeUser | null; act: DetailActions; onClose: () => void }) {
  const { mine, canEdit, canDelete } = detailPerms(p, me);
  // "6d overdue" on a payment that is already paid is just wrong — once it is
  // settled the due date is history, so only the date is shown. The list and
  // the header drop the countdown the same way.
  const settled = p.status === "PAID" || p.status === "CONFIRMED" || p.status === "CANCELLED";
  const due = relDue(p.dueDate);
  return (
    <Sheet
      title="Payment details"
      onClose={onClose}
      foot={<>
        {canEdit && <button className="btn btn-ghost" onClick={() => { onClose(); act.onEdit(p); }}><IcEdit />Edit</button>}
        {canDelete && <button className="btn btn-ghost del" onClick={() => { onClose(); act.onDelete(p.id); }}><IcTrash />Delete</button>}
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </>}
    >
      <div className="dlist">
        <DRow k="Status" v={<StatusPill eff={p.effective} />} />
        <DRow k="Amount" v={fmtPaise(p.amount)} />
        <DRow k={p.payFromType === "INDIVIDUAL" ? "Individual" : "Pay from"} v={p.payFrom} />
        <DRow k="Pay to" v={p.upi || p.payee} />
        <DRow k="Purpose" v={p.purpose || "—"} />
        <DRow k="Due" v={settled ? fmtShort(p.dueDate) : <>{fmtShort(p.dueDate)} <span style={{ color: due.c }}>· {due.t}</span></>} />
        {p.scheduledFor && <DRow k="Planned for" v={fmtShort(p.scheduledFor)} />}
        <DRow k="Raised by" v={mine ? "You" : p.requestedBy.name} />
        <DRow k="Raised" v={fmtStamp(p.createdAt)} />
        {p.editedAt && <DRow k="Edited" v={fmtStamp(p.editedAt)} />}
        {p.paidAt && <DRow k="Paid" v={`${fmtStamp(p.paidAt)}${p.paidBy ? ` · ${p.paidBy.name}` : ""}`} />}
        {p.confirmedAt && <DRow k="Confirmed" v={`${fmtStamp(p.confirmedAt)}${p.confirmedBy ? ` · ${p.confirmedBy.name}` : ""}`} />}
      </div>
    </Sheet>
  );
}

/* Chat: anyone on a payment (raiser, approver, payer, admin) can message here. */
function ChatBox({ paymentId }: { paymentId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const m = useMutation({
    mutationFn: (msg: string) => api.postNote(paymentId, msg),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["payment", paymentId] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const send = () => { const t = text.trim(); if (t && !m.isPending) m.mutate(t); };
  return (
    <div className="composer">
      <input
        className="compin"
        placeholder="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
      />
      <button className="compsend" onClick={send} disabled={!text.trim() || m.isPending} aria-label="Send message">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
    </div>
  );
}

/* Secure OTP thread — approver <-> payer only. Collapsed by default; messages
   are blurred until tapped and auto-expire. Opened on demand so it stays private. */
function OtpMessageRow({ m }: { m: OtpMsg }) {
  const [show, setShow] = useState(false);
  const left = Math.max(0, Math.round((new Date(m.expiresAt).getTime() - Date.now()) / 60000));
  return (
    <div className={`otpmsg ${m.fromMe ? "me" : ""}`}>
      <div className="otphead">{m.fromMe ? "You" : m.senderName} · {timeAgo(m.createdAt)} · expires in {left}m</div>
      <button className={`otpbody ${show ? "shown" : ""}`} onClick={() => setShow((s) => !s)} title={show ? "Tap to hide" : "Tap to reveal"}>
        {show ? m.body : "•••••• tap to reveal"}
      </button>
    </div>
  );
}

function OtpFab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const q = useQuery({
    queryKey: ["otp"],
    queryFn: () => api.otpList(),
    refetchInterval: open ? 8000 : 20000, // light background poll so the badge shows up
  });
  const msgs = q.data?.messages ?? [];
  const m = useMutation({
    mutationFn: (msg: string) => api.otpSend(msg),
    onSuccess: (d) => { setText(""); qc.setQueryData(["otp"], d); },
  });
  const send = () => { const t = text.trim(); if (t && !m.isPending) m.mutate(t); };

  return (
    <>
      <button type="button" className="otpfab" onClick={() => setOpen(true)} aria-label="Secure OTP" title="Secure OTP — approver ↔ payer">
        🔒
        {msgs.length > 0 && <span className="otpfabdot">{msgs.length}</span>}
      </button>
      {open && (
        <div className="otpmodal" onClick={() => setOpen(false)}>
          <div className="otpcard" onClick={(e) => e.stopPropagation()}>
            <div className="otpcardhead">
              <span className="otptitle"><span className="otplock">🔒</span> Secure OTP <span className="otpsub">approver ↔ payer</span></span>
              <button className="npclose" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="otpnote">Private to the approver and payer. Encrypted, kept out of notifications, and gone after 10 minutes.</div>
            <div className="otplist">
              {msgs.length === 0
                ? <div className="otpempty">No messages yet. Share an OTP securely here.</div>
                : msgs.map((x) => <OtpMessageRow key={x.id} m={x} />)}
            </div>
            <div className="chatbox">
              <input className="chatin" placeholder="Type the OTP or a note…" value={text} autoComplete="off"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} />
              <button className="chatsend" onClick={send} disabled={!text.trim() || m.isPending} aria-label="Send securely">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const SYS_TYPES = new Set(["SCHEDULE", "CONFIRM", "HOLD", "CANCEL", "NUDGE", "REMINDER", "APPROVE", "RETURN", "RESUBMIT"]);
function ThreadMsg({ ev, me }: { ev: EventLite; me: MeUser | null }) {
  const who = ev.actor?.name ?? "System";
  // Status changes read as the centred grey notices WhatsApp uses for
  // "Messages are encrypted" — they are events, not something anyone said.
  if (SYS_TYPES.has(ev.type) && !ev.attachment) {
    const ic = ev.type === "CONFIRM" ? <IcCheck /> : <IcClock />;
    // A returned or cancelled payment carries the reason the person typed,
    // stored in their own words with no name attached. Unlabelled it reads as
    // the app talking, so say who it was.
    const named = !ev.actor || ev.message.includes(who);
    return (
      <div className="msg sys">
        <span className="sysline">
          {ic}
          {named ? ev.message : <span><b>{who}</b>: {ev.message}</span>}
        </span>
      </div>
    );
  }
  const mine = !!me && !!ev.actor && ev.actor.id === me.id;
  return (
    <div className={`msg ${mine ? "mine" : ""}`}>
      {/* Like a WhatsApp group: the other people get an avatar and a coloured
          name, your own messages need neither. */}
      {!mine && <div className="msgav" style={{ background: colorFor(who) }}>{initials(who)}</div>}
      <div className="msgb">
        {!mine && <div className="msgwho" style={{ color: PEOPLE[who] ?? "var(--ink-2)" }}>{who}</div>}
        {ev.attachment && <AttachmentView a={ev.attachment} />}
        {ev.message && <div className="msgtxt">{ev.message}</div>}
        <div className="msgtime">{fmtTime(ev.createdAt)}</div>
      </div>
    </div>
  );
}
function AttachmentView({ a }: { a: { id: string; kind: string; originalName: string; mimeType: string } }) {
  const href = `/api/v1/attachments/${a.id}`;
  const openImage = useContext(ImageViewerCtx);
  if (a.mimeType.startsWith("image/")) {
    return (
      <button type="button" className="msgimg" onClick={() => openImage(href, a.originalName)} title={a.originalName}>
        { /* eslint-disable-next-line @next/next/no-img-element */ }
        <img src={href} alt={a.originalName} loading="lazy" />
      </button>
    );
  }
  const label = a.mimeType === "application/pdf" ? "PDF" : "FILE";
  return (
    <a className="msgfile" href={href} target="_blank" rel="noreferrer">
      <div className="msgfileic" style={{ color: a.mimeType === "application/pdf" ? "var(--over)" : "var(--ink-2)" }}>{label}</div>
      <div className="msgfilemid">
        <div className="msgfilename">{a.originalName}</div>
        <div className="msgfilesize">{a.kind === "PROOF" ? "Proof of payment" : "Instruction"}</div>
      </div>
    </a>
  );
}

function Actions({ p, me, act }: { p: Detail; me: MeUser | null; act: DetailActions }) {
  const eff = p.effective;
  const isPayer = !!me?.isPayer;
  const isApprover = !!me?.isApprover;
  const mine = me?.id === p.requestedBy.id;
  let hint = ""; let btns: React.ReactNode = null;

  if (p.status === "AWAITING_APPROVAL") {
    if (isApprover) {
      hint = "Review this request — approve it, or send it back for changes.";
      btns = (<>
        <button className="btn btn-ghost" onClick={() => act.onReject(p.id)}><IcReturn />Return</button>
        <button className="btn btn-primary" onClick={() => act.onApprove(p.id)}><IcCheck />Approve</button>
      </>);
    } else if (mine) {
      hint = "Waiting for Jagat to approve. You can still edit it.";
    } else { hint = "Waiting for Jagat to approve."; }
  } else if (p.status === "RETURNED") {
    if (mine) {
      hint = "Jagat returned this for changes. Edit it, then resubmit.";
      btns = <button className="btn btn-primary" onClick={() => act.onResubmit(p.id)}><IcResubmit />Resubmit</button>;
    } else { hint = `Returned to ${p.requestedBy.name} for changes.`; }
  } else if (isPayer) {
    if (eff === "REQUESTED" || (eff === "OVERDUE" && p.status === "REQUESTED")) {
      hint = "Pick a day to pay, or pay it now.";
      btns = (<>
        <button className="btn btn-sched" onClick={() => act.onSchedule(p.id)}><IcCalendar />Pick a day</button>
        <button className="btn btn-paid" onClick={() => act.onPay(p.id)}><IcCheck />I paid this</button>
      </>);
    } else if (eff === "SCHEDULED" || (eff === "OVERDUE" && p.status === "SCHEDULED")) {
      hint = p.scheduledFor ? `Planned for ${fmtShort(p.scheduledFor)}.` : "A day is planned.";
      btns = <button className="btn btn-paid" onClick={() => act.onPay(p.id)}><IcCheck />I paid this</button>;
    } else if (eff === "HOLD") {
      hint = "Waiting on missing details before you can pay."; btns = <button className="btn btn-paid" onClick={() => act.onPay(p.id)}><IcCheck />I paid this</button>;
    } else if (eff === "PAID") {
      hint = `Paid. Now ${p.requestedBy.name} needs to say they got it.`;
    } else if (eff === "CONFIRMED") { hint = "All finished — paid and confirmed."; }
    else if (eff === "CANCELLED") { hint = "This payment was cancelled."; }
  } else {
    // requester / other admin view
    if (eff === "PAID" && mine) {
      hint = "Paid, with the proof attached. Look, then say you got it.";
      btns = <button className="btn btn-conf" onClick={() => act.onConfirm(p.id)}><IcCheck />Yes, I got it</button>;
    } else if (eff === "CONFIRMED") { hint = mine ? "You said you got it. All finished." : "Paid and confirmed — all finished."; }
    else if (eff === "CANCELLED") { hint = "This payment was cancelled."; }
    else if (eff === "PAID") { hint = `Paid — waiting for ${p.requestedBy.name} to confirm.`; }
    else {
      hint = mine ? "Approved — with the payer now. You'll be told as it changes." : `Raised by ${p.requestedBy.name}. With the payer now.`;
      btns = <button className="btn btn-sched" onClick={() => act.onNudge(p.id)}><IcBell />Send a reminder</button>;
    }
  }
  // Edit and Delete moved into the ⋯ menu, so this bar carries only the
  // decision the screen is asking for — on a phone that is one row, not three.
  return (
    <div className="actions">
      <span className="hint"><IcInfo />{hint}</span>
      {btns && <div className="actmain">{btns}</div>}
    </div>
  );
}

/* ── sheets ────────────────────────────────────────────────────────── */
/* While a sheet is open, Ctrl/⌘+V pastes a screenshot straight into it. */
function usePasteImage(onImage: (f: File) => void) {
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const named = f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}.png`, { type: f.type || "image/png" });
            onImage(named);
            e.preventDefault();
          }
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [onImage]);
}

function Sheet({ title, children, foot, onClose }: { title: string; children: React.ReactNode; foot: React.ReactNode; onClose: () => void }) {
  return (
    <div className="scrim on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="mhead"><h3>{title}</h3><div style={{ flex: 1 }} /><button className="x" onClick={onClose}>✕</button></div>
        <div className="mbody">{children}</div>
        <div className="mfoot">{foot}</div>
      </div>
    </div>
  );
}

type PaymentSourceType = "ACCOUNT" | "INDIVIDUAL";

/* Source picker — accounts for everyone, individual members for Jagat/payer. */
function PayFromField({
  value,
  sourceType,
  onValueChange,
  onTypeChange,
  canUseIndividuals,
}: {
  value: string;
  sourceType: PaymentSourceType;
  onValueChange: (v: string) => void;
  onTypeChange: (v: PaymentSourceType) => void;
  canUseIndividuals: boolean;
}) {
  const accountsQ = useQuery({ queryKey: ["payAccounts"], queryFn: api.payAccounts });
  const membersQ = useQuery({ queryKey: ["privateMembers"], queryFn: api.privateMembers, enabled: canUseIndividuals });
  const activeAccounts = useMemo(() => (accountsQ.data?.accounts ?? []).filter((a) => a.active), [accountsQ.data]);
  const activeMembers = useMemo(() => (membersQ.data?.members ?? []).filter((m) => m.active), [membersQ.data]);
  const active = sourceType === "INDIVIDUAL" ? activeMembers : activeAccounts;
  // Keep the current value selectable even if it's inactive/unknown (e.g. editing an old entry).
  const options = value && !active.some((a) => a.name === value) ? [value, ...active.map((a) => a.name)] : active.map((a) => a.name);

  // Default to the first source once the list loads and nothing is chosen yet.
  useEffect(() => {
    if (!value && active.length) onValueChange(active[0].name);
  }, [value, active, onValueChange]);

  function onChange(next: string) {
    onValueChange(next);
  }

  function switchType(next: PaymentSourceType) {
    onTypeChange(next);
    const nextList = next === "INDIVIDUAL" ? activeMembers : activeAccounts;
    onValueChange(nextList[0]?.name ?? "");
  }

  return (
    <div className="fld">
      <label>{sourceType === "INDIVIDUAL" ? "Individual" : "Pay from"}</label>
      {canUseIndividuals && (
        <div className="srcswitch">
          <button type="button" className={sourceType === "ACCOUNT" ? "on" : ""} onClick={() => switchType("ACCOUNT")}>Pay-from account</button>
          <button type="button" className={sourceType === "INDIVIDUAL" ? "on" : ""} onClick={() => switchType("INDIVIDUAL")}>Individual</button>
        </div>
      )}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.length === 0 && <option value="">{sourceType === "INDIVIDUAL" ? "No individuals yet" : "No accounts yet"}</option>}
        {options.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

function NewSheet({ onClose, onSubmit, busy, onError, initial, canUseIndividuals }: { onClose: () => void; onSubmit: (f: FormData) => void; busy: boolean; onError: (m: string) => void; initial?: Detail; canUseIndividuals: boolean }) {
  const editing = !!initial;
  const [amt, setAmt] = useState(initial ? (Number(initial.amount) / 100).toLocaleString("en-IN") : "");
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [payFrom, setPayFrom] = useState(initial?.payFrom ?? "");
  const [payFromType, setPayFromType] = useState<PaymentSourceType>(initial?.payFromType ?? "ACCOUNT");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [upi, setUpi] = useState(initial?.upi ?? "");
  const [due, setDue] = useState(initial ? initial.dueDate.slice(0, 10) : isoDay(2));
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  usePasteImage(setFile);
  const rupees = parseInt(amt.replace(/[^0-9]/g, "") || "0", 10);
  const words = rupees ? `₹${rupees.toLocaleString("en-IN")} — ${wordsFromRupees(rupees)}` : "";

  function submit() {
    if (!rupees || !payee.trim()) { onError("Please fill in how much and who to pay"); return; }
    if (!payFrom.trim()) { onError(payFromType === "INDIVIDUAL" ? "Please choose an individual" : "Please choose a pay-from account"); return; }
    const f = new FormData();
    f.set("amount", String(rupees * 100)); // rupees -> paise
    f.set("payee", payee.trim());
    f.set("payFrom", payFrom.trim());
    f.set("payFromType", payFromType);
    f.set("purpose", purpose.trim());
    f.set("upi", upi.trim());
    f.set("dueDate", due);
    if (file) f.set("file", file);
    onSubmit(f);
  }
  return (
    <Sheet title={editing ? "Edit request" : "Add a payment"} onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add payment"}</button></>}>
      <div className="two">
        <div className="fld"><label>How much?</label><div className="amtin"><span>₹</span>
          <input inputMode="numeric" placeholder="45,000" value={amt} onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, "") || "0", 10); setAmt(n ? n.toLocaleString("en-IN") : ""); }} /></div></div>
        <div className="fld"><label>Pay before</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="amtwords">{words}</div>
      <div className="two">
        <PayFromField value={payFrom} sourceType={payFromType} onValueChange={setPayFrom} onTypeChange={setPayFromType} canUseIndividuals={canUseIndividuals} />
        <div className="fld"><label>Their UPI or bank <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>(optional)</span></label><input placeholder="name@upi" value={upi} onChange={(e) => setUpi(e.target.value)} /></div>
      </div>
      <div className="fld"><label>Pay who?</label><input placeholder="Shop or person name" value={payee} onChange={(e) => setPayee(e.target.value)} /></div>
      <div className="fld"><label>What is this for?</label><input placeholder="e.g. Diwali advert pictures" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
      <div className="fld">
        <label>Add a photo or bill</label>
        <div className="drop" onClick={() => fileRef.current?.click()}><IcUpload /><div>Tap to add a bill, screenshot, or PDF — or paste (Ctrl/⌘+V)</div></div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <div className="attached">📎 {file.name} attached</div>}
      </div>
    </Sheet>
  );
}

function ScheduleSheet({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (date: string) => void; busy: boolean }) {
  const [date, setDate] = useState(isoDay(1));
  const [quick, setQuick] = useState<number | null>(1);
  const pick = (off: number) => { setDate(isoDay(off)); setQuick(off); };
  return (
    <Sheet title="Pick a day to pay" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-sched" onClick={() => onSubmit(date)} disabled={busy}>{busy ? "Saving…" : "Save this day"}</button></>}>
      <p>Choose the day you will pay. The app reminds you — and the person who asked — so it isn&apos;t forgotten.</p>
      <div className="fld">
        <label>I will pay on…</label>
        <div className="qdrow">
          <button className={`qd ${quick === 0 ? "on" : ""}`} onClick={() => pick(0)}>Today</button>
          <button className={`qd ${quick === 1 ? "on" : ""}`} onClick={() => pick(1)}>Tomorrow</button>
          <button className={`qd ${quick === 7 ? "on" : ""}`} onClick={() => pick(7)}>Next week</button>
        </div>
        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setQuick(null); }} />
      </div>
    </Sheet>
  );
}

function PaidSheet({ onClose, onSubmit, busy, onError }: { onClose: () => void; onSubmit: (f: FormData) => void; busy: boolean; onError: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  usePasteImage(setFile);
  function submit() {
    if (!file) { onError("Please add proof before marking it paid"); return; }
    const f = new FormData();
    f.set("file", file);
    f.set("note", note.trim());
    onSubmit(f);
  }
  return (
    <Sheet title="I paid this" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-paid" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Done, it's paid"}</button></>}>
      <p>Add a picture that shows you paid — a screenshot or receipt. This is how everyone knows it&apos;s really done.</p>
      <div className="fld">
        <label>Add proof of payment</label>
        <div className="drop" onClick={() => fileRef.current?.click()}><IcUpload /><div>Tap to add the screenshot or receipt — or paste (Ctrl/⌘+V)</div></div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file && <div className="attached">📎 {file.name} attached</div>}
      </div>
      <div className="fld"><label>Note <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>(optional)</span></label><input placeholder="e.g. paid by UPI" value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Sheet>
  );
}

function RejectSheet({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet title="Return for changes" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSubmit(reason.trim())} disabled={busy}>{busy ? "Sending…" : "Return to them"}</button></>}>
      <p>Tell them what needs fixing. They can edit and resubmit it for approval.</p>
      <div className="fld"><label>Reason <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>(optional)</span></label>
        <textarea rows={3} placeholder="e.g. wrong account, attach the bill…" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Sheet>
  );
}

/* Pay-from accounts manager (any admin). Add a new source or hide/show one. */
function AccountRow({ a, first, last, onToast }: { a: PayAccountLite; first: boolean; last: boolean; onToast: (m: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(a.name);
  const inval = () => qc.invalidateQueries({ queryKey: ["payAccounts"] });
  const mRename = useMutation({ mutationFn: (name: string) => api.payAccountRename(a.id, name), onSuccess: () => { inval(); setEditing(false); onToast("Account renamed"); }, onError: (e: Error) => onToast(e.message, true) });
  const mActive = useMutation({ mutationFn: (active: boolean) => api.payAccountSetActive(a.id, active), onSuccess: inval, onError: (e: Error) => onToast(e.message, true) });
  const mDelete = useMutation({ mutationFn: () => api.payAccountDelete(a.id), onSuccess: () => { inval(); onToast("Account deleted"); }, onError: (e: Error) => onToast(e.message, true) });
  const mMove = useMutation({ mutationFn: (dir: "up" | "down") => api.payAccountMove(a.id, dir), onSuccess: inval, onError: (e: Error) => onToast(e.message, true) });

  if (editing) {
    return (
      <div className="acctrow editing">
        <input className="acctedit" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) mRename.mutate(val.trim()); if (e.key === "Escape") { setEditing(false); setVal(a.name); } }} />
        <button className="acctbtn on" disabled={!val.trim() || mRename.isPending} onClick={() => mRename.mutate(val.trim())}>Save</button>
        <button className="acctbtn" onClick={() => { setEditing(false); setVal(a.name); }}>Cancel</button>
      </div>
    );
  }
  return (
    <div className={`acctrow ${a.active ? "" : "off"}`}>
      <span className="acctico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V10m14 11V10M3 10l9-6 9 6M9.5 21v-5h5v5" /></svg>
      </span>
      <span className="acctname">{a.name}{!a.active && <span className="acctbadge">Hidden</span>}</span>
      <div className="acctacts">
        <div className="acctmove">
          <button className="acctic mv" title="Move up" disabled={first || mMove.isPending} onClick={() => mMove.mutate("up")}>▲</button>
          <button className="acctic mv" title="Move down" disabled={last || mMove.isPending} onClick={() => mMove.mutate("down")}>▼</button>
        </div>
        <button className="acctic" title="Rename" onClick={() => { setVal(a.name); setEditing(true); }}>✏️</button>
        <button className={`acctbtn ${a.active ? "" : "on"}`} onClick={() => mActive.mutate(!a.active)}>{a.active ? "Hide" : "Show"}</button>
        <button className="acctic del" title="Delete permanently" onClick={() => { if (window.confirm(`Delete "${a.name}" from the list? Existing payments keep their label.`)) mDelete.mutate(); }}>🗑</button>
      </div>
    </div>
  );
}

function AccountsManager({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payAccounts"], queryFn: api.payAccounts });
  const accounts = q.data?.accounts ?? [];
  const [name, setName] = useState("");
  const mAdd = useMutation({
    mutationFn: (n: string) => api.payAccountCreate(n),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payAccounts"] }); setName(""); onToast("Account added"); },
    onError: (e: Error) => onToast(e.message, true),
  });
  const canAdd = !!name.trim() && !mAdd.isPending;
  return (
    <div className="acctmgr">
      <div className="acctadd">
        <input placeholder="Add an account (e.g. HDFC)" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canAdd) mAdd.mutate(name.trim()); }} />
        <button className="btn btn-primary sm" disabled={!canAdd} onClick={() => mAdd.mutate(name.trim())}>{mAdd.isPending ? "Adding…" : "Add"}</button>
      </div>
      <div className="acctlist">
        {accounts.map((a, i) => <AccountRow key={a.id} a={a} first={i === 0} last={i === accounts.length - 1} onToast={onToast} />)}
        {accounts.length === 0 && <div className="acctempty">No accounts yet — add your first one above.</div>}
      </div>
    </div>
  );
}

function MemberRow({ m, first, last, onToast }: { m: PrivateMemberLite; first: boolean; last: boolean; onToast: (msg: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.name);
  const inval = () => { qc.invalidateQueries({ queryKey: ["privateMembers"] }); qc.invalidateQueries({ queryKey: ["payments"] }); };
  const mRename = useMutation({ mutationFn: (name: string) => api.privateMemberRename(m.id, name), onSuccess: () => { inval(); setEditing(false); onToast("Member renamed"); }, onError: (e: Error) => onToast(e.message, true) });
  const mActive = useMutation({ mutationFn: (active: boolean) => api.privateMemberSetActive(m.id, active), onSuccess: inval, onError: (e: Error) => onToast(e.message, true) });
  const mDelete = useMutation({ mutationFn: () => api.privateMemberDelete(m.id), onSuccess: () => { inval(); onToast("Member deleted"); }, onError: (e: Error) => onToast(e.message, true) });
  const mMove = useMutation({ mutationFn: (dir: "up" | "down") => api.privateMemberMove(m.id, dir), onSuccess: inval, onError: (e: Error) => onToast(e.message, true) });

  if (editing) {
    return (
      <div className="acctrow editing">
        <input className="acctedit" autoFocus value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) mRename.mutate(val.trim()); if (e.key === "Escape") { setEditing(false); setVal(m.name); } }} />
        <button className="acctbtn on" disabled={!val.trim() || mRename.isPending} onClick={() => mRename.mutate(val.trim())}>Save</button>
        <button className="acctbtn" onClick={() => { setEditing(false); setVal(m.name); }}>Cancel</button>
      </div>
    );
  }
  return (
    <div className={`acctrow ${m.active ? "" : "off"}`}>
      <span className="acctico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></svg>
      </span>
      <span className="acctname">{m.name}{!m.active && <span className="acctbadge">Hidden</span>}</span>
      <div className="acctacts">
        <div className="acctmove">
          <button className="acctic mv" title="Move up" disabled={first || mMove.isPending} onClick={() => mMove.mutate("up")}>▲</button>
          <button className="acctic mv" title="Move down" disabled={last || mMove.isPending} onClick={() => mMove.mutate("down")}>▼</button>
        </div>
        <button className="acctic" title="Rename" onClick={() => { setVal(m.name); setEditing(true); }}>✏️</button>
        <button className={`acctbtn ${m.active ? "" : "on"}`} onClick={() => mActive.mutate(!m.active)}>{m.active ? "Hide" : "Show"}</button>
        <button className="acctic del" title="Delete permanently" onClick={() => { if (window.confirm(`Delete "${m.name}" from the individual list? Existing payments keep their label.`)) mDelete.mutate(); }}>🗑</button>
      </div>
    </div>
  );
}

function MembersManager({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["privateMembers"], queryFn: api.privateMembers });
  const members = q.data?.members ?? [];
  const [name, setName] = useState("");
  const mAdd = useMutation({
    mutationFn: (n: string) => api.privateMemberCreate(n),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["privateMembers"] }); setName(""); onToast("Member added"); },
    onError: (e: Error) => onToast(e.message, true),
  });
  const canAdd = !!name.trim() && !mAdd.isPending;
  return (
    <div className="acctmgr">
      <div className="acctadd">
        <input placeholder="Add an individual (e.g. Ramesh)" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canAdd) mAdd.mutate(name.trim()); }} />
        <button className="btn btn-primary sm" disabled={!canAdd} onClick={() => mAdd.mutate(name.trim())}>{mAdd.isPending ? "Adding…" : "Add"}</button>
      </div>
      <div className="acctlist">
        {members.map((m, i) => <MemberRow key={m.id} m={m} first={i === 0} last={i === members.length - 1} onToast={onToast} />)}
        {members.length === 0 && <div className="acctempty">No individuals yet — Jagat can add the first one above.</div>}
      </div>
    </div>
  );
}

/* Team + pay-from accounts. Users: managers only. Accounts/members: any admin. */
function TeamSheet({ onClose, onToast, isManager, isAdmin }: { onClose: () => void; onToast: (m: string, err?: boolean) => void; isManager: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ["team"], queryFn: api.teamList, enabled: isManager });
  const users = usersQ.data?.users ?? [];
  const [showNew, setShowNew] = useState(false);
  const [acctOpen, setAcctOpen] = useState(true);
  const [memberOpen, setMemberOpen] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);
  const [name, setName] = useState(""); const [loginId, setLoginId] = useState(""); const [pw, setPw] = useState(""); const [role, setRole] = useState<Role>("USER");

  const mCreate = useMutation({
    mutationFn: () => api.teamCreate({ name: name.trim(), loginId: loginId.trim(), password: pw, role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); setShowNew(false); setName(""); setLoginId(""); setPw(""); setRole("USER"); onToast("User created"); },
    onError: (e: Error) => onToast(e.message, true),
  });
  const mPass = useMutation({ mutationFn: ({ id, password }: { id: string; password: string }) => api.teamSetPassword(id, password), onSuccess: () => onToast("Password reset"), onError: (e: Error) => onToast(e.message, true) });
  const mActive = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.teamSetActive(id, active), onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }), onError: (e: Error) => onToast(e.message, true) });

  function resetPw(u: TeamUser) {
    const p = window.prompt(`New password for ${u.name} (${u.email}):`);
    if (p === null) return;
    if (p.length < 6) { onToast("Password must be at least 6 characters", true); return; }
    mPass.mutate({ id: u.id, password: p });
  }

  return (
    <Sheet title="Team" onClose={onClose} foot={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      {showNew ? (
        <>
          <div className="fld"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></div>
          <div className="fld"><label>Login ID</label><input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="name@payment.com" /></div>
          <div className="fld"><label>Password</label><input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="at least 6 characters" /></div>
          <div className="fld"><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="USER">User (needs approval)</option><option value="ADMIN">Admin (sees everything)</option></select></div>
          <div style={{ display: "flex", gap: 9, marginTop: 4 }}>
            <button className="btn btn-ghost" onClick={() => setShowNew(false)}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => mCreate.mutate()} disabled={mCreate.isPending || !name.trim() || loginId.length < 3 || pw.length < 6}>{mCreate.isPending ? "Creating…" : "Create user"}</button>
          </div>
        </>
      ) : (
        <>
          {isManager && (
            <>
              <div className="sechead">Team members</div>
              <button className="btn btn-primary" onClick={() => setShowNew(true)}><IcPlus />Add user</button>
              <div className="teamlist">
                {users.map((u) => (
                  <div key={u.id} className={`teamrow ${u.active ? "" : "off"}`}>
                    <div className="tav" style={{ background: colorFor(u.name) }}>{initials(u.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tname">{u.name}{!u.active && <span className="tinactive">inactive</span>}</div>
                      <div className="temail">{u.email} · {u.role === "ADMIN" ? "Admin" : "User"}{u.isPayer ? " · payer" : ""}{u.isApprover ? " · approver" : ""}{u.isManager ? " · manager" : ""}</div>
                    </div>
                    <button className="tbtn" onClick={() => resetPw(u)} title="Reset password">🔑</button>
                    <button className="tbtn" onClick={() => mActive.mutate({ id: u.id, active: !u.active })} title={u.active ? "Deactivate" : "Reactivate"}>{u.active ? "🚫" : "↺"}</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {isAdmin && (
            <div className="acctsec" style={{ marginTop: isManager ? 18 : 0 }}>
              <button type="button" className="sechead toggle" onClick={() => setAcctOpen((o) => !o)}>
                <span>Pay-from accounts</span>
                <span className={`chev ${acctOpen ? "open" : ""}`}>▾</span>
              </button>
              {acctOpen && <AccountsManager onToast={onToast} />}
              <button type="button" className="sechead toggle" style={{ marginTop: 18 }} onClick={() => setMemberOpen((o) => !o)}>
                <span>Individual members</span>
                <span className={`chev ${memberOpen ? "open" : ""}`}>▾</span>
              </button>
              {memberOpen && <MembersManager onToast={onToast} />}
              <button type="button" className="sechead toggle" style={{ marginTop: 18 }} onClick={() => setNotifOpen((o) => !o)}>
                <span>Notification check</span>
                <span className={`chev ${notifOpen ? "open" : ""}`}>▾</span>
              </button>
              {notifOpen && <NotificationCheck onToast={onToast} />}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}


/* ── notification check (admin) ────────────────────────────────────── */
/* Two questions, side by side: is each person *routed* the alerts their role
   implies, and are their devices still *accepting* a push? A phone that
   quietly stopped receiving looks identical to a working one until you ask. */
function roleLine(p: PersonAlerts): string {
  const tags = [p.role === "ADMIN" ? "Admin" : "User"];
  if (p.isPayer) tags.push("payer");
  if (p.isApprover) tags.push("approver");
  if (p.isManager) tags.push("manager");
  return tags.join(" · ");
}

function deliveryLine(p: PersonAlerts): string {
  if (p.state === "off") return "No device — won't get alerts when PayTrack is closed";
  const n = p.devices.length;
  const devices = `${n} device${n > 1 ? "s" : ""}`;
  const last = p.lastDeliveredAt ? `last delivered ${timeAgo(p.lastDeliveredAt)}` : "nothing delivered yet";
  return p.state === "failing" ? `${devices} · failing · ${last}` : `${devices} · ${last}`;
}

function resultLine(r: TestResult): string {
  if (r.miss === "no-device") return `${r.name} — no device registered`;
  if (r.miss === "not-configured") return `${r.name} — server has no push keys`;
  if (r.delivered > 0) return `${r.name} — reached ${r.delivered} of ${r.devices}`;
  return `${r.name} — failed on ${r.devices} device${r.devices > 1 ? "s" : ""}`;
}

function NotificationCheck({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts"], queryFn: api.alertsOverview });
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(scope: "all" | "user", userId?: string) {
    setBusy(userId ?? "all");
    setResults(null);
    try {
      const { results: r } = await api.pushTest({ scope, userId });
      setResults(r);
      const reached = r.filter((x) => x.delivered > 0).length;
      onToast(reached === r.length ? `Test sent — all ${r.length} reached` : `Test sent — ${reached} of ${r.length} reached`, reached < r.length);
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      onToast((e as Error).message, true);
    }
    setBusy(null);
  }

  if (q.isLoading) return <div className="ncmeta" style={{ padding: "8px 2px" }}>Checking…</div>;
  if (q.error) return <div className="ncwarn">Couldn&apos;t load the check: {(q.error as Error).message}</div>;
  const d = q.data;
  if (!d) return null;

  return (
    <div className="nccheck">
      {!d.configured && (
        <div className="ncwarn">
          Closed-app alerts aren&apos;t set up on the server (no push keys), so nobody is receiving them yet.
          In-app chime and vibration still work while PayTrack is open.
        </div>
      )}
      <div className="ncsum">
        <span><b>{d.on}</b> getting alerts</span>
        {d.failing > 0 && <span className="bad"><b>{d.failing}</b> failing</span>}
        {d.off > 0 && <span className="warn"><b>{d.off}</b> not set up</span>}
      </div>
      <button className="btn btn-primary" onClick={() => send("all")} disabled={!!busy}>
        {busy === "all" ? "Sending…" : "🔔 Send a test to everyone"}
      </button>

      {results && (
        <div className="ncres">
          {results.map((r) => (
            <div key={r.userId} className={r.delivered > 0 ? "ok" : "bad"}>
              {r.delivered > 0 ? "✓" : "✕"} {resultLine(r)}
            </div>
          ))}
        </div>
      )}

      <div className="nclist">
        {d.people.map((p) => (
          <div key={p.id} className="ncrow">
            <span className={`ncdot ${p.state}`} title={p.state} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ncname">{p.name} <span className="ncrole">{roleLine(p)}</span></div>
              <div className="ncmeta">{deliveryLine(p)}</div>
              {p.devices.length > 0 && (
                <div className="ncdevs">
                  {p.devices.map((dev) => (
                    <span key={dev.id} className={dev.healthy ? "" : "bad"}>
                      {dev.device ?? "Unknown device"}
                      {dev.failureCount > 0 ? ` (${dev.failureCount} failed)` : ""}
                    </span>
                  ))}
                </div>
              )}
              <div className="ncfor">Pinged for: {p.alertsFor.join(" · ")}</div>
            </div>
            <button className="tbtn" onClick={() => send("user", p.id)} disabled={!!busy} title={`Send ${p.name} a test`}>
              {busy === p.id ? "…" : "🔔"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
