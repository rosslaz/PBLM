import { useState } from "react";
import { S } from "../styles.js";
import { MAX_COURTS, MAX_PER_COURT, COURT_COLORS, SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";

// Build a fresh courtConfig array of the given length.
// Each entry is { name: "", time: "" }. Existing values at the same index
// are preserved so growing/shrinking numCourts doesn't lose data.
function resizeCourtConfig(existing, length) {
  const out = [];
  for (let i = 0; i < length; i++) {
    out.push({
      name: existing?.[i]?.name || "",
      time: existing?.[i]?.time || "",
    });
  }
  return out;
}

export function LeagueForm({ initial, onSubmit, onCancel }) {
  const isMobile = useIsMobile();
  const initialNumCourts = initial?.numCourts || 4;
  const [form, setForm] = useState({
    name: initial?.name || "",
    weeks: initial?.weeks || 8,
    startDate: initial?.startDate || new Date().toISOString().split("T")[0],
    format: initial?.format || "Singles",
    gender: initial?.gender || "Mixed",
    competitionType: initial?.competitionType || "mixer",
    numCourts: initialNumCourts,
    location: initial?.location || "",
    description: initial?.description || "",
    status: initial?.status || "open",
    courtConfig: resizeCourtConfig(initial?.courtConfig, initialNumCourts),
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // When the user changes Number of Courts, resize courtConfig to match.
  function setNumCourts(n) {
    setForm(f => ({
      ...f,
      numCourts: n,
      courtConfig: resizeCourtConfig(f.courtConfig, n),
    }));
  }

  function setCourtField(i, field, value) {
    setForm(f => ({
      ...f,
      courtConfig: f.courtConfig.map((c, j) => j === i ? { ...c, [field]: value } : c),
    }));
  }

  function handleSubmit() {
    if (!form.name.trim()) return alert("League name required");
    // Drop empty courtConfig entries — store undefined if every entry is blank,
    // so leagues that don't customize don't carry a payload.
    const hasAnyOverride = form.courtConfig.some(c => c.name || c.time);
    const payload = {
      ...form,
      courtConfig: hasAnyOverride ? form.courtConfig : undefined,
    };
    onSubmit(payload);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
      <div><label style={S.label}>League Name *</label><input style={S.input} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Singles 2025" /></div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.md }}>
        <div><label style={S.label}>Number of Weeks *</label><input style={S.input} type="number" min={1} max={52} value={form.weeks} onChange={e => set("weeks", +e.target.value)} /></div>
        <div><label style={S.label}>Start Date *</label><input style={S.input} type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.md }}>
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
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.md }}>
        <div><label style={S.label}>Status</label><select style={S.input} value={form.status} onChange={e => set("status", e.target.value)}><option value="open">Open Registration</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select></div>
        <div>
          <label style={S.label}>Number of Courts *</label>
          <select style={S.input} value={form.numCourts} onChange={e => setNumCourts(+e.target.value)}>
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
          {/* The dropdown value is still "mixer" internally — it's the
              database identifier. The user-facing label is "Round-Robin" as
              of v0.10.x. */}
          <option value="mixer">Round-Robin — every player faces every other player across the season</option>
          <option value="ladder">Ladder — week-by-week, courts based on previous week's results</option>
        </select>
      </div>
      <div><label style={S.label}>Description</label><textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional…" /></div>

      {/* ─── Court config (optional) ─────────────────────────────────────
          Default name + start time for each court. Applies to every week
          unless the commissioner sets a per-week override on Edit Week. */}
      <div style={{
        padding: `${SPACE.md}px ${SPACE.md}px`,
        background: "var(--color-background-secondary)",
        borderRadius: 8,
        border: "0.5px solid var(--color-border-secondary)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, marginBottom: SPACE.xs }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Court defaults
          </span>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>optional</span>
        </div>
        <p style={{ margin: `0 0 ${SPACE.sm}px`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          Set a default name and start time for each court. These apply to every week unless overridden per week. Leave blank to use the generator default and the week's start time.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
          {form.courtConfig.map((c, i) => {
            const color = COURT_COLORS[i % COURT_COLORS.length];
            return (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "80px 1fr 100px" : "100px 1fr 120px",
                gap: SPACE.sm,
                alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, fontSize: 12, fontWeight: 600, color }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  Court {i + 1}
                </div>
                <input
                  style={{ ...S.input, fontSize: 13 }}
                  type="text"
                  placeholder={`Default name (e.g. "8AM N")`}
                  value={c.name}
                  onChange={e => setCourtField(i, "name", e.target.value)}
                />
                <input
                  style={{ ...S.input, fontSize: 13 }}
                  type="time"
                  placeholder="time"
                  value={c.time}
                  onChange={e => setCourtField(i, "time", e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm, marginTop: SPACE.xs }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>{initial ? "Save Changes" : "Create League"}</button>
      </div>
    </div>
  );
}
