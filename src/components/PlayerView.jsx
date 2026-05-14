import { useState } from "react";
import { S } from "../styles.js";
import { COLORS, CSC, MAX_PER_COURT } from "../lib/constants.js";
import { formatDate, formatTime, playerFullName, playerInitial, resolveCourtName, resolveCourtTime, todayISO } from "../lib/format.js";
import { Toast, Modal, EmptyState, AvatarMenu, VersionFooter, RefreshButton, PullToRefresh, PickleballIcon } from "./ui.jsx";
import { ScoreForm } from "./ScoreForm.jsx";
import { CourtWeekCard } from "./CourtWeekCard.jsx";
import { StandingsTable } from "./StandingsTable.jsx";
import { LeagueRegistrationCard } from "./LeagueRegistrationCard.jsx";

// ─── Helpers ────────────────────────────────────────────────────────────────
// Find the player's next or most recent match in a league's schedule.
// "Next" = the earliest unlocked week >= today where they have a match.
// If none, fall back to the most recent locked week with a match.
function findHighlightMatch(player, sched, isWeekLocked, leagueId) {
  const weeks = (sched?.weeks || []).filter(w => w.courts.some(ct => ct.players.includes(player.id)));
  if (weeks.length === 0) return null;

  const today = new Date(); today.setHours(0,0,0,0);
  const parseDate = iso => {
    if (!iso) return null;
    const [y,m,d] = iso.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m-1, d);
  };

  // Find weeks with no scores yet (or any unlocked) — preference order:
  // 1. Future or today, unlocked, and player hasn't played yet (no scores in their court)
  // 2. Most recent past week
  const withDates = weeks.map(w => ({ w, date: parseDate(w.date) }));
  // Sort ascending by date
  withDates.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  // Find first upcoming unlocked week
  const upcoming = withDates.find(({ w, date }) => {
    if (!date) return false;
    if (date < today) return false;
    return !isWeekLocked(leagueId, w.week);
  });
  if (upcoming) return { ...upcoming, kind: "upcoming" };

  // Otherwise: most recent past week (locked or not)
  const past = [...withDates].reverse().find(({ w, date }) => date && date <= today);
  if (past) return { ...past, kind: "past" };

  // No dates? Just the first available week
  return { ...withDates[0], kind: "upcoming" };
}

// Get the specific match (and its court) on a given week that the player is in
function findPlayerMatchInWeek(week, playerId, isWeekLocked, leagueId, getScore) {
  const courtIndex = week.courts.findIndex(ct => ct.players.includes(playerId));
  if (courtIndex === -1) return null;
  const court = week.courts[courtIndex];
  // Among matches in their court, prefer one without a score
  let target = court.matches.find(m => {
    const inMatch = (m.format === "doubles"
      ? [...(m.team1||[]), ...(m.team2||[])].includes(playerId)
      : (m.home === playerId || m.away === playerId));
    if (!inMatch) return false;
    const score = getScore(leagueId, m.week, m.id);
    return !score;
  });
  if (!target) {
    // Fall back to any match they're in
    target = court.matches.find(m => (m.format === "doubles"
      ? [...(m.team1||[]), ...(m.team2||[])].includes(playerId)
      : (m.home === playerId || m.away === playerId)));
  }
  return { court, courtIndex, match: target };
}

