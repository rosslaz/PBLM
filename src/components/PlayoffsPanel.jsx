import { S, accentTint } from "../styles.js";
import { formatDate, formatDateTime, todayISO } from "../lib/format.js";
import { useIsMobile } from "../lib/session.js";
import {
  playoffState, semifinalPairings, seriesSummary,
  PLAYOFF_BEST_OF, PLAYOFF_WINS_NEEDED, PLAYOFF_SEEDS,
} from "../lib/playoffs.js";
import { CourtWeekCard } from "./CourtWeekCard.jsx";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

// v1.16.0 — the Playoffs tab, shared by the commissioner (isAdmin) and player
// views. Four parts, top to bottom:
//
//   1. Champions banner, once the final has a winner
//   2. Commissioner status bar: what the bracket is waiting on, and the one
//      action that moves it forward (set up playoffs / set up finals)
//   3. The bracket. Before setup it's a projection from the live standings,
//      labelled as such; after setup it's the real thing.
//   4. The rounds as ordinary week cards in series mode, where scores go in.
//
// All the series arithmetic is in lib/playoffs.js; this file only draws it.

// Same visual vocabulary as LeagueDetail's schedule state widget: hardcoded
// pale fills with hardcoded dark text, so both halves of each pair are fixed
// and stay legible in either theme.
const TONE = {
  ready:   { bg: "#E6F1FB", border: "#185FA5", text: "#0E3A6B" },
  info:    { bg: "var(--color-background-secondary)", border: "var(--color-border-tertiary)", text: "var(--color-text-primary)" },
  done:    { bg: "#EAF3DE", border: "#A5D070", text: "#3B6D11" },
};

// The neutral seed chip: themed fill and themed text, so it adapts as a pair.
const seedChip = {
  flexShrink: 0, minWidth: 30, textAlign: "center",
  background: "var(--color-background-secondary)", color: "var(--color-text-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700,
};
const youChip = {
  background: "var(--color-text-primary)", color: "var(--color-background-primary)",
  borderRadius: 999, padding: "1px 6px", fontSize: 9, fontWeight: 700, letterSpacing: "0.4px", flexShrink: 0,
};

function TeamRow({ team, seeds, wins, showWins, isWinner, isLoser, myId, getPlayerName, placeholder }) {
  const mine = !!myId && (team || []).includes(myId);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
      <span style={seedChip} aria-label={seeds ? `Seeds ${seeds.join(" and ")}` : undefined}>
        {seeds ? seeds.join("·") : "–"}
      </span>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontWeight: isWinner || mine ? 700 : 400,
        color: placeholder || isLoser ? "var(--color-text-secondary)" : "var(--color-text-primary)",
        fontStyle: placeholder ? "italic" : "normal",
      }}>
        {placeholder || team.map(getPlayerName).join(" & ")}
      </span>
      {mine && <span style={youChip}>YOU</span>}
      {isWinner && <span aria-label="Won the series" style={{ color: "var(--color-text-success)", fontWeight: 700, fontSize: 13 }}>✓</span>}
      {showWins && (
        <span style={{ minWidth: 14, textAlign: "right", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isLoser ? "var(--color-text-secondary)" : "var(--color-text-primary)" }}>
          {wins}
        </span>
      )}
    </div>
  );
}

// One matchup in the bracket.
function SeriesBox({ label, state, pairing, placeholders, myId, getPlayerName, teamName }) {
  const started = !!state && state.played > 0;
  const rows = state
    ? [
        { team: state.teamA, seeds: state.seedsA, wins: state.winsA, win: state.winner === "A", lose: state.winner === "B" },
        { team: state.teamB, seeds: state.seedsB, wins: state.winsB, win: state.winner === "B", lose: state.winner === "A" },
      ]
    : pairing
      ? [{ team: pairing.teamA, seeds: pairing.seedsA }, { team: pairing.teamB, seeds: pairing.seedsB }]
      : placeholders.map(p => ({ placeholder: p }));
  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 2 }}>
        {label}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={i === 1 ? { borderTop: "0.5px solid var(--color-border-tertiary)" } : undefined}>
          <TeamRow team={r.team} seeds={r.seeds} wins={r.wins} showWins={started}
            isWinner={r.win} isLoser={r.lose} placeholder={r.placeholder}
            myId={myId} getPlayerName={getPlayerName} />
        </div>
      ))}
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
        {state ? seriesSummary(state, teamName) : `Best of ${PLAYOFF_BEST_OF}`}
      </div>
    </div>
  );
}

