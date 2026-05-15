import { useState } from "react";
import { S, genderBadgeStyle } from "../styles.js";
import { COLORS, COURT_COLORS, MAX_PER_COURT, MIN_PER_COURT, courtNames } from "../lib/constants.js";
import { formatDate, formatPlayerName, playerFullName, playerInitial } from "../lib/format.js";
import { useIsMobile, buildDisplayWeeks } from "../lib/session.js";
import { distributePlayersToCourts } from "../lib/scheduling.js";
import { CourtWeekCard } from "./CourtWeekCard.jsx";
import { StandingsTable } from "./StandingsTable.jsx";
import { EmptyState } from "./ui.jsx";

export function LeagueDetail({ league, db, regs, schedule, getScore, getPlayerName, getStandings, onEdit, onDelete, onToggleArchive, onGenerate, onAddPlayer, onRemovePlayer, onTogglePaid, onToggleLockWeek, isWeekLocked, onEnterScore, onSubmitScore, onEditWeekDateTime, onRebalanceWeek, getCheckIn }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("schedule");
  const c = COLORS[league.color] || COLORS.csc;
  const weeks = buildDisplayWeeks(league, schedule);
  const realWeeks = weeks.filter(w => !w.placeholder);
  const realWeeksCount = realWeeks.length;
  const lastRealWeek = realWeeks[realWeeks.length - 1] || null;
  const totalMatches = weeks.reduce((s, w) => s + w.courts.reduce((cs, ct) => cs + ct.matches.length, 0), 0);
  const n = regs.length;
  const numCourts = league.numCourts || 4;
  const maxPlayers = numCourts * MAX_PER_COURT;
  const sizes = distributePlayersToCourts(n, numCourts);
  const capacityOk = !!sizes;
  const paidCount = regs.filter(r => r.paid).length;
  const courtList = courtNames(numCourts);

  // ─── Schedule state widget data ─────────────────────────────────────────
  // Consolidates the "what's the system waiting on?" question into one
  // widget. The state machine: first matching state wins.
  // Returns { tone, title, hint, action }:
  //   tone   "ready" | "blocked" | "done" | "info"  → drives the color
  //   title  short status sentence shown in bold
  //   hint   optional secondary line
  //   action  { label, disabled? } or null when no action is available
  const scheduleState = (() => {
    const isLadder = league.competitionType === "ladder";
    const allDone = realWeeksCount >= league.weeks;
    const hasLockedWeeks = realWeeks.some(w => isWeekLocked(w.week));

    if (allDone) {
      return {
        tone: "done",
        title: `All ${league.weeks} weeks generated.`,
        hint: hasLockedWeeks ? null : "Lock weeks as their scores come in to update standings.",
        action: null,
      };
    }
    if (n < MIN_PER_COURT) {
      return {
        tone: "blocked",
        title: n === 0 ? "No players registered yet." : `Need at least ${MIN_PER_COURT} players to schedule.`,
        hint: "Add players in the Players tab.",
        action: null,
      };
    }
    if (!capacityOk) {
      return {
        tone: "blocked",
        title: `${n} players can't be split evenly across ${numCourts} court${numCourts!==1?"s":""}.`,
        hint: `Need ${MIN_PER_COURT}–${maxPlayers} players (${MIN_PER_COURT}–${MAX_PER_COURT} per court).`,
        action: null,
      };
    }
    if (!isLadder) {
      // Round-Robin (internal id: "mixer")
      if (realWeeksCount === 0) {
        return {
          tone: "ready",
          title: "Ready to generate the season schedule.",
          hint: `${n} player${n!==1?"s":""} · ${numCourts} court${numCourts!==1?"s":""} · ${league.weeks} weeks`,
          action: { label: "Generate Schedule" },
        };
      }
      if (hasLockedWeeks) {
        return {
          tone: "info",
          title: `Schedule generated · ${realWeeksCount} of ${league.weeks} weeks · ${totalMatches} matches.`,
          hint: "One or more weeks are locked. Unlock all weeks before regenerating.",
          action: null,
        };
      }
      return {
        tone: "info",
        title: `Schedule generated · ${realWeeksCount} of ${league.weeks} weeks · ${totalMatches} matches.`,
        hint: "Replacing the schedule will reshuffle court assignments and clear any entered scores.",
        action: { label: "Replace Schedule" },
      };
    }
    // Ladder
    if (realWeeksCount === 0) {
      return {
        tone: "ready",
        title: "Ready to generate Week 1.",
        hint: "Ladder Week 1 randomly assigns starting courts. Subsequent weeks rotate based on results.",
        action: { label: "Generate Week 1" },
      };
    }
    const lastLocked = lastRealWeek && isWeekLocked(lastRealWeek.week);
    if (!lastLocked) {
      return {
        tone: "blocked",
        title: `Lock Week ${lastRealWeek.week} to generate Week ${lastRealWeek.week + 1}.`,
        hint: "Ladder rotation needs the previous week's results locked in.",
        action: null,
      };
    }
    return {
      tone: "ready",
      title: `Ready to generate Week ${lastRealWeek.week + 1}.`,
      hint: `Court assignments will rotate based on Week ${lastRealWeek.week} results.`,
      action: { label: `Generate Week ${lastRealWeek.week + 1}` },
    };
  })();

  // Visual treatment per tone. CSC blue for ready (the main "go" action),
  // amber for blocked/info, green for done.
  const SCHEDULE_TONE = {
    ready:   { bg: "#E6F1FB", border: "#185FA5", text: "#0E3A6B" },
    blocked: { bg: "#FAEEDA", border: "#ECC580", text: "#854F0B" },
    info:    { bg: "var(--color-background-secondary)", border: "var(--color-border-tertiary)", text: "var(--color-text-primary)" },
    done:    { bg: "#EAF3DE", border: "#A5D070", text: "#3B6D11" },
  };
  const stateStyle = SCHEDULE_TONE[scheduleState.tone];

  return (
    <div>
      {/* Banner */}
      <div style={{ ...S.card, margin: "16px 20px", borderLeft: `4px solid ${c.bg}`, background: c.light }}>
        <div style={{ ...S.row, justifyContent: "space-between", flexWrap: "wrap", rowGap: 12 }}>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: c.text, fontWeight: 600 }}>
              {league.gender || "Mixed"} · {league.format || "Singles"} · {league.weeks} weeks
              <span style={{ ...S.badge(league.competitionType === "ladder" ? "purple" : "info"), marginLeft: 8, fontSize: 10 }}>
                {league.competitionType === "ladder" ? "🪜 Ladder" : "🔀 Round-Robin"}
              </span>
              {league.status === "archived" && <span style={{ ...S.badge("warning"), marginLeft: 8, fontSize: 10 }}>📦 Archived</span>}
              {league.status === "completed" && <span style={{ ...S.badge("info"), marginLeft: 8, fontSize: 10 }}>Completed</span>}
            </p>
            <p style={{ margin: "0 0 4px", fontSize: 13, color: c.text }}>{n} players · {paidCount} paid · Starts {formatDate(league.startDate)}</p>
            {league.location && <p style={{ margin: 0, fontSize: 13, color: c.text }}>📍 {league.location}</p>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btnSm("secondary")} onClick={onEdit}>Edit</button>
            {(league.status === "completed" || league.status === "archived") && (
              <button style={S.btnSm("secondary")} onClick={onToggleArchive}>
                {league.status === "archived" ? "Unarchive" : "Archive"}
              </button>
            )}
            <button style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D" }} onClick={onDelete}>Delete</button>
          </div>
        </div>
      </div>

      <div style={S.tabBar}>
        {["schedule", "players", "standings"].map(t => <button key={t} style={S.tab(tab===t, c.bg)} onClick={() => setTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}
      </div>

      <div style={S.section}>
        {tab === "schedule" && (
          <div>
            {/* Reminder: weeks with all scores entered but not yet locked */}
            {(() => {
              const fullyScoredUnlocked = realWeeks.filter(w => {
                if (isWeekLocked(w.week)) return false;
                let total = 0, scored = 0;
                w.courts.forEach(ct => ct.matches.forEach(m => {
                  total++;
                  if (getScore(league.id, w.week, m.id)) scored++;
                }));
                return total > 0 && scored === total;
              });
              if (fullyScoredUnlocked.length === 0) return null;
              return (
                <div style={{ padding: "12px 16px", marginBottom: 16, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B", display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>🔓</span>
                  <span>
                    <b>{fullyScoredUnlocked.length} week{fullyScoredUnlocked.length!==1?"s":""}</b> with all scores entered but not yet locked
                    ({fullyScoredUnlocked.map(w => `Week ${w.week}`).join(", ")}).
                    Lock {fullyScoredUnlocked.length!==1?"them":"it"} to count toward standings.
                  </span>
                </div>
              );
            })()}
            {/* Court capacity visualizer */}
            <div style={{ ...S.card, marginBottom: 16, padding: "12px 16px", background: "var(--color-background-secondary)" }}>
              <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Court Assignments</span>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{n} of {maxPlayers} players (ideal: {MAX_PER_COURT} per court)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(numCourts, isMobile ? 3 : 4)}, 1fr)`, gap: 8 }}>
                {courtList.map((name, ci) => {
                  const sz = sizes ? sizes[ci] : 0;
                  const full = sz === MAX_PER_COURT;
                  const color = COURT_COLORS[ci % COURT_COLORS.length];
                  return (
                    <div key={name} style={{ textAlign: "center" }}>
                      <div style={{ height: 44, borderRadius: 8, background: sz ? color : "var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", opacity: sz ? 1 : 0.35 }}>
                        {sz ? (
                          <div>
                            <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{sz}</span>
                            {full && <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, display: "block", marginTop: -2 }}>FULL</span>}
                          </div>
                        ) : <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>–</span>}
                      </div>
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: sz ? color : "var(--color-text-tertiary)", fontWeight: sz ? 600 : 400 }}>{name}</p>
                    </div>
                  );
                })}
              </div>
              {capacityOk && n < maxPlayers && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#854F0B" }}>{maxPlayers-n} more player{maxPlayers-n!==1?"s":""} needed for {numCourts} full court{numCourts!==1?"s":""} of {MAX_PER_COURT}.</p>}
              {capacityOk && n === maxPlayers && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#3B6D11" }}>✓ Perfect — {numCourts} court{numCourts!==1?"s":""} of {MAX_PER_COURT} players each.</p>}
            </div>

            {/* Consolidated schedule state widget — replaces the previous mix of
                summary text + standalone Generate button + ladder banner +
                empty-state placeholder. One status sentence + one action. */}
            <div style={{
              padding: "14px 16px",
              marginBottom: 16,
              background: stateStyle.bg,
              border: `0.5px solid ${stateStyle.border}`,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: stateStyle.text }}>
                  {scheduleState.title}
                </p>
                {scheduleState.hint && (
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: stateStyle.text, opacity: 0.85 }}>
                    {scheduleState.hint}
                  </p>
                )}
              </div>
              {scheduleState.action && (
                <button
                  style={{ ...S.btn("primary"), background: c.bg }}
                  onClick={onGenerate}>
                  {scheduleState.action.label}
                </button>
              )}
            </div>
            {(() => {
              // Build these once per LeagueDetail render so all week cards
              // share the same stable references (helps any future React.memo)
              const getPlayerEmail = pid => db.players[pid]?.email;
              return weeks.map(w => <CourtWeekCard key={w.week} weekData={w} league={league} leagueId={league.id} leagueName={league.name} getScore={getScore} getPlayerName={getPlayerName} getPlayerEmail={getPlayerEmail} onEnterScore={onEnterScore} onSubmitScore={onSubmitScore} onToggleLock={onToggleLockWeek} onEditDateTime={onEditWeekDateTime} onRebalance={onRebalanceWeek} isLocked={isWeekLocked(w.week)} isAdmin regs={regs} getCheckInForPlayer={(pid) => getCheckIn(league.id, w.week, pid)} />);
            })()}
          </div>
        )}

        {tab === "players" && (
          <div>
            <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>{n} registered · {paidCount} paid</p>
              <button style={{ ...S.btn("primary"), background: c.bg }} onClick={onAddPlayer}>+ Add Player</button>
            </div>
            {regs.length === 0 && <EmptyState msg="No players yet. Add players to start building the roster." />}
            {regs.map(r => {
              const p = db.players[r.playerId];
              if (!p) return null;
              return (
                <div key={r.key} style={S.card}>
                  <div style={{ ...S.row, marginBottom: 8 }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: c.light, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: c.bg, fontSize: 15, flexShrink: 0 }}>{playerInitial(p)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{formatPlayerName(p)}</p>
                        {p.gender && <span style={{ ...genderBadgeStyle(p.gender), fontSize: 10 }}>{p.gender}</span>}
                        {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC</span>}
                        {r.paid ? <span style={{ ...S.badge("success"), fontSize: 10 }}>Paid</span> : <span style={{ ...S.badge("warning"), fontSize: 10 }}>Unpaid</span>}
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                    </div>
                  </div>
                  <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 8 }}>
                    <button style={r.paid ? { ...S.btnSm("secondary"), color: "#854F0B", borderColor: "#854F0B", fontSize: 11 } : { ...S.btnSm("primary"), background: "#3B6D11", fontSize: 11 }} onClick={() => onTogglePaid(p.id)}>
                      {r.paid ? "Undo Payment" : "Mark as Paid"}
                    </button>
                    <button style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11 }} onClick={() => { if (confirm(`Remove ${playerFullName(p)}?`)) onRemovePlayer(p.id); }}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "standings" && (() => {
          const standings = getStandings();
          const pendingWeeks = weeks.filter(w => !isWeekLocked(w.week) && w.courts.some(ct => ct.matches.some(m => getScore(league.id, w.week, m.id)))).length;
          return <StandingsTable standings={standings} getPlayerName={getPlayerName} color={c} pendingWeeks={pendingWeeks} />;
        })()}
      </div>
    </div>
  );
}
