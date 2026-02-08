/* Day Timeline Tracker - Service Worker (offline cache) */
const CACHE_NAME = "day-tracker-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./dexie.min.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // runtime cache same-origin GETs
      if (req.method === "GET" && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});

/* Optional: handle push if you later add a push server */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  const title = data.title || "Day Tracker";
  const options = {
    body: data.body || "Reminder",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: data.data || {}
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({type: "window", includeUncontrolled: true});
    if (allClients.length) {
      allClients[0].focus();
      allClients[0].postMessage({type: "notif_click", data: event.notification.data || {}});
      return;
    }
    await clients.openWindow("./");
  })());
});
