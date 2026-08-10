// Loads the real public/sw.js into a sandbox and fires a push event at it, so
// the notification options (sound, vibration, renotify) are checked as shipped
// rather than as remembered.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

type Listener = (e: unknown) => void;
type Shown = { title: string; opts: Record<string, unknown> };

const shown: Shown[] = [];
const posted: unknown[] = [];
const listeners: Record<string, Listener> = {};

beforeAll(() => {
  const sw = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
  const self = {
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: (title: string, opts: Record<string, unknown>) => {
        shown.push({ title, opts });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([{ postMessage: (m: unknown) => posted.push(m) }]),
    },
  };
  const caches = { open: () => Promise.resolve({ addAll: () => Promise.resolve() }), keys: () => Promise.resolve([]) };
  vm.runInNewContext(sw, { self, caches, fetch: () => Promise.resolve(), URL, Promise, console });
});

async function firePush(payload: unknown) {
  shown.length = 0;
  posted.length = 0;
  let waited: Promise<unknown> = Promise.resolve();
  listeners.push({
    data: { json: () => payload, text: () => JSON.stringify(payload) },
    waitUntil: (p: Promise<unknown>) => { waited = p; },
  } as never);
  await waited;
}

describe("service worker push handler", () => {
  it("asks for vibration and lets the OS play its sound", async () => {
    await firePush({ title: "Payment paid", body: "₹45,000 to Acme", tag: "pay-1", url: "/p/1" });
    expect(shown).toHaveLength(1);
    const { opts } = shown[0];
    expect(opts.vibrate).toEqual([120, 60, 120]);
    expect(opts.silent).toBe(false);
    expect(opts.renotify).toBe(true); // tag present → a repeat still buzzes
  });

  it("does not set renotify without a tag (the browser rejects that pairing)", async () => {
    await firePush({ title: "Nudge", body: "Please pay" });
    expect(shown[0].opts.renotify).toBe(false);
  });

  it("tells open tabs to chime, since an open page mutes the OS sound", async () => {
    await firePush({ title: "New request", body: "₹500", tag: "req-9" });
    expect(posted).toEqual([{ type: "paytrack-notify" }]);
  });

  it("still notifies when the payload is not JSON", async () => {
    shown.length = 0;
    let waited: Promise<unknown> = Promise.resolve();
    listeners.push({
      data: { json: () => { throw new Error("not json"); }, text: () => "plain text" },
      waitUntil: (p: Promise<unknown>) => { waited = p; },
    } as never);
    await waited;
    expect(shown[0].title).toBe("PayTrack");
    expect(shown[0].opts.vibrate).toEqual([120, 60, 120]);
  });
});
