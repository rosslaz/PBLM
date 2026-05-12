import { useState } from "react";
import { S } from "../styles.js";
import { useIsMobile } from "../lib/session.js";
import { formatDate } from "../lib/format.js";

function validatePickleballScore(h, a) {
  const hi = parseInt(h, 10), ai = parseInt(a, 10);
  if (isNaN(hi) || isNaN(ai)) return null;
  if (hi < 0 || ai < 0) return "Scores cannot be negative.";
  const winner = Math.max(hi, ai), loser = Math.min(hi, ai);
  if (winner < 11) return "Winner must reach at least 11.";
  if (winner === loser) return "Scores cannot be tied — someone must win.";
  if (winner === 11 && loser > 9) return "At 11, winner must lead by 2 (e.g. 11–9 or less).";
  if (winner > 11 && (winner - loser) !== 2) return "When over 11, winner must lead by exactly 2 (win by 2).";
  return "valid";
}

// Get the two "side" labels for any match (singles → 1 player each side, doubles → 2)
export function matchSides(match) {
  if (match.format === "doubles") {
    return { sideA: match.team1, sideB: match.team2 };
  }
  return { sideA: [match.home], sideB: [match.away] };
}

export function ScoreForm({ match, leagueId, existing, getPlayerName, onSubmit, onClose }) {
  const isMobile = useIsMobile();
  const [home, setHome] = useState(existing?.homeScore ?? "");
  const [away, setAway] = useState(existing?.awayScore ?? "");

  const { sideA, sideB } = matchSides(match);
  const labelA = sideA.map(getPlayerName).join(" + ");
  const labelB = sideB.map(getPlayerName).join(" + ");

  const validation = (home !== "" && away !== "") ? validatePickleballScore(home, away) : null;
  const isValid = validation === "valid";
  const errorMsg = validation && validation !== "valid" ? validation : null;

  function handleSubmit() {
    if (home === "" || away === "") return alert("Enter both scores.");
    if (!isValid) return alert(errorMsg);
    onSubmit(home, away); onClose();
  }

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <span style={{ ...S.badge("info"), marginBottom: 8, display: "inline-block" }}>{match.court} · Week {match.week} · {formatDate(match.date)}</span>
        <p style={{ margin: "8px 0 0", fontSize: 16, fontWeight: 600 }}>{labelA} vs {labelB}</p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>Play to 11, win by 2</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
        <div style={{ textAlign: "center" }}>
          <label style={{ ...S.label, textAlign: "center", whiteSpace: "normal" }}>{labelA}</label>
          <input style={{ ...S.input, textAlign: "center", fontSize: isMobile ? 24 : 32, padding: isMobile ? "10px 6px" : "14px 8px", border: `2px solid ${home !== "" && away !== "" ? (isValid ? "#3B6D11" : "#A32D2D") : "var(--color-border-secondary)"}` }} type="number" min={0} max={99} value={home} onChange={e => setHome(e.target.value)} />
        </div>
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 22, paddingBottom: 12 }}>–</div>
        <div style={{ textAlign: "center" }}>
          <label style={{ ...S.label, textAlign: "center", whiteSpace: "normal" }}>{labelB}</label>
          <input style={{ ...S.input, textAlign: "center", fontSize: isMobile ? 24 : 32, padding: isMobile ? "10px 6px" : "14px 8px", border: `2px solid ${home !== "" && away !== "" ? (isValid ? "#3B6D11" : "#A32D2D") : "var(--color-border-secondary)"}` }} type="number" min={0} max={99} value={away} onChange={e => setAway(e.target.value)} />
        </div>
      </div>
      {errorMsg && <p style={{ textAlign: "center", color: "#A32D2D", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#FCEBEB", borderRadius: 6 }}>{errorMsg}</p>}
      {isValid && <p style={{ textAlign: "center", color: "#3B6D11", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#EAF3DE", borderRadius: 6 }}>
        {parseInt(home,10) > parseInt(away,10) ? labelA : labelB} wins!
      </p>}
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onClose}>Cancel</button>
        <button style={{ ...S.btn("primary"), opacity: isValid ? 1 : 0.5 }} onClick={handleSubmit}>Submit Score</button>
      </div>
    </div>
  );
}
