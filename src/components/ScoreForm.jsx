import { useState, useRef, useEffect } from "react";
import { S } from "../styles.js";
import { useIsMobile } from "../lib/session.js";
import { formatDate } from "../lib/format.js";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

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

// Subtle accent border when a field is filled but the pair isn't yet complete.
// Brand blue at 30% alpha.
const CSC_BLUE_30 = "rgba(27, 108, 193, 0.3)";

// Pickleball winners typically reach exactly 11; anything ≥11 is also a
// plausible "done typing the winning score" signal for the auto-advance.
const WINNING_THRESHOLD = 11;
const AUTO_ADVANCE_MS = 400;

export function ScoreForm({ match, leagueId, existing, getPlayerName, onSubmit, onClose }) {
  const isMobile = useIsMobile();
  const isLoading = useIsActionPending("submit-score");
  const [home, setHome] = useState(existing?.homeScore ?? "");
  const [away, setAway] = useState(existing?.awayScore ?? "");
  const homeRef = useRef(null);
  const awayRef = useRef(null);

  // Autofocus on mount. The empty side gets focus first; if both are filled
  // (edit case) we focus home and select its contents so the user can
  // immediately retype to replace.
  useEffect(() => {
    const targetRef = home === "" ? homeRef
                    : away === "" ? awayRef
                    : homeRef;
    const el = targetRef.current;
    if (!el) return;
    // Small timeout — modal mount → focus race condition on some browsers
    const t = setTimeout(() => {
      el.focus();
      if (el.value) el.select();
    }, 50);
    return () => clearTimeout(t);
    // Only run on mount. We don't want focus to jump back here every time
    // `home` or `away` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance: once the home value reaches a plausible winning score AND
  // the user pauses typing, jump focus to the away field. The pause matters:
  // typing "1" then "1" should NOT trigger a jump at "1", only at "11" after
  // the user stops. Cleanup cancels the timer when the value keeps changing.
  useEffect(() => {
    if (away !== "") return; // user already moved on — don't yank focus
    const value = parseInt(home, 10);
    if (!Number.isFinite(value) || value < WINNING_THRESHOLD) return;
    // Don't auto-advance from a non-focused home field (e.g. user manually
    // refocused the home input to fix it after entering both scores).
    if (document.activeElement !== homeRef.current) return;
    const t = setTimeout(() => {
      // Re-check at fire time: state may have changed
      if (parseInt(home, 10) >= WINNING_THRESHOLD && away === "" && document.activeElement === homeRef.current) {
        awayRef.current?.focus();
      }
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [home, away]);

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

  // Enter on the home field moves to away (if empty) or submits when valid;
  // Enter on the away field always submits when valid.
  function handleKeyDown(e, which) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (which === "home" && away === "") {
      awayRef.current?.focus();
    } else if (isValid) {
      handleSubmit();
    }
  }

  // Strip non-digit characters before setting state. Keeps inputMode="numeric"
  // robust against pasted text or stray characters, and caps at 2 digits.
  function cleanedNumeric(value) {
    return value.replace(/\D/g, "").slice(0, 2);
  }

  // Score input field — shared styling for both sides. Font size comes from
  // the .score-input CSS class (necessary because the iOS-zoom-prevention
  // media query uses !important; we need a class-based !important to win).
  const fieldStyle = (filled) => ({
    ...S.input,
    textAlign: "center",
    padding: isMobile ? "14px 6px" : "18px 8px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    border: `2px solid ${home !== "" && away !== "" ? (isValid ? "#3B6D11" : "#A32D2D") : (filled ? CSC_BLUE_30 : "var(--color-border-secondary)")}`,
  });

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
          <input
            ref={homeRef}
            className="score-input"
            style={fieldStyle(home !== "")}
            // type=text + inputMode=numeric gives the iOS numeric keypad
            // without the spinner UI and odd arrow-key behavior of type=number.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            // Hint to mobile keyboards: show "next" key if away is still empty
            enterKeyHint={away === "" ? "next" : "done"}
            value={home}
            onChange={e => setHome(cleanedNumeric(e.target.value))}
            onKeyDown={e => handleKeyDown(e, "home")}
            onFocus={e => e.target.select()}
          />
        </div>
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 22, paddingBottom: 14 }}>–</div>
        <div style={{ textAlign: "center" }}>
          <label style={{ ...S.label, textAlign: "center", whiteSpace: "normal" }}>{labelB}</label>
          <input
            ref={awayRef}
            className="score-input"
            style={fieldStyle(away !== "")}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            enterKeyHint="done"
            value={away}
            onChange={e => setAway(cleanedNumeric(e.target.value))}
            onKeyDown={e => handleKeyDown(e, "away")}
            onFocus={e => e.target.select()}
          />
        </div>
      </div>
      {errorMsg && <p style={{ textAlign: "center", color: "#A32D2D", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#FCEBEB", borderRadius: 6 }}>{errorMsg}</p>}
      {isValid && <p style={{ textAlign: "center", color: "#3B6D11", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#EAF3DE", borderRadius: 6 }}>
        {parseInt(home,10) > parseInt(away,10) ? labelA : labelB} wins!
      </p>}
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onClose} disabled={isLoading}>Cancel</button>
        <button
          style={{ ...S.btn("primary"), opacity: isValid && !isLoading ? 1 : 0.5, minWidth: 130 }}
          onClick={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? <><Spinner /> Saving…</> : "Submit Score"}
        </button>
      </div>
    </div>
  );
}
