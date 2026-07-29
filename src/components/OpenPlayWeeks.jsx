import { useState } from "react";
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";
import { formatDate, isPastWeek, isCurrentOrPastWeek, todayISO } from "../lib/format.js";
import { CheckInRow } from "./CheckInRow.jsx";
import { CheckInSummary } from "./CheckInSummary.jsx";

// ─── Open-play week card ─────────────────────────────────────────────────────
// Open play has no courts, matches, scores, or standings — just a weekly RSVP.
// This is the per-week card. It deliberately reuses the exact same RSVP
// components as the court-based schedule:
//   - Players get CheckInRow (their own In/Maybe/Sub/Out control)
//   - The commissioner gets CheckInSummary (counts, reminders, per-player editor)
// so the RSVP experience is identical whether or not there are courts.
//
// `isCurrentWeek` gets a "THIS WEEK" pill; past weeks are de-emphasized.
function OpenPlayWeekCard({
  weekData, leagueId, leagueName, isCurrentWeek,
  // player mode
  myId, myCheckIn, onSetCheckIn,
  // commissioner mode
  isAdmin, regs, getPlayerName, getPlayerEmail, getCheckInForPlayer, onSetPlayerCheckIn,
}) {
  // Default the current (and future) weeks open; collapse past weeks to keep
  // a long season scannable. The commissioner most often wants the upcoming
  // week, and players only act on the current one.
  const [expanded, setExpanded] = useState(isCurrentWeek || !isPastWeek(weekData.date));

  const past = isPastWeek(weekData.date);

  // Count RSVPs for the collapsed-header summary (commissioner only — players
  // only see their own status). Cheap: one pass over the league's regs.
  const counts = { in: 0, maybe: 0, sub: 0, out: 0, none: 0 };
  if (isAdmin && regs) {
    regs.forEach(r => {
      const s = getCheckInForPlayer(r.playerId)?.status || "none";
      counts[s] = (counts[s] || 0) + 1;
    });
  }

  const headerBg = isCurrentWeek ? CSC.blueLight : "var(--color-background-secondary)";

  return (
    <div style={{ ...S.card, marginBottom: 12, padding: 0, overflow: "hidden", opacity: past && !isCurrentWeek ? 0.85 : 1 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: headerBg, borderBottom: expanded ? "0.5px solid var(--color-border-tertiary)" : "none" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Week {weekData.week}</span>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{formatDate(weekData.date)}</span>
          {isCurrentWeek && <span style={{ background: CSC.blue, color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>This week</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Commissioner sees a compact in-count on the collapsed header so
              they can eyeball attendance without expanding every week. */}
          {isAdmin && regs && (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {counts.in + counts.maybe} in{counts.none > 0 ? ` · ${counts.none} no reply` : ""}
            </span>
          )}
          {/* Player sees their own status at a glance. */}
          {myId && (
            <span style={{ fontSize: 12, color: myCheckIn?.status ? "var(--color-text-primary)" : "var(--color-text-tertiary)", fontWeight: myCheckIn?.status ? 600 : 400 }}>
              {myCheckIn?.status
                ? { in: "✓ In", maybe: "? Maybe", sub: "↔ Sub", out: "✗ Out" }[myCheckIn.status]
                : "Tap to RSVP"}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "inline-block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
      </div>

      {expanded && (
        <div style={{ paddingBottom: 12 }}>
          {/* Player's own RSVP. Hidden on strictly-past weeks where it's moot. */}
          {myId && onSetCheckIn && !past && (
            <CheckInRow
              current={myCheckIn?.status}
              currentSubName={myCheckIn?.subName}
              setByAdmin={myCheckIn?.setByAdmin}
              isLocked={false}
              onSet={(status, subName) => onSetCheckIn(weekData.week, status, subName)} />
          )}
          {myId && past && (
            <p style={{ margin: "12px 16px 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
              This week has passed.
            </p>
          )}
          {/* Commissioner summary + per-player editor. */}
          {isAdmin && regs && getCheckInForPlayer && (
            <CheckInSummary
              regs={regs}
              getCheckInForPlayer={getCheckInForPlayer}
              getPlayerName={getPlayerName}
              getPlayerEmail={getPlayerEmail}
              leagueId={leagueId}
              leagueName={leagueName}
              week={weekData.week}
              weekDate={formatDate(weekData.date)}
              isLocked={false}
              onSetPlayerCheckIn={
                onSetPlayerCheckIn
                  ? (playerId, status, subName) => onSetPlayerCheckIn(weekData.week, playerId, status, subName)
                  : undefined
              } />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Open-play weeks list ────────────────────────────────────────────────────
// Renders the full set of derived weeks for an open-play league. Used by both
// the player view (myId set) and the commissioner league detail (isAdmin set).
//
// `weeks` is the array from openPlayWeeks(league) — [{ week, date }, ...].
export function OpenPlayWeeks({
  weeks, leagueId, leagueName,
  myId, getCheckIn, onSetCheckIn,
  isAdmin, regs, getPlayerName, getPlayerEmail, onSetPlayerCheckIn,
}) {
  const today = todayISO();
  // The "current" week is the first one that's today or later; if all weeks
  // are in the past, the season's over and nothing is current.
  const currentWeek = weeks.find(w => w.date >= today) || null;

  if (weeks.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-text-secondary)", fontSize: 14 }}>
        No weeks yet — set a start date and number of weeks on the league to generate the RSVP calendar.
      </div>
    );
  }

  return (
    <div>
      {weeks.map(w => (
        <OpenPlayWeekCard
          key={w.week}
          weekData={w}
          leagueId={leagueId}
          leagueName={leagueName}
          isCurrentWeek={currentWeek?.week === w.week}
          myId={myId}
          myCheckIn={myId ? getCheckIn(leagueId, w.week, myId) : null}
          onSetCheckIn={onSetCheckIn}
          isAdmin={isAdmin}
          regs={regs}
          getPlayerName={getPlayerName}
          getPlayerEmail={getPlayerEmail}
          getCheckInForPlayer={isAdmin && getCheckIn ? (pid) => getCheckIn(leagueId, w.week, pid) : undefined}
          onSetPlayerCheckIn={onSetPlayerCheckIn}
        />
      ))}
    </div>
  );
}
