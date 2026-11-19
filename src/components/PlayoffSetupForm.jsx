import { useState } from "react";
import { S } from "../styles.js";
import { SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";
import { playoffGroups, PLAYOFF_GAME_TO } from "../lib/playoffs.js";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

// v1.17.0 — the commissioner's playoff setup, and the same form for moving
// the night later.
//
//   mode "setup"  shows the seeds (final standings order), the two groups and
//                 the three games each plays, then asks for the date
//   mode "dates"  just the date and start time
//
// Seeds aren't editable here on purpose: they come from the standings, which
// is the whole fairness argument for the format. If the standings are wrong,
// the fix is the scores, not hand-edited groups.
export function PlayoffSetupForm({ mode = "setup", seeds = [], seedPoints, getPlayerName, defaults, onSubmit, onCancel, color }) {
  const isMobile = useIsMobile();
  const actionId = mode === "setup" ? "setup-playoffs" : "playoff-dates";
  const isPending = useIsActionPending(actionId);
  const [date, setDate] = useState(defaults?.date || "");
  const [time, setTime] = useState(defaults?.time || "");

  const error = !date ? "Pick a date for the playoff night." : null;
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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.sm }}>
            {playoffGroups(seeds).map(g => (
              <div key={g.key} style={{ minWidth: 0, padding: "8px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, fontSize: 13 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700 }}>
                  {g.label} <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}>· seeds {g.seeds[0]}–{g.seeds[3]}</span>
                </p>
                {g.games.map((game, i) => (
                  <p key={i} style={{ margin: "2px 0 0" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>G{i + 1}</span> {team(game.team1)} <span style={{ color: "var(--color-text-secondary)" }}>vs</span> {team(game.team2)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: SPACE.md }}>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="po-date" style={S.label}>Playoff night</label>
          <input id="po-date" style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="po-time" style={S.label}>Start time</label>
          <input id="po-time" style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
        Each group plays all three partner combos, one game each, to {PLAYOFF_GAME_TO} (win by 2). Most wins tops the group;
        ties go to point differential, then seed. Playoff games don't count toward the standings
        {mode === "setup" ? ", and the groups are fixed once they're created." : "."}
      </p>

      <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm }}>
        <button style={S.btn("secondary")} onClick={onCancel} disabled={isPending}>Cancel</button>
        <button
          style={{ ...S.btn("primary"), background: color, opacity: error ? 0.5 : 1, minWidth: 150 }}
          disabled={!!error || isPending}
          title={error || undefined}
          onClick={() => onSubmit({ date, time })}>
          {isPending ? <><Spinner /> Saving…</> : mode === "setup" ? "Create playoffs" : "Save date"}
        </button>
      </div>
    </div>
  );
}
