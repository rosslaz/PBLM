import { useState } from "react";
import { S } from "../styles.js";
import { useIsMobile } from "../lib/session.js";
import { isValidPhone, digitsOnly } from "../lib/format.js";

// Phase 3 / v1.2.0: the CSC-specific `cscMember` checkbox was removed.
// Multi-tenant signups can't ask club-specific questions, so this form
// is now generic across all clubs. Existing players' `cscMember=true`
// stored values are preserved on edit (the field round-trips through
// the App-level updatePlayer wrapper via the JSONB merge); the form
// just stops exposing it. If per-club custom fields are needed later,
// they'll be modeled at the club level rather than hardcoded here.
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
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function handleSubmit() {
    if (!form.firstName.trim()) return alert("First name required");
    if (!form.lastName.trim()) return alert("Last name required");
    if (!form.email.trim()) return alert("Email required");
    if (!form.phone.trim()) return alert("Phone number required");
    if (!isValidPhone(form.phone)) return alert("Please enter a valid phone number (at least 10 digits).");
    if (!form.gender) return alert("Please select a gender");
    // Store the digits-only canonical form. Display formatting happens at
    // render time via formatPhone. This keeps copy-to-clipboard and any
    // future SMS/WhatsApp links consistent regardless of how the user
    // typed the number ("(248) 555-1234" vs "248-555-1234" vs "2485551234").
    onSubmit({
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: digitsOnly(form.phone),
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
      <div><label style={S.label}>Phone Number *</label><input style={S.input} type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 000-0000" /></div>
      <div>
        <label style={S.label}>Gender *</label>
        <select style={S.input} value={form.gender} onChange={e => set("gender", e.target.value)}>
          <option value="">Select gender…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
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
