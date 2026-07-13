// Service worker for CSC Pickleball League Manager.
//
// ─── v1.5.0: upgraded from the previous no-op worker to a caching worker ────
//
// The previous version registered but deliberately did nothing (no fetch
// handler), purely to satisfy the browser's PWA installability requirement.
// Its header laid out the roadmap for upgrading it; this is that upgrade.
//
// WHAT THIS DOES NOW:
//   - Precaches the app shell on install (HTML, manifest, icons, logo).
//   - Serves navigations network-first: a fresh deploy is picked up on the
//     next online load, and we fall back to the cached shell when offline.
//   - Serves Vite's hashed build assets (/assets/*) cache-first. Vite emits
//     content-hashed filenames, so a given URL's bytes never change — it's
//     safe (and fast) to serve them from cache indefinitely. New builds emit
//     new filenames, which simply miss the cache and get fetched.
//   - Leaves Supabase (and every other cross-origin request) completely
//     alone. Data is never cached at the SW layer.
//
// WHAT THIS STILL DOES NOT DO:
//   - No write queueing / background sync. The app hard-blocks writes when
//     offline (see `action()` in App.jsx). Queueing mutations is a genuinely
//     separate project — it needs conflict resolution, ordering guarantees,
//     and partial-failure handling — and the write-first/read-back data layer
//     assumes every write is confirmed by the server before React sees it.
//   - No push notifications.
//
// ─── The offline data story ─────────────────────────────────────────────────
// This SW caches the *app*, not the *data*. Caching Supabase responses here
// would be the wrong layer: the app speaks to Supabase through the JS client,
// not plain cacheable GETs, and a stale API response served invisibly from a
// cache is far more dangerous than a clearly-labelled stale snapshot.
//
// Instead, App.jsx persists the last successful loadDB() snapshot to
// localStorage. When the app boots offline, the SW serves the cached shell,
// React starts, the live fetch fails, and we fall back to that snapshot with
// a visible "Offline — showing data from X ago" banner. Read-only, honest,
// and no invisible staleness.
//
// ─── Update flow (important) ────────────────────────────────────────────────
// The previous worker called skipWaiting() on install. That was safe when
// nothing was cached. It is NOT safe now, and it's deliberately removed.
//
// With caching, an immediately-activating SW can serve v2 assets to a page
// still running v1 JS — the classic version-skew failure. It also defeats the
// update banner: the whole point is that the new worker WAITS until the user
// agrees to reload.
//
// So: a new SW installs, precaches, and then sits in `waiting`. index.html
// detects it and fires a `pwa:update-ready` event; React shows the banner;
// when the user clicks Reload we post SKIP_WAITING to the waiting worker,
// it activates, and `controllerchange` reloads the page. Update happens on a
// user gesture, never behind their back.

// Bump this on every release that changes cached assets. The activate handler
// deletes every cache whose name doesn't match the current one, so bumping
// this is what flushes stale shells.
const CACHE_VERSION = "v1.5.0";
const CACHE_NAME = `csc-pickleball-${CACHE_VERSION}`;

// The app shell. Everything here is fetched and cached on install, so a cold
// offline start has enough to boot React.
//
// NOTE: we intentionally do NOT list /assets/* here — those filenames are
// content-hashed and unknowable at author time. They get cached lazily on
// first fetch (see the fetch handler), which is sufficient: the first load of
// any deploy is necessarily online, and that's when they land in the cache.
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/csc-pickleball.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

// ─── Install: precache the shell ────────────────────────────────────────────
// Note the absence of skipWaiting(). See the update-flow notes above.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll() is atomic-ish: if any single request 404s, the whole thing
      // rejects and the SW fails to install. That's too brittle for optional
      // assets (an icon rename shouldn't break the worker), so we add them
      // individually and tolerate misses.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            console.warn("[sw] precache miss:", url, err);
          }
        })
      );
      console.log(`[sw] installed (${CACHE_VERSION}), shell precached`);
    })()
  );
});

// ─── Activate: drop stale caches, take control ──────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("csc-pickleball-") && n !== CACHE_NAME)
          .map((n) => {
            console.log("[sw] deleting stale cache:", n);
            return caches.delete(n);
          })
      );
      // Claim clients so this worker controls already-open pages. By the time
      // we activate, the user has either just installed the app for the first
      // time (nothing to skew) or explicitly clicked Reload in the update
      // banner (page is about to reload anyway) — so claiming is safe here.
      await self.clients.claim();
      console.log(`[sw] activated (${CACHE_VERSION})`);
    })()
  );
});

// ─── Message: the update handshake ──────────────────────────────────────────
// The page posts this when the user clicks "Reload" in the update banner.
// Activating triggers `controllerchange` on the client, which reloads.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    console.log("[sw] SKIP_WAITING received — activating");
    self.skipWaiting();
  }
});

// ─── Fetch: routing ─────────────────────────────────────────────────────────
//
// Three cases, in order:
//   1. Anything we shouldn't touch  → ignore entirely (let the browser do it)
//   2. Hashed build assets          → cache-first
//   3. Navigations / everything else on our origin → network-first
//
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Bypass ──
  // Only ever handle GETs. Writes (POST/PATCH/DELETE) must always hit the
  // network — never intercept, never cache, never replay.
  if (request.method !== "GET") return;

  // Only handle our own origin. This is what keeps Supabase (and any other
  // third party) entirely out of the SW: different origin → we don't touch it,
  // the request goes straight to the network as if no SW existed.
  if (url.origin !== self.location.origin) return;

  // Chrome extensions et al.
  if (!url.protocol.startsWith("http")) return;

  // ── 2. Hashed assets: cache-first ──
  // Vite emits /assets/index-a1b2c3d4.js — the hash is derived from content,
  // so this URL's bytes are immutable. Cache-first is both safe and the whole
  // performance win. A new deploy produces new hashes → cache miss → fetched
  // and cached fresh.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── 3. Navigations and other same-origin GETs: network-first ──
  // Network-first (not cache-first) for HTML is what prevents the classic PWA
  // staleness trap: index.html is the un-hashed entry point that points at the
  // hashed bundles, so serving it from cache would pin users to an old build.
  // We always try the network, and only fall back to cache when it fails.
  event.respondWith(networkFirst(request));
});

// Cache-first: return the cached copy if present; otherwise fetch, cache, and
// return. Used only for immutable, content-hashed assets.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Only cache genuinely successful, basic (same-origin) responses. Caching
    // an opaque or error response would poison the cache.
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn("[sw] cache-first fetch failed:", request.url, err);
    // No cached copy and no network — nothing we can do for a hashed asset.
    return Response.error();
  }
}

// Network-first: try the network, cache the win, fall back to cache on
// failure. For navigations, fall back to the cached shell so React can boot
// offline and render its cached-snapshot state.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Offline, and this exact request isn't cached. If it's a navigation, any
    // route should boot the SPA — serve the cached shell and let the React
    // router (such as it is) sort it out.
    if (request.mode === "navigate") {
      const shell = await cache.match("/index.html") || await cache.match("/");
      if (shell) return shell;
    }

    console.warn("[sw] network-first failed with no cache:", request.url);
    return Response.error();
  }
}
