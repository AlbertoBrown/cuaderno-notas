const CACHE = "cuaderno-notas-v39";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=37",
  "./manifest.webmanifest",
  "./icon.svg",
  "./js/app.js?v=39",
  "./js/store.js",
  "./js/sync.js",
  "./js/supabase.js",
  "./js/visual-notes.js"
];

function recoverInterruptedSyncs() {
  return new Promise(resolve => {
    if (!("indexedDB" in self)) {
      resolve();
      return;
    }

    const request = indexedDB.open("cuaderno-notas-db");

    request.onerror = () => resolve();
    request.onupgradeneeded = () => {
      // No modificamos el esquema desde el Service Worker.
      try { request.transaction?.abort(); } catch {}
      resolve();
    };

    request.onsuccess = () => {
      const db = request.result;
      const stores = ["notes", "notebooks", "notebook_days", "links"]
        .filter(name => db.objectStoreNames.contains(name));

      if (!stores.length) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(stores, "readwrite");

      for (const storeName of stores) {
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();

        cursorRequest.onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;

          const value = cursor.value;
          if (value?.syncStatus === "syncing") {
            cursor.update({
              ...value,
              syncStatus: "pending",
              syncError: null,
            });
          }

          cursor.continue();
        };
      }

      const finish = () => {
        db.close();
        resolve();
      };

      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    };
  });
}

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));

    // iOS puede dejar registros persistidos como "syncing" si suspende la PWA
    // durante una subida. Los devolvemos a "pending" sin tocar el Blob local.
    await recoverInterruptedSyncs();
    await self.clients.claim();

    // Forzamos una recarga de las ventanas abiertas para que app.js vuelva a leer
    // IndexedDB y reintente inmediatamente las fotos recuperadas.
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    await Promise.all(clients.map(async client => {
      try {
        await client.navigate(client.url);
      } catch {}
    }));
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML and application code: cache-busting explícito para evitar que iOS
  // mantenga módulos antiguos después de una actualización.
  if (
    request.mode === "navigate" ||
    (sameOrigin && ["script", "style"].includes(request.destination))
  ) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
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
