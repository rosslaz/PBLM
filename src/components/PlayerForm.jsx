import { useState } from "react";
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";

export function PlayerForm({ onSubmit, onCancel, initial }) {
  const isMobile = useIsMobile();
  // Backward-compat: if editing a legacy player with only `name`, split it
  const [legacyFirst, legacyLast] = (() => {
    if (!initial?.name || initial?.firstName) return ["", ""];
    const parts = initial.name.trim().split(/\s+/);
    return [parts[0] || "", parts.slice(1).join(" ")];
  })();

  const [form, setForm] = useState({
    firstName: initial?.firstName ?? legacyFirst,
    lastName: initial?.lastName ?? legacyLast,
    email: initial?.email || "",
    phone: initial?.phone || "",
    gender: initial?.gender || "",
    cscMember: initial?.cscMember || false,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function handleSubmit() {
    if (!form.firstName.trim()) return alert("First name required");
    if (!form.lastName.trim()) return alert("Last name required");
    if (!form.email.trim()) return alert("Email required");
    if (!form.gender) return alert("Please select a gender");
    // Also write the derived name for any legacy code paths that still read it
    onSubmit({
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      name: `${form.firstName.trim()} ${form.lastName.trim()}`,
    });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>First Name *</label><input style={S.input} value={form.firstName} onChange={e => set("firstName", e.target.value)} placeholder="Jane" /></div>
        <div><label style={S.label}>Last Name *</label><input style={S.input} value={form.lastName} onChange={e => set("lastName", e.target.value)} placeholder="Smith" /></div>
      </div>
      <div><label style={S.label}>Email *</label><input style={S.input} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="jane@email.com" /></div>
      <div><label style={S.label}>Phone Number</label><input style={S.input} type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 000-0000" /></div>
      <div>
        <label style={S.label}>Gender *</label>
        <select style={S.input} value={form.gender} onChange={e => set("gender", e.target.value)}>
          <option value="">Select gender…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", background: "var(--color-background-secondary)", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", cursor: "pointer" }} onClick={() => set("cscMember", !form.cscMember)}>
        <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${form.cscMember ? CSC.blue : "var(--color-border-secondary)"}`, background: form.cscMember ? CSC.blue : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {form.cscMember && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 500 }}>CSC Member</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>I am a current Community Sports Club member</p>
        </div>
      </div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        {/* "Save Changes" only when editing an existing player (presence of an
            id). Pre-filling email on a new account still shows "Create Account". */}
        <button style={S.btn("primary")} onClick={handleSubmit}>{initial?.id ? "Save Changes" : "Create Account"}</button>
      </div>
    </div>
  );
}
