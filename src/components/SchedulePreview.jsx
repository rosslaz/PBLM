// ─── Schedule preview — review a generated schedule before committing it ────
// Mixer leagues generate a full season at once; ladder leagues generate one
// week. Either way, this modal shows the proposed court compositions and the
// commissioner accepts, retries (if applicable), or cancels.
import { S } from "../styles.js";
import { CSC, COURT_COLORS } from "../lib/constants.js";
import { formatDate, formatDateTime } from "../lib/format.js";

// Single week of preview — collapsed list of courts and their players.
function PreviewWeek({ week }) {
  return (
    <div style={{ marginBottom: 14, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "10px 12px", background: "var(--color-background-secondary)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Week {week.week}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {formatDateTime(week.date, week.time) || formatDate(week.date)}
        </span>
      </div>
      {week.courts.map((court, ci) => {
        const color = COURT_COLORS[ci % COURT_COLORS.length];
        return (
          <div key={court.courtName} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "5px 8px", borderRadius: 6, background: color + "12", border: `0.5px solid ${color}40` }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 11, color, letterSpacing: "0.4px", minWidth: 60 }}>
              {court.courtName.toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-primary)", flex: 1, minWidth: 0 }}>
              {court.playerNames.join(" · ")}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>
              {court.players.length} players
            </span>
          </div>
        );
      })}
    </div>
  );
}

// `preview` is what computePreview returned. It must have:
//   - weeks: same shape as schedule data, but each court has a `playerNames`
//     array alongside `players` (pre-resolved for display)
//   - leagueName, summary (a one-line description)
//   - canRetry (bool): whether the "Try Again" button is shown
// `onAccept` writes the preview to the DB; `onRetry` recomputes (only used if
// canRetry); `onCancel` closes the modal.
export function SchedulePreview({ preview, onAccept, onRetry, onCancel }) {
  if (!preview) return null;
  return (
    <div>
      <div style={{ marginBottom: 14, padding: "10px 12px", background: CSC.blueLight, borderRadius: 8, border: `0.5px solid ${CSC.blue}30` }}>
        <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 700, color: CSC.blueDark, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Preview · not yet saved
        </p>
        <p style={{ margin: 0, fontSize: 13, color: CSC.blueDark }}>{preview.summary}</p>
      </div>

      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4, marginBottom: 14 }}>
        {preview.weeks.map(w => <PreviewWeek key={w.week} week={w} />)}
      </div>

      {preview.warning && (
        <div style={{ padding: "8px 12px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 12, color: "#854F0B" }}>
          ⚠ {preview.warning}
        </div>
      )}

      <div style={{ ...S.row, justifyContent: "space-between", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <div style={{ display: "flex", gap: 8 }}>
          {preview.canRetry && (
            <button style={S.btn("secondary")} onClick={onRetry}>↻ Try Again</button>
          )}
          <button style={S.btn("primary")} onClick={onAccept}>Accept &amp; Save</button>
        </div>
      </div>
    </div>
  );
}
