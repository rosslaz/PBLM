import { S, accentTint } from "../styles.js";
import { formatDateTime, todayISO } from "../lib/format.js";
import { useIsMobile } from "../lib/session.js";
import { playoffState, playoffGroups, PLAYOFF_SEEDS, PLAYOFF_GAME_TO } from "../lib/playoffs.js";
import { CourtWeekCard } from "./CourtWeekCard.jsx";

// v1.17.0 — the Playoffs tab, shared by the commissioner (isAdmin) and player
// views. Top to bottom:
//
//   1. Champion banner, once the title group's three games are in
//   2. Commissioner status bar: what the night is waiting on, and the action
//      that moves it forward (set up playoffs), plus date / remove controls
//   3. The two group tables. Before setup they're a projection from the live
//      standings, labelled as such, with the games each group would play.
//   4. The playoff night as an ordinary week card, where scores go in.
//
// The arithmetic is in lib/playoffs.js; this file only draws it.

// Same visual vocabulary as LeagueDetail's schedule state widget: hardcoded
// pale fills with hardcoded dark text, so both halves of each pair are fixed
// and stay legible in either theme.
const TONE = {
  ready:   { bg: "#E6F1FB", border: "#185FA5", text: "#0E3A6B" },
  info:    { bg: "var(--color-background-secondary)", border: "var(--color-border-tertiary)", text: "var(--color-text-primary)" },
  done:    { bg: "#EAF3DE", border: "#A5D070", text: "#3B6D11" },
};

// The neutral seed / place chip: themed fill and themed text, so it adapts as
// a pair.
const chip = {
  flexShrink: 0, minWidth: 26, textAlign: "center",
  background: "var(--color-background-secondary)", color: "var(--color-text-secondary)",
  border: "0.5px solid var(--color-border-tertiary)",
  borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700,
};
const youChip = {
  background: "var(--color-text-primary)", color: "var(--color-background-primary)",
  borderRadius: 999, padding: "1px 6px", fontSize: 9, fontWeight: 700, letterSpacing: "0.4px", flexShrink: 0,
};
const ordinal = n => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const signed = n => (n > 0 ? `+${n}` : `${n}`);