// ─── PlayerView ─────────────────────────────────────────────────────────────
export function PlayerView({ db, player, myLeagues, unregistered, playerTab, setPlayerTab, modal, setModal, toast, getLeagueSchedule, getScore, getPlayerName, getStandings, registerForLeague, submitScore, submitScoreInline, isWeekLocked, getCheckIn, setCheckIn, adminEmails, onSwitchToAdmin, onLogout, scoreModal, onRefresh, isRefreshing }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(myLeagues[0]?.id || null);
  // Even if the commissioner soft-deletes a league while the player is
  // looking at it, don't render the stale data — treat it as null.
  const rawLeague = selectedLeagueId ? db.leagues[selectedLeagueId] : null;
  const selectedLeague = rawLeague && !rawLeague.deletedAt ? rawLeague : null;
  const c = selectedLeague ? (COLORS[selectedLeague.color] || COLORS.csc) : COLORS.teal;
  const sched = selectedLeagueId ? getLeagueSchedule(selectedLeagueId) : { weeks: [] };
  const myWeeks = (sched.weeks || []).filter(w => w.courts.some(ct => ct.players.includes(player.id)));

  // Group registrations by league so the join cards can show a roster
  // preview and player count without re-scanning all registrations per card.
  const regsByLeague = {};
  Object.values(db.registrations).forEach(r => {
    (regsByLeague[r.leagueId] || (regsByLeague[r.leagueId] = [])).push(r);
  });

  // Helper to start the join flow — goes through a confirm step rather than
  // enrolling on a single tap (prevents thumb-mis-tap enrollments).
  function startJoinFlow(league) {
    setModal({ type: "confirmJoinLeague", league });
  }

  return (
    <PullToRefresh onRefresh={onRefresh} isRefreshing={isRefreshing}>
    <div style={S.page}>
      <Toast toast={toast} />
      {scoreModal}
      {modal?.type === "enterScore" && (
        <Modal title="Submit Score" onClose={() => setModal(null)}>
          <ScoreForm match={modal.match} leagueId={modal.leagueId}
            existing={getScore(modal.leagueId, modal.match.week, modal.match.id)}
            getPlayerName={getPlayerName}
            onSubmit={(h, a) => submitScore(modal.leagueId, modal.match.week, modal.match.id, h, a, modal.match)}
            onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === "joinLeague" && (
        <Modal title="Join a League" onClose={() => setModal(null)}>
          {unregistered.length === 0 && (
            <p style={{ color: "var(--color-text-secondary)", fontSize: 14, textAlign: "center", padding: "16px 0" }}>
              No leagues are open for registration right now. Check back soon!
            </p>
          )}
          {unregistered.length > 0 && (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              Tap a league to see details and join.
            </p>
          )}
          {unregistered.map(l => (
            <LeagueRegistrationCard
              key={l.id}
              league={l}
              regs={regsByLeague[l.id] || []}
              players={db.players}
              onSelect={league => startJoinFlow(league)} />
          ))}
        </Modal>
      )}

      {/* Join confirmation — second step so a tap on a list of leagues
          doesn't enroll the player by accident. The modal restates the
          league details before they commit. */}
      {modal?.type === "confirmJoinLeague" && (() => {
        const league = modal.league;
        const lc = COLORS[league.color] || COLORS.csc;
        const leagueRegs = regsByLeague[league.id] || [];
        const filled = leagueRegs.length;
        const capacity = (league.numCourts || 4) * MAX_PER_COURT;
        return (
          <Modal title="Join this league?" onClose={() => setModal(null)}>
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--color-background-secondary)", borderRadius: 8, borderLeft: `4px solid ${lc.bg}` }}>
              <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 15 }}>{league.name}</p>
              <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {league.gender || "Mixed"} · {league.format || "Singles"} · {league.weeks} weeks
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                Starts {formatDate(league.startDate)}
              </p>
              {league.location && (
                <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  📍 {league.location}
                </p>
              )}
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
                {filled} of {capacity} spots filled
              </p>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              You'll be added to the roster. The commissioner will mark you as paid once your payment is received.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("secondary")} onClick={() => setModal(null)}>Cancel</button>
              <button
                style={{ ...S.btn("primary"), background: lc.bg }}
                onClick={() => {
                  registerForLeague(league.id, player.id);
                  setModal(null);
                  setSelectedLeagueId(league.id);
                }}>
                Join League
              </button>
            </div>
          </Modal>
        );
      })()}

      <div style={S.header(c.bg)} className="pwa-safe-top pwa-safe-x">
        <div>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Playing as</p>
          <h1 style={{ ...S.logo, fontSize: 16 }}>{playerFullName(player)}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RefreshButton onClick={onRefresh} isRefreshing={isRefreshing} />
          <AvatarMenu
            initial={playerInitial(player)}
            ariaLabel={`Menu for ${playerFullName(player)}`}
            items={[
              // Commissioner Mode — only for users in the admin allowlist
              ...(adminEmails.map(e => e.toLowerCase()).includes(player.email.toLowerCase())
                ? [{ label: "Commissioner Mode", icon: "⚙", onClick: onSwitchToAdmin }]
                : []),
              { label: "Join a League", icon: "＋", onClick: () => setModal({ type: "joinLeague" }) },
              { label: "Log Out", icon: "↪", onClick: onLogout, danger: true },
            ]}
          />
        </div>
      </div>

      {myLeagues.length > 1 && (
        <div style={{ padding: "12px 20px", display: "flex", gap: 8, overflowX: "auto", background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          {myLeagues.map(l => {
            const lc = COLORS[l.color] || COLORS.csc;
            const archived = l.status === "archived";
            return <button key={l.id} style={{ ...S.btnSm(selectedLeagueId===l.id?"primary":"secondary"), background: selectedLeagueId===l.id?lc.bg:"transparent", whiteSpace:"nowrap", opacity: archived ? 0.7 : 1 }} onClick={() => setSelectedLeagueId(l.id)}>{archived ? "📦 " : ""}{l.name}</button>;
          })}
        </div>
      )}

      {myLeagues.length === 0 && (
        <div style={{ padding: "32px 20px", color: "var(--color-text-secondary)" }}>
          <div style={{ textAlign: "center", marginBottom: unregistered.length > 0 ? 28 : 0 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <PickleballIcon size={48} />
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
              Ready to play?
            </p>
            <p style={{ fontSize: 14, margin: "6px 0 0" }}>
              {unregistered.length > 0
                ? "You're not in any leagues yet. Pick one below to get started."
                : "No leagues are open for registration right now. Check back soon!"}
            </p>
          </div>
          {/* Show actual open leagues directly on the empty state so a
              brand-new player can browse and join without a modal hop. */}
          {unregistered.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Open for registration
              </p>
              {unregistered.map(l => (
                <LeagueRegistrationCard
                  key={l.id}
                  league={l}
                  regs={regsByLeague[l.id] || []}
                  players={db.players}
                  onSelect={league => startJoinFlow(league)} />
              ))}
            </>
          )}
        </div>
      )}

      {selectedLeague && (() => {
        const highlight = findHighlightMatch(player, sched, isWeekLocked, selectedLeagueId);
        if (!highlight || selectedLeague.status === "archived") return null;
        const { w: hw, kind } = highlight;
        const found = findPlayerMatchInWeek(hw, player.id, isWeekLocked, selectedLeagueId, getScore);
        if (!found?.court) return null;
        const isUpcoming = kind === "upcoming";
        const partners = found.court.players.filter(p => p !== player.id);
        const dateLabel = formatDate(hw.date);
        // Cascade: per-week override → league config → week default.
        // Matters for leagues with staggered start times.
        const effectiveTime = resolveCourtTime(found.court, found.courtIndex, selectedLeague, hw.time);
        const timeLabel = effectiveTime ? formatTime(effectiveTime) : null;
        const displayCourtName = resolveCourtName(found.court, found.courtIndex, selectedLeague);
        return (
          <div style={{ margin: "12px 16px 0" }}>
            <div style={{
              background: isUpcoming ? c.bg : "var(--color-background-primary)",
              color: isUpcoming ? "#fff" : "var(--color-text-primary)",
              borderRadius: 12, padding: "12px 16px",
              border: isUpcoming ? "none" : `0.5px solid ${c.bg}40`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  background: isUpcoming ? "rgba(255,255,255,0.25)" : c.bg,
                  color: isUpcoming ? "#fff" : "#fff",
                  padding: "2px 8px", borderRadius: 999,
                }}>
                  {isUpcoming ? "Your next match" : "Most recent match"}
                </span>
                <span style={{ fontSize: 12, opacity: 0.85 }}>Week {hw.week} · {displayCourtName}</span>
              </div>
              <p style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, letterSpacing: "-0.2px" }}>
                {dateLabel}{timeLabel ? ` · ${timeLabel}` : ""}
              </p>
              <p style={{ margin: 0, fontSize: 13, opacity: 0.92 }}>
                {partners.length > 0
                  ? `${selectedLeague.format === "Singles" ? "Court with" : "On court with"}: ${partners.map(p => getPlayerName(p)).join(" · ")}`
                  : "Court matchups will appear here once the schedule is published."}
              </p>
            </div>
          </div>
        );
      })()}
      {selectedLeague && (
        <>
          <div style={S.tabBar}>
            {["schedule","standings"].map(t => <button key={t} style={S.tab(playerTab===t,c.bg)} onClick={() => setPlayerTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}
          </div>
          <div style={S.section}>
            {playerTab === "schedule" && (() => {
              // Season progress: identify the "current week" — the earliest
              // week whose date is >= today, falling back to the last week
              // if the whole season is in the past. Used both for the
              // summary text and to highlight the current week's card.
              const today = todayISO();
              const allWeeks = sched.weeks || [];
              const currentWeek = (() => {
                if (allWeeks.length === 0) return null;
                const upcoming = allWeeks.find(w => w.date && w.date >= today);
                return upcoming || allWeeks[allWeeks.length - 1];
              })();
              const completedWeeks = allWeeks.filter(w => w.date && w.date < today).length;
              const totalWeeks = selectedLeague.weeks || allWeeks.length;
              const weeksLeft = Math.max(0, totalWeeks - completedWeeks);
              const showProgress = totalWeeks > 0 && selectedLeague.status !== "archived";
              return (
                <div>
                  <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--color-text-secondary)" }}>Your matches in <b>{selectedLeague.name}</b></p>
                  {selectedLeague.status === "archived" && (
                    <div style={{ padding: "12px 16px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                      📦 This league has been archived. Your matches are visible for reference, but scores and check-ins can no longer be edited.
                    </div>
                  )}
                  {/* Season-at-a-glance summary. Hidden for archived leagues
                      (the archive banner is the more important signal there)
                      and for empty schedules (no weeks to summarize). */}
                  {showProgress && currentWeek && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", marginBottom: 12,
                      background: CSC.blueLight, borderRadius: 8,
                      fontSize: 13, color: CSC.blueDark, fontWeight: 600,
                    }}>
                      <span>Week {currentWeek.week} of {totalWeeks}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>
                        {weeksLeft === 0 ? "Season complete" : `${weeksLeft} week${weeksLeft !== 1 ? "s" : ""} left`}
                      </span>
                    </div>
                  )}
                  {myWeeks.length === 0 && <EmptyState msg="Schedule coming soon! Your matches will appear here once the commissioner generates the season." />}
                  {myWeeks.map(w => (
                    <CourtWeekCard
                      key={w.week}
                      weekData={w}
                      league={selectedLeague}
                      leagueId={selectedLeagueId}
                      getScore={getScore}
                      getPlayerName={getPlayerName}
                      onEnterScore={match => setModal({ type: "enterScore", match, leagueId: selectedLeagueId })}
                      onSubmitScore={(home, away, match, actionId) => submitScoreInline(selectedLeagueId, home, away, match, actionId)}
                      myId={player.id}
                      isLocked={isWeekLocked(selectedLeagueId, w.week) || selectedLeague.status === "archived"}
                      isCurrentWeek={currentWeek?.week === w.week && selectedLeague.status !== "archived"}
                      myCheckIn={getCheckIn(selectedLeagueId, w.week, player.id)}
                      onSetCheckIn={(week, status, subName) => setCheckIn(selectedLeagueId, week, player.id, status, subName)} />
                  ))}
                </div>
              );
            })()}
            {playerTab === "standings" && (() => {
              const weeks = sched.weeks || [];
              const pendingWeeks = weeks.filter(w => !isWeekLocked(selectedLeagueId, w.week) && w.courts.some(ct => ct.matches.some(m => getScore(selectedLeagueId, w.week, m.id)))).length;
              return <StandingsTable standings={getStandings(selectedLeagueId)} getPlayerName={getPlayerName} color={c} myId={player.id} pendingWeeks={pendingWeeks} />;
            })()}
          </div>
        </>
      )}
      <VersionFooter />
    </div>
    </PullToRefresh>
  );
}
