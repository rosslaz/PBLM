import { useState, useRef } from "react";
import { S } from "../styles.js";
import { CSC, COURT_COLORS } from "../lib/constants.js";
import { formatDate, formatDateTime, formatTime, resolveCourtName, resolveCourtTime, isCurrentOrPastWeek, isPastWeek } from "../lib/format.js";
import { useIsMobile } from "../lib/session.js";
import { CheckInRow } from "./CheckInRow.jsx";
import { CheckInSummary } from "./CheckInSummary.jsx";
import { matchSides, validatePickleballScore } from "./ScoreForm.jsx";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

// ─── Inline score entry ────────────────────────────────────────────────────
// Compact two-input + submit-button group that sits in place of the "Score"
// button on unscored match rows. Replaces the round-trip to the modal for
// the common case: just played a match, type two numbers, done.
//
// Validation happens inline — invalid scores can't be submitted; an error
// message appears below the row briefly. Editing existing scores still
// goes through the full modal (tap the displayed score), since that's the
// less-frequent and validation-heavier case.
//
// matchId is used as part of the per-match action ID so a spinning ✓
// button doesn't affect other rows.
function InlineScoreEntry({ match, onSubmit, accentColor }) {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const homeRef = useRef(null);
  const awayRef = useRef(null);
  const actionId = `submit-score-${match.id}`;
  const isPending = useIsActionPending(actionId);

  // Digits-only normalization (mobile keyboards can sneak in weird chars).
  const clean = v => v.replace(/[^0-9]/g, "").slice(0, 2);

  const both = home !== "" && away !== "";
  const validation = both ? validatePickleballScore(home, away) : null;
  const isValid = validation === "valid";

  function handleSubmit() {
    if (!both) {
      // If only one side is filled, focus the empty one.
      if (home === "") homeRef.current?.focus();
      else if (away === "") awayRef.current?.focus();
      return;
    }
    if (!isValid) {
      // Button is already disabled when invalid; this branch is defensive.
      return;
    }
    onSubmit(home, away, match, actionId);
  }

  // Auto-advance to the away input on space/enter/dash from home; Enter on
  // away submits. The keyboard's "next" / "done" hints reinforce this.
  function handleHomeChange(v) {
    setHome(clean(v));
  }
  function handleAwayChange(v) {
    setAway(clean(v));
  }
  function handleHomeKey(e) {
    if (e.key === "Enter" || e.key === " " || e.key === "-") {
      e.preventDefault();
      awayRef.current?.focus();
    }
  }
  function handleAwayKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  const sharedInputStyle = {
    width: 36,
    height: 28,
    padding: "0 4px",
    textAlign: "center",
    fontWeight: 700,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    borderRadius: 6,
    border: `1.5px solid ${both && !isValid ? "#A32D2D" : "var(--color-border-secondary)"}`,
    background: "var(--color-background-primary)",
    color: "var(--color-text-primary)",
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <>
      <input
        ref={homeRef}
        className="inline-score-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        autoComplete="off"
        enterKeyHint={away === "" ? "next" : "done"}
        value={home}
        onChange={e => handleHomeChange(e.target.value)}
        onKeyDown={handleHomeKey}
        onFocus={e => e.target.select()}
        aria-label="Home score"
        disabled={isPending}
        style={sharedInputStyle}
      />
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
      <input
        ref={awayRef}
        className="inline-score-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        autoComplete="off"
        enterKeyHint="done"
        value={away}
        onChange={e => handleAwayChange(e.target.value)}
        onKeyDown={handleAwayKey}
        onFocus={e => e.target.select()}
        aria-label="Away score"
        disabled={isPending}
        style={sharedInputStyle}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || (both && !isValid)}
        aria-label="Submit score"
        title={both && !isValid ? validation : "Submit score"}
        style={{
          marginLeft: 4,
          width: 30, height: 28,
          padding: 0,
          fontSize: 14, fontWeight: 700, lineHeight: 1,
          border: "none", borderRadius: 6,
          background: (both && isValid) ? accentColor : "var(--color-border-secondary)",
          color: (both && isValid) ? "#fff" : "var(--color-text-tertiary)",
          cursor: isPending ? "default" : ((both && isValid) ? "pointer" : "not-allowed"),
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontFamily: "inherit",
        }}>
        {isPending ? <Spinner marginRight={0} /> : "✓"}
      </button>
    </>
  );
}