export function PlayoffsPanel({
  league, playoffs, standings, seasonComplete, lockedRegularWeeks,
  getScore, getPlayerName, getPlayerEmail, isWeekLocked, color,
  isAdmin, myId, regs, getCheckIn, onSetCheckIn, onSetPlayerCheckIn,
  onEnterScore, onSubmitScore, onToggleRoundLock,
  onSetup, onSetupFinals, onUndoFinals, onCancel, onEditDates,
  archived = false,
}) {
  const isMobile = useIsMobile();
  const finalsPending = useIsActionPending("setup-finals");
  const teamName = ids => (ids || []).map(getPlayerName).join(" & ");
  const state = playoffs ? playoffState(playoffs, getScore, league.id) : null;
  const [semisRound, finalsRound] = state?.rounds || [];
  const totalWeeks = league.weeks || 14;

  // Before setup the bracket is a projection from today's standings.
  const projectedSeeds = (standings || []).slice(0, PLAYOFF_SEEDS).map(r => r.id);
  const canProject = !playoffs && projectedSeeds.length === PLAYOFF_SEEDS;
  const projected = canProject ? semifinalPairings(projectedSeeds) : null;

  // ─── Commissioner status ───────────────────────────────────────────────
  const status = (() => {
    if (!playoffs) {
      if (!seasonComplete) {
        return {
          tone: "info",
          title: `Playoffs start after week ${totalWeeks}.`,
          hint: `Seeds come from the final standings, so setup opens once all ${totalWeeks} weeks are locked (${lockedRegularWeeks} of ${totalWeeks} so far).`,
        };
      }
      return {
        tone: "ready",
        title: "Regular season complete.",
        hint: "Set up the bracket. Seeds come from the final standings.",
        action: { label: "Set up playoffs", onClick: onSetup },
      };
    }
    if (state.stage === "semis") {
      return { tone: "info", title: `Semifinals · ${formatDateTime(semisRound.date, semisRound.time)}`, hint: "Once both series have a winner, set up the finals here." };
    }
    if (state.stage === "awaitingFinals") {
      return {
        tone: "ready",
        title: "Both semifinals are decided.",
        hint: "Set up the finals: winners play for the title, losers for 3rd. This locks the semifinal scores.",
        action: { label: "Set up finals", onClick: onSetupFinals, pending: finalsPending },
      };
    }
    if (state.stage === "finals") {
      return { tone: "info", title: `Finals · ${formatDateTime(finalsRound.date, finalsRound.time)}`, hint: `Championship and 3rd place, best of ${PLAYOFF_BEST_OF}.` };
    }
    // The champions banner above already names the winners.
    return { tone: "done", title: "Playoffs complete.", hint: "Lock the finals to freeze the results." };
  })();
  const tone = TONE[status.tone];

  const finalsSetUp = !!finalsRound?.setUp;
  // The round people are most likely to act on opens by default: the latest
  // one that's been set up.
  const liveRounds = (state?.rounds || []).filter(r => r.setUp);
  const openRound = liveRounds[liveRounds.length - 1]?.week;

  return (
    <div>
      {/* 1. Champions */}
      {state?.stage === "complete" && (
        <div style={{ ...S.card, borderLeft: `4px solid ${color.bg}`, background: accentTint(color.bg), marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1 }}>🏆</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
                {league.name} champions
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>{teamName(state.champions)}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                Runners-up {teamName(state.runnersUp)} · 3rd place {teamName(state.third)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Commissioner status */}
      {isAdmin && (
        <div style={{ padding: "14px 16px", marginBottom: 16, background: tone.bg, border: `0.5px solid ${tone.border}`, borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: tone.text }}>{status.title}</p>
              {status.hint && <p style={{ margin: "4px 0 0", fontSize: 12, color: tone.text }}>{status.hint}</p>}
            </div>
            {status.action && (
              <button style={{ ...S.btn("primary"), background: color.bg }} onClick={status.action.onClick} disabled={status.action.pending}>
                {status.action.pending ? <><Spinner /> Saving…</> : status.action.label}
              </button>
            )}
          </div>
          {playoffs && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {state.stage !== "complete" && (
                <button style={{ ...S.btnSm("secondary"), fontSize: 11, color: tone.text, borderColor: tone.border }} onClick={onEditDates}>
                  ✏ Edit dates
                </button>
              )}
              {finalsSetUp && !state.finalsHaveScores && (
                <button
                  style={{ ...S.btnSm("secondary"), fontSize: 11, color: tone.text, borderColor: tone.border }}
                  onClick={() => {
                    if (confirm("Undo the finals?\n\nThe championship and 3rd-place matchups are cleared and the semifinal scores can be edited again. Nothing has been scored in the finals yet, so nothing is lost.")) onUndoFinals();
                  }}>
                  ↩ Undo finals
                </button>
              )}
              {!state.hasScores && (
                <button
                  style={{ ...S.btnSm("secondary"), fontSize: 11, color: "var(--color-text-danger)", borderColor: "var(--color-text-danger)", background: "var(--color-background-primary)" }}
                  onClick={() => {
                    if (confirm("Remove the playoff bracket?\n\nNo playoff games have been scored, so nothing is lost. You can set it up again from the final standings.")) onCancel();
                  }}>
                  Remove playoffs
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Format explainer for everyone until the bracket exists */}
      {!playoffs && (
        <div style={{ padding: "12px 14px", marginBottom: 16, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
          <b>Two weeks of playoffs after week {totalWeeks}.</b> The top seeds team up: 1 &amp; 2 play 7 &amp; 8, and 3 &amp; 4 play 5 &amp; 6.
          Every matchup is best of {PLAYOFF_BEST_OF} (first to {PLAYOFF_WINS_NEEDED} wins). The next week, the winners play for the title and the losers play for 3rd.
          Playoff games don't count toward the standings.
        </div>
      )}

      {/* 3. Bracket */}
      {(playoffs || projected) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {playoffs ? "Bracket" : seasonComplete ? "Bracket preview" : "If the season ended today"}
            </span>
            {!playoffs && (
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {seasonComplete ? "From the final standings · not set until the commissioner creates it" : "Projected from the current standings"}
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 4 : 16 }}>
            <div>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                Week 1 · Semifinals{semisRound?.date ? ` · ${formatDate(semisRound.date)}` : ""}
              </p>
              {(semisRound?.series || projected || []).map((x, i) => (
                <SeriesBox key={i}
                  label={x.label}
                  state={semisRound ? x : null}
                  pairing={semisRound ? null : x}
                  myId={myId} getPlayerName={getPlayerName} teamName={teamName} />
              ))}
            </div>
            <div>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                Week 2 · Finals{finalsRound?.date ? ` · ${formatDate(finalsRound.date)}` : ""}
              </p>
              {finalsSetUp
                ? finalsRound.series.map((s, i) => (
                    <SeriesBox key={i} label={s.label} state={s} myId={myId} getPlayerName={getPlayerName} teamName={teamName} />
                  ))
                : (
                  <>
                    <SeriesBox label="Championship" placeholders={["Winner of semifinal 1", "Winner of semifinal 2"]} myId={myId} getPlayerName={getPlayerName} teamName={teamName} />
                    <SeriesBox label="3rd place" placeholders={["Loser of semifinal 1", "Loser of semifinal 2"]} myId={myId} getPlayerName={getPlayerName} teamName={teamName} />
                  </>
                )}
            </div>
          </div>
        </div>
      )}
      {!playoffs && !projected && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          The projected bracket appears once the standings have {PLAYOFF_SEEDS} players.
        </p>
      )}

      {/* 4. Rounds, latest first */}
      {[...liveRounds].reverse().map(r => {
        const frozen = r.round === 1 && finalsSetUp;
        const isAdminLockable = isAdmin && !frozen && !archived;
        return (
          <CourtWeekCard
            key={r.week}
            weekData={{ week: r.week, date: r.date, time: r.time, courts: r.courts }}
            title={r.round === 1 ? "Semifinals" : "Finals"}
            league={league}
            leagueId={league.id}
            leagueName={league.name}
            getScore={getScore}
            getPlayerName={getPlayerName}
            getPlayerEmail={getPlayerEmail}
            onEnterScore={onEnterScore}
            onSubmitScore={archived ? undefined : onSubmitScore}
            onToggleLock={isAdminLockable ? () => onToggleRoundLock(r) : undefined}
            lockLabels={{
              lock: "Lock round", unlock: "Unlock round",
              lockTitle: "Lock this round so its scores can't be changed",
              unlockTitle: "Unlock this round so scores can be edited",
            }}
            scoresFrozen={frozen || archived}
            frozenNote={frozen
              ? (isAdmin
                  ? "These results are final: the finals were drawn from them. To change one, undo the finals first (only possible before any finals game is scored)."
                  : "These results are final: the finals were drawn from them.")
              : null}
            isLocked={isWeekLocked(r.week) || archived}
            isAdmin={isAdmin}
            isCurrentWeek={!isAdmin && r.week === openRound && !!r.date && r.date >= todayISO()}
            defaultExpanded={r.week === openRound}
            myId={isAdmin ? undefined : myId}
            myCheckIn={!isAdmin && myId ? getCheckIn(league.id, r.week, myId) : undefined}
            onSetCheckIn={!isAdmin && onSetCheckIn && !archived ? onSetCheckIn : undefined}
            regs={isAdmin ? regs : undefined}
            getCheckInForPlayer={isAdmin ? (pid => getCheckIn(league.id, r.week, pid)) : undefined}
            onSetPlayerCheckIn={isAdmin ? onSetPlayerCheckIn : undefined}
          />
        );
      })}
    </div>
  );
}
