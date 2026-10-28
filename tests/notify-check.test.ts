// Delivery accounting and the "is everyone getting alerts?" check, against a
// fake push service and an in-memory stand-in for the database. What's being
// tested is the bookkeeping: who was reached, whose device went quiet, and
// which devices get pruned.
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Sub {
  id: string; userId: string; endpoint: string; p256dh: string; auth: string;
  createdAt: Date; device: string | null;
  lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null;
  failureCount: number;
}
interface U {
  id: string; name: string; role: "ADMIN" | "USER"; active: boolean;
  isPayer: boolean; isApprover: boolean; isManager: boolean;
}

const store: { users: U[]; subs: Sub[] } = { users: [], subs: [] };

/** Endpoint -> what the push service does. Default: accept. */
let behaviour: Record<string, "ok" | number> = {};

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (sub: { endpoint: string }) => {
      const b = behaviour[sub.endpoint] ?? "ok";
      if (b === "ok") return Promise.resolve();
      const err = new Error(`push rejected (${b})`) as Error & { statusCode: number };
      err.statusCode = b;
      return Promise.reject(err);
    },
  },
}));

type Where = {
  userId?: string; active?: boolean; id?: { in: string[] };
  isPayer?: boolean; isApprover?: boolean;
};

vi.mock("@/lib/db", () => ({
  prisma: {
    pushSubscription: {
      findMany: async ({ where }: { where: Where }) => store.subs.filter((s) => s.userId === where.userId),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = store.subs.find((x) => x.id === where.id);
        if (!s) throw new Error("no such subscription");
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) {
            (s as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else {
            (s as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return s;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = store.subs.findIndex((x) => x.id === where.id);
        if (i >= 0) store.subs.splice(i, 1);
        return {};
      },
    },
    user: {
      findMany: async ({ where = {}, include }: { where?: Where; include?: { pushSubscriptions?: unknown } }) => {
        let rows = store.users.filter((u) => where.active === undefined || u.active === where.active);
        if (where.id?.in) rows = rows.filter((u) => where.id!.in.includes(u.id));
        if (where.isPayer !== undefined) rows = rows.filter((u) => u.isPayer === where.isPayer);
        if (where.isApprover !== undefined) rows = rows.filter((u) => u.isApprover === where.isApprover);
        return rows.map((u) =>
          include?.pushSubscriptions ? { ...u, pushSubscriptions: store.subs.filter((s) => s.userId === u.id) } : u,
        );
      },
    },
  },
}));

function person(id: string, name: string, extra: Partial<U> = {}): U {
  return { id, name, role: "ADMIN", active: true, isPayer: false, isApprover: false, isManager: false, ...extra };
}
let subSeq = 0;
function device(userId: string, label: string, extra: Partial<Sub> = {}): Sub {
  subSeq++;
  return {
    id: `s${subSeq}`, userId, endpoint: `https://push.example/${userId}/${subSeq}`,
    p256dh: "k", auth: "a", createdAt: new Date("2026-10-01"), device: label,
    lastSuccessAt: null, lastFailureAt: null, lastError: null, failureCount: 0, ...extra,
  };
}

beforeEach(() => {
  vi.resetModules();
  store.users = [];
  store.subs = [];
  behaviour = {};
  subSeq = 0;
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
});

const payload = { title: "t", body: "b" };

describe("sendPushToUser — delivery accounting", () => {
  it("reports how many of a person's devices were reached", async () => {
    store.users = [person("u1", "Mahesh")];
    store.subs = [device("u1", "Android · Chrome"), device("u1", "Mac · Safari")];
    const { sendPushToUser } = await import("@/lib/push");

    const r = await sendPushToUser("u1", payload);
    expect(r).toMatchObject({ userId: "u1", devices: 2, delivered: 2, failed: 0, dropped: 0 });
    expect(r.miss).toBeUndefined();
    // A success clears the failure streak and stamps the time.
    expect(store.subs.every((s) => s.lastSuccessAt !== null && s.failureCount === 0)).toBe(true);
  });

  it("says plainly when someone has no device registered", async () => {
    store.users = [person("u1", "Payal")];
    const { sendPushToUser } = await import("@/lib/push");
    const r = await sendPushToUser("u1", payload);
    expect(r.miss).toBe("no-device");
    expect(r.delivered).toBe(0);
  });

  it("says plainly when the server has no push keys, instead of looking sent", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    store.users = [person("u1", "Mahesh")];
    store.subs = [device("u1", "Android · Chrome")];
    const { sendPushToUser } = await import("@/lib/push");
    const r = await sendPushToUser("u1", payload);
    expect(r.miss).toBe("not-configured");
    expect(r.delivered).toBe(0);
  });

  it("records a failure against the device so a quiet phone is visible", async () => {
    store.users = [person("u1", "Mahesh")];
    const d = device("u1", "Android · Chrome");
    store.subs = [d];
    behaviour[d.endpoint] = 500;
    const { sendPushToUser } = await import("@/lib/push");

    const r = await sendPushToUser("u1", payload);
    expect(r).toMatchObject({ devices: 1, delivered: 0, failed: 1, dropped: 0 });
    expect(store.subs[0].failureCount).toBe(1);
    expect(store.subs[0].lastFailureAt).not.toBeNull();
    expect(store.subs[0].lastError).toContain("500");
  });

  it("drops a subscription the browser has thrown away (410), keeping others", async () => {
    store.users = [person("u1", "Mahesh")];
    const gone = device("u1", "old phone");
    const live = device("u1", "new phone");
    store.subs = [gone, live];
    behaviour[gone.endpoint] = 410;
    const { sendPushToUser } = await import("@/lib/push");

    const r = await sendPushToUser("u1", payload);
    expect(r).toMatchObject({ devices: 2, delivered: 1, dropped: 1, failed: 0 });
    expect(store.subs.map((s) => s.device)).toEqual(["new phone"]);
  });

  it("counts a partial delivery as partial, not as success", async () => {
    store.users = [person("u1", "Mahesh")];
    const bad = device("u1", "phone");
    const good = device("u1", "laptop");
    store.subs = [bad, good];
    behaviour[bad.endpoint] = 429;
    const { sendPushToUser } = await import("@/lib/push");

    const r = await sendPushToUser("u1", payload);
    expect(r).toMatchObject({ devices: 2, delivered: 1, failed: 1 });
  });
});

describe("fan-out to payers and approvers", () => {
  beforeEach(() => {
    store.users = [
      person("mahesh", "Mahesh", { isPayer: true }),
      person("jagat", "Jagat", { isApprover: true }),
      person("payal", "Payal", { role: "USER" }),
      person("gone", "Ex-staff", { isPayer: true, active: false }),
    ];
    store.subs = [device("mahesh", "phone"), device("jagat", "phone"), device("payal", "phone"), device("gone", "phone")];
  });

  it("reaches every active payer and nobody else", async () => {
    const { sendPushToPayers } = await import("@/lib/push");
    const rs = await sendPushToPayers(payload);
    expect(rs.map((r) => r.userId)).toEqual(["mahesh"]);
    expect(rs[0].delivered).toBe(1);
  });

  it("reaches every active approver", async () => {
    const { sendPushToApprovers } = await import("@/lib/push");
    const rs = await sendPushToApprovers(payload);
    expect(rs.map((r) => r.userId)).toEqual(["jagat"]);
  });

  it("never sends twice to someone listed twice", async () => {
    const { sendPushToUsers } = await import("@/lib/push");
    const rs = await sendPushToUsers(["mahesh", "mahesh", "jagat"], payload);
    expect(rs).toHaveLength(2);
  });

  it("leaves a deactivated person out of the fan-out", async () => {
    const { sendPushToPayers } = await import("@/lib/push");
    const rs = await sendPushToPayers(payload);
    expect(rs.some((r) => r.userId === "gone")).toBe(false);
  });
});

describe("alertsFor — what each role is pinged about", () => {
  it("tells a payer about payments to pay and the digest", async () => {
    const { alertsFor } = await import("@/lib/notify-check");
    const list = alertsFor({ isPayer: true, isApprover: false });
    expect(list).toContain("Payments to pay");
    expect(list).toContain("The reminder digest");
    expect(list).toContain("Chat messages");
  });

  it("tells an approver about approvals, not about paying", async () => {
    const { alertsFor } = await import("@/lib/notify-check");
    const list = alertsFor({ isPayer: false, isApprover: true });
    expect(list).toContain("Requests needing approval");
    expect(list).not.toContain("Payments to pay");
  });

  it("warns, in effect, that someone with no duties only hears about their own", async () => {
    const { alertsFor } = await import("@/lib/notify-check");
    expect(alertsFor({ isPayer: false, isApprover: false })).toEqual(["Payments they raise"]);
  });
});

describe("alertsOverview — the team check", () => {
  it("marks a person with a healthy device as on", async () => {
    store.users = [person("u1", "Mahesh", { isPayer: true })];
    store.subs = [device("u1", "Android · Chrome", { lastSuccessAt: new Date("2026-10-27") })];
    const { alertsOverview } = await import("@/lib/notify-check");
    const o = await alertsOverview();
    expect(o.people[0].state).toBe("on");
    expect(o.people[0].lastDeliveredAt).toEqual(new Date("2026-10-27"));
    expect(o).toMatchObject({ on: 1, failing: 0, off: 0 });
  });

  it("marks a person with no device as off, so they can be chased", async () => {
    store.users = [person("u1", "Payal", { role: "USER" })];
    const { alertsOverview } = await import("@/lib/notify-check");
    const o = await alertsOverview();
    expect(o.people[0].state).toBe("off");
    expect(o.people[0].devices).toEqual([]);
    expect(o.off).toBe(1);
  });

  it("marks a device that keeps failing as failing, not as on", async () => {
    store.users = [person("u1", "Umang")];
    store.subs = [device("u1", "phone", { failureCount: 3 })];
    const { alertsOverview } = await import("@/lib/notify-check");
    const o = await alertsOverview();
    expect(o.people[0].state).toBe("failing");
    expect(o.people[0].devices[0].healthy).toBe(false);
    expect(o).toMatchObject({ on: 0, failing: 1 });
  });

  it("still counts a person as on when one of their two devices works", async () => {
    store.users = [person("u1", "Mahesh")];
    store.subs = [device("u1", "dead phone", { failureCount: 7 }), device("u1", "good phone")];
    const { alertsOverview } = await import("@/lib/notify-check");
    expect((await alertsOverview()).people[0].state).toBe("on");
  });

  it("leaves deactivated people out of the check entirely", async () => {
    store.users = [person("u1", "Mahesh"), person("u2", "Ex-staff", { active: false })];
    const { alertsOverview } = await import("@/lib/notify-check");
    const o = await alertsOverview();
    expect(o.people.map((p) => p.name)).toEqual(["Mahesh"]);
  });

  it("reports that nothing is really being sent when push keys are missing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    store.users = [person("u1", "Mahesh")];
    const { alertsOverview } = await import("@/lib/notify-check");
    expect((await alertsOverview()).configured).toBe(false);
  });
});

describe("sendTestPush", () => {
  it("names each person alongside their result", async () => {
    store.users = [person("u1", "Mahesh"), person("u2", "Payal", { role: "USER" })];
    store.subs = [device("u1", "phone")];
    const { sendTestPush } = await import("@/lib/notify-check");

    const rs = await sendTestPush(["u1", "u2"], "Jagat");
    expect(rs.find((r) => r.name === "Mahesh")).toMatchObject({ delivered: 1 });
    expect(rs.find((r) => r.name === "Payal")).toMatchObject({ miss: "no-device" });
  });

  it("skips a deactivated person asked for by id", async () => {
    store.users = [person("u1", "Ex-staff", { active: false })];
    const { sendTestPush } = await import("@/lib/notify-check");
    expect(await sendTestPush(["u1"], "Jagat")).toEqual([]);
  });
});
