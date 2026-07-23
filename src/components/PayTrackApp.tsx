"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, STATUS, PEOPLE, colorFor, initials, fmtPaise, wordsFromRupees, relDue, fmtShort, isoDay, timeAgo,
  type Card, type Detail, type Effective, type EventLite, type UserLite,
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
  const isPayer = me?.role === "PAYER";

  // When the acting user changes (e.g. after login), default the filter by role
  // — payer sees everything, requesters land on their own — reset the selection,
  // and drop any query cache left over from the previous user.
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    if (me && me.id !== lastUserId.current) {
      const switched = lastUserId.current !== null;
      lastUserId.current = me.id;
      setFilter(me.role === "PAYER" ? "all" : "mine");
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
    onSuccess: (d) => { setNewOpen(false); setFilter("all"); refresh(); setSelected(d.payment.id); showToast("Payment added"); },
    onError: (e: Error) => showToast(e.message, true),
  });

  // ── derived list ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank: Record<Effective, number> = { OVERDUE: 0, REQUESTED: 1, SCHEDULED: 2, HOLD: 3, PAID: 4, CONFIRMED: 5, CANCELLED: 6 };
    return all
      .filter((p) => {
        if (q) {
          const hay = `${p.payee} ${p.purpose} ${p.amount} ${p.requestedBy.name} ${p.payFrom}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filter === "all") return true;
        if (filter === "mine") return p.mine;
        if (filter === "paid") return p.effective === "PAID" || p.effective === "CONFIRMED";
        if (filter === "requested") return p.effective === "REQUESTED";
        if (filter === "scheduled") return p.effective === "SCHEDULED";
        if (filter === "overdue") return p.effective === "OVERDUE";
        return true;
      })
      .sort((a, b) => (rank[a.effective] - rank[b.effective]) || (+new Date(a.dueDate) - +new Date(b.dueDate)));
  }, [all, filter, search]);

  const counts = useMemo(() => ({
    all: all.length,
    mine: all.filter((p) => p.mine).length,
    requested: all.filter((p) => p.effective === "REQUESTED").length,
    scheduled: all.filter((p) => p.effective === "SCHEDULED").length,
    overdue: all.filter((p) => p.effective === "OVERDUE").length,
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
          <TopBar me={me} onSignOut={() => signOutAction()} onAdd={() => setNewOpen(true)} onToast={showToast} onOpenPayment={(id) => setSelected(id)} />
          <RemindBanner show={!!isPayer} all={all} />
          <StatStrip all={all} isPayer={!!isPayer} />
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
                />
              </div>
            </div>
          </div>

          {newOpen && <NewSheet onClose={() => setNewOpen(false)} onSubmit={(f) => mCreate.mutate(f)} busy={mCreate.isPending} onError={(m) => showToast(m, true)} />}
          {schedFor && <ScheduleSheet onClose={() => setSchedFor(null)} onSubmit={(date) => mSchedule.mutate({ id: schedFor, date })} busy={mSchedule.isPending} />}
          {paidFor && <PaidSheet onClose={() => setPaidFor(null)} onSubmit={(f) => mPay.mutate({ id: paidFor, form: f })} busy={mPay.isPending} onError={(m) => showToast(m, true)} />}

          <div className={`toast ${toast ? "on" : ""} ${toast?.err ? "err" : ""}`}>
            {!toast?.err && <IcCheck />}<span>{toast?.msg}</span>
          </div>
        </div>
      </div>
      <Lightbox img={lightbox} onClose={() => setLightbox(null)} />
    </ImageViewerCtx.Provider>
  );
}

/* Full-screen image viewer (WhatsApp-style). Close on ✕ / backdrop / Esc. */
function Lightbox({ img, onClose }: { img: { src: string; name: string } | null; onClose: () => void }) {
  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [img, onClose]);
  if (!img) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lbclose" onClick={onClose} aria-label="Close">✕</button>
      { /* eslint-disable-next-line @next/next/no-img-element */ }
      <img src={img.src} alt={img.name} onClick={(e) => e.stopPropagation()} />
      <div className="lbname" onClick={(e) => e.stopPropagation()}>{img.name}</div>
    </div>
  );
}

/* ── top bar ───────────────────────────────────────────────────────── */
function TopBar({ me, onSignOut, onAdd, onToast, onOpenPayment }: { me: UserLite | null; onSignOut: () => void; onAdd: () => void; onToast: (msg: string, err?: boolean) => void; onOpenPayment: (id: string) => void }) {
  return (
    <header className="topbar">
      <div className="logo"><div className="mark">₹</div><div>PayTrack <small style={{ display: "block" }}>Go DinDin</small></div></div>
      <div className="spacer" />
      <button className="btn btn-primary addbtn" onClick={onAdd}><IcPlus />Add a payment</button>
      <NotificationBell onToast={onToast} onOpenPayment={onOpenPayment} />
      <div className="me">
        <div className="avatar" style={{ background: colorFor(me?.name ?? "") }}>{me ? initials(me.name) : "?"}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "12.5px" }}>{me?.name ?? "…"}</div>
          <div className="role">{me?.role === "PAYER" ? "You pay the bills" : "You add payments"}</div>
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
        <div className="notifpanel">
          <div className="nphead">
            <strong>Notifications</strong>
            {unread > 0 && <button onClick={() => markRead.mutate()}>Mark all read</button>}
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
      )}
    </div>
  );
}

/* ── reminder banner (payer) ───────────────────────────────────────── */
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
function StatStrip({ all, isPayer }: { all: Card[]; isPayer: boolean }) {
  let cards: { lab: string; val: string | number; sub: string; ac: string; tint: string; ic: string }[];
  if (isPayer) {
    const pend = all.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status));
    const over = all.filter((p) => p.effective === "OVERDUE");
    const dueToday = all.filter((p) => ["REQUESTED", "SCHEDULED"].includes(p.status) && fmtISODate(p.dueDate) === isoDay(0));
    cards = [
      { lab: "To pay", val: sumPaise(pend), sub: `${pend.length} waiting`, ac: "var(--brand)", tint: "var(--brand-soft)", ic: "💰" },
      { lab: "Today", val: dueToday.length, sub: dueToday.length ? "pay these today" : "all clear", ac: "var(--sched)", tint: "var(--sched-soft)", ic: "📅" },
      { lab: "Late", val: over.length, sub: over.length ? sumPaise(over) : "none late", ac: "var(--over)", tint: "var(--over-soft)", ic: "⚠️" },
      { lab: "Done", val: all.filter((p) => ["PAID", "CONFIRMED"].includes(p.status)).length, sub: "proof saved", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "✅" },
    ];
  } else {
    const mine = all.filter((p) => p.mine);
    const pend = mine.filter((p) => ["REQUESTED", "SCHEDULED", "HOLD"].includes(p.status));
    const over = mine.filter((p) => p.effective === "OVERDUE");
    const toConf = mine.filter((p) => p.status === "PAID");
    cards = [
      { lab: "To pay", val: pend.length, sub: pend.length ? sumPaise(pend) : "none waiting", ac: "var(--brand)", tint: "var(--brand-soft)", ic: "⏳" },
      { lab: "Check", val: toConf.length, sub: toConf.length ? "say you got it" : "none to check", ac: "var(--paid)", tint: "var(--paid-soft)", ic: "👀" },
      { lab: "Late", val: over.length, sub: over.length ? "remind payer" : "on time", ac: "var(--over)", tint: "var(--over-soft)", ic: "⚠️" },
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
        {needsMe && <div className="flagline">✓ Paid — tap to say you got it</div>}
      </div>
    </div>
  );
}

/* ── detail ────────────────────────────────────────────────────────── */
function PaymentDetail(props: {
  detail: Detail | null; me: UserLite | null; loading: boolean;
  onBack: () => void; onSchedule: (id: string) => void; onPay: (id: string) => void;
  onHold: (id: string) => void; onConfirm: (id: string) => void; onNudge: (id: string) => void;
}) {
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
        </div>
        <div className="amt grotesk">{fmtPaise(p.amount)}<small>from {p.payFrom}</small></div>
      </div>
      <div className="frow">
        <div className="cell"><div className="k">Pay from</div><div className="v">{p.payFrom}</div></div>
        <div className="cell"><div className="k">Pay to</div><div className="v">{p.upi || p.payee}</div></div>
        <div className="cell"><div className="k">Amount</div><div className="v">{fmtPaise(p.amount)}</div></div>
      </div>
      <div className="thread">{p.events.map((e) => <ThreadMsg key={e.id} ev={e} />)}</div>
      <Actions p={p} me={me} onSchedule={props.onSchedule} onPay={props.onPay} onHold={props.onHold} onConfirm={props.onConfirm} onNudge={props.onNudge} />
    </>
  );
}

const SYS_TYPES = new Set(["SCHEDULE", "CONFIRM", "HOLD", "CANCEL", "NUDGE", "REMINDER"]);
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

function Actions(props: {
  p: Detail; me: UserLite | null;
  onSchedule: (id: string) => void; onPay: (id: string) => void; onHold: (id: string) => void; onConfirm: (id: string) => void; onNudge: (id: string) => void;
}) {
  const { p, me } = props;
  const eff = p.effective;
  const isPayer = me?.role === "PAYER";
  const mine = me?.id === p.requestedBy.id;
  let hint = ""; let btns: React.ReactNode = null;

  if (isPayer) {
    if (eff === "REQUESTED" || (eff === "OVERDUE" && p.status === "REQUESTED")) {
      hint = "Pick a day to pay, or pay it now.";
      btns = (<>
        <button className="btn btn-sched" onClick={() => props.onSchedule(p.id)}>📅 Pick a day</button>
        <button className="btn btn-paid" onClick={() => props.onPay(p.id)}>✓ I paid this</button>
      </>);
    } else if (eff === "SCHEDULED" || (eff === "OVERDUE" && p.status === "SCHEDULED")) {
      hint = p.scheduledFor ? `Planned for ${fmtShort(p.scheduledFor)}.` : "A day is planned.";
      btns = <button className="btn btn-paid" onClick={() => props.onPay(p.id)}>✓ I paid this</button>;
    } else if (eff === "PAID") {
      hint = `Paid. Now ${p.requestedBy.name} needs to say they got it.`;
      btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>Waiting for {p.requestedBy.name}</button>;
    } else if (eff === "CONFIRMED") {
      hint = "All finished — paid and confirmed."; btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>✅ Finished</button>;
    } else if (eff === "HOLD") {
      hint = "Waiting on missing details before you can pay."; btns = <button className="btn btn-paid" onClick={() => props.onPay(p.id)}>✓ I paid this</button>;
    } else if (eff === "CANCELLED") {
      hint = "This payment was cancelled."; btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>Cancelled</button>;
    }
  } else {
    if (!mine) {
      hint = `${p.requestedBy.name} asked for this one. You are only looking.`;
      btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>Just looking</button>;
    } else if (eff === "PAID") {
      hint = "Paid, with the proof attached. Look, then say you got it.";
      btns = <button className="btn btn-conf" onClick={() => props.onConfirm(p.id)}>✓ Yes, I got it</button>;
    } else if (eff === "CONFIRMED") {
      hint = "You said you got it. All finished."; btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>✅ Finished</button>;
    } else if (eff === "CANCELLED") {
      hint = "This payment was cancelled."; btns = <button className="btn btn-ghost" disabled style={{ opacity: .55 }}>Cancelled</button>;
    } else {
      hint = eff === "OVERDUE" ? "This one is late. Send a reminder." : "Sent to the payer. You'll be told as it changes.";
      btns = <button className="btn btn-sched" onClick={() => props.onNudge(p.id)}>🔔 Send a reminder</button>;
    }
  }
  return <div className="actions"><span className="hint"><IcInfo />{hint}</span>{btns}</div>;
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

function NewSheet({ onClose, onSubmit, busy, onError }: { onClose: () => void; onSubmit: (f: FormData) => void; busy: boolean; onError: (m: string) => void }) {
  const [amt, setAmt] = useState("");
  const [payee, setPayee] = useState("");
  const [payFrom, setPayFrom] = useState("Peliswan");
  const [purpose, setPurpose] = useState("");
  const [upi, setUpi] = useState("");
  const [due, setDue] = useState(isoDay(2));
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  usePasteImage(setFile);
  const rupees = parseInt(amt.replace(/[^0-9]/g, "") || "0", 10);
  const words = rupees ? `₹${rupees.toLocaleString("en-IN")} — ${wordsFromRupees(rupees)}` : "";

  function submit() {
    if (!rupees || !payee.trim()) { onError("Please fill in how much and who to pay"); return; }
    const f = new FormData();
    f.set("amount", String(rupees * 100)); // rupees -> paise
    f.set("payee", payee.trim());
    f.set("payFrom", payFrom.toUpperCase());
    f.set("purpose", purpose.trim());
    f.set("upi", upi.trim());
    f.set("dueDate", due);
    if (file) f.set("file", file);
    onSubmit(f);
  }
  return (
    <Sheet title="Add a payment" onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add payment"}</button></>}>
      <div className="two">
        <div className="fld"><label>How much?</label><div className="amtin"><span>₹</span>
          <input inputMode="numeric" placeholder="45,000" value={amt} onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, "") || "0", 10); setAmt(n ? n.toLocaleString("en-IN") : ""); }} /></div></div>
        <div className="fld"><label>Pay before</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="amtwords">{words}</div>
      <div className="two">
        <div className="fld"><label>Pay from</label><select value={payFrom} onChange={(e) => setPayFrom(e.target.value)}><option>Peliswan</option><option>Lemolite</option><option>Shivam</option><option>Zenith</option></select></div>
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
