const CACHE_PREFIX = "sapc-reviewer-shell-";
const CACHE_NAME = `${CACHE_PREFIX}20261122-v1`;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/terms.html",
  "/privacy.html",
  "/style.css",
  "/app.js",
  "/peer-call.js",
  "/pwa.js",
  "/firebase-config.js",
  "/firebase-services.js",
  "/api-config.js",
  "/manifest.webmanifest",
  "/app-icon-192.png",
  "/app-icon-512.png",
  "/app-icon-192.svg",
  "/app-icon-512.svg",
  "/logo.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/") || url.pathname === "/health") return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // OAuth and password-reset URLs may carry short-lived credentials in the query string.
        if (response.ok && !url.search && url.pathname !== "/reset-password.html") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
          if (url.pathname === "/" || url.pathname === "/index.html") await cache.put("/", response.clone());
        }
        return response;
      } catch {
        if (url.pathname === "/reset-password.html") {
          return new Response("Password reset requires an internet connection. Reopen this page while online.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return await caches.match(request, { ignoreSearch: true })
          || await caches.match("/index.html")
          || new Response("The app is offline. Reconnect to sign in and sync your study data.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  const isShellAsset = SHELL_URLS.includes(url.pathname);
  if (!isShellAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then(response => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    try { return await network; }
    catch { return new Response("This app resource is unavailable offline.", { status: 503 }); }
  })());
});
