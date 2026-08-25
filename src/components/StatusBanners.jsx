import { useState, useEffect } from "react";
import { CSC } from "../lib/constants.js";
import { formatRelativeTime } from "../lib/format.js";

// ─── Page-level status banners (v1.5.0) ─────────────────────────────────────
// Two thin, full-width bars that sit directly under the app header and tell
// the user something about the app's *state* rather than its data:
//
//   <UpdateBanner />   — a new build is downloaded and waiting to activate
//   <OfflineBanner />  — we're showing a cached snapshot, not live data
//
// Both are deliberately unstyled-by-props and self-contained: drop them in at
// the top of a view and they render only when relevant, nothing otherwise.

// ─── Update banner ──────────────────────────────────────────────────────────
// The service worker (public/sw.js) does NOT call skipWaiting() on install.
// A new worker precaches the new build and then sits in `waiting` — it does
// not take over until the user says so. That's what makes this banner real:
// the app you're using does not change under you mid-task.
//
// The handshake lives in index.html (outside the React bundle, so it works
// even if the bundle itself is what's being updated):
//   1. index.html detects the waiting worker
//   2. dispatches `pwa:update-ready` on window
//   3. this component hears it and renders
//   4. "Reload" calls window.__pwaApplyUpdate()
//   5. that posts SKIP_WAITING → worker activates → `controllerchange` → reload
//
// We listen for a plain CustomEvent rather than importing a helper from
// vite-plugin-pwa's `virtual:pwa-register` because we don't use that plugin —
// the worker is hand-written. A DOM event is the natural seam between the
// vanilla registration script and React.
// v1.8.0: `ready` and `onDismiss` are now controlled by the parent. App.jsx
// listens for `pwa:update-ready` itself because it needs to know whether ANY
// banner is on screen — the banner stack owns the iOS safe-area inset, and
// the sticky header has to drop its own inset when a banner is above it.
// Keeping that state here would have meant the parent couldn't see it.
export function UpdateBanner({ ready, onDismiss }) {
  const [applying, setApplying] = useState(false);

  if (!ready) return null;

  function reload() {
    setApplying(true);
    if (typeof window.__pwaApplyUpdate === "function") {
      window.__pwaApplyUpdate();
    } else {
      // Registration script didn't load (shouldn't happen) — a plain reload
      // still gets them onto the new build on most browsers.
      window.location.reload();
    }
  }

  return (
    <div
      role="status"
      style={{
        background: CSC.blue,
        color: "#fff",
        padding: "10px 16px",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
      <span>A new version is available.</span>
      <button
        type="button"
        onClick={reload}
        disabled={applying}
        style={{
          background: "#fff",
          color: CSC.blue,
          border: "none",
          padding: "4px 14px",
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 12,
          fontFamily: "inherit",
          cursor: applying ? "default" : "pointer",
          opacity: applying ? 0.7 : 1,
        }}>
        {applying ? "Reloading…" : "Reload"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={applying}
        style={{
          background: "transparent",
          color: "#fff",
          border: "0.5px solid rgba(255,255,255,0.45)",
          padding: "4px 14px",
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "inherit",
          cursor: "pointer",
        }}>
        Later
      </button>
    </div>
  );
}

// ─── Offline banner ─────────────────────────────────────────────────────────
// Shown when React booted from the cached localStorage snapshot because the
// live Supabase fetch failed. The whole point is to make staleness VISIBLE —
// a cached snapshot rendered silently is worse than no offline mode at all,
// because the user can't tell whether what they're looking at is real.
//
// `cachedAt` is the epoch-ms timestamp stored alongside the snapshot. We
// re-render every 30s so "a minute ago" doesn't sit there saying that for an
// hour. `onRetry` re-attempts a live load.
//
// Note this is about DATA freshness, not connectivity per se: we show it
// whenever we're displaying a snapshot, which is exactly the condition that
// matters to the user. Writes are separately hard-blocked while offline (see
// `action()` in App.jsx), so there's no way to mutate on top of stale data.
export function OfflineBanner({ cachedAt, onRetry, isRetrying }) {
  // Tick so the relative time stays honest without a full app re-render loop.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!cachedAt) return null;

  return (
    <div
      role="status"
      style={{
        background: "#FAEEDA",
        color: "#854F0B",
        borderBottom: "0.5px solid #ECC580",
        padding: "8px 16px",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flexWrap: "wrap",
        textAlign: "center",
      }}>
      <span>
        Offline — showing data from {formatRelativeTime(cachedAt)}. Changes can't be saved.
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          style={{
            background: "transparent",
            color: "#854F0B",
            border: "0.5px solid #854F0B",
            padding: "2px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontFamily: "inherit",
            fontWeight: 600,
            cursor: isRetrying ? "default" : "pointer",
            opacity: isRetrying ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}>
          {isRetrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
