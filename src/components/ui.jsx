// ─── Shared UI primitives ───────────────────────────────────────────────────
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";

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
