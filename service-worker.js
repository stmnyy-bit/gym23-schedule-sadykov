const CACHE_NAME = "gymnasium-23-schedule-v8";
const APP_VERSION = "20260531-4";
const CORE_ASSETS = [
  "./",
  "./index.html",
  `./styles.css?v=${APP_VERSION}`,
  `./app.js?v=${APP_VERSION}`,
  "./manifest.webmanifest",
  "./assets/icon.svg",
  `./data/schedule.js?v=${APP_VERSION}`,
  `./data/schedule.json?v=${APP_VERSION}`,
  "./assets/school-bg.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
