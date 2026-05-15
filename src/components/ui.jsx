// ─── Shared UI primitives ───────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { S } from "../styles.js";
import { CSC, SPACE, APP_INFO } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";

// ─── CSCMark ───────────────────────────────────────────────────────────────
// The club's brand mark — green dolphin leaping over a yellow pickleball with
// "CSC" lettered across the bottom — used as the decorative icon for empty
// states and the About modal hero. Cropped from the master logo banner; the
// image lives at /csc-mark.png in the public folder.
//
// `PickleballIcon` is kept as a backwards-compat alias so any older imports
// still resolve. New code should use `CSCMark` directly.
export function CSCMark({ size = 32, style }) {
  return (
    <img
      src="/csc-mark.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      // Slight border-radius so the square-cropped mark sits naturally inside
      // round chips and card surfaces without looking like a raw screenshot.
      style={{ borderRadius: Math.max(4, Math.round(size * 0.12)), display: "block", ...style }}
    />
  );
}
export const PickleballIcon = CSCMark;

// Module-level counter for nested/overlapping modal opens. Used by the
// Modal scroll-lock effect to ensure the body unlocks only when the last
// modal closes. Decoupled from React state so the value persists across
// remounts and isn't subject to closure capture surprises.
let modalOpenCount = 0;

