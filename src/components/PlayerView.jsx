import { useState } from "react";
import { S } from "../styles.js";
import { COLORS } from "../lib/constants.js";
import { formatDate, formatTime, playerFullName, playerInitial } from "../lib/format.js";
import { Toast, Modal, EmptyState, AvatarMenu } from "./ui.jsx";
import { ScoreForm } from "./ScoreForm.jsx";
import { CourtWeekCard } from "./CourtWeekCard.jsx";
import { StandingsTable } from "./StandingsTable.jsx";

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
  const court = week.courts.find(ct => ct.players.includes(playerId));
  if (!court) return null;
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
  return { court, match: target };
}

// ─── PlayerView ─────────────────────────────────────────────────────────────
export function PlayerView({ db, player, myLeagues, unregistered, playerTab, setPlayerTab, modal, setModal, toast, getLeagueSchedule, getScore, getPlayerName, getStandings, registerForLeague, submitScore, isWeekLocked, getCheckIn, setCheckIn, adminEmails, onSwitchToAdmin, onLogout, scoreModal }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(myLeagues[0]?.id || null);
  // Even if the commissioner soft-deletes a league while the player is
  // looking at it, don't render the stale data — treat it as null.
  const rawLeague = selectedLeagueId ? db.leagues[selectedLeagueId] : null;
  const selectedLeague = rawLeague && !rawLeague.deletedAt ? rawLeague : null;
  const c = selectedLeague ? (COLORS[selectedLeague.color] || COLORS.csc) : COLORS.teal;
  const sched = selectedLeagueId ? getLeagueSchedule(selectedLeagueId) : { weeks: [] };
  const myWeeks = (sched.weeks || []).filter(w => w.courts.some(ct => ct.players.includes(player.id)));

  return (
    <div style={S.page}>
      <Toast toast={toast} />
      {scoreModal}
      {modal?.type === "enterScore" && (
        <Modal title="Submit Score" onClose={() => setModal(null)}>
          <ScoreForm match={modal.match} leagueId={modal.leagueId}
            existing={getScore(modal.leagueId, modal.match.week, modal.match.id)}
            getPlayerName={getPlayerName}
            onSubmit={(h, a) => submitScore(modal.leagueId, modal.match.week, modal.match.id, h, a)}
            onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === "joinLeague" && (
        <Modal title="Join League" onClose={() => setModal(null)}>
          {unregistered.length === 0 && <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>You're already in all available leagues!</p>}
          {unregistered.map(l => {
            const lc = COLORS[l.color] || COLORS.csc;
            return <div key={l.id} style={{ ...S.card, borderLeft: `4px solid ${lc.bg}` }}>
              <div style={S.row}><div style={{ flex: 1 }}><p style={{ margin:"0 0 2px",fontWeight:600 }}>{l.name}</p><p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{l.gender || "Mixed"} · {l.format} · {l.weeks} weeks</p></div>
              <button style={{ ...S.btnSm("primary"), background: lc.bg }} onClick={() => { registerForLeague(l.id, player.id); setModal(null); setSelectedLeagueId(l.id); }}>Join</button></div>
            </div>;
          })}
        </Modal>
      )}

      <div style={S.header(c.bg)} className="pwa-safe-top pwa-safe-x">
        <div>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Playing as</p>
          <h1 style={{ ...S.logo, fontSize: 16 }}>{playerFullName(player)}</h1>
        </div>
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
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--color-text-secondary)" }}>
          <p style={{ fontSize: 15 }}>You're not in any leagues yet.</p>
          <button style={{ ...S.btn("primary"), marginTop: 12 }} onClick={() => setModal({ type: "joinLeague" })}>Join a League</button>
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
        // Per-court time overrides the week-level time when set. This matters
        // for leagues with staggered start times (e.g. Court 1 at 8:00,
        // Court 3 at 9:30).
        const effectiveTime = found.court.time || hw.time;
        const timeLabel = effectiveTime ? formatTime(effectiveTime) : null;
        const displayCourtName = found.court.customName || found.court.courtName;
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
                  : "Court roster TBD"}
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
            {playerTab === "schedule" && (
              <div>
                <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>Your matches in <b>{selectedLeague.name}</b></p>
                {selectedLeague.status === "archived" && (
                  <div style={{ padding: "12px 16px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                    📦 This league has been archived. Your matches are visible for reference, but scores and check-ins can no longer be edited.
                  </div>
                )}
                {myWeeks.length === 0 && <EmptyState msg="No schedule yet. Check back after the commissioner generates this season's schedule." />}
                {myWeeks.map(w => <CourtWeekCard key={w.week} weekData={w} leagueId={selectedLeagueId} getScore={getScore} getPlayerName={getPlayerName} onEnterScore={match => setModal({ type: "enterScore", match, leagueId: selectedLeagueId })} myId={player.id} isLocked={isWeekLocked(selectedLeagueId, w.week) || selectedLeague.status === "archived"} myCheckIn={getCheckIn(selectedLeagueId, w.week, player.id)} onSetCheckIn={(week, status, subName) => setCheckIn(selectedLeagueId, week, player.id, status, subName)} />)}
              </div>
            )}
            {playerTab === "standings" && (() => {
              const weeks = sched.weeks || [];
              const pendingWeeks = weeks.filter(w => !isWeekLocked(selectedLeagueId, w.week) && w.courts.some(ct => ct.matches.some(m => getScore(selectedLeagueId, w.week, m.id)))).length;
              return <StandingsTable standings={getStandings(selectedLeagueId)} getPlayerName={getPlayerName} color={c} myId={player.id} pendingWeeks={pendingWeeks} />;
            })()}
          </div>
        </>
      )}
    </div>
  );
}
