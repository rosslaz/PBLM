import { useState } from "react";
import { S } from "../styles.js";
import { SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";
import { semifinalPairings, PLAYOFF_BEST_OF, PLAYOFF_WINS_NEEDED } from "../lib/playoffs.js";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

// v1.16.0 — the commissioner's playoff setup, and the same form for moving
// the dates later.
//
//   mode "setup"  shows the seeds (final standings order) and the semifinal
//                 pairings they produce, then asks for the two dates
//   mode "dates"  just the dates and start time
//
// Seeds aren't editable here on purpose: they come from the standings, which
// is the whole fairness argument for the format. If the standings are wrong,
// the fix is the scores, not a hand-edited bracket.
export function PlayoffSetupForm({ mode = "setup", seeds = [], seedPoints, getPlayerName, defaults, onSubmit, onCancel, color }) {
  const isMobile = useIsMobile();
  const actionId = mode === "setup" ? "setup-playoffs" : "playoff-dates";
  const isPending = useIsActionPending(actionId);
  const [semiDate, setSemiDate] = useState(defaults?.dates?.[0] || "");
  const [finalDate, setFinalDate] = useState(defaults?.dates?.[1] || "");
  const [time, setTime] = useState(defaults?.time || "");

  const error = !semiDate || !finalDate
    ? "Pick a date for both playoff weeks."
    : finalDate < semiDate
      ? "The finals can't be before the semifinals."
      : null;
  const team = ids => ids.map(getPlayerName).join(" & ");
  const fmtPts = v => {
    if (v == null) return "";
    const r = Math.round(v * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)} pts`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
      {mode === "setup" && (
        <>
          <div>
            <p style={{ ...S.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Seeds · final standings</p>
            <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", columnGap: SPACE.lg, rowGap: 2, fontSize: 13 }}>
              {seeds.map((pid, i) => (
                <li key={pid}>
                  <span style={{ fontWeight: 600 }}>{getPlayerName(pid)}</span>
                  {seedPoints?.[i] != null && <span style={{ color: "var(--color-text-secondary)" }}> · {fmtPts(seedPoints[i])}</span>}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p style={{ ...S.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Semifinals</p>
            {semifinalPairings(seeds).map(sf => (
              <div key={sf.key} style={{ padding: "8px 12px", marginBottom: SPACE.xs, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{sf.label}:</span>{" "}
                {team(sf.teamA)} <span style={{ color: "var(--color-text-secondary)" }}>({sf.seedsA.join(" & ")})</span>
                {" vs "}
                {team(sf.teamB)} <span style={{ color: "var(--color-text-secondary)" }}>({sf.seedsB.join(" & ")})</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: SPACE.md }}>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="po-semi-date" style={S.label}>Semifinals</label>
          <input id="po-semi-date" style={S.input} type="date" value={semiDate} onChange={e => setSemiDate(e.target.value)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="po-final-date" style={S.label}>Finals &amp; 3rd place</label>
          <input id="po-final-date" style={S.input} type="date" value={finalDate} onChange={e => setFinalDate(e.target.value)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="po-time" style={S.label}>Start time</label>
          <input id="po-time" style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
        Every matchup is best of {PLAYOFF_BEST_OF}: the first team to win {PLAYOFF_WINS_NEEDED} games takes the series.
        Week 2 is set from the week 1 results: winners play for the title, losers for 3rd.
        Playoff games don't count toward the standings{mode === "setup" ? ", and the seeds are fixed once the bracket is created." : "."}
      </p>

      {error && (semiDate || finalDate) && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-danger)" }}>{error}</p>
      )}

      <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm }}>
        <button style={S.btn("secondary")} onClick={onCancel} disabled={isPending}>Cancel</button>
        <button
          style={{ ...S.btn("primary"), background: color, opacity: error ? 0.5 : 1, minWidth: 150 }}
          disabled={!!error || isPending}
          onClick={() => onSubmit({ dates: [semiDate, finalDate], time })}>
          {isPending ? <><Spinner /> Saving…</> : mode === "setup" ? "Create bracket" : "Save dates"}
        </button>
      </div>
    </div>
  );
}