// Modal renders an overlay + sheet. On desktop it centers; on mobile (≤640px)
// it pins to the bottom and slides up — the bottom-sheet pattern, defined in
// index.css. The grab handle above the title shows on mobile only and is
// purely visual (drag-to-dismiss not implemented). Backdrop tap and the ×
// button both still dismiss.
export function Modal({ title, onClose, children }) {
  // Close on Escape key — universally expected behavior.
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while open. Without this, the page underneath can be
  // scrolled which feels wrong — especially with the bottom-sheet pattern
  // where the sheet itself is the scrollable surface. Uses a global
  // open-count so two modals (one above the other) coexist correctly: the
  // body unlocks only when the last modal closes. Restoring an empty
  // string (rather than the previously captured value) avoids the
  // "captures hidden, leaves it hidden permanently" failure that could
  // otherwise lock the page indefinitely if cleanup paths interleaved.
  useEffect(() => {
    if (typeof document === "undefined") return;
    modalOpenCount += 1;
    if (modalOpenCount === 1) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      modalOpenCount = Math.max(0, modalOpenCount - 1);
      if (modalOpenCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        {/* Grab handle — visible on mobile only via .modal-handle CSS */}
        <div className="modal-handle" aria-hidden="true" />
        <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--color-text-secondary)", padding: 0, lineHeight: 1 }}
            onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "#A32D2D" : CSC.blue, color: "#fff", borderRadius: 999, padding: "12px 20px", fontSize: 14, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>{toast.msg}</div>;
}

export function EmptyState({ msg }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0", color: "var(--color-text-secondary)", fontSize: 14 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <PickleballIcon size={40} />
      </div>
      <p style={{ margin: 0 }}>{msg}</p>
    </div>
  );
}

// ─── AvatarMenu ─────────────────────────────────────────────────────────────
// A round avatar button that opens a dropdown menu of actions when tapped.
// Used in headers to collapse multiple action buttons into a single tap target.
//
// Props:
//   initial      — single character to show inside the avatar (e.g. "J")
//   items        — array of { label, onClick, icon?, danger? } for the menu
//                  Items with `danger: true` render in red (typically Log Out)
//   ariaLabel    — accessibility label for the button (default: "Account menu")
//
// Behavior:
//   - Tap avatar → menu opens
//   - Tap outside → menu closes
//   - Tap item → onClick runs, menu closes
//   - Escape key → menu closes
export function AvatarMenu({ initial, items, ariaLabel = "Account menu" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click. mousedown (not click) lets the menu close before
  // any other handlers fire — feels more responsive.
  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          border: "1px solid rgba(255,255,255,0.4)",
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background-color 120ms ease",
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 200,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            // Header sits at zIndex 100; the menu must clear that AND sit
            // above any sticky sub-headers (which use zIndex 100 too).
            zIndex: 150,
            overflow: "hidden",
            // Prevents the menu being clipped by overflow:hidden ancestors.
            // The pwa-safe-x parent has padding via !important class — fine.
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); item.onClick(); }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: `${SPACE.md}px ${SPACE.lg}px`,
                background: "transparent",
                border: "none",
                borderTop: i === 0 ? "none" : "0.5px solid var(--color-border-tertiary)",
                fontFamily: "inherit",
                fontSize: 14,
                color: item.danger ? "#A32D2D" : "var(--color-text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: SPACE.sm,
              }}
            >
              {item.icon && <span style={{ fontSize: 14, opacity: 0.8 }}>{item.icon}</span>}
              <span style={{ flex: 1 }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── About content ─────────────────────────────────────────────────────────
// Body content of the About modal. Wrap with <Modal title="About"> at the
// call site. Reads APP_INFO from constants so updating the version touches
// only one place.
export function AboutContent({ onClose }) {
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: SPACE.lg }}>
        {/* The CSC mark already includes the brand blue background and
            its own internal margin, so it doesn't need a surrounding chip. */}
        <div style={{ display: "inline-block", marginBottom: SPACE.md }}>
          <CSCMark size={80} />
        </div>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          CSC Pickleball League Manager
        </h3>
        <p style={{
          margin: `${SPACE.xs}px 0 0`,
          fontSize: 13,
          color: "var(--color-text-secondary)",
        }}>
          Version {APP_INFO.version}
        </p>
      </div>

      <p style={{
        margin: `0 0 ${SPACE.md}px`,
        fontSize: 14,
        color: "var(--color-text-secondary)",
        textAlign: "center",
        lineHeight: 1.5,
      }}>
        {APP_INFO.description}
      </p>

      <div style={{
        padding: `${SPACE.md}px ${SPACE.md}px`,
        background: "var(--color-background-secondary)",
        borderRadius: 8,
        border: "0.5px solid var(--color-border-tertiary)",
        textAlign: "center",
        marginBottom: SPACE.md,
      }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary)" }}>
          Created by
        </p>
        <p style={{
          margin: `${SPACE.xs}px 0 0`,
          fontSize: 15,
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}>
          {APP_INFO.createdBy}
        </p>
      </div>

      <div style={{ ...S.row, justifyContent: "flex-end" }}>
        <button style={S.btn("primary")} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ─── VersionFooter ─────────────────────────────────────────────────────────
// Tiny, low-contrast version badge at the bottom of any screen. Tapping it
// opens the About modal. The footer pads itself with the iOS safe-area inset
// at the bottom so it clears the home indicator on PWA installs.
//
// Use at the bottom of each top-level view (HomeView, PlayerView, the admin
// panel root) so it's discoverable from anywhere without crowding the headers
// or avatar menu.
export function VersionFooter() {
  const [showAbout, setShowAbout] = useState(false);
  return (
    <>
      <div style={{
        padding: `${SPACE.lg}px ${SPACE.lg}px calc(${SPACE.lg}px + env(safe-area-inset-bottom, 0px))`,
        textAlign: "center",
      }}>
        <button
          type="button"
          onClick={() => setShowAbout(true)}
          style={{
            background: "none", border: "none", padding: 0,
            fontFamily: "inherit", fontSize: 11,
            color: "var(--color-text-tertiary)",
            cursor: "pointer",
          }}>
          v{APP_INFO.version} · About
        </button>
      </div>
      {showAbout && (
        <Modal title="About" onClose={() => setShowAbout(false)}>
          <AboutContent onClose={() => setShowAbout(false)} />
        </Modal>
      )}
    </>
  );
}

// ─── RefreshButton ─────────────────────────────────────────────────────────
// Small circular refresh button intended for headers. Spins while the
// `isRefreshing` flag is true. Pass the parent's refresh callback as onClick.
// Disabled while another action is in flight so it doesn't pile up requests.
//
// Hidden on mobile by default — mobile users have pull-to-refresh, so a
// button would just crowd the header. Pass `alwaysShow` to force render.
export function RefreshButton({ onClick, isRefreshing, disabled, alwaysShow }) {
  const isMobile = useIsMobile();
  if (isMobile && !alwaysShow) return null;
  const isBusy = !!isRefreshing;
  return (
    <button
      type="button"
      aria-label="Refresh data"
      title="Refresh data"
      onClick={onClick}
      disabled={disabled || isBusy}
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "rgba(255,255,255,0.15)",
        border: "0.5px solid rgba(255,255,255,0.3)",
        color: "#fff",
        cursor: (disabled || isBusy) ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        fontFamily: "inherit", padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        // The icon itself spins; the button is static.
      }}>
      <span style={{
        display: "inline-block", fontSize: 16, lineHeight: 1,
        animation: isBusy ? "spin 0.8s linear infinite" : "none",
        // Slight vertical nudge — the unicode "↻" sits high in the line-box.
        transform: "translateY(-1px)",
      }}>↻</span>
    </button>
  );
}

