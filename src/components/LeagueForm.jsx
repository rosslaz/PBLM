import { useState } from "react";
import { S } from "../styles.js";
import { MAX_COURTS, MAX_PER_COURT } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";

export function LeagueForm({ initial, onSubmit, onCancel }) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({ name: initial?.name || "", weeks: initial?.weeks || 8, startDate: initial?.startDate || new Date().toISOString().split("T")[0], format: initial?.format || "Singles", gender: initial?.gender || "Mixed", competitionType: initial?.competitionType || "mixer", numCourts: initial?.numCourts || 4, location: initial?.location || "", description: initial?.description || "", status: initial?.status || "open" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function handleSubmit() {
    if (!form.name.trim()) return alert("League name required");
    onSubmit(form);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label style={S.label}>League Name *</label><input style={S.input} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Singles 2025" /></div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Number of Weeks *</label><input style={S.input} type="number" min={1} max={52} value={form.weeks} onChange={e => set("weeks", +e.target.value)} /></div>
        <div><label style={S.label}>Start Date *</label><input style={S.input} type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Format</label><select style={S.input} value={form.format} onChange={e => set("format", e.target.value)}><option>Singles</option><option>Doubles</option><option>Mixed Doubles</option></select></div>
        <div>
          <label style={S.label}>Gender *</label>
          <select style={S.input} value={form.gender} onChange={e => set("gender", e.target.value)}>
            <option value="Mixed">Mixed</option>
            <option value="Men's">Men's</option>
            <option value="Women's">Women's</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Status</label><select style={S.input} value={form.status} onChange={e => set("status", e.target.value)}><option value="open">Open Registration</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select></div>
        <div>
          <label style={S.label}>Number of Courts *</label>
          <select style={S.input} value={form.numCourts} onChange={e => set("numCourts", +e.target.value)}>
            {Array.from({ length: MAX_COURTS }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n} court{n!==1?"s":""} (max {n * MAX_PER_COURT} players)</option>
            ))}
          </select>
        </div>
        <div><label style={S.label}>Location</label><input style={S.input} value={form.location} onChange={e => set("location", e.target.value)} placeholder="Community Center" /></div>
      </div>
      <div>
        <label style={S.label}>Competition Type *</label>
        <select style={S.input} value={form.competitionType} onChange={e => set("competitionType", e.target.value)}>
          <option value="mixer">Mixer — full schedule generated upfront, courts rotate for variety</option>
          <option value="ladder">Ladder — week-by-week, courts based on previous week's results</option>
        </select>
      </div>
      <div><label style={S.label}>Description</label><textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional…" /></div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>{initial ? "Save Changes" : "Create League"}</button>
      </div>
    </div>
  );
}
