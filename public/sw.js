// Service worker for CSC Pickleball League Manager.
//
// PURPOSE: Satisfy the PWA installability requirement (browsers won't show
// "Add to Home Screen" without a registered service worker on most platforms).
//
// WHAT THIS DOES *NOT* DO — DELIBERATELY:
//   - No fetch caching. Every request goes straight to the network.
//   - No offline support. The app fails like a regular web page if offline.
//   - No background sync, no push, no periodic sync.
//
// Why so minimal? Caching the app shell is what enables offline, but it's
// also what creates the classic PWA pitfall: users seeing stale code days
// after a deploy because their cached HTML/JS hasn't been invalidated. Our
// app's data layer is write-first/read-back against Supabase — there's no
// meaningful offline mode without queueing writes, which is its own project.
// Until that ships, the safest pattern is no caching.
//
// To upgrade this to a caching service worker later, you'll want:
//   - A versioned cache name (bump on deploy)
//   - install/activate handlers that pre-cache the app shell
//   - A fetch handler with a strategy (network-first for HTML, cache-first
//     for hashed assets) — Vite emits hashed filenames so cache-first on
//     /assets/* is safe; the root HTML still needs network-first.
//
// The bump in CACHE_VERSION below isn't currently used, but bumping it on
// every deploy is the convention worth adopting so an unregister+re-register
// of the worker can flush any future caches.

const CACHE_VERSION = "v1";
console.log(`[sw] active (${CACHE_VERSION}, no caching)`);

self.addEventListener("install", () => {
  // Take over immediately on first install rather than waiting for all tabs
  // to close. Safe because we're not caching anything.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim any clients that loaded before the SW activated. Means the SW
  // controls the page on first visit, not just on the second refresh.
  event.waitUntil(self.clients.claim());
});

// No fetch handler = browser does its default networking. This is the
// correct behavior for "installable but online-only".
