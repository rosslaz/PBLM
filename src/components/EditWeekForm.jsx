import { useState } from "react";
import { S } from "../styles.js";
import { useIsMobile } from "../lib/session.js";

export function EditWeekForm({ weekData, onSubmit, onCancel }) {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(weekData.date || "");
  const [time, setTime] = useState(weekData.time || "");
  function handleSubmit() {
    if (!date) return alert("Date is required.");
    onSubmit(date, time || null);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Adjust the date or start time for this week. Players will see the updated time on their schedule.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        <div>
          <label style={S.label}>Date *</label>
          <input style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Start time</label>
          <input style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} placeholder="e.g. 18:00" />
        </div>
      </div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}