// One group: a projection (rows by seed, plus the games it would play) or the
// live table (rows by place, with W-L and point differential).
function GroupCard({ label, seeds, rows, games, live, complete, myId, getPlayerName }) {
  const name = id => getPlayerName(id);
  const notes = live
    ? rows.map((r, i) => (r.tiebreak && rows[i + 1]
        ? `${name(r.id)} is ahead of ${name(rows[i + 1].id)} on ${r.tiebreak === "diff" ? "point differential" : "seed"}.`
        : null)).filter(Boolean)
    : [];
  return (
    <div style={{ minWidth: 0, background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.4px", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
          {label}{complete ? " ✓" : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>seeds {seeds[0]}–{seeds[seeds.length - 1]}</span>
      </div>
      {live && (
        <div aria-hidden="true" style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", padding: "2px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <span style={{ flex: 1 }} />
          <span style={{ width: 34, textAlign: "right" }}>W–L</span>
          <span style={{ width: 34, textAlign: "right" }}>+/−</span>
        </div>
      )}
      {rows.map((r, i) => {
        const mine = !!myId && r.id === myId;
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: i > 0 ? "0.5px solid var(--color-border-tertiary)" : undefined }}>
            <span style={chip} aria-label={live ? `${ordinal(r.place)} place` : `Seed ${r.seed}`}>
              {live ? ordinal(r.place) : `#${r.seed}`}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: mine ? 700 : 400, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name(r.id)}
              {live && <span style={{ fontWeight: 400, fontSize: 11, color: "var(--color-text-secondary)" }}> · #{r.seed}</span>}
            </span>
            {mine && <span style={youChip}>YOU</span>}
            {live && (
              <>
                <span style={{ width: 34, textAlign: "right", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.wins}–{r.losses}</span>
                <span style={{ width: 34, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>{r.played ? signed(r.diff) : "–"}</span>
              </>
            )}
          </div>
        );
      })}
      {games && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          {games.map((g, i) => (
            <p key={i} style={{ margin: "2px 0", fontSize: 12, color: "var(--color-text-primary)" }}>
              <span style={{ fontWeight: 700, color: "var(--color-text-secondary)" }}>G{i + 1}</span>{" "}
              {g.team1.map(name).join(" & ")} <span style={{ color: "var(--color-text-secondary)" }}>vs</span> {g.team2.map(name).join(" & ")}
            </p>
          ))}
        </div>
      )}
      {notes.map(n => (
        <p key={n} style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>{n}</p>
      ))}
    </div>
  );
}

export function PlayoffsPanel({
  league, playoffs, standings, seasonComplete, lockedRegularWeeks,
  getScore, getPlayerName, getPlayerEmail, isWeekLocked, color,
  isAdmin, myId, regs, getCheckIn, onSetCheckIn, onSetPlayerCheckIn,
  onEnterScore, onSubmitScore, onToggleRoundLock,
  onSetup, onCancel, onEditDates,
  archived = false,
}) {
  const isMobile = useIsMobile();
  const name = id => getPlayerName(id);
  const state = playoffs ? playoffState(playoffs, getScore, league.id) : null;
  const round = state?.round || null;
  const locked = !!round && isWeekLocked(round.week);
  const totalWeeks = league.weeks || 14;

  // Before setup the groups are a projection from today's standings.
  const projectedSeeds = (standings || []).slice(0, PLAYOFF_SEEDS).map(r => r.id);
  const projected = !playoffs && projectedSeeds.length === PLAYOFF_SEEDS ? playoffGroups(projectedSeeds) : null;

  // ─── Commissioner status ───────────────────────────────────────────────
  const status = (() => {
    if (!playoffs) {
      if (!seasonComplete) {
        return {
          tone: "info",
          title: `Playoff night after week ${totalWeeks}.`,
          hint: `Seeds come from the final standings, so setup opens once all ${totalWeeks} weeks are locked (${lockedRegularWeeks} of ${totalWeeks} so far).`,
        };
      }
      return {
        tone: "ready",
        title: "Regular season complete.",
        hint: "Set up the playoff night. Seeds come from the final standings.",
        action: { label: "Set up playoffs", onClick: onSetup },
      };
    }
    if (state.legacy) {
      return { tone: "info", title: "These playoffs use the old bracket format.", hint: "Remove them, then set up the playoff night again." };
    }
    const when = formatDateTime(round.date, round.time);
    if (state.stage === "scheduled") {
      return { tone: "info", title: `Playoff night · ${when}`, hint: `${state.totalGames} games to ${PLAYOFF_GAME_TO}, three in each group. Scores go in on the night.` };
    }
    if (state.stage === "inProgress") {
      return { tone: "info", title: `Playoff night · ${when}`, hint: `${state.scoredGames} of ${state.totalGames} games scored. Lock the night once every score is in.` };
    }
    return locked
      ? { tone: "done", title: "Playoffs complete and locked." }
      : { tone: "done", title: "Playoffs complete.", hint: "Lock the night to make the results final." };
  })();
  const tone = TONE[status.tone];

  const titleGroup = state?.groups?.find(g => g.key === "title");

  return (
    <div>
      {/* 1. Champion */}
      {state?.champion && titleGroup && (
        <div style={{ ...S.card, borderLeft: `4px solid ${color.bg}`, background: accentTint(color.bg), marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1 }}>🏆</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
                {league.name} champion
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>{name(state.champion)}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                {titleGroup.rows.slice(1).map(r => `${ordinal(r.place)} ${name(r.id)}`).join(" · ")}
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
              <button style={{ ...S.btn("primary"), background: color.bg }} onClick={status.action.onClick}>
                {status.action.label}
              </button>
            )}
          </div>
          {playoffs && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {!state.legacy && !locked && state.stage !== "complete" && (
                <button style={{ ...S.btnSm("secondary"), fontSize: 11, color: tone.text, borderColor: tone.border }} onClick={onEditDates}>
                  ✏ Edit date
                </button>
              )}
              {!state.hasScores && (
                <button
                  style={{ ...S.btnSm("secondary"), fontSize: 11, color: "var(--color-text-danger)", borderColor: "var(--color-text-danger)", background: "var(--color-background-primary)" }}
                  onClick={() => {
                    if (confirm("Remove the playoffs?\n\nNo playoff games have been scored, so nothing is lost. You can set them up again from the final standings.")) onCancel();
                  }}>
                  Remove playoffs
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Format explainer for everyone until the playoffs exist */}
      {!playoffs && (
        <div style={{ padding: "12px 14px", marginBottom: 16, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
          <b>One playoff night after week {totalWeeks}.</b> Seeds 1–4 play for the title and seeds 5–8 for 5th–8th.
          Each group plays all three partner combos (1 &amp; 2 vs 3 &amp; 4, 1 &amp; 3 vs 2 &amp; 4, 1 &amp; 4 vs 2 &amp; 3), one game each, to {PLAYOFF_GAME_TO}, win by 2.
          Every game you win counts for you. Most wins tops the group; ties go to point differential, then seed.
          Playoff games don't count toward the standings.
        </div>
      )}

      {/* 3. Groups */}
      {(projected || (state && !state.legacy)) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {playoffs ? "Groups" : seasonComplete ? "Groups preview" : "If the season ended today"}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {playoffs
                ? "Most wins, then point differential, then seed"
                : seasonComplete ? "From the final standings · set when the commissioner creates the playoffs" : "Projected from the current standings"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 0 : 16 }}>
            {playoffs
              ? state.groups.map(g => (
                  // Until a group has a score, places and tiebreak notes would
                  // only restate the seeds, so it lists the seeds instead.
                  <GroupCard key={g.key} label={g.label} seeds={g.seeds}
                    rows={g.rows} live={g.scored > 0} complete={g.complete}
                    myId={myId} getPlayerName={getPlayerName} />
                ))
              : projected.map(g => (
                  <GroupCard key={g.key} label={g.label} seeds={g.seeds}
                    rows={g.players.map((id, i) => ({ id, seed: g.seeds[i] }))} games={g.games}
                    myId={myId} getPlayerName={getPlayerName} />
                ))}
          </div>
        </div>
      )}
      {!playoffs && !projected && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          The projected groups appear once the standings have {PLAYOFF_SEEDS} players.
        </p>
      )}

      {/* 4. The night */}
      {round && (
        <CourtWeekCard
          weekData={{ week: round.week, date: round.date, time: round.time, courts: round.courts }}
          title="Playoff night"
          league={league}
          leagueId={league.id}
          leagueName={league.name}
          getScore={getScore}
          getPlayerName={getPlayerName}
          getPlayerEmail={getPlayerEmail}
          onEnterScore={onEnterScore}
          onSubmitScore={archived ? undefined : onSubmitScore}
          onToggleLock={isAdmin && !archived ? () => onToggleRoundLock(round) : undefined}
          lockLabels={{
            lock: "Lock playoffs", unlock: "Unlock playoffs",
            lockTitle: "Lock the playoff night so its scores can't be changed",
            unlockTitle: "Unlock the playoff night so scores can be edited",
          }}
          scoresFrozen={archived}
          isLocked={locked || archived}
          isAdmin={isAdmin}
          isCurrentWeek={!isAdmin && !!round.date && round.date >= todayISO()}
          defaultExpanded
          myId={isAdmin ? undefined : myId}
          myCheckIn={!isAdmin && myId ? getCheckIn(league.id, round.week, myId) : undefined}
          onSetCheckIn={!isAdmin && onSetCheckIn && !archived ? onSetCheckIn : undefined}
          regs={isAdmin ? regs : undefined}
          getCheckInForPlayer={isAdmin ? (pid => getCheckIn(league.id, round.week, pid)) : undefined}
          onSetPlayerCheckIn={isAdmin ? onSetPlayerCheckIn : undefined}
        />
      )}
    </div>
  );
}
