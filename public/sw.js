// Service worker — PWA install + Web Push notifications.
// Network-first shell cache; API calls always hit the network (never cached),
// so payment data is never served stale.
const CACHE = "paytrack-v2";
const SHELL = ["/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // never cache API
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("/"))),
  );
});

// ── Web Push ─────────────────────────────────────────────────────────
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "PayTrack", body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "PayTrack";
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: data.tag,
        renotify: !!data.tag, // a repeat on the same tag should still buzz
        silent: false, // let the OS play its notification sound
        vibrate: [120, 60, 120],
        data: { url: data.url || "/" },
      }),
      // If a tab is open, ask it to play the in-app chime + buzz — an open page
      // often suppresses the OS notification sound.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: "paytrack-notify" })))
        .catch(() => {}),
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
