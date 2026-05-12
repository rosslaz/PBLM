// ─── Spinner + per-button loading state ────────────────────────────────────
// Inline CSS-only spinner suitable for placing inside buttons. The spinning
// keyframe is injected once at import time; subsequent imports are no-ops.
import { createContext, useContext } from "react";

// Inject the keyframe + spinner class once. Safe to call multiple times
// because we check for an existing style element first.
(function injectSpinnerCSS() {
  if (typeof document === "undefined") return; // SSR safety
  const id = "__pb_spinner_css";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes pb-spin {
      to { transform: rotate(360deg); }
    }
    .pb-spinner {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: pb-spin 0.7s linear infinite;
      vertical-align: -0.15em;
    }
  `;
  document.head.appendChild(style);
})();

// Use inside a button next to (or instead of) the label.
//   <button>{isLoading ? <Spinner /> : null} Submit</button>
// Size scales with the button's font-size (uses 1em).
export function Spinner({ marginRight = 6, color }) {
  return (
    <span
      className="pb-spinner"
      style={{
        marginRight,
        color: color || "currentColor",
      }}
      aria-hidden="true"
    />
  );
}

// ─── Action-pending context ─────────────────────────────────────────────────
// App sets `currentActionId` to a string (e.g. "submit-score") while a
// write is in flight, and back to null when it finishes. Buttons can use
// `useIsActionPending("submit-score")` to know whether to show their
// loading state. Different actions don't interfere with each other; only
// the button that owns the in-flight ID shows its spinner.
//
// Generic actions that don't need per-button spinners just pass no actionId
// and the App's global "saving…" indicator covers them.
const ActionPendingContext = createContext(null);

export function ActionPendingProvider({ value, children }) {
  return (
    <ActionPendingContext.Provider value={value}>
      {children}
    </ActionPendingContext.Provider>
  );
}

export function useIsActionPending(actionId) {
  const current = useContext(ActionPendingContext);
  if (!actionId) return false;
  return current === actionId;
}
