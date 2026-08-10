// Sound + vibration for notifications.
// The chime is synthesised with WebAudio (no audio file to ship, nothing to
// host) and the buzz uses the standard Vibration API. Both are best-effort:
// unsupported browsers (iOS has no vibration, Safari gates audio) just no-op.

let ctx: AudioContext | null = null;
let lastFiredAt = 0;

type WebAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as WebAudioWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers only allow audio after a user gesture. Create/resume the context on
 * the first tap or keypress so the chime is ready when a notification lands.
 */
export function primeAlertFx(): void {
  if (typeof window === "undefined") return;
  const prime = () => {
    const c = audioContext();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", prime, { once: true, passive: true });
  window.addEventListener("keydown", prime, { once: true });
}

/** A short two-note chime — soft, not a system alarm. */
export function playChime(): void {
  const c = audioContext();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const now = c.currentTime;
  // G5 then C6 — a rising "ding-dong".
  [
    { freq: 784, at: 0 },
    { freq: 1046.5, at: 0.14 },
  ].forEach(({ freq, at }) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Quick attack, gentle decay — avoids the click of a hard on/off.
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.35);
    osc.connect(gain).connect(c.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.4);
  });
}

/** Buzz the phone. No-op on desktop and iOS, which don't support it. */
export function buzz(pattern: number | number[] = [120, 60, 120]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when the page isn't visible */
  }
}

/**
 * Fire both for a new notification. Debounced so the 10s poll and the service
 * worker's push message can't double-buzz for the same event.
 */
export function notifyFx(): void {
  const now = Date.now();
  if (now - lastFiredAt < 3000) return;
  lastFiredAt = now;
  playChime();
  buzz();
}