// myId: the current player's id (undefined for commissioner full view)
// myCourtPlayers: set of player IDs on the same court as myId this week (for edit gating)
// isLocked: commissioner has locked this week — players cannot edit, commissioner still can
// isAdmin: full commissioner access
// league: the league record (used to resolve league-level court defaults)
export function CourtWeekCard({ weekData, league, leagueId, leagueName, getScore, getPlayerName, getPlayerEmail, onEnterScore, onSubmitScore, onToggleLock, onEditDateTime, onRebalance, myId, myCourtPlayers, isLocked, isAdmin, isCurrentWeek, myCheckIn, onSetCheckIn, regs, getCheckInForPlayer }) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();

  // Compute the time summary for the week header.
  // Default: the week's single time, e.g. "Wed Oct 15 · 8:00 AM".
  // If any court has an override (per-week or league-level) that differs,
  // show a range like "Wed Oct 15 · 8:00 AM – 9:30 AM" — quick sense of the
  // day's span without enumerating every court.
  const headerDateTime = (() => {
    if (weekData.placeholder || !weekData.courts) {
      return formatDateTime(weekData.date, weekData.time);
    }
    // Resolve each court's effective time via the cascade
    const effective = weekData.courts
      .map((ct, i) => resolveCourtTime(ct, i, league, weekData.time))
      .filter(Boolean);
    if (effective.length === 0) return formatDate(weekData.date);
    const unique = [...new Set(effective)].sort();
    if (unique.length === 1) return formatDateTime(weekData.date, unique[0]);
    return `${formatDate(weekData.date)} · ${formatTime(unique[0])} – ${formatTime(unique[unique.length - 1])}`;
  })();
  const totalMatches = weekData.courts.reduce((s, c) => s + c.matches.length, 0);
  const scoredMatches = weekData.courts.reduce((s, c) => s + c.matches.filter(m => getScore(leagueId, m.week, m.id)).length, 0);
  const allScored = scoredMatches === totalMatches && totalMatches > 0;
  // Players can't enter scores for weeks that haven't happened yet. The
  // commissioner can score any week regardless (for testing / corrections).
  const weekIsCurrentOrPast = isCurrentOrPastWeek(weekData.date);
  const weekIsStrictlyPast = isPastWeek(weekData.date);
  const playerBlockedFuture = !!myId && !weekIsCurrentOrPast;

  const headerBg = isLocked ? "#F1EFE8" : allScored ? "#EAF3DE" : "var(--color-background-secondary)";

  // Season-progress tinting via a 4px left stripe on the card.
  //   - Past:    muted gray (de-emphasized — for reference)
  //   - Current: NO stripe — identity comes from the "THIS WEEK" badge in
  //              the header; a stripe + badge double-cued the same idea
  //              and made the card feel visually shouty.
  //   - Future:  pale blue (gently positive, "coming up")
  // Placeholder weeks (no data yet) and the commissioner view both skip the
  // stripe entirely — the stripe is purely a player-side orientation aid.
  const showStripe = !weekData.placeholder && !isAdmin && !isCurrentWeek
    && (weekIsStrictlyPast || !weekIsCurrentOrPast);
  const stripeColor = weekIsStrictlyPast
    ? "var(--color-border-secondary)"
    : CSC.blueLight;

  return (
    <div style={{
      ...S.card,
      marginBottom: 12,
      padding: 0,
      overflow: "hidden",
      borderLeft: showStripe ? `4px solid ${stripeColor}` : (S.card.borderLeft || undefined),
    }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: headerBg, borderBottom: expanded ? "0.5px solid var(--color-border-tertiary)" : "none" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Week {weekData.week}</span>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {headerDateTime}
          </span>
          {weekData.placeholder && <span style={{ ...S.badge("info"), fontSize: 10 }}>Not generated</span>}
          {isCurrentWeek && !weekData.placeholder && <span style={{ background: CSC.blue, color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>This week</span>}
          {isLocked && <span style={{ ...S.badge("warning"), fontSize: 10 }}>🔒 Locked</span>}
          {!isLocked && !weekData.placeholder && allScored && totalMatches > 0 && <span style={{ ...S.badge("success"), fontSize: 10 }}>Complete</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && onEditDateTime && (
            <button
              style={{ ...S.btnSm("secondary"), fontSize: 11 }}
              onClick={e => { e.stopPropagation(); onEditDateTime(weekData); }}
              title="Edit date and time">
              ✏ Edit
            </button>
          )}
          {isAdmin && onToggleLock && !weekData.placeholder && (
            <button
              style={{ ...S.btnSm(isLocked ? "primary" : "secondary", isLocked ? "#854F0B" : undefined), fontSize: 11 }}
              onClick={e => { e.stopPropagation(); onToggleLock(weekData.week); }}
              // Long label tells the new commissioner what locking actually
              // does (counts the week toward standings). Compressed on phones
              // so it fits next to Edit / Rebalance without wrapping.
              title={isLocked ? "Unlock this week — scores won't count toward standings" : "Lock this week and count its scores toward standings"}>
              {isLocked
                ? (isMobile ? "🔒 Unlock" : "Unlock Week")
                : (isMobile ? "🔒 Lock" : "Lock & Update Standings")}
            </button>
          )}
          {isAdmin && onRebalance && !weekData.placeholder && !isLocked && (
            <button
              style={{ ...S.btnSm("secondary"), fontSize: 11, color: "#534AB7", borderColor: "#534AB7" }}
              onClick={e => { e.stopPropagation(); onRebalance(weekData); }}
              title="Rebalance courts based on RSVP status">
              ⚖ Rebalance
            </button>
          )}
          {!weekData.placeholder && (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {isMobile ? `${scoredMatches}/${totalMatches} matches` : `${scoredMatches} of ${totalMatches} matches scored`}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "inline-block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
      </div>

      {expanded && (
        <div style={{ paddingBottom: 12 }}>
          {weekData.placeholder && (
            <div style={{ margin: "12px 16px 0", padding: "12px 16px", background: CSC.blueLight, border: `0.5px solid ${CSC.blue}40`, borderRadius: 8, fontSize: 13, color: CSC.blueDark }}>
              📅 This week's schedule has not been generated yet. Use the Generate button at the top of the schedule to create it.
            </div>
          )}
          {!weekData.placeholder && isLocked && !isAdmin && (
            <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "#FAEEDA", borderRadius: 6, fontSize: 12, color: "#854F0B" }}>
              This week has been locked by the commissioner. Scores can no longer be edited.
            </div>
          )}
          {/* Future-week notice: shown to players (not the commissioner) for
              weeks whose date hasn't arrived yet. Hidden when the week is
              already locked because the locked notice covers that case. */}
          {!weekData.placeholder && !isLocked && playerBlockedFuture && (
            <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: CSC.blueLight, borderRadius: 6, fontSize: 12, color: CSC.blueDark }}>
              📅 Scoring opens {formatDate(weekData.date)}. You can preview matchups now and enter scores when the week begins.
            </div>
          )}
          {/* Player's own check-in. Hidden on past weeks where RSVP is
              moot — the player is in the schedule to look up scores, not
              to commit to attending a week that's already happened. */}
          {myId && onSetCheckIn && !weekIsStrictlyPast && (
            <CheckInRow
              current={myCheckIn?.status}
              currentSubName={myCheckIn?.subName}
              isLocked={isLocked}
              onSet={(status, subName) => onSetCheckIn(weekData.week, status, subName)} />
          )}
          {/* Commissioner check-in summary */}
          {isAdmin && regs && getCheckInForPlayer && (
            <CheckInSummary regs={regs} getCheckInForPlayer={getCheckInForPlayer}
              getPlayerName={getPlayerName} getPlayerEmail={getPlayerEmail}
              leagueId={leagueId} leagueName={leagueName}
              week={weekData.week} weekDate={formatDate(weekData.date)} />
          )}
          {weekData.courts.map((court, ci) => {
            const courtColor = COURT_COLORS[ci] || CSC.blue;
            // For players: show only their own court; for commissioner: show all courts
            const onMyCourt = myId ? court.players.includes(myId) : true;
            if (myId && !onMyCourt) return null;
            // Three-tier name resolution: per-week override → league default
            // → generator's "Court N" fallback.
            const displayName = resolveCourtName(court, ci, league);
            // Effective time considers per-week, league config, then week
            // default. Show the time stripe only when it differs from the
            // week's default (so single-time weeks stay clean).
            const courtTime = resolveCourtTime(court, ci, league, weekData.time);
            const showCourtTime = courtTime && courtTime !== weekData.time;
            return (
              <div key={court.courtName} style={{ margin: "12px 16px 0" }}>
                {/* Court label */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: courtColor + "18", border: `0.5px solid ${courtColor}40` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: courtColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12, color: courtColor, letterSpacing: "0.5px" }}>{displayName.toUpperCase()}</span>
                  {showCourtTime && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: courtColor, opacity: 0.85 }}>
                      · {formatTime(courtTime)}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {court.players.map(id => getPlayerName(id)).join(" · ")}
                  </span>
                </div>
                {/* Match rows */}
                {court.matches.map(match => {
                  const score = getScore(leagueId, match.week, match.id);
                  const hasScore = !!score;
                  const sideAWon = hasScore && score.homeScore > score.awayScore;
                  const { sideA, sideB } = matchSides(match);
                  const myOnSideA = myId && sideA.includes(myId);
                  const myOnSideB = myId && sideB.includes(myId);
                  const myInMatch = myOnSideA || myOnSideB;
                  const mySat = myId && match.sitOut === myId;
                  const myWon = hasScore && ((myOnSideA && sideAWon) || (myOnSideB && !sideAWon));
                  // Player can edit any match on their own court (not just ones they're in)
                  // unless the week is locked. Commissioner can always edit.
                  // Players are also blocked from scoring weeks that haven't happened
                  // yet — the commissioner bypasses this restriction.
                  const playerCanEdit = onMyCourt && !isLocked && weekIsCurrentOrPast;
                  const canEdit = isAdmin || playerCanEdit;

                  // Render each side's player names on their own line so
                  // doubles teammates don't get squeezed/truncated on narrow
                  // viewports. Singles renders as a single name (just one
                  // entry in the array). When the current player is on the
                  // side, only their own name is bolded — partners stay
                  // regular weight so "you" stands out from your team.
                  const renderSide = (playerIds, isMySide, align) => (
                    <span style={{
                      flex: 1, minWidth: 0,
                      fontSize: 13,
                      display: "flex", flexDirection: "column",
                      alignItems: align === "right" ? "flex-end" : "flex-start",
                      lineHeight: 1.25,
                      color: isMySide ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    }}>
                      {playerIds.map(pid => {
                        const isMe = myId && pid === myId;
                        return (
                          <span key={pid} style={{
                            fontWeight: isMe ? 700 : 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                          }}>
                            {getPlayerName(pid)}
                          </span>
                        );
                      })}
                    </span>
                  );

                  return (
                    <div key={match.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, marginBottom: 4, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                      {renderSide(sideA, myOnSideA, "right")}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        {hasScore ? (
                          <>
                            <span style={{ fontSize: 17, fontWeight: 700, color: sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.homeScore}</span>
                            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
                            <span style={{ fontSize: 17, fontWeight: 700, color: !sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.awayScore}</span>
                          </>
                        ) : canEdit && onSubmitScore ? (
                          // Inline score entry — replaces the modal round-trip
                          // for the common case (just played, type two numbers).
                          // Editing existing scores still goes through the modal.
                          <InlineScoreEntry match={match} onSubmit={onSubmitScore} accentColor={courtColor} />
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "0 6px" }}>vs</span>
                        )}
                      </div>
                      {renderSide(sideB, myOnSideB, "left")}
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                        {mySat && <span style={{ ...S.badge("info"), fontSize: 10 }}>You sit</span>}
                        {myInMatch && hasScore && <span style={S.badge(myWon ? "success" : "danger")}>{myWon ? "W" : "L"}</span>}
                        {isLocked && hasScore && isAdmin && <span style={{ ...S.badge("warning"), fontSize: 10 }}>🔒</span>}
                        {canEdit && hasScore && (
                          <button style={{ ...S.btnSm("secondary"), fontSize: 11 }}
                            onClick={() => onEnterScore(match)}>
                            Edit
                          </button>
                        )}
                        {!canEdit && !hasScore && (
                          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