// ─── PullToRefresh ─────────────────────────────────────────────────────────
// Mobile pull-to-refresh wrapper. Listens for touchstart/move/end at the
// document root; only activates when the page is scrolled to the very top
// AND the drag is mostly vertical. Past a threshold, calling onRefresh()
// re-fetches data; the indicator spins until it resolves.
//
// Transparent — renders children unchanged; the only DOM it adds is a small
// fixed-position indicator that slides into view from above as you pull.
//
// `isRefreshing` is the parent's "currently refreshing" state, so the
// indicator can stay visible during the awaited refresh and dismiss only
// when the parent says it's done.
const PULL_THRESHOLD = 70; // px to commit a refresh
const PULL_MAX = 110;      // px the indicator can travel
export function PullToRefresh({ children, onRefresh, isRefreshing }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [committing, setCommitting] = useState(false);
  const startY = useRef(null);
  const startX = useRef(null);
  const horizontalLock = useRef(false);
  // Mirror of pullDistance for use inside the touchmove handler. Reading
  // state directly inside the handler would either force the effect to
  // re-run on every pixel of pull (which was causing scroll to break on
  // mobile — listeners got torn down and re-added mid-gesture, occasionally
  // missing the touchend and leaving startY pinned), or capture a stale
  // value. The ref tracks the live value without re-mounting the effect.
  const pullDistanceRef = useRef(0);
  // Also mirror isRefreshing for the same reason — its changes shouldn't
  // remount the effect mid-scroll.
  const isRefreshingRef = useRef(isRefreshing);
  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);
  // Keep onRefresh fresh without forcing the effect to remount when the
  // parent supplies a new function reference each render.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  // Wrap setPullDistance so the ref stays in lockstep with state.
  const updatePull = (v) => {
    pullDistanceRef.current = v;
    setPullDistance(v);
  };

  useEffect(() => {
    // Only set up listeners on touch devices. Desktops have the refresh
    // button; PTR on a non-touch device just adds dead listeners.
    if (typeof window === "undefined") return;
    if (!("ontouchstart" in window)) return;

    function onTouchStart(e) {
      // Only start tracking if the page is scrolled to the very top
      if (window.scrollY > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      horizontalLock.current = false;
    }

    function onTouchMove(e) {
      if (startY.current === null) return;
      if (isRefreshingRef.current) return; // ignore additional pulls during refresh
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;
      // If the gesture is clearly horizontal, abandon — the user is
      // swiping the league-tabs row or similar horizontal scroller.
      if (!horizontalLock.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        horizontalLock.current = true;
        if (pullDistanceRef.current !== 0) updatePull(0);
        return;
      }
      if (horizontalLock.current) return;
      if (dy <= 0) {
        // Dragging up — reset.
        if (pullDistanceRef.current !== 0) updatePull(0);
        return;
      }
      // Apply a damping factor so the further you pull, the harder it gets —
      // mimics native PTR feel.
      const damped = Math.min(PULL_MAX, dy * 0.55);
      updatePull(damped);
      // Block iOS rubber-band only when we're actively pulling and the
      // page is at the top. preventDefault must be called on a non-passive
      // listener; we use { passive: false } below.
      if (window.scrollY === 0 && e.cancelable) {
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      if (startY.current === null) return;
      startY.current = null;
      const final = pullDistanceRef.current;
      if (final >= PULL_THRESHOLD && !isRefreshingRef.current) {
        setCommitting(true);
        Promise.resolve(onRefreshRef.current?.()).finally(() => {
          setCommitting(false);
          updatePull(0);
        });
      } else {
        // Released before threshold — snap back.
        updatePull(0);
      }
    }

    // passive: false on touchmove so preventDefault works (suppresses iOS bounce)
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
    // Empty deps — listeners mount once and use refs for live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = pullDistance > 0 || isRefreshing || committing;
  const ready = pullDistance >= PULL_THRESHOLD;
  // Indicator position: when refreshing, fix at +30; while pulling, follow
  // the finger up to PULL_MAX, biased so the indicator is visible by ~20px
  // when at the threshold.
  const indicatorY = isRefreshing || committing
    ? 30
    : Math.max(-40, pullDistance - 40);

  return (
    <>
      <div
        aria-hidden={!visible}
        style={{
          position: "fixed",
          top: 60, // below the sticky header
          left: "50%",
          transform: `translateX(-50%) translateY(${indicatorY}px)`,
          width: 40, height: 40, borderRadius: "50%",
          background: CSC.blue, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          zIndex: 150,
          pointerEvents: "none",
          opacity: visible ? 1 : 0,
          transition: visible
            ? "opacity 120ms ease"
            : "opacity 200ms ease, transform 200ms ease",
        }}>
        <span style={{
          display: "inline-block",
          fontSize: 20,
          lineHeight: 1,
          // While refreshing → spin. While pulling → rotate by pull progress.
          // Past threshold → flip the arrow upside down to signal "release".
          transform: (isRefreshing || committing)
            ? "none"
            : `rotate(${ready ? 180 : (pullDistance / PULL_THRESHOLD) * 180}deg)`,
          transition: !startY.current ? "transform 120ms ease" : "none",
          animation: (isRefreshing || committing) ? "spin 0.8s linear infinite" : "none",
        }}>
          {(isRefreshing || committing) ? "↻" : "↓"}
        </span>
      </div>
      {children}
    </>
  );
}

// ─── PWA install banner ────────────────────────────────────────────────────
// Dismissible banner shown on the home screen to teach iOS Safari users how
// to install the app to their home screen. Hidden when:
//   - Already running as an installed PWA (display-mode standalone, or
//     iOS's legacy navigator.standalone === true)
//   - Previously dismissed (localStorage flag)
//   - Not iOS Safari (Chrome Android has its own install UI; desktop users
//     are uncommon for this app and can install via browser menu)
//
// The flag is versioned so a future copy update can re-show the banner if
// we ever want to nudge again — bump the suffix.
const PWA_DISMISS_KEY = "pickleball_pwa_dismissed_v1";

// True when on an iPhone/iPad in Safari (not Chrome/Firefox iOS, which can't
// trigger Add-to-Home-Screen). Detection is permissive: it accepts the
// classic "iPhone/iPad" UA tokens and modern iPadOS where Safari masquerades
// as desktop Safari. False on anything else — better to under-show than
// to teach the wrong gesture.
function isIOSSafari() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS 13+ reports Mac UA but still has touch
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  // Exclude Chrome/Firefox/Edge on iOS (CriOS, FxiOS, EdgiOS) — those
  // browsers wrap WebKit but don't support Add-to-Home-Screen the same way.
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return !isOtherBrowser;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  // iOS legacy property
  if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
  return false;
}

export function PWAInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Run detection client-side only. SSR-safe by virtue of the useEffect.
    if (isStandalone()) return;
    if (!isIOSSafari()) return;
    try {
      if (localStorage.getItem(PWA_DISMISS_KEY)) return;
    } catch (_) { /* localStorage unavailable — show anyway */ }
    setVisible(true);
  }, []);

  function dismiss() {
    try { localStorage.setItem(PWA_DISMISS_KEY, "1"); } catch (_) {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      background: CSC.blueLight,
      border: `0.5px solid ${CSC.blue}40`,
      borderRadius: 10,
      padding: `${SPACE.md}px ${SPACE.lg}px`,
      marginBottom: SPACE.lg,
      display: "flex", alignItems: "flex-start", gap: SPACE.md,
    }}>
      <span style={{ fontSize: 22, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>📱</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: CSC.blueDark }}>
          Install the app
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: CSC.blueDark, lineHeight: 1.4 }}>
          Tap <span style={{
            display: "inline-block", padding: "0 4px",
            border: `0.5px solid ${CSC.blue}60`, borderRadius: 3,
            background: "rgba(255,255,255,0.6)",
          }}>↑ Share</span>, then <strong>Add to Home Screen</strong> for faster access.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent", border: "none",
          color: CSC.blueDark, opacity: 0.6,
          fontSize: 20, lineHeight: 1, padding: 4, cursor: "pointer",
          fontFamily: "inherit", flexShrink: 0,
        }}>
        ×
      </button>
    </div>
  );
}
