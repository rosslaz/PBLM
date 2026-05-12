import { useState } from "react";
import { S } from "../styles.js";
import { COURT_COLORS, SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";

// Edit Week: week-level date/time PLUS optional per-court name + time overrides.
//
// The common use case: a league has 4 courts but only 2 physical surfaces, so
// two groups play at 8:00 and two at 9:30. The commissioner edits Week 1's
// court overrides and clicks "Apply to all weeks" so they don't have to
// repeat it for every week of the season.
//
// onSubmit receives (date, time, courtOverrides, applyTo)
//   date           "YYYY-MM-DD"
//   time           "HH:MM" or null  — week-level default time
//   courtOverrides array indexed by court position, each { name, time }
//                  (both strings; empty = "no override / fall back to week")
//   applyTo        "this" | "all"
export function EditWeekForm({ weekData, onSubmit, onCancel }) {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(weekData.date || "");
  const [time, setTime] = useState(weekData.time || "");
  const [applyTo, setApplyTo] = useState("this");

  // Per-court state: one row per court in the week. We initialize from any
  // existing customName / time on the court, leaving the rest empty.
  // Placeholders / empty weeks have no courts yet, so this is an empty array.
  const courts = weekData.courts || [];
  const [overrides, setOverrides] = useState(
    courts.map(ct => ({
      name: ct.customName || "",
      time: ct.time || "",
    }))
  );

  function setCourtOverride(i, field, value) {
    setOverrides(prev => prev.map((o, j) => j === i ? { ...o, [field]: value } : o));
  }

  function handleSubmit() {
    if (!date) return alert("Date is required.");
    // Only pass courtOverrides if there are courts (skip for placeholder weeks)
    const payload = courts.length > 0 ? overrides : undefined;
    onSubmit(date, time || null, payload, applyTo);
  }

  const hasCourts = courts.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Adjust the week's date, default start time, and (optionally) per-court name and time. Players will see the updated info on their schedule.
      </p>

      {/* Week-level fields */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.md }}>
        <div>
          <label style={S.label}>Date *</label>
          <input style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Default start time</label>
          <input style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} placeholder="e.g. 08:00" />
        </div>
      </div>

      {/* Per-court overrides */}
      {hasCourts && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, marginBottom: SPACE.sm }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Per-court overrides
            </span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              optional
            </span>
          </div>
          <p style={{ margin: `0 0 ${SPACE.sm}px`, fontSize: 12, color: "var(--color-text-secondary)" }}>
            Leave a field blank to use the week defaults. Useful when courts run at different times — e.g. Courts 1 &amp; 2 at 8:00, Courts 3 &amp; 4 at 9:30.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
            {courts.map((ct, i) => {
              const color = COURT_COLORS[i % COURT_COLORS.length];
              return (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "80px 1fr 100px" : "100px 1fr 120px",
                  gap: SPACE.sm,
                  alignItems: "center",
                }}>
                  {/* Court swatch + default label */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: SPACE.xs,
                    fontSize: 12,
                    fontWeight: 600,
                    color,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    {ct.courtName || `Court ${i + 1}`}
                  </div>
                  <input
                    style={{ ...S.input, fontSize: 13 }}
                    type="text"
                    placeholder={`Custom name (default: ${ct.courtName || `Court ${i + 1}`})`}
                    value={overrides[i]?.name || ""}
                    onChange={e => setCourtOverride(i, "name", e.target.value)}
                  />
                  <input
                    style={{ ...S.input, fontSize: 13 }}
                    type="time"
                    placeholder="time"
                    value={overrides[i]?.time || ""}
                    onChange={e => setCourtOverride(i, "time", e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Apply-to scope */}
      {hasCourts && (
        <div style={{
          padding: `${SPACE.md}px ${SPACE.md}px`,
          background: "var(--color-background-secondary)",
          borderRadius: 8,
          border: "0.5px solid var(--color-border-secondary)",
        }}>
          <label style={{ ...S.label, marginBottom: SPACE.sm }}>Apply changes to</label>
          <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs }}>
            <label style={{ display: "flex", alignItems: "center", gap: SPACE.sm, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="applyTo"
                value="this"
                checked={applyTo === "this"}
                onChange={() => setApplyTo("this")}
              />
              Just Week {weekData.week}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: SPACE.sm, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="applyTo"
                value="all"
                checked={applyTo === "all"}
                onChange={() => setApplyTo("all")}
              />
              <span>
                All weeks in the season
                <span style={{ marginLeft: SPACE.xs, fontSize: 11, color: "var(--color-text-secondary)" }}>
                  (court names + times copy to every week; each week keeps its own date)
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm, marginTop: SPACE.xs }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>
          {applyTo === "all" ? "Save & Apply to All" : "Save"}
        </button>
      </div>
    </div>
  );
}
