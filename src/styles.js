// ─── Inline style presets ───────────────────────────────────────────────────
// Shared style snippets used by virtually every component. Imported as S.
// All spacing values reference the SPACE scale (constants.js) to keep paddings
// and gaps consistent across the app.
import { CSC, SPACE } from "./lib/constants.js";

// System font stack. `system-ui` picks up the OS UI face on every modern
// platform (SF on Apple, Segoe UI on Windows, Roboto on Android, Cantarell
// on GNOME). The explicit fallbacks cover older browsers and the rare
// system where system-ui resolves oddly. `-apple-system` ahead of
// system-ui on Safari renders crisper for Apple platforms specifically.
//
// Switched from Georgia/Times in 2026: serifs read fine for prose but
// look dated and slightly off for app UI, especially for numerals in
// the standings table and scoring inputs.
export const FONT_STACK = `-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export const S = {
  page: { minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: FONT_STACK },
  // Sticky page header. Padding 16/20 = lg/xl, the standard page-edge inset.
  header: (color) => ({ background: color || CSC.blue, color: "#fff", padding: `${SPACE.lg}px ${SPACE.xl}px`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap", rowGap: SPACE.sm }),
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px", margin: 0 },
  // Standard content card. Padding 16/20, bottom margin 12 (md).
  card: { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: `${SPACE.lg}px ${SPACE.xl}px`, marginBottom: SPACE.md },
  // Buttons. The "primary" variant uses the CSC blue by default but accepts an
  // override color for league-themed actions.
  btn: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: `${SPACE.sm}px ${SPACE.lg}px`, cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 500 }),
  // Small button. Vertical padding bumped from off-scale 5 → 4 (xs); horizontal
  // 12 → 12 (md). Slightly tighter vertical feel, perfectly on the 4px grid.
  btnSm: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: `${SPACE.xs}px ${SPACE.md}px`, cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 500 }),
  input: { width: "100%", padding: `${SPACE.sm}px ${SPACE.md}px`, borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" },
  label: { fontSize: 12, color: "var(--color-text-secondary)", marginBottom: SPACE.xs, display: "block" },
  row: { display: "flex", gap: SPACE.md, alignItems: "center" },
  // Page section content. Same edge padding as the header.
  section: { padding: `${SPACE.lg}px ${SPACE.xl}px` },
  tabBar: { display: "flex", gap: SPACE.xs, borderBottom: "0.5px solid var(--color-border-tertiary)", padding: `0 ${SPACE.xl}px`, background: "var(--color-background-primary)", overflowX: "auto" },
  // Active tab gets a thicker underline, heavier weight, and a faint
  // background tint. Each on its own is subtle; together they make the
  // active state read at a glance instead of requiring a second look.
  tab: (active, color) => ({
    padding: `${SPACE.sm}px ${SPACE.lg}px`,
    cursor: "pointer",
    fontSize: 14,
    border: "none",
    background: active ? "var(--color-background-secondary)" : "transparent",
    fontFamily: "inherit",
    color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    borderBottom: active ? `3px solid ${color || CSC.blue}` : "3px solid transparent",
    fontWeight: active ? 600 : 500,
    whiteSpace: "nowrap",
    // Subtle hover hint for the inactive tabs on devices that hover
    transition: "background-color 120ms ease, color 120ms ease",
  }),
  badge: (type) => { const m = { success: ["#EAF3DE","#3B6D11"], warning: ["#FAEEDA","#854F0B"], danger: ["#FCEBEB","#A32D2D"], info: ["#E6F1FB","#185FA5"], purple: ["#EEEDFE","#534AB7"], pink: ["#FCE7F0","#A03968"] }; const [bg, c] = m[type] || m.info; return { background: bg, color: c, borderRadius: 999, padding: `2px ${SPACE.sm}px`, fontSize: 11, fontWeight: 600, display: "inline-block" }; },
  // Modal styles moved to index.css (.modal-overlay, .modal-sheet, .modal-handle).
  // The Modal component in ui.jsx applies those classes so the bottom-sheet
  // behavior on mobile comes from media queries rather than JS branching.
};

// ─── Gender badge ─────────────────────────────────────────────────────────
// Returns the badge style for a player's gender — Male reads as blue (info),
// Female as pink. Centralized so all three places that render the badge
// (commissioner player list, add-to-league modal, in-league player list)
// stay in sync. Falls back to the neutral info-blue style for any unknown
// gender value so the badge still renders cleanly on legacy/malformed
// records. Callers should still gate on `p.gender` truthiness — this only
// handles "set but unrecognized."
export function genderBadgeStyle(gender) {
  if (gender === "Female") return S.badge("pink");
  return S.badge("info");
}
