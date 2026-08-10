// Exercises the notification chime/buzz against stubbed browser APIs — the
// oscillators and vibration calls are real, the audio hardware is not.
import { describe, it, expect, beforeEach, vi } from "vitest";

interface StubNode { connect: (n: unknown) => StubNode }
const started: number[] = [];
const buzzes: (number | number[])[] = [];
let ctxState = "running";

function stubAudio() {
  started.length = 0;
  const node = (): StubNode => ({ connect: () => node() });
  return class {
    state = ctxState;
    currentTime = 0;
    resume() { this.state = "running"; return Promise.resolve(); }
    createGain() {
      return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => node() };
    }
    createOscillator() {
      return { type: "", frequency: { value: 0 }, connect: () => node(), start: (t: number) => started.push(t), stop: () => {} };
    }
  };
}

beforeEach(() => {
  vi.resetModules();
  buzzes.length = 0;
  ctxState = "running";
  vi.stubGlobal("window", { AudioContext: stubAudio(), addEventListener: () => {} });
  vi.stubGlobal("navigator", { vibrate: (p: number | number[]) => { buzzes.push(p); return true; } });
});

describe("notification chime + buzz", () => {
  it("plays two tones and vibrates", async () => {
    const { notifyFx } = await import("../src/lib/alert-fx");
    notifyFx();
    expect(started).toHaveLength(2); // a two-note chime
    expect(buzzes).toEqual([[120, 60, 120]]);
  });

  it("debounces, so the poll and the service worker can't double-buzz", async () => {
    const { notifyFx } = await import("../src/lib/alert-fx");
    notifyFx();
    notifyFx(); // same event arriving via the other path
    expect(buzzes).toHaveLength(1);
  });

  it("resumes a suspended audio context instead of staying silent", async () => {
    ctxState = "suspended";
    const { playChime } = await import("../src/lib/alert-fx");
    playChime();
    expect(started).toHaveLength(2);
  });

  it("is a no-op where vibration or audio is missing (iOS, old browsers)", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { addEventListener: () => {} }); // no AudioContext
    const { notifyFx } = await import("../src/lib/alert-fx");
    expect(() => notifyFx()).not.toThrow();
    expect(buzzes).toHaveLength(0);
  });
});
