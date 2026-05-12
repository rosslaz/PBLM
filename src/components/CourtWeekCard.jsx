import { useState } from "react";
import { S } from "../styles.js";
import { CSC, COURT_COLORS } from "../lib/constants.js";
import { formatDate, formatDateTime } from "../lib/format.js";
import { CheckInRow } from "./CheckInRow.jsx";
import { CheckInSummary } from "./CheckInSummary.jsx";
import { matchSides } from "./ScoreForm.jsx";

// myId: the current player's id (undefined for commissioner full view)
// myCourtPlayers: set of player IDs on the same court as myId this week (for edit gating)
// isLocked: commissioner has locked this week — players cannot edit, commissioner still can
// isAdmin: full commissioner access
export function CourtWeekCard({ weekData, leagueId, leagueName, getScore, getPlayerName, getPlayerEmail, onEnterScore, onToggleLock, onEditDateTime, onRebalance, myId, myCourtPlayers, isLocked, isAdmin, myCheckIn, onSetCheckIn, regs, getCheckInForPlayer }) {
  const [expanded, setExpanded] = useState(false);
  const totalMatches = weekData.courts.reduce((s, c) => s + c.matches.length, 0);
  const scoredMatches = weekData.courts.reduce((s, c) => s + c.matches.filter(m => getScore(leagueId, m.week, m.id)).length, 0);
  const allScored = scoredMatches === totalMatches && totalMatches > 0;

  const headerBg = isLocked ? "#F1EFE8" : allScored ? "#EAF3DE" : "var(--color-background-secondary)";

  return (
    <div style={{ ...S.card, marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: headerBg, borderBottom: expanded ? "0.5px solid var(--color-border-tertiary)" : "none" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Week {weekData.week}</span>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {formatDateTime(weekData.date, weekData.time)}
          </span>
          {weekData.placeholder && <span style={{ ...S.badge("info"), fontSize: 10 }}>Not generated</span>}
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
              onClick={e => { e.stopPropagation(); onToggleLock(weekData.week); }}>
              {isLocked ? "Unlock" : "Lock Week"}
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
          {!weekData.placeholder && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{scoredMatches}/{totalMatches} scored</span>}
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
          {/* Player's own check-in */}
          {myId && onSetCheckIn && (
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
            return (
              <div key={court.courtName} style={{ margin: "12px 16px 0" }}>
                {/* Court label */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: courtColor + "18", border: `0.5px solid ${courtColor}40` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: courtColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12, color: courtColor, letterSpacing: "0.5px" }}>{court.courtName.toUpperCase()}</span>
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
                  const playerCanEdit = onMyCourt && !isLocked;
                  const canEdit = isAdmin || playerCanEdit;

                  const labelA = sideA.map(getPlayerName).join(" + ");
                  const labelB = sideB.map(getPlayerName).join(" + ");

                  return (
                    <div key={match.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, marginBottom: 4, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: myOnSideA ? 700 : 400, textAlign: "right", color: myOnSideA ? "var(--color-text-primary)" : "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {labelA}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        {hasScore ? (
                          <>
                            <span style={{ fontSize: 17, fontWeight: 700, color: sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.homeScore}</span>
                            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
                            <span style={{ fontSize: 17, fontWeight: 700, color: !sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.awayScore}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "0 6px" }}>vs</span>
                        )}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: myOnSideB ? 700 : 400, color: myOnSideB ? "var(--color-text-primary)" : "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {labelB}
                      </span>
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                        {mySat && <span style={{ ...S.badge("info"), fontSize: 10 }}>You sit</span>}
                        {myInMatch && hasScore && <span style={S.badge(myWon ? "success" : "danger")}>{myWon ? "W" : "L"}</span>}
                        {isLocked && hasScore && isAdmin && <span style={{ ...S.badge("warning"), fontSize: 10 }}>🔒</span>}
                        {canEdit ? (
                          <button style={{ ...S.btnSm(hasScore ? "secondary" : "primary", hasScore ? undefined : courtColor), fontSize: 11 }}
                            onClick={() => onEnterScore(match)}>
                            {hasScore ? "Edit" : "Score"}
                          </button>
                        ) : (
                          !hasScore && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
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
