import { useState } from "react";
import { S } from "../styles.js";
import { COLORS, COURT_COLORS, MAX_PER_COURT, MIN_PER_COURT, courtNames } from "../lib/constants.js";
import { formatDate, formatPlayerName, playerFullName, playerInitial } from "../lib/format.js";
import { useIsMobile, buildDisplayWeeks } from "../lib/session.js";
import { distributePlayersToCourts } from "../lib/scheduling.js";
import { CourtWeekCard } from "./CourtWeekCard.jsx";
import { StandingsTable } from "./StandingsTable.jsx";
import { EmptyState } from "./ui.jsx";

export function LeagueDetail({ league, db, regs, schedule, getScore, getPlayerName, getStandings, onEdit, onDelete, onToggleArchive, onGenerate, onAddPlayer, onRemovePlayer, onTogglePaid, onToggleLockWeek, isWeekLocked, onEnterScore, onEditWeekDateTime, onRebalanceWeek, getCheckIn }) {
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

  return (
    <div>
      {/* Banner */}
      <div style={{ ...S.card, margin: "16px 20px", borderLeft: `4px solid ${c.bg}`, background: c.light }}>
        <div style={{ ...S.row, justifyContent: "space-between", flexWrap: "wrap", rowGap: 12 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 13, color: c.text, fontWeight: 600 }}>
              {league.gender || "Mixed"} · {league.format || "Singles"} · {league.weeks} weeks
              <span style={{ ...S.badge(league.competitionType === "ladder" ? "purple" : "info"), marginLeft: 8, fontSize: 10 }}>
                {league.competitionType === "ladder" ? "🪜 Ladder" : "🔀 Mixer"}
              </span>
              {league.status === "archived" && <span style={{ ...S.badge("warning"), marginLeft: 8, fontSize: 10 }}>📦 Archived</span>}
              {league.status === "completed" && <span style={{ ...S.badge("info"), marginLeft: 8, fontSize: 10 }}>Completed</span>}
            </p>
            <p style={{ margin: "0 0 2px", fontSize: 13, color: c.text }}>{n} players · {paidCount} paid · Starts {formatDate(league.startDate)}</p>
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
                <div style={{ padding: "10px 14px", marginBottom: 16, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B", display: "flex", alignItems: "flex-start", gap: 8 }}>
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
            <div style={{ ...S.card, marginBottom: 16, padding: "14px 16px", background: "var(--color-background-secondary)" }}>
              <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 10 }}>
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
                      <p style={{ margin: "5px 0 0", fontSize: 11, color: sz ? color : "var(--color-text-tertiary)", fontWeight: sz ? 600 : 400 }}>{name}</p>
                    </div>
                  );
                })}
              </div>
              {!capacityOk && n > 0 && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#A32D2D" }}>⚠ {n} players can't be evenly split into {numCourts} court{numCourts!==1?"s":""}. Need {MIN_PER_COURT}–{maxPlayers} players.</p>}
              {capacityOk && n < maxPlayers && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#854F0B" }}>{maxPlayers-n} more player{maxPlayers-n!==1?"s":""} needed for {numCourts} full court{numCourts!==1?"s":""} of {MAX_PER_COURT}.</p>}
              {capacityOk && n === maxPlayers && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#3B6D11" }}>✓ Perfect — {numCourts} court{numCourts!==1?"s":""} of {MAX_PER_COURT} players each.</p>}
            </div>

            <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
                {realWeeksCount} of {league.weeks} weeks scheduled · {totalMatches} total matches
              </p>
              {(() => {
                const isLadder = league.competitionType === "ladder";
                const allDone = realWeeksCount >= league.weeks;
                let label;
                if (isLadder) {
                  if (realWeeksCount === 0) label = "Generate Week 1";
                  else if (allDone) label = "All Weeks Done";
                  else label = `Generate Week ${realWeeksCount + 1}`;
                } else {
                  label = realWeeksCount ? "Regenerate" : "Generate Schedule";
                }
                return (
                  <button
                    style={{ ...S.btn("primary"), background: c.bg, opacity: (!capacityOk || allDone) ? 0.5 : 1 }}
                    disabled={allDone}
                    onClick={onGenerate}>
                    {label}
                  </button>
                );
              })()}
            </div>
            {league.competitionType === "ladder" && realWeeksCount > 0 && realWeeksCount < league.weeks && lastRealWeek && !isWeekLocked(lastRealWeek.week) && (
              <div style={{ padding: "10px 14px", marginBottom: 16, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                🪜 Ladder leagues generate one week at a time. Lock Week {lastRealWeek.week}'s scores before generating Week {lastRealWeek.week + 1}.
              </div>
            )}
            {realWeeksCount === 0 && <EmptyState msg={capacityOk ? (league.competitionType === "ladder" ? "Click Generate Week 1 to randomly assign starting courts." : "Click Generate Schedule to create court assignments.") : "Fix player count first."} />}
            {(() => {
              // Build these once per LeagueDetail render so all week cards
              // share the same stable references (helps any future React.memo)
              const getPlayerEmail = pid => db.players[pid]?.email;
              return weeks.map(w => <CourtWeekCard key={w.week} weekData={w} leagueId={league.id} leagueName={league.name} getScore={getScore} getPlayerName={getPlayerName} getPlayerEmail={getPlayerEmail} onEnterScore={onEnterScore} onToggleLock={onToggleLockWeek} onEditDateTime={onEditWeekDateTime} onRebalance={onRebalanceWeek} isLocked={isWeekLocked(w.week)} isAdmin regs={regs} getCheckInForPlayer={(pid) => getCheckIn(league.id, w.week, pid)} />);
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
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{formatPlayerName(p)}</p>
                        {p.gender && <span style={{ ...S.badge("info"), fontSize: 10 }}>{p.gender}</span>}
                        {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC</span>}
                        {r.paid ? <span style={{ ...S.badge("success"), fontSize: 10 }}>Paid</span> : <span style={{ ...S.badge("warning"), fontSize: 10 }}>Unpaid</span>}
                      </div>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
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
