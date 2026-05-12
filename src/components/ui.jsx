// ─── Shared UI primitives ───────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { S } from "../styles.js";
import { CSC, SPACE } from "../lib/constants.js";

export function Modal({ title, onClose, children }) {
  return (
    <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modalBox}>
        <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--color-text-secondary)", padding: 0, lineHeight: 1 }} onClick={onClose}>×</button>
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
  return <div style={{ textAlign: "center", padding: "32px 0", color: "var(--color-text-secondary)", fontSize: 14 }}><div style={{ fontSize: 32, marginBottom: 8 }}>🏓</div><p style={{ margin: 0 }}>{msg}</p></div>;
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
