const CACHE = "cuaderno-notas-v19";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=19",
  "./manifest.webmanifest",
  "./icon.svg",
  "./js/app.js?v=19",
  "./js/store.js",
  "./js/sync.js",
  "./js/supabase.js",
  "./js/visual-notes.js"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML and application code: network first so a deployed fix is visible immediately.
  if (
    request.mode === "navigate" ||
    (sameOrigin && ["script", "style"].includes(request.destination))
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
    );
    return;
  }

  // Static assets: cache first.
  if (sameOrigin && ["image", "manifest"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE).then(cache => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
  }
});
