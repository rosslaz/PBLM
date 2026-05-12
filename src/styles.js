// ─── Inline style presets ───────────────────────────────────────────────────
// Shared style snippets used by virtually every component. Imported as S.
import { CSC } from "./lib/constants.js";

export const S = {
  page: { minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "'Georgia','Times New Roman',serif" },
  header: (color) => ({ background: color || CSC.blue, color: "#fff", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap", rowGap: 8 }),
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px", margin: 0 },
  card: { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "16px 20px", marginBottom: 12 },
  btn: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 500 }),
  btnSm: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 500 }),
  input: { width: "100%", padding: "8px 12px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" },
  label: { fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4, display: "block" },
  row: { display: "flex", gap: 12, alignItems: "center" },
  section: { padding: "16px 20px" },
  tabBar: { display: "flex", gap: 4, borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 20px", background: "var(--color-background-primary)", overflowX: "auto" },
  tab: (active, color) => ({ padding: "10px 16px", cursor: "pointer", fontSize: 14, border: "none", background: "transparent", fontFamily: "inherit", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)", borderBottom: active ? `2px solid ${color || CSC.blue}` : "2px solid transparent", fontWeight: active ? 500 : 400, whiteSpace: "nowrap" }),
  badge: (type) => { const m = { success: ["#EAF3DE","#3B6D11"], warning: ["#FAEEDA","#854F0B"], danger: ["#FCEBEB","#A32D2D"], info: ["#E6F1FB","#185FA5"], purple: ["#EEEDFE","#534AB7"] }; const [bg, c] = m[type] || m.info; return { background: bg, color: c, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, display: "inline-block" }; },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 },
  modalBox: { background: "var(--color-background-primary)", borderRadius: 16, padding: "24px", maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" },
};
