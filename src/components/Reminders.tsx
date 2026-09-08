"use client";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, fmtPaise, wordsFromRupees, isoDay, colorFor, initials, fmtHours,
  type MeUser, type Reminder, type ReminderImportResult, type ReminderDefaults, type MyTiming,
} from "@/lib/client";

/* EMI reminders tab. Only Jignesh (manager), Jagat (approver) and Mahesh
   (payer) ever see this — the server enforces the same rule. Jignesh adds
   rows by hand or from a sheet; any of the three can mark one paid, which
   stops the reminders immediately. */

const IcPlus = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>);
const IcClock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const IcSheet = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 4h16v16H4z" /><path d="M4 9h16M4 14h16M9 4v16M15 4v16" /></svg>);

/* Local copy of the app's modal shell — importing it from PayTrackApp would
   make the two files import each other. */
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

/** Same day-of-month N months on, clamped to short months — mirrors the
    server's addMonthsYmd so the preview matches what gets created. */
function lastDueDate(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + (months - 1);
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** 1st, 2nd, 3rd, 4th … — "the 3th" was showing before this existed. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** 'YYYY-MM-DD' shifted by whole days, month and year rollover included. */
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const fmtDay = (ymd: string): string =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Plain-language due label, driven by the server's APP_TZ day count. */
function dueLabel(r: Reminder): { t: string; c: string } {
  const d = r.daysUntilDue;
  if (d < 0) return { t: `${-d}d late`, c: "var(--over)" };
  if (d === 0) return { t: "due today", c: "var(--over)" };
  if (d === 1) return { t: "due tomorrow", c: "var(--sched)" };
  if (d <= 3) return { t: `due in ${d}d`, c: "var(--sched)" };
  return { t: `due in ${d}d`, c: "var(--ink-3)" };
}

export function RemindersPanel({ me, onToast }: { me: MeUser | null; onToast: (m: string, err?: boolean) => void }) {
  const qc = useQueryClient();
  const isManager = me?.isManager ?? false;
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editFor, setEditFor] = useState<Reminder | null>(null);
  const [payFor, setPayFor] = useState<Reminder | null>(null);
  const [deleteFor, setDeleteFor] = useState<Reminder | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);

  const q = useQuery({ queryKey: ["reminders"], queryFn: api.reminders, enabled: !!me, refetchInterval: 30000 });
  const all = useMemo(() => q.data?.reminders ?? [], [q.data]);
  const defaults = q.data?.defaults ?? { sendHours: [11, 21], leadDays: 3 };
  const my: MyTiming = q.data?.my ?? { group: defaults, followsGroup: true, mine: defaults };
  const refresh = () => qc.invalidateQueries({ queryKey: ["reminders"] });

  const mDelete = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: "one" | "series" }) => api.reminderDelete(id, scope),
    onSuccess: (r) => {
      refresh();
      setDeleteFor(null);
      onToast(r.deleted > 1 ? `Removed ${r.deleted} months` : "Reminder removed");
    },
    onError: (e: Error) => onToast(e.message, true),
  });
  const mUndo = useMutation({
    mutationFn: (id: string) => api.reminderUnmarkPaid(id),
    onSuccess: () => { refresh(); onToast("Put back — reminders will start again"); },
    onError: (e: Error) => onToast(e.message, true),
  });

  const nowDue = all.filter((r) => r.status === "PENDING" && r.inWindow).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  const upcoming = all.filter((r) => r.status === "PENDING" && !r.inWindow).sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  const paid = all.filter((r) => r.status === "PAID").sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
  const dueTotal = nowDue.reduce((s, r) => s + BigInt(r.amount), 0n).toString();

  function row(r: Reminder) {
    const lab = dueLabel(r);
    const paidRow = r.status === "PAID";
    return (
      <div key={r.id} className={`remrow ${paidRow ? "done" : r.late || r.daysUntilDue === 0 ? "hot" : ""}`}>
        <div className="remico">{paidRow ? "✅" : r.late ? "⚠️" : "📅"}</div>
        <div className="remmid">
          <div className="remdesc">{r.description}</div>
          {paidRow ? (
            <div className="remmeta">
              Paid {r.paidOn ? fmtDay(r.paidOn) : ""}{r.paidBy ? ` by ${r.paidBy.name}` : ""} · was due {fmtDay(r.dueDate)}
            </div>
          ) : (
            <div className="remmeta">
              Due {fmtDay(r.dueDate)} · <b style={{ color: lab.c }}>{lab.t}</b>
              {r.monthly && <span className="remtag">monthly</span>}
              {r.customTiming && (
                <span className="remtag alt" title={`${r.leadDays}d ahead · ${fmtHours(r.sendHours)}`}>own timing</span>
              )}
            </div>
          )}
          {paidRow && r.paidNote && <div className="remnote">“{r.paidNote}”</div>}
        </div>
        <div className="remright">
          <div className="remamt grotesk">{fmtPaise(r.amount)}</div>
          <div className="rembtns">
            {!paidRow && <button className="btn btn-paid sm" onClick={() => setPayFor(r)}>✓ Paid</button>}
            {isManager && !paidRow && <button className="rembtn" title="Edit" onClick={() => setEditFor(r)}>✏️</button>}
            {isManager && paidRow && <button className="rembtn" title="Undo paid" onClick={() => mUndo.mutate(r.id)}>↺</button>}
            {isManager && (
              <button
                className="rembtn"
                title="Delete"
                onClick={() => {
                  // A monthly run asks which months to drop; a one-off just confirms.
                  if (r.monthly) setDeleteFor(r);
                  else if (window.confirm(`Delete "${r.description}" permanently?`)) mDelete.mutate({ id: r.id, scope: "one" });
                }}
              >🗑️</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rempanel">
      <div className="remhead">
        <div>
          <h3>EMI reminders</h3>
          <p>
            You get reminded {my.mine.leadDays === 0 ? "on the due date" : `${my.mine.leadDays} day${my.mine.leadDays === 1 ? "" : "s"} ahead`},
            at {fmtHours(my.mine.sendHours)}, then every day until someone marks it paid.
            {my.followsGroup ? " That's the group setting." : " That's your own setting."}
          </p>
        </div>
        <div className="remtools">
          <button className="btn btn-ghost sm" onClick={() => setTimingOpen(true)}><IcClock />Timing</button>
          {isManager && (
            <>
              <button className="btn btn-ghost sm" onClick={() => setImportOpen(true)}><IcSheet />Import sheet</button>
              <button className="btn btn-primary sm" onClick={() => setAddOpen(true)}><IcPlus />Add</button>
            </>
          )}
        </div>
      </div>

      {nowDue.length > 0 && (
        <div className="remsum">
          <b>{nowDue.length}</b> to pay now · <b>{fmtPaise(dueTotal)}</b>
        </div>
      )}

      {q.isLoading && <div className="remempty">Loading…</div>}

      {!q.isLoading && all.length === 0 && (
        <div className="remempty">
          <div className="big">📅</div>
          <h4>No reminders yet</h4>
          <p>{isManager ? "Add one, or import your sheet — due date, description, amount." : "Jignesh hasn't added any yet."}</p>
        </div>
      )}

      {nowDue.length > 0 && <><div className="remsec">Pay these</div>{nowDue.map(row)}</>}
      {upcoming.length > 0 && <><div className="remsec">Coming up</div>{upcoming.map(row)}</>}
      {paid.length > 0 && (
        <>
          <button type="button" className="remsec toggle" onClick={() => setShowPaid((v) => !v)}>
            <span>Paid ({paid.length})</span><span className={`chev ${showPaid ? "open" : ""}`}>▾</span>
          </button>
          {showPaid && paid.map(row)}
        </>
      )}

      {addOpen && <ReminderSheet defaults={defaults} onClose={() => setAddOpen(false)} onDone={(m) => { refresh(); setAddOpen(false); onToast(m); }} onError={(m) => onToast(m, true)} />}
      {editFor && <ReminderSheet initial={editFor} defaults={defaults} onClose={() => setEditFor(null)} onDone={(m) => { refresh(); setEditFor(null); onToast(m); }} onError={(m) => onToast(m, true)} />}
      {payFor && <MarkPaidSheet reminder={payFor} me={me} onClose={() => setPayFor(null)} onDone={(m) => { refresh(); setPayFor(null); onToast(m); }} onError={(m) => onToast(m, true)} />}
      {timingOpen && (
        <TimingSheet
          my={my}
          isManager={isManager}
          defaults={defaults}
          onClose={() => setTimingOpen(false)}
          onDone={(m) => { refresh(); setTimingOpen(false); onToast(m); }}
          onError={(m) => onToast(m, true)}
        />
      )}
      {deleteFor && (
        <DeleteSeriesSheet
          reminder={deleteFor}
          busy={mDelete.isPending}
          onClose={() => setDeleteFor(null)}
          onDelete={(scope) => mDelete.mutate({ id: deleteFor.id, scope })}
        />
      )}
      {importOpen && <ImportSheet onClose={() => setImportOpen(false)} onDone={(m) => { refresh(); setImportOpen(false); onToast(m); }} onError={(m) => onToast(m, true)} />}
    </div>
  );
}

/* Hour picker — a row of 0-23 toggles. Clearer than a free-text field, and it
   can't produce an invalid hour. */
function HourPicker({ value, onChange }: { value: number[]; onChange: (h: number[]) => void }) {
  const toggle = (h: number) =>
    onChange(value.includes(h) ? value.filter((x) => x !== h).sort((a, b) => a - b) : [...value, h].sort((a, b) => a - b));
  return (
    <div className="hourgrid">
      {Array.from({ length: 24 }, (_, h) => (
        <button
          key={h}
          type="button"
          className={`hourcell ${value.includes(h) ? "on" : ""}`}
          onClick={() => toggle(h)}
          aria-pressed={value.includes(h)}
        >
          {String(h).padStart(2, "0")}
        </button>
      ))}
    </div>
  );
}

function LeadDaysField({
  value, onChange, dueDate,
}: { value: string; onChange: (v: string) => void; dueDate?: string }) {
  const n = Number(value);
  const ok = Number.isInteger(n) && n >= 0 && n <= 60;

  // Spelling it out against the date actually chosen beats an abstract example.
  let hint: string;
  if (!ok) hint = "Enter a number from 0 to 60.";
  else if (n === 0) hint = "Only on the due date itself, then daily until paid.";
  else if (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    hint = `Due ${fmtDay(dueDate)} → first reminder ${fmtDay(addDaysYmd(dueDate, -n))}, then daily until paid.`;
  } else {
    const due = 10;
    hint = `Due on the ${ordinal(due)} → first reminder on the ${ordinal(due - n)}, then daily until paid.`;
  }

  return (
    <div className="fld">
      <label>Start reminding this many days ahead</label>
      <div className="remmonths">
        <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
        <span>days before it&apos;s due</span>
      </div>
      <div className="amtwords">{hint}</div>
    </div>
  );
}

/* ── timing: mine, and (for Jignesh) the group's ───────────────────── */
function TimingSheet({
  my, isManager, defaults, onClose, onDone, onError,
}: {
  my: MyTiming; isManager: boolean; defaults: ReminderDefaults;
  onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<"mine" | "group">("mine");

  // ── my own ──
  const [followGroup, setFollowGroup] = useState(my.followsGroup);
  const [myHours, setMyHours] = useState<number[]>(my.mine.sendHours);
  const [myLead, setMyLead] = useState(String(my.mine.leadDays));
  const myLeadN = Number(myLead);
  const mineOk = followGroup || (myHours.length > 0 && Number.isInteger(myLeadN) && myLeadN >= 0 && myLeadN <= 60);

  const mSaveMine = useMutation({
    mutationFn: () =>
      api.myTimingSave(followGroup ? { sendHours: null, leadDays: null } : { sendHours: myHours, leadDays: myLeadN }),
    onSuccess: () => onDone(followGroup ? "You now follow the group timing" : "Your timing saved"),
    onError: (e: Error) => onError(e.message),
  });

  // ── the group's ──
  const [gHours, setGHours] = useState<number[]>(defaults.sendHours);
  const [gLead, setGLead] = useState(String(defaults.leadDays));
  const gLeadN = Number(gLead);
  const groupOk = gHours.length > 0 && Number.isInteger(gLeadN) && gLeadN >= 0 && gLeadN <= 60;

  const mSaveGroup = useMutation({
    mutationFn: () => api.reminderSettingsSave({ sendHours: gHours, leadDays: gLeadN }),
    onSuccess: () => onDone("Group timing saved"),
    onError: (e: Error) => onError(e.message),
  });

  const busy = mSaveMine.isPending || mSaveGroup.isPending;
  const onMine = tab === "mine";

  return (
    <Sheet
      title="Reminder timing"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || (onMine ? !mineOk : !groupOk)}
            onClick={() => (onMine ? mSaveMine.mutate() : mSaveGroup.mutate())}
          >
            {busy ? "Saving…" : onMine ? "Save my timing" : "Save group timing"}
          </button>
        </>
      }
    >
      {isManager && (
        <div className="timingtabs">
          <button type="button" className={onMine ? "on" : ""} onClick={() => setTab("mine")}>Just me</button>
          <button type="button" className={!onMine ? "on" : ""} onClick={() => setTab("group")}>Everyone</button>
        </div>
      )}

      {onMine ? (
        <>
          <p>How far ahead <b>you</b> want to hear about an EMI. It changes nothing for anyone else.</p>
          <div className="fld">
            <label className="remcheck">
              <input type="checkbox" checked={followGroup} onChange={(e) => setFollowGroup(e.target.checked)} />
              <span>Use the group timing</span>
            </label>
            {followGroup ? (
              <div className="amtwords">
                {my.group.leadDays === 0 ? "On the due date" : `${my.group.leadDays} days ahead`}, at {fmtHours(my.group.sendHours)}.
              </div>
            ) : (
              <div className="subfld">
                <div className="fld">
                  <label>Send at</label>
                  <HourPicker value={myHours} onChange={setMyHours} />
                  <div className="amtwords">{myHours.length ? fmtHours(myHours) : "Pick at least one time."}</div>
                </div>
                <LeadDaysField value={myLead} onChange={setMyLead} />
              </div>
            )}
          </div>
          <p>
            If an EMI is set to need more notice than you asked for, you still get it earlier — nobody
            hears about something later than the EMI demands.
          </p>
        </>
      ) : (
        <>
          <p>The group setting. It applies to everyone who hasn&apos;t chosen their own.</p>
          <div className="fld">
            <label>Send at</label>
            <HourPicker value={gHours} onChange={setGHours} />
            <div className="amtwords">{gHours.length ? `${fmtHours(gHours)} — India time.` : "Pick at least one time."}</div>
          </div>
          <LeadDaysField value={gLead} onChange={setGLead} />
          <p>Anyone who set their own timing keeps it. This never restarts reminders on anything already paid.</p>
        </>
      )}
    </Sheet>
  );
}

/* ── add / edit one reminder ───────────────────────────────────────── */
function ReminderSheet({
  initial, defaults, onClose, onDone, onError,
}: {
  initial?: Reminder; defaults: ReminderDefaults;
  onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? isoDay());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rupees, setRupees] = useState(initial ? String(Number(initial.amount) / 100) : "");
  // Editing touches only the month in front of you — the repeat is set once, at
  // creation, because changing it later would mean rewriting the whole run.
  const [monthly, setMonthly] = useState(false);
  const [months, setMonths] = useState("12");
  // Off = inherit the house default, which is what almost every EMI wants.
  const [ownTiming, setOwnTiming] = useState(initial?.customTiming ?? false);
  const [hours, setHours] = useState<number[]>(initial?.sendHours ?? defaults.sendHours);
  const [lead, setLead] = useState(String(initial?.leadDays ?? defaults.leadDays));

  const amountPaise = (() => {
    const n = Number(rupees);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100)) : "";
  })();

  const repeatMonths = monthly ? Number(months) : 1;
  const repeatOk = !monthly || (Number.isInteger(repeatMonths) && repeatMonths >= 1 && repeatMonths <= 120);

  const leadN = Number(lead);
  const timingOk = !ownTiming || (hours.length > 0 && Number.isInteger(leadN) && leadN >= 0 && leadN <= 60);
  // null explicitly clears an override back to the default.
  const timing = ownTiming ? { sendHours: hours, leadDays: leadN } : { sendHours: null, leadDays: null };

  const m = useMutation({
    mutationFn: () => {
      const body = { description: description.trim(), amount: amountPaise, dueDate, ...timing };
      return initial ? api.reminderUpdate(initial.id, body) : api.reminderCreate({ ...body, repeatMonths });
    },
    onSuccess: () =>
      onDone(
        initial ? "Reminder updated"
          : repeatMonths > 1 ? `Added ${repeatMonths} monthly reminders`
          : "Reminder added",
      ),
    onError: (e: Error) => onError(e.message),
  });

  const ready = !!description.trim() && !!amountPaise && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && repeatOk && timingOk;

  return (
    <Sheet
      title={initial ? "Edit reminder" : "New reminder"}
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={!ready || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : initial ? "Save changes" : "Add reminder"}
          </button>
        </>
      }
    >
      <div className="fld"><label>Due date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      <div className="fld"><label>EMI description</label><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Car loan EMI — HDFC" /></div>
      <div className="fld">
        <label>Amount</label>
        <div className="amtin"><span>₹</span><input inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} placeholder="45000" /></div>
        <div className="amtwords">{Number(rupees) > 0 ? wordsFromRupees(Number(rupees)) : ""}</div>
      </div>
      {!initial && (
        <div className="fld">
          <label className="remcheck">
            <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
            <span>This repeats every month</span>
          </label>
          {monthly && (
            <div className="subfld">
              <div className="remmonths">
                <span>for</span>
                <input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
                <span>months</span>
              </div>
              <div className="amtwords">
                {repeatOk
                  ? `${repeatMonths} reminders · ${fmtDay(dueDate)} to ${fmtDay(lastDueDate(dueDate, repeatMonths))}`
                  : "Enter a number from 1 to 120."}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="fld">
        <label className="remcheck">
          <input type="checkbox" checked={ownTiming} onChange={(e) => setOwnTiming(e.target.checked)} />
          <span>Give this one its own timing</span>
        </label>
        {!ownTiming ? (
          <div className="amtwords">
            Uses the house default — {defaults.leadDays === 0 ? "on the due date" : `${defaults.leadDays} days ahead`}, at {fmtHours(defaults.sendHours)}.
          </div>
        ) : (
          <div className="subfld">
            <div className="fld">
              <label>Send at</label>
              <HourPicker value={hours} onChange={setHours} />
              <div className="amtwords">{hours.length ? fmtHours(hours) : "Pick at least one time."}</div>
            </div>
            <LeadDaysField value={lead} onChange={setLead} dueDate={dueDate} />
          </div>
        )}
      </div>
      <p>Reminders repeat every day past the due date until someone marks that month paid.</p>
    </Sheet>
  );
}

/* ── mark one paid ─────────────────────────────────────────────────── */
function MarkPaidSheet({
  reminder, me, onClose, onDone, onError,
}: { reminder: Reminder; me: MeUser | null; onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [paidOn, setPaidOn] = useState(isoDay());
  const [note, setNote] = useState("");

  const m = useMutation({
    mutationFn: () => api.reminderMarkPaid(reminder.id, { paidOn, note: note.trim() }),
    onSuccess: () => onDone("Marked paid — reminders stopped"),
    onError: (e: Error) => onError(e.message),
  });

  return (
    <Sheet
      title="Mark this paid"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-paid" style={{ flex: 1 }} disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : "✓ I paid this"}
          </button>
        </>
      }
    >
      <div className="rempaidhead">
        <div className="av" style={{ background: colorFor(me?.name ?? "") }}>{initials(me?.name ?? "?")}</div>
        <div>
          <div className="remdesc">{reminder.description}</div>
          <div className="remmeta">{fmtPaise(reminder.amount)} · was due {fmtDay(reminder.dueDate)}</div>
        </div>
      </div>
      <div className="fld"><label>Paid on</label><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
      <div className="fld"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid from Zenith" /></div>
      <p>Everyone stops getting reminders for this one straight away.</p>
    </Sheet>
  );
}

/* ── deleting one month vs the whole run ───────────────────────────── */
function DeleteSeriesSheet({
  reminder, busy, onClose, onDelete,
}: { reminder: Reminder; busy: boolean; onClose: () => void; onDelete: (scope: "one" | "series") => void }) {
  return (
    <Sheet
      title="Delete this reminder"
      onClose={onClose}
      foot={<button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
    >
      <div className="rempaidhead">
        <div className="remico">📅</div>
        <div>
          <div className="remdesc">{reminder.description}</div>
          <div className="remmeta">{fmtPaise(reminder.amount)} · due {fmtDay(reminder.dueDate)} · repeats monthly</div>
        </div>
      </div>
      <p>This is one month of a monthly EMI. Which do you want to remove?</p>
      <button className="btn btn-ghost" disabled={busy} onClick={() => onDelete("one")}>
        Just this month
      </button>
      <button className="btn btn-ghost del" disabled={busy} onClick={() => onDelete("series")}>
        This month and every month after it
      </button>
      <p>Months already marked paid are kept either way — they&apos;re the record of what you actually paid.</p>
    </Sheet>
  );
}

/* ── import a sheet ────────────────────────────────────────────────── */
function ImportSheet({
  onClose, onDone, onError,
}: { onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ReminderImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview first, always — the sheet is shown back before anything is saved.
  const mCheck = useMutation({
    mutationFn: () => api.reminderImport(csv, true),
    onSuccess: (r) => setPreview(r),
    onError: (e: Error) => onError(e.message),
  });
  const mCommit = useMutation({
    mutationFn: () => api.reminderImport(csv, false),
    onSuccess: (r) => onDone(`Imported ${r.imported} reminder${r.imported === 1 ? "" : "s"}`),
    onError: (e: Error) => onError(e.message),
  });

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) { onError("That file is too big (max 2 MB)."); return; }
    setCsv(await f.text());
    setPreview(null);
  }

  return (
    <Sheet
      title="Import reminders"
      onClose={onClose}
      foot={
        preview ? (
          <>
            <button className="btn btn-ghost" onClick={() => setPreview(null)}>Back</button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={!preview.rows.length || mCommit.isPending} onClick={() => mCommit.mutate()}>
              {mCommit.isPending
                ? "Importing…"
                : `Import ${preview.rows.reduce((n, r) => n + Math.max(1, r.repeatMonths), 0)} reminders`}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={!csv.trim() || mCheck.isPending} onClick={() => mCheck.mutate()}>
              {mCheck.isPending ? "Checking…" : "Check the sheet"}
            </button>
          </>
        )
      }
    >
      {!preview ? (
        <>
          <p>
            Columns in this order: <b>due date, EMI description, amount</b>, and optionally
            <b> repeat</b>. A header row is fine. Dates can be 06/09/2026, 06-09-2026 or
            2026-09-06 — day first.
          </p>
          <p>
            Leave the 4th column empty for a one-off. Put <b>36</b> in it for a 36-month EMI, or a
            date like <b>06/08/2029</b> to repeat until then — one line becomes the whole schedule.
          </p>
          <p>
            Two more optional columns set timing per row: <b>5th</b> = days ahead to start
            reminding, <b>6th</b> = send times as hours, e.g. <b>9,18</b>. Leave either blank and
            that row follows the house default.
          </p>
          <div className="fld">
            <label>Upload a CSV</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>
          <div className="fld">
            <label>…or paste the rows straight from your sheet</label>
            <textarea
              rows={7}
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
              placeholder={"06/09/2026, Car loan EMI — HDFC, 45000, 36, 5, \"9,18\"\n10/09/2026, Office rent, 120000"}
            />
          </div>
        </>
      ) : (
        <>
          <div className="impsum">
            <b>{preview.rows.length}</b> line{preview.rows.length === 1 ? "" : "s"} ready
            {preview.rows.some((r) => r.repeatMonths > 1) && (
              <> · <b>{preview.rows.reduce((n, r) => n + Math.max(1, r.repeatMonths), 0)}</b> reminders once the monthly ones are expanded</>
            )}
            {preview.duplicates.length > 0 && <> · {preview.duplicates.length} already added</>}
            {preview.errors.length > 0 && <> · <span style={{ color: "var(--over)" }}>{preview.errors.length} couldn&apos;t be read</span></>}
          </div>
          {preview.rows.length > 0 && (
            <div className="imptable">
              {preview.rows.map((r) => (
                <div key={r.line} className="improw">
                  <span className="impdate">{fmtDay(r.dueDate)}</span>
                  <span className="impdesc">
                    {r.description}
                    {r.repeatMonths > 1 && <span className="remtag">×{r.repeatMonths} months</span>}
                    {(r.leadDays !== null || r.sendHours) && (
                      <span className="remtag alt">
                        {r.leadDays !== null ? `${r.leadDays}d ahead` : ""}
                        {r.leadDays !== null && r.sendHours ? " · " : ""}
                        {r.sendHours ? fmtHours(r.sendHours) : ""}
                      </span>
                    )}
                  </span>
                  <span className="impamt grotesk">{fmtPaise(r.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {preview.duplicates.length > 0 && (
            <>
              <div className="remsec">Already in the list — skipped</div>
              <div className="imptable dim">
                {preview.duplicates.map((r) => (
                  <div key={`d${r.line}`} className="improw">
                    <span className="impdate">{fmtDay(r.dueDate)}</span>
                    <span className="impdesc">{r.description}</span>
                    <span className="impamt grotesk">{fmtPaise(r.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {preview.errors.length > 0 && (
            <>
              <div className="remsec">Couldn&apos;t read these</div>
              <div className="imptable bad">
                {preview.errors.map((e) => (
                  <div key={`e${e.line}`} className="improw err">
                    <span className="impdate">Line {e.line}</span>
                    <span className="impdesc">{e.message}<em>{e.raw}</em></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
