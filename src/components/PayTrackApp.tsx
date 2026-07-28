"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, STATUS, PEOPLE, colorFor, initials, fmtPaise, wordsFromRupees, relDue, fmtShort, fmtStamp, isoDay, timeAgo, dueRank,
  type Card, type Detail, type Effective, type EventLite, type UserLite, type MeUser, type TeamUser, type Role,
} from "@/lib/client";
import { signOutAction } from "@/app/actions";
import { enablePush, isPushEnabled, pushSupported, pushBlocked } from "@/lib/push-client";

/* ── tiny inline icons (match the prototype) ───────────────────────── */
const IcSearch = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>);
const IcPlus = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>);
const IcBack = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg>);
const IcInfo = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>);
const IcCheck = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>);
const IcClock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" /></svg>);
const IcUpload = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>);

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));

// Opens the full-screen image lightbox (provided at the app root).
const ImageViewerCtx = createContext<(src: string, name: string) => void>(() => {});

export function PayTrackApp() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
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
    document.body.classList.toggle("viewing", !!selected);
    return () => document.body.classList.remove("viewing");
  }, [selected]);

  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me });
  const me = meQ.data?.me ?? null;
  const isPayer = me?.isPayer ?? false;
  const isApprover = me?.isApprover ?? false;
  const isManager = me?.isManager ?? false;
  const isAdmin = me?.isAdmin ?? false;

  // When the acting user changes (e.g. after login), default the filter by role
  // — payer sees everything, requesters land on their own — reset the selection,
  // and drop any query cache left over from the previous user.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    if (me && me.id !== lastUserId.current) {
      const switched = lastUserId.current !== null;
      lastUserId.current = me.id;
      setFilter(me.role === "ADMIN" ? "all" : "mine");
      setSelected(null);
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
    const isWaiting = (e: Effective) => e === "REQUESTED" || e === "AWAITING_APPROVAL" || e === "RETURNED" || e === "OVERDUE";
    return all
      .filter((p) => {
        if (q) {
          const hay = `${p.payee} ${p.purpose} ${p.amount} ${p.requestedBy.name} ${p.payFrom}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filter === "all") return true;
        if (filter === "mine") return p.mine;
        if (filter === "paid") return p.effective === "PAID" || p.effective === "CONFIRMED";
        if (filter === "requested") return isWaiting(p.effective);
        return true;
      })
      // Urgent on top (overdue → due today → upcoming → paid/done), newest-first within each.
      .sort((a, b) => {
        const ua = dueRank(a), ub = dueRank(b);
        if (ua !== ub) return ua - ub;
        return +new Date(b.createdAt) - +new Date(a.createdAt);
      });
  }, [all, filter, search]);

  const counts = useMemo(() => ({
    all: all.length,
    mine: all.filter((p) => p.mine).length,
    requested: all.filter((p) => ["REQUESTED", "AWAITING_APPROVAL", "RETURNED", "OVERDUE"].includes(p.effective)).length,
    paid: all.filter((p) => p.effective === "PAID" || p.effective === "CONFIRMED").length,
  }), [all]);

  const detail = detailQ.data?.payment ?? null;

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
          <StatStrip all={all} isPayer={isPayer} isApprover={isApprover} isAdmin={isAdmin} />
          <div className="dots" id="stripDots"><i className="on" /><i /><i /><i /></div>

          <div className="body">
            <div className="listcol">
              <div className="search">
                <IcSearch />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payee, purpose, amount…" />
              </div>
              <Filters filter={filter} counts={counts} onPick={setFilter} />
              <div className="list">
                {filtered.length === 0 ? (
                  <div className="empty" style={{ height: "100%" }}><div><div className="big">✓</div><h3>Nothing here</h3><p>No payments in this filter.</p></div></div>
                ) : filtered.map((p) => (
                  <PaymentCard key={p.id} p={p} selected={selected === p.id} onClick={() => select(p.id)} />
                ))}
              </div>
              <div className="mobbar"><button className="btn btn-primary" onClick={() => setNewOpen(true)}>＋ Add a payment</button></div>
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
          </div>

          {newOpen && <NewSheet onClose={() => setNewOpen(false)} onSubmit={(f) => mCreate.mutate(f)} busy={mCreate.isPending} onError={(m) => showToast(m, true)} />}
          {editFor && <NewSheet initial={editFor} onClose={() => setEditFor(null)} onSubmit={(f) => mEdit.mutate({ id: editFor.id, form: f })} busy={mEdit.isPending} onError={(m) => showToast(m, true)} />}
          {schedFor && <ScheduleSheet onClose={() => setSchedFor(null)} onSubmit={(date) => mSchedule.mutate({ id: schedFor, date })} busy={mSchedule.isPending} />}
          {paidFor && <PaidSheet onClose={() => setPaidFor(null)} onSubmit={(f) => mPay.mutate({ id: paidFor, form: f })} busy={mPay.isPending} onError={(m) => showToast(m, true)} />}
          {rejectFor && <RejectSheet onClose={() => setRejectFor(null)} onSubmit={(reason) => mReject.mutate({ id: rejectFor, reason })} busy={mReject.isPending} />}
          {teamOpen && <TeamSheet onClose={() => setTeamOpen(false)} onToast={showToast} isManager={isManager} isAdmin={isAdmin} />}

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

/* Notification centre: bell + unread badge, opens a panel of recent activity.
   The browser-push toggle lives inside the panel so there's one control. */
function NotificationBell({ onToast, onOpenPayment }: { onToast: (msg: string, err?: boolean) => void; onOpenPayment: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<"loading" | "on" | "off" | "blocked" | "unsupported">("loading");

  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: api.notifications, refetchInterval: 10000 });
  const items = notifQ.data?.items ?? [];
  const unread = notifQ.data?.unread ?? 0;

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

          <div className="nplist">
            {items.length === 0 ? (
              <div className="npempty">Nothing yet — you&apos;ll see activity here.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  className={`npitem ${n.unread ? "un" : ""}`}
                  onClick={() => { onOpenPayment(n.payment.id); setOpen(false); }}
                >
                  <div className="npav" style={{ background: colorFor(n.actor?.name ?? "") }}>
                    {initials(n.actor?.name ?? "?")}
                  </div>
                  <div className="npbody">
                    <div className="npmsg">{n.message}</div>
                    <div className="npmeta">{n.payment.payee} · {fmtPaise(n.payment.amount)} · {timeAgo(n.createdAt)}</div>
                  </div>
                </button>
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
function Filters({ filter, counts, onPick }: { filter: string; counts: Record<string, number>; onPick: (f: string) => void }) {
  const tabs: [string, string][] = [["requested", "Waiting"], ["paid", "Paid"], ["all", "All"], ["mine", "Mine"]];
  return (
    <div className="filters">
      {tabs.map(([k, l]) => (
        <button key={k} className={`chip-f ${k === "mine" ? "mine" : ""} ${filter === k ? "on" : ""}`} onClick={() => onPick(k)}>
          {l}<span className="n">{counts[k] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/* ── list card ─────────────────────────────────────────────────────── */
function StatusPill({ eff }: { eff: Effective }) {
  const s = STATUS[eff];
  return <span className={`pill ${s.cls}`}><span style={{ fontSize: 12, lineHeight: 1 }}>{s.ic}</span>{s.lab}</span>;
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
        <div className="row2"><StatusPill eff={p.effective} />{showDue && <span className="due" style={{ color: due.c }}>{due.t}</span>}</div>
        <div className="meta">{p.purpose}</div>
        <div className="submeta">from <b>{p.payFrom}</b> · {p.mine ? "you asked" : "by " + p.requestedBy.name}</div>
        <div className="cstamp">🕒 {fmtStamp(p.createdAt)}{p.editedAt ? ` · edited ${fmtStamp(p.editedAt)}` : ""}</div>
        {needsMe && <div className="flagline">✓ Paid — tap to say you got it</div>}
      </div>
    </div>
  );
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
          <div className="sub">{p.purpose} · {mine ? "you asked" : "asked by " + p.requestedBy.name}</div>
          <div style={{ marginTop: 7, display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill eff={eff} />{showDue && <span className="due" style={{ color: due.c }}>{due.t}</span>}
          </div>
          <div className="tstamp">🕒 Raised {fmtStamp(p.createdAt)}{p.editedAt ? ` · edited ${fmtStamp(p.editedAt)}` : ""}</div>
        </div>
        <div className="amt grotesk">{fmtPaise(p.amount)}<small>from {p.payFrom}</small></div>
      </div>
      <div className="frow">
        <div className="cell"><div className="k">Pay from</div><div className="v">{p.payFrom}</div></div>
        <div className="cell"><div className="k">Pay to</div><div className="v">{p.upi || p.payee}</div></div>
        <div className="cell"><div className="k">Amount</div><div className="v">{fmtPaise(p.amount)}</div></div>
      </div>
      <div className="thread">{p.events.map((e) => <ThreadMsg key={e.id} ev={e} />)}</div>
      <Actions p={p} me={me} act={props} />
    </>
  );
}

const SYS_TYPES = new Set(["SCHEDULE", "CONFIRM", "HOLD", "CANCEL", "NUDGE", "REMINDER", "APPROVE", "RETURN", "RESUBMIT"]);
function ThreadMsg({ ev }: { ev: EventLite }) {
  if (SYS_TYPES.has(ev.type) && !ev.attachment) {
    const ic = ev.type === "CONFIRM" ? <IcCheck /> : <IcClock />;
    return <div className="tmsg sys"><span className="sysline">{ic}{ev.message}</span></div>;
  }
  const who = ev.actor?.name ?? "System";
  return (
    <div className="tmsg">
      <div className="tav" style={{ background: colorFor(who) }}>{initials(who)}</div>
      <div className="bubble">
        <div className="who" style={{ color: PEOPLE[who] ?? "#333" }}>{who}</div>
        <div className="txt">{ev.message}</div>
        {ev.attachment && <AttachmentView a={ev.attachment} />}
        <div className="time">{new Date(ev.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}
function AttachmentView({ a }: { a: { id: string; kind: string; originalName: string; mimeType: string } }) {
  const href = `/api/v1/attachments/${a.id}`;
  const openImage = useContext(ImageViewerCtx);
  if (a.mimeType.startsWith("image/")) {
    return (
      <button type="button" className="proofimg" onClick={() => openImage(href, a.originalName)} title={a.originalName}>
        { /* eslint-disable-next-line @next/next/no-img-element */ }
        <img src={href} alt={a.originalName} loading="lazy" />
      </button>
    );
  }
  const label = a.mimeType === "application/pdf" ? "PDF" : "FILE";
  return (
    <div className="att">
      <a className="file" href={href} target="_blank" rel="noreferrer">
        <div className="ic" style={{ background: a.mimeType === "application/pdf" ? "#DE3C3C" : "#5A6B7B" }}>{label}</div>
        <div style={{ minWidth: 0 }}><div className="fn">{a.originalName}</div><div className="fs">{a.kind === "PROOF" ? "proof" : "instruction"}</div></div>
      </a>
    </div>
  );
}

function Actions({ p, me, act }: { p: Detail; me: MeUser | null; act: DetailActions }) {
  const eff = p.effective;
  const isPayer = !!me?.isPayer;
  const isApprover = !!me?.isApprover;
  const mine = me?.id === p.requestedBy.id;
  const disabled = (label: string) => <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>{label}</button>;
  let hint = ""; let btns: React.ReactNode = null;

  if (p.status === "AWAITING_APPROVAL") {
    if (isApprover) {
      hint = "Review this request — approve it, or send it back for changes.";
      btns = (<>
        <button className="btn btn-ghost" onClick={() => act.onReject(p.id)}>↩️ Return</button>
        <button className="btn btn-primary" onClick={() => act.onApprove(p.id)}>✓ Approve</button>
      </>);
    } else if (mine) {
      hint = "Waiting for Jagat to approve. You can still edit it.";
    } else { hint = "Waiting for Jagat to approve."; btns = disabled("Awaiting approval"); }
  } else if (p.status === "RETURNED") {
    if (mine) {
      hint = "Jagat returned this for changes. Edit it, then resubmit.";
      btns = <button className="btn btn-primary" onClick={() => act.onResubmit(p.id)}>↥ Resubmit</button>;
    } else { hint = `Returned to ${p.requestedBy.name} for changes.`; btns = disabled("Returned"); }
  } else if (isPayer) {
    if (eff === "REQUESTED" || (eff === "OVERDUE" && p.status === "REQUESTED")) {
      hint = "Pick a day to pay, or pay it now.";
      btns = (<>
        <button className="btn btn-sched" onClick={() => act.onSchedule(p.id)}>📅 Pick a day</button>
        <button className="btn btn-paid" onClick={() => act.onPay(p.id)}>✓ I paid this</button>
      </>);
    } else if (eff === "SCHEDULED" || (eff === "OVERDUE" && p.status === "SCHEDULED")) {
      hint = p.scheduledFor ? `Planned for ${fmtShort(p.scheduledFor)}.` : "A day is planned.";
      btns = <button className="btn btn-paid" onClick={() => act.onPay(p.id)}>✓ I paid this</button>;
    } else if (eff === "HOLD") {
      hint = "Waiting on missing details before you can pay."; btns = <button className="btn btn-paid" onClick={() => act.onPay(p.id)}>✓ I paid this</button>;
    } else if (eff === "PAID") {
      hint = `Paid. Now ${p.requestedBy.name} needs to say they got it.`; btns = disabled(`Waiting for ${p.requestedBy.name}`);
    } else if (eff === "CONFIRMED") { hint = "All finished — paid and confirmed."; btns = disabled("✅ Finished"); }
    else if (eff === "CANCELLED") { hint = "This payment was cancelled."; btns = disabled("Cancelled"); }
  } else {
    // requester / other admin view
    if (eff === "PAID" && mine) {
      hint = "Paid, with the proof attached. Look, then say you got it.";
      btns = <button className="btn btn-conf" onClick={() => act.onConfirm(p.id)}>✓ Yes, I got it</button>;
    } else if (eff === "CONFIRMED") { hint = mine ? "You said you got it. All finished." : "Finished."; btns = disabled("✅ Finished"); }
    else if (eff === "CANCELLED") { hint = "This payment was cancelled."; btns = disabled("Cancelled"); }
    else if (eff === "PAID") { hint = `Paid — waiting for ${p.requestedBy.name} to confirm.`; btns = disabled(`Waiting for ${p.requestedBy.name}`); }
    else {
      hint = mine ? "Approved — with the payer now. You'll be told as it changes." : `Raised by ${p.requestedBy.name}. With the payer now.`;
      btns = <button className="btn btn-sched" onClick={() => act.onNudge(p.id)}>🔔 Send a reminder</button>;
    }
  }
  // Edit (raiser) and Delete (raiser or admin) are available until it's paid.
  const notFinal = p.status !== "PAID" && p.status !== "CONFIRMED" && p.status !== "CANCELLED";
  const canEdit = mine && notFinal;
  // Admin can delete any entry; the raiser can delete their own until it's paid.
  const canDelete = !!me?.isAdmin || (mine && p.status !== "PAID" && p.status !== "CONFIRMED");
  return (
    <div className="actions">
      <span className="hint"><IcInfo />{hint}</span>
      {canEdit && <button className="btn btn-ghost" onClick={() => act.onEdit(p)}>✏️ Edit</button>}
      {canDelete && <button className="btn btn-ghost del" onClick={() => act.onDelete(p.id)}>🗑 Delete</button>}
      {btns}
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

/* "Pay from" picker — a plain dropdown of the active accounts. Admins add /
   hide accounts in the Team panel, not here. */
function PayFromField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accountsQ = useQuery({ queryKey: ["payAccounts"], queryFn: api.payAccounts });
  const active = useMemo(() => (accountsQ.data?.accounts ?? []).filter((a) => a.active), [accountsQ.data]);
  // Keep the current value selectable even if it's inactive/unknown (e.g. editing an old entry).
  const options = value && !active.some((a) => a.name === value) ? [value, ...active.map((a) => a.name)] : active.map((a) => a.name);

  // Default to the first account once the list loads and nothing is chosen yet.
  useEffect(() => {
    if (!value && active.length) onChange(active[0].name);
  }, [value, active, onChange]);

  return (
    <div className="fld">
      <label>Pay from</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.length === 0 && <option value="">No accounts yet</option>}
        {options.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

function NewSheet({ onClose, onSubmit, busy, onError, initial }: { onClose: () => void; onSubmit: (f: FormData) => void; busy: boolean; onError: (m: string) => void; initial?: Detail }) {
  const editing = !!initial;
  const [amt, setAmt] = useState(initial ? (Number(initial.amount) / 100).toLocaleString("en-IN") : "");
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [payFrom, setPayFrom] = useState(initial?.payFrom ?? "");
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
    if (!payFrom.trim()) { onError("Please choose a pay-from account"); return; }
    const f = new FormData();
    f.set("amount", String(rupees * 100)); // rupees -> paise
    f.set("payee", payee.trim());
    f.set("payFrom", payFrom.trim());
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
        <PayFromField value={payFrom} onChange={setPayFrom} />
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
  const mActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.payAccountSetActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payAccounts"] }),
    onError: (e: Error) => onToast(e.message, true),
  });
  return (
    <div className="acctmgr">
      <div className="acctadd">
        <input placeholder="New account name" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) mAdd.mutate(name.trim()); }} />
        <button className="btn btn-primary sm" disabled={!name.trim() || mAdd.isPending} onClick={() => mAdd.mutate(name.trim())}>Add</button>
      </div>
      <div className="acctlist">
        {accounts.map((a) => (
          <div key={a.id} className={`acctrow ${a.active ? "" : "off"}`}>
            <span>{a.name}{a.active ? "" : " · hidden"}</span>
            <button className="linklike" onClick={() => mActive.mutate({ id: a.id, active: !a.active })}>{a.active ? "Hide" : "Show"}</button>
          </div>
        ))}
        {accounts.length === 0 && <div className="acctrow"><span style={{ color: "var(--ink-3)" }}>No accounts yet</span></div>}
      </div>
    </div>
  );
}

/* Team + pay-from accounts. Users: managers only. Accounts: any admin. */
function TeamSheet({ onClose, onToast, isManager, isAdmin }: { onClose: () => void; onToast: (m: string, err?: boolean) => void; isManager: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ["team"], queryFn: api.teamList, enabled: isManager });
  const users = usersQ.data?.users ?? [];
  const [showNew, setShowNew] = useState(false);
  const [acctOpen, setAcctOpen] = useState(true);
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
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
