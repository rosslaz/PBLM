import { useState, useEffect, useCallback } from "react";

import { SUPER_ADMIN, COLORS, CSC, MIN_PER_COURT, MAX_PER_COURT, courtName } from "./lib/constants.js";
import { formatDate, formatPlayerName, playerInitial } from "./lib/format.js";
import { useIsMobile, sortLeagues, loadSession, saveSession, saveLastEmail } from "./lib/session.js";
import {
  supabase, loadDB, defaultDB,
  dbCreateLeague, dbUpdateLeague,
  dbSoftDeleteLeague, dbRestoreLeague, dbHardDeleteLeague,
  dbCreatePlayer, dbUpdatePlayer, dbTogglePlayerPaid,
  dbSoftDeletePlayer, dbRestorePlayer, dbHardDeletePlayer,
  dbRegisterForLeague, dbRemovePlayerFromLeague, dbToggleRegPaid,
  dbWriteSchedule, dbWriteScore, dbWriteWeekDateTime, dbRebalanceWeek,
  dbToggleLockWeek, dbSetCheckIn,
  dbAddAdmin, dbRemoveAdmin,
} from "./lib/supabase.js";
import {
  distributePlayersToCourts, seededShuffle, singlesMatches, doublesMatches,
  generateCourtSchedule, assignBalancedCourts, laddderRotate, buildLadderWeek,
} from "./lib/scheduling.js";
import { S } from "./styles.js";

import { Modal, Toast, EmptyState, VersionFooter, RefreshButton, PullToRefresh } from "./components/ui.jsx";
import { PlayerForm } from "./components/PlayerForm.jsx";
import { LeagueForm } from "./components/LeagueForm.jsx";
import { EditWeekForm } from "./components/EditWeekForm.jsx";
import { ScoreForm } from "./components/ScoreForm.jsx";
import { AddPlayerToLeague } from "./components/AddPlayerToLeague.jsx";
import { LeagueDetail } from "./components/LeagueDetail.jsx";
import { AdminsTab } from "./components/AdminsTab.jsx";
import { TrashTab } from "./components/TrashTab.jsx";
import { SchedulePreview } from "./components/SchedulePreview.jsx";
import { HomeView } from "./components/HomeView.jsx";
import { PlayerView } from "./components/PlayerView.jsx";
import { ActionPendingProvider, Spinner } from "./components/Spinner.jsx";

export default function App() {
  const isMobile = useIsMobile();
  const [db, setDB] = useState(null);
  const [view, setView] = useState("home");
  const [adminTab, setAdminTab] = useState("leagues");
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [playerTab, setPlayerTab] = useState("schedule");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  // Tracks which action is currently in flight. null = idle.
  // String identifier like "submit-score-w1_c0_m0" lets specific buttons
  // know it's their action that's pending so they can show a spinner.
  // Actions that don't need per-button feedback pass no ID; they still
  // set `currentActionId = "_generic"` to drive the global indicator.
  const [currentActionId, setCurrentActionId] = useState(null);
  const saving = currentActionId !== null;
  const [adminEmail, setAdminEmail] = useState(null);
  const [sessionRestored, setSessionRestored] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  function logout() {
    setCurrentPlayer(null);
    setAdminEmail(null);
    setSelectedLeague(null);
    setView("home");
    saveSession(null);
    showToast("Logged out");
  }

  const reload = useCallback(async () => {
    try {
      const fresh = await loadDB();
      setDB(fresh);
    } catch (e) {
      console.error("[reload] failed:", e);
      showToast("Database error — see console", "error");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const fresh = await loadDB();
        setDB(fresh);
      } catch (e) {
        console.error("[initial load] failed:", e);
        setDB(defaultDB());
        showToast("Could not load data — check Supabase credentials", "error");
      }
    })();
  }, []);

  // Restore login session once db is loaded
  useEffect(() => {
    if (!db || sessionRestored) return;
    const adminEmailSetLowerLocal = new Set((db.adminEmails || [SUPER_ADMIN]).map(e => e.toLowerCase()));
    const sess = loadSession();
    // Block session restore for trashed players — they shouldn't log back in
    // just because a saved session is still in localStorage.
    const savedPlayer = sess.playerId ? db.players[sess.playerId] : null;
    const playerIsLive = savedPlayer && !savedPlayer.deletedAt;
    if (sess.playerId && playerIsLive) {
      setCurrentPlayer(savedPlayer);
      if (sess.adminEmail && adminEmailSetLowerLocal.has(sess.adminEmail.toLowerCase())) {
        setAdminEmail(sess.adminEmail);
        setView(sess.view === "admin" ? "admin" : "player");
      } else {
        setView("player");
      }
    } else if (sess.adminEmail) {
      if (adminEmailSetLowerLocal.has(sess.adminEmail.toLowerCase())) {
        setAdminEmail(sess.adminEmail);
        setView("admin");
      }
    }
    setSessionRestored(true);
  }, [db, sessionRestored]);

  useEffect(() => {
    if (!sessionRestored) return;
    if (currentPlayer || adminEmail) {
      saveSession({
        playerId: currentPlayer?.id || null,
        adminEmail: adminEmail || null,
        view,
      });
    } else {
      saveSession(null);
    }
  }, [currentPlayer, adminEmail, view, sessionRestored]);

  const dbPlayers = db?.players;
  useEffect(() => {
    if (!currentPlayer || !dbPlayers) return;
    const fresh = dbPlayers[currentPlayer.id];
    if (fresh && fresh !== currentPlayer) {
      if (JSON.stringify(fresh) !== JSON.stringify(currentPlayer)) {
        setCurrentPlayer(fresh);
      }
    }
  }, [dbPlayers, currentPlayer]);

  // Wraps every write: marks the action in flight, runs the write, reloads
  // from DB, shows a success/error toast.
  //
  // `actionId` is an opaque string that prominent action buttons can use to
  // know "this is my action running" — they read it via useIsActionPending
  // and render their own inline spinner. If omitted, the action still drives
  // the global "Saving…" indicator in the header.
  async function action(fn, successMsg, actionId) {
    setCurrentActionId(actionId || "_generic");
    try {
      await fn();
      await reload();
      if (successMsg) showToast(successMsg);
    } catch (e) {
      console.error("[action] failed:", e);
      showToast(e.message || "Operation failed", "error");
    } finally {
      setCurrentActionId(null);
    }
  }

  // User-initiated refresh — pull-to-refresh on mobile, refresh button on
  // desktop. Re-runs loadDB() so changes made by other commissioners or by
  // the same user from another device become visible. Reuses the saving
  // indicator state so any in-flight refresh is naturally serialized with
  // other writes.
  async function refresh() {
    if (currentActionId) return; // already busy
    setCurrentActionId("refresh");
    try {
      await reload();
    } finally {
      setCurrentActionId(null);
    }
  }

  if (!db) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:300,color:"var(--color-text-secondary)",fontSize:18 }}>Loading…</div>;

  // Split records by whether they've been soft-deleted. `leagues`/`players`
  // are the live ones every existing view reads from; trashed records are only
  // surfaced in the Trash tab. By-ID lookups (`db.leagues[id]`, `db.players[id]`)
  // still work for both — important so the Trash UI can read them and so any
  // stale references resolve.
  const isTrashed = r => !!r?.deletedAt;
  const allLeagues = Object.values(db.leagues);
  const allPlayers = Object.values(db.players);
  const leagues = allLeagues.filter(l => !isTrashed(l));
  const players = allPlayers.filter(p => !isTrashed(p));
  const trashedLeagues = allLeagues.filter(isTrashed);
  const trashedPlayers = allPlayers.filter(isTrashed);
  const sortedLeagues = sortLeagues(leagues);

  // Pre-index registrations by leagueId so getLeagueRegs is O(1) lookup.
  const regsByLeague = (() => {
    const idx = {};
    Object.values(db.registrations).forEach(r => {
      (idx[r.leagueId] || (idx[r.leagueId] = [])).push(r);
    });
    return idx;
  })();

  const getLeagueRegs = lid => regsByLeague[lid] || [];
  const getLeagueSchedule = lid => db.schedules[lid] || { weeks: [] };
  const getScore = (lid, week, mid) => db.scores[`${lid}_${week}_${mid}`] || null;
  const getPlayerName = id => formatPlayerName(db.players[id]);

  function getStandings(leagueId) {
    const regs = getLeagueRegs(leagueId);
    const sched = getLeagueSchedule(leagueId);
    const stats = {};
    regs.forEach(r => { stats[r.playerId] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
    (sched.weeks || []).forEach(w => {
      if (!isWeekLocked(leagueId, w.week)) return;
      w.courts.forEach(ct => ct.matches.forEach(match => {
        const score = getScore(leagueId, match.week, match.id);
        if (!score) return;
        const { homeScore: hs, awayScore: as } = score;
        const sideA = match.format === "doubles" ? match.team1 : [match.home];
        const sideB = match.format === "doubles" ? match.team2 : [match.away];
        const aWon = hs > as;
        sideA.forEach(pid => {
          if (!stats[pid]) return;
          stats[pid].pointsFor += hs;
          stats[pid].pointsAgainst += as;
          if (aWon) stats[pid].wins++; else stats[pid].losses++;
        });
        sideB.forEach(pid => {
          if (!stats[pid]) return;
          stats[pid].pointsFor += as;
          stats[pid].pointsAgainst += hs;
          if (!aWon) stats[pid].wins++; else stats[pid].losses++;
        });
      }));
    });
    return Object.entries(stats).map(([id, s]) => {
      const matches = s.wins + s.losses;
      const winPct = matches > 0 ? s.wins / matches : 0;
      return { id, ...s, matches, winPct };
    }).sort((a, b) => {
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      const da = a.pointsFor - a.pointsAgainst, dbb = b.pointsFor - b.pointsAgainst;
      if (dbb !== da) return dbb - da;
      return b.wins - a.wins;
    });
  }

  const getCheckIn = (leagueId, week, playerId) =>
    db.checkIns?.[`${leagueId}_w${week}_${playerId}`] || null;

  async function setCheckIn(leagueId, week, playerId, status, subName) {
    await action(() => dbSetCheckIn(leagueId, week, playerId, status, subName));
  }

  // ─── Action wrappers — each writes to DB then reloads ─────────────────────
  async function createLeague(data) {
    await action(() => dbCreateLeague(data, leagues.length), `League "${data.name}" created!`);
    setModal(null);
  }
  async function updateLeague(id, data) {
    await action(() => dbUpdateLeague(id, data), "League updated!");
    setModal(null);
  }
  async function toggleArchiveLeague(id) {
    const cur = db.leagues[id];
    if (!cur) return;
    const newStatus = cur.status === "archived" ? "completed" : "archived";
    await action(() => dbUpdateLeague(id, { status: newStatus }),
      newStatus === "archived" ? "League archived." : "League unarchived.");
  }
  // "Delete" from the league detail page → soft-delete (moves to trash).
  // The toast tells the commissioner it's recoverable.
  async function doDeleteLeague(id) {
    await action(() => dbSoftDeleteLeague(id), "League moved to trash. Restore from the Trash tab within 30 days.", "soft-delete-league");
    setSelectedLeague(null); setModal(null);
  }
  async function restoreLeague(id) {
    await action(() => dbRestoreLeague(id), "League restored.");
    setModal(null);
  }
  async function hardDeleteLeague(id) {
    await action(() => dbHardDeleteLeague(id), "League permanently deleted.", "hard-delete-league");
    setSelectedLeague(null); setModal(null);
  }

  async function rebalanceWeek(leagueId, weekNum) {
    const league = db.leagues[leagueId];
    const regs = getLeagueRegs(leagueId);
    const sched = getLeagueSchedule(leagueId);
    const week = sched.weeks?.find(w => w.week === weekNum);
    if (!week) { showToast("Week not found.", "error"); return; }

    const activePlayerIds = regs
      .map(r => r.playerId)
      .filter(pid => {
        const ci = getCheckIn(leagueId, weekNum, pid);
        return ci?.status !== "out";
      });

    if (activePlayerIds.length < MIN_PER_COURT) {
      showToast(`Only ${activePlayerIds.length} players available. Need at least ${MIN_PER_COURT}.`, "error");
      return;
    }

    const numCourts = league.numCourts || 4;
    const sizes = distributePlayersToCourts(activePlayerIds.length, numCourts);
    if (!sizes) {
      const maxAllowed = numCourts * MAX_PER_COURT;
      showToast(`Cannot rebalance ${activePlayerIds.length} players. Need ${MIN_PER_COURT}–${maxAllowed} (${MIN_PER_COURT}–${MAX_PER_COURT} per court).`, "error");
      return;
    }

    const shuffled = seededShuffle(activePlayerIds, Date.now() & 0xffffffff);
    let courtGroups;
    if (league.format === "Mixed Doubles") {
      const playerGenders = {};
      activePlayerIds.forEach(pid => { playerGenders[pid] = db.players[pid]?.gender; });
      courtGroups = assignBalancedCourts(shuffled, sizes, playerGenders);
    } else {
      courtGroups = [];
      let idx = 0;
      for (const sz of sizes) {
        courtGroups.push(shuffled.slice(idx, idx + sz));
        idx += sz;
      }
    }

    const isDoubles = league.format === "Doubles" || league.format === "Mixed Doubles";
    const newCourts = courtGroups.map((group, c) => {
      let rawMatches;
      if (isDoubles) rawMatches = doublesMatches(group, weekNum * 1009 + c * 7 + 13);
      else            rawMatches = singlesMatches(group);
      const matches = rawMatches.map((m, mi) => ({
        id: `w${weekNum}_c${c}_m${mi}`,
        ...m,
        week: weekNum,
        court: courtName(c),
        date: week.date,
        format: isDoubles ? "doubles" : "singles",
      }));
      return { courtName: courtName(c), players: group, matches };
    });

    let scoresCleared = 0;
    (week.courts || []).forEach(ct => ct.matches.forEach(m => {
      if (db.scores[`${leagueId}_${weekNum}_${m.id}`]) scoresCleared++;
    }));

    await action(() => dbRebalanceWeek(leagueId, weekNum, newCourts));
    const sz = courtGroups.map(g => g.length).join(", ");
    showToast(`Week ${weekNum} rebalanced: ${courtGroups.length} courts (${sz} players)${scoresCleared > 0 ? `, ${scoresCleared} score${scoresCleared!==1?"s":""} cleared` : ""}.`);
    setModal(null);
  }

  async function updateWeekDateTime(leagueId, weekNum, date, time, courtOverrides, applyTo) {
    const successMsg = applyTo === "all"
      ? `Week ${weekNum} updated, and court settings applied to all weeks.`
      : `Week ${weekNum} updated.`;
    await action(
      () => dbWriteWeekDateTime(leagueId, weekNum, date, time, courtOverrides, applyTo),
      successMsg
    );
    setModal(null);
  }

  // ─── Schedule generation: compute → preview → accept ────────────────────
  // Splits the old monolithic flow so the commissioner can review the
  // generated courts before they're written to the DB.
  //
  // `computeScheduleProposal` does no DB writes — it returns either:
  //   { error: "..." }  for validation failures (existing toast behavior), or
  //   { proposal: {...} }  for the SchedulePreview modal to render and the
  //                        commit step to consume.

  function computeScheduleProposal(leagueId, seedOverride) {
    const league = db.leagues[leagueId];
    const playerIds = getLeagueRegs(leagueId).map(r => r.playerId);
    const numCourts = league.numCourts || 4;
    const sizes = distributePlayersToCourts(playerIds.length, numCourts);
    if (!sizes) {
      const maxAllowed = numCourts * MAX_PER_COURT;
      return { error: `Cannot schedule ${playerIds.length} players. Need ${MIN_PER_COURT}–${maxAllowed} players (${MIN_PER_COURT}–${MAX_PER_COURT} per court, up to ${numCourts} court${numCourts!==1?"s":""}).` };
    }

    const isLadder = league.competitionType === "ladder";

    // Convenience: enrich each court with resolved playerNames for display.
    const withNames = (weeks) => weeks.map(w => ({
      ...w,
      courts: w.courts.map(c => ({
        ...c,
        playerNames: c.players.map(pid => getPlayerName(pid)),
      })),
    }));

    if (!isLadder) {
      // ─── Mixer: full season at once ───────────────────────────────────
      const existingWeeks = db.schedules[leagueId]?.weeks || [];
      const hasLockedWeek = existingWeeks.some(w => isWeekLocked(leagueId, w.week));
      if (hasLockedWeek) {
        return { error: "Cannot regenerate: one or more weeks are locked. Unlock all weeks first." };
      }
      const playerGenders = {};
      playerIds.forEach(pid => { playerGenders[pid] = db.players[pid]?.gender; });
      const result = generateCourtSchedule(playerIds, league.weeks, league.startDate, league.format, numCourts, playerGenders);
      if (result.error) return { error: result.error };
      const existingByWeek = {};
      existingWeeks.forEach(w => { existingByWeek[w.week] = w; });
      result.weeks = result.weeks.map(w => {
        const prev = existingByWeek[w.week];
        if (!prev) return w;
        const merged = { ...w };
        // Carry over commissioner-edited week date/time
        if (prev.date) merged.date = prev.date;
        if (prev.time) merged.time = prev.time;
        // Carry over per-court customizations by position. The generator
        // produces fresh court groups, but court *index* is stable — so the
        // commissioner's "Court 3 = 9:30 AM" sticks to Court 3 in the new
        // schedule, even though the players in Court 3 are different.
        if (prev.courts && prev.courts.length > 0) {
          merged.courts = w.courts.map((newCt, i) => {
            const prevCt = prev.courts[i];
            if (!prevCt) return newCt;
            const carried = { ...newCt };
            if (prevCt.customName) carried.customName = prevCt.customName;
            if (prevCt.time) carried.time = prevCt.time;
            return carried;
          });
        }
        return merged;
      });
      const scoresWiped = Object.keys(db.scores).filter(k => k.startsWith(`${leagueId}_`)).length;
      const courtsCount = result.weeks[0]?.courts.length || 0;
      const sz = result.weeks[0]?.courts.map(c => c.players.length) || [];
      return {
        proposal: {
          kind: "mixer",
          leagueId,
          leagueName: league.name,
          schedule: result,
          scoresWiped,
          weeks: withNames(result.weeks),
          summary: `Mixer schedule: ${courtsCount} courts (${sz.join(", ")} players) × ${league.weeks} weeks`,
          warning: scoresWiped > 0 ? `Accepting will clear ${scoresWiped} existing score${scoresWiped!==1?"s":""} from this league.` : null,
          // Mixer generation is deterministic with the current seeding (the
          // week-index folds into a fixed seed, not a random one). Retrying
          // would produce identical output, so don't offer it.
          canRetry: false,
          successToast: `Schedule generated! ${courtsCount} courts (${sz.join(", ")} players) × ${league.weeks} weeks${scoresWiped > 0 ? `, ${scoresWiped} previous score${scoresWiped!==1?"s":""} cleared` : ""}`,
        },
      };
    }

    // ─── Ladder: one week at a time ────────────────────────────────────
    const existingSched = db.schedules[leagueId] || { weeks: [] };
    const existingWeeks = existingSched.weeks || [];

    const realWeeks = existingWeeks.filter(w => !w.placeholder && w.courts.length > 0);
    const nextWeekNum = realWeeks.length + 1;

    if (nextWeekNum > league.weeks) {
      return { error: `All ${league.weeks} weeks already generated.` };
    }

    const placeholder = existingWeeks.find(w => w.week === nextWeekNum && w.placeholder);
    let dateStr, timeStr = null;
    if (placeholder) {
      dateStr = placeholder.date;
      timeStr = placeholder.time || null;
    } else {
      const weekDate = new Date(league.startDate);
      weekDate.setDate(weekDate.getDate() + (nextWeekNum - 1) * 7);
      dateStr = weekDate.toISOString().split("T")[0];
    }

    let courtGroups;
    const isFirstWeek = realWeeks.length === 0;
    if (isFirstWeek) {
      // Week 1 is random; a retry generates a fresh seed and reshuffles.
      const seed = (seedOverride ?? (Date.now() & 0xffffffff));
      const shuffled = seededShuffle(playerIds, seed);
      if (league.format === "Mixed Doubles") {
        const playerGenders = {};
        playerIds.forEach(pid => { playerGenders[pid] = db.players[pid]?.gender; });
        courtGroups = assignBalancedCourts(shuffled, sizes, playerGenders);
      } else {
        courtGroups = [];
        let idx = 0;
        for (const sz of sizes) {
          courtGroups.push(shuffled.slice(idx, idx + sz));
          idx += sz;
        }
      }
    } else {
      const prevWeek = realWeeks[realWeeks.length - 1];
      const prevLocked = isWeekLocked(leagueId, prevWeek.week);
      if (!prevLocked) {
        return { error: `Lock Week ${prevWeek.week} first, then generate Week ${nextWeekNum}.` };
      }
      const prevPlayers = new Set(prevWeek.courts.flatMap(c => c.players));
      const currentPlayers = new Set(playerIds);
      const missing = [...prevPlayers].filter(p => !currentPlayers.has(p));
      if (missing.length > 0) {
        return { error: `Cannot continue ladder: ${missing.length} player${missing.length!==1?"s":""} from last week ${missing.length!==1?"are":"is"} no longer registered. Re-register or remove them first.` };
      }
      const returning = [...currentPlayers].filter(p => !prevPlayers.has(p));

      const prevSizes = prevWeek.courts.map(c => c.players.length);
      const rotated = laddderRotate(prevWeek.courts, db.scores, leagueId, prevWeek.week, prevSizes);
      const ordered = rotated.flat();
      const fullOrder = [...ordered, ...returning];
      courtGroups = [];
      let idx = 0;
      for (const sz of sizes) {
        courtGroups.push(fullOrder.slice(idx, idx + sz));
        idx += sz;
      }
    }

    const newWeek = buildLadderWeek(courtGroups, nextWeekNum, dateStr, league.format);
    if (timeStr) newWeek.time = timeStr;
    const otherWeeks = existingWeeks.filter(w => w.week !== nextWeekNum);
    const newSched = { weeks: [...otherWeeks, newWeek].sort((a, b) => a.week - b.week) };

    return {
      proposal: {
        kind: "ladder",
        leagueId,
        leagueName: league.name,
        schedule: newSched,
        scoresWiped: 0, // ladder writes only the new week; no scores affected
        weeks: withNames([newWeek]),
        summary: isFirstWeek
          ? `Ladder Week 1 (random starting courts): ${courtGroups.length} courts (${courtGroups.map(g => g.length).join(", ")} players)`
          : `Ladder Week ${nextWeekNum} (rotated from Week ${nextWeekNum - 1}'s results): ${courtGroups.length} courts (${courtGroups.map(g => g.length).join(", ")} players)`,
        warning: null,
        // Only Week 1 ladder generation is non-deterministic; rotation is
        // fully derived from previous results, so retrying is meaningless.
        canRetry: isFirstWeek,
        successToast: `Week ${nextWeekNum} generated! ${courtGroups.length} courts (${courtGroups.map(g => g.length).join(", ")} players)`,
      },
    };
  }

  async function commitScheduleProposal(proposal) {
    if (!proposal) return;
    const { leagueId, schedule, scoresWiped, successToast } = proposal;
    await action(async () => {
      await dbWriteSchedule(leagueId, schedule);
      if (scoresWiped > 0) {
        const { error } = await supabase.from("pb_scores").delete().like("key", `${leagueId}_%`);
        if (error) throw error;
      }
    }, undefined, "commit-schedule");
    showToast(successToast);
    setModal(null);
  }

  // Entry point: opens the preview modal (or surfaces a validation error).
  function generateSchedule(leagueId) {
    const { error, proposal } = computeScheduleProposal(leagueId);
    if (error) { showToast(error, "error"); return; }
    setModal({ type: "schedulePreview", proposal });
  }

  // Re-run the proposal generator for the same league. Only meaningful when
  // the underlying generator is non-deterministic (ladder Week 1 today).
  function retryScheduleProposal() {
    const cur = modal?.proposal;
    if (!cur) return;
    const { error, proposal } = computeScheduleProposal(cur.leagueId);
    if (error) { showToast(error, "error"); return; }
    setModal({ type: "schedulePreview", proposal });
  }

  async function removePlayer(leagueId, playerId) {
    await action(() => dbRemovePlayerFromLeague(leagueId, playerId), "Player removed. Regenerate schedule.");
  }

  async function createPlayer(data) {
    let newId = null;
    const displayName = data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : data.name;
    await action(async () => {
      newId = await dbCreatePlayer(data);
    }, `Player "${displayName}" created!`);
    setModal(null);
    return newId;
  }

  async function updatePlayer(id, data) {
    await action(() => dbUpdatePlayer(id, data), "Player updated!");
    setModal(null);
  }

  async function togglePlayerPaid(playerId) {
    const p = db.players[playerId]; if (!p) return;
    await action(() => dbTogglePlayerPaid(playerId), !p.paid ? "Marked as paid!" : "Payment removed.");
  }

  // "Delete" from the players list → soft-delete (moves to trash). The
  // commissioner can restore within 30 days, or hard-delete from the trash UI.
  async function deletePlayer(playerId) {
    const p = db.players[playerId]; if (!p) return;
    await action(() => dbSoftDeletePlayer(playerId), `${formatPlayerName(p)} moved to trash. Restore from the Trash tab within 30 days.`, "soft-delete-player");
    setModal(null);
  }
  async function restorePlayer(playerId) {
    const p = db.players[playerId]; if (!p) return;
    await action(() => dbRestorePlayer(playerId), `${formatPlayerName(p)} restored.`);
    setModal(null);
  }
  async function hardDeletePlayer(playerId) {
    const p = db.players[playerId]; if (!p) return;
    await action(() => dbHardDeletePlayer(playerId), `${formatPlayerName(p)} permanently deleted.`, "hard-delete-player");
    setModal(null);
  }

  async function registerForLeague(leagueId, playerId) {
    const key = `${leagueId}_${playerId}`;
    if (db.registrations[key]) { showToast("Already registered!", "error"); return; }
    await action(() => dbRegisterForLeague(leagueId, playerId), "Registered successfully!");
    setModal(null);
  }

  async function submitScore(leagueId, week, matchId, homeScore, awayScore) {
    await action(
      () => dbWriteScore(leagueId, week, matchId, homeScore, awayScore),
      "Score submitted!",
      "submit-score"
    );
    setModal(null);
  }

  async function togglePaid(leagueId, playerId) {
    const reg = db.registrations[`${leagueId}_${playerId}`]; if (!reg) return;
    await action(() => dbToggleRegPaid(leagueId, playerId), !reg.paid ? "Marked as paid!" : "Payment removed.");
  }

  async function toggleLockWeek(leagueId, week) {
    let nowLocked = false;
    await action(async () => {
      nowLocked = await dbToggleLockWeek(leagueId, week);
    });
    showToast(nowLocked ? `Week ${week} locked.` : `Week ${week} unlocked.`);
  }

  const isWeekLocked = (leagueId, week) => !!(db.lockedWeeks?.[`${leagueId}_w${week}`]);

  async function addAdminEmail(email) {
    if (!email.trim()) return;
    let res;
    await action(async () => { res = await dbAddAdmin(email); });
    if (res?.ok) showToast(`${email.trim().toLowerCase()} added as commissioner.`);
    else if (res?.reason === "already_admin") showToast("Already a commissioner.", "error");
  }

  async function removeAdminEmail(email) {
    let res;
    await action(async () => { res = await dbRemoveAdmin(email); });
    if (res?.ok) showToast(`${email} removed.`);
    else if (res?.reason === "super_admin") showToast("Cannot remove the primary commissioner.", "error");
  }

  // Test data seeder — creates Test1..Test20 players (skips any that exist)
  async function seedTestPlayers() {
    const existingEmails = new Set(players.map(p => p.email?.toLowerCase()).filter(Boolean));
    let added = 0, skipped = 0;
    setCurrentActionId("seed-test-players");
    try {
      for (let i = 1; i <= 20; i++) {
        const email = `test${i}@test.com`;
        if (existingEmails.has(email)) { skipped++; continue; }
        await dbCreatePlayer({
          firstName: `Test${i}`,
          lastName: "Player",
          name: `Test${i} Player`,
          email,
          phone: "",
          gender: i % 2 === 0 ? "Female" : "Male",
          cscMember: false,
        });
        added++;
      }
      await reload();
      showToast(`Test players: ${added} added${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
    } catch (e) {
      console.error("[seedTestPlayers] failed:", e);
      showToast(e.message || "Failed to seed players", "error");
    } finally {
      setCurrentActionId(null);
      setModal(null);
    }
  }

  const scoreModal = modal?.type === "enterScore" && (
    <Modal title="Enter Score" onClose={() => setModal(null)}>
      <ScoreForm match={modal.match} leagueId={modal.leagueId}
        existing={getScore(modal.leagueId, modal.match.week, modal.match.id)}
        getPlayerName={getPlayerName}
        onSubmit={(h, a) => submitScore(modal.leagueId, modal.match.week, modal.match.id, h, a)}
        onClose={() => setModal(null)} />
    </Modal>
  );

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (view === "home") {
    return (
      <ActionPendingProvider value={currentActionId}>
        <PullToRefresh onRefresh={refresh} isRefreshing={currentActionId === "refresh"}>
        <HomeView leagues={leagues} players={players} db={db}
          onAdmin={(email) => { setAdminEmail(email); setView("admin"); }}
          onPlayerLogin={p => {
            // Remember this email on this device for next time, even if the
            // user later logs out. The login screen will pre-fill it.
            if (p?.email) saveLastEmail(p.email);
            setCurrentPlayer(p);
            setView("player");
          }}
          onCreatePlayer={createPlayer} toast={toast} modal={modal} setModal={setModal}
          registerForLeague={registerForLeague} />
        </PullToRefresh>
      </ActionPendingProvider>
    );
  }

  // ─── COMMISSIONER ─────────────────────────────────────────────────────────
  if (view === "admin") {
    // If the active league was soft-deleted (own action or another tab),
    // treat it as null so the admin falls back to the leagues list.
    const rawLeague = selectedLeague ? db.leagues[selectedLeague] : null;
    const league = rawLeague && !rawLeague.deletedAt ? rawLeague : null;
    const c = league ? (COLORS[league.color] || COLORS.csc) : COLORS.teal;
    return (
      <ActionPendingProvider value={currentActionId}>
        <PullToRefresh onRefresh={refresh} isRefreshing={currentActionId === "refresh"}>
        <div style={S.page}>
          <Toast toast={toast} />
        {scoreModal}
        {modal?.type === "createLeague" && <Modal title="Create League" onClose={() => setModal(null)}><LeagueForm onSubmit={createLeague} onCancel={() => setModal(null)} /></Modal>}
        {modal?.type === "editLeague" && <Modal title="Edit League" onClose={() => setModal(null)}><LeagueForm initial={modal.league} onSubmit={d => updateLeague(modal.league.id, d)} onCancel={() => setModal(null)} /></Modal>}
        {modal?.type === "addPlayerToLeague" && <Modal title="Add Player to League" onClose={() => setModal(null)}><AddPlayerToLeague players={players} leagueId={modal.leagueId} existing={getLeagueRegs(modal.leagueId).map(r => r.playerId)} onRegister={registerForLeague} onCreatePlayer={createPlayer} onClose={() => setModal(null)} /></Modal>}
        {modal?.type === "createPlayer" && <Modal title="Create Player" onClose={() => setModal(null)}><PlayerForm onSubmit={createPlayer} onCancel={() => setModal(null)} /></Modal>}
        {modal?.type === "editPlayer" && <Modal title="Edit Player" onClose={() => setModal(null)}><PlayerForm initial={modal.player} onSubmit={d => updatePlayer(modal.player.id, d)} onCancel={() => setModal(null)} /></Modal>}
        {modal?.type === "seedPlayers" && (
          <Modal title="Seed Test Players" onClose={() => setModal(null)}>
            <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>
              This will add up to 20 test players (Test1–Test20) with emails test1@test.com through test20@test.com. Any that already exist will be skipped.
            </p>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 12px", marginBottom: 16, fontSize: 13 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Players to be added:</p>
              {Array.from({length: 20}, (_, i) => i + 1).map(i => (
                <span key={i} style={{ display: "inline-block", margin: "2px 4px 2px 0", ...S.badge("info"), fontSize: 10 }}>Test{i}</span>
              ))}
            </div>
            <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("secondary")} onClick={() => setModal(null)}>Cancel</button>
              <button style={S.btn("primary")} onClick={seedTestPlayers}>Add Test Players</button>
            </div>
          </Modal>
        )}
        {modal?.type === "confirmDelete" && (
          <Modal title="Move League to Trash" onClose={() => setModal(null)}>
            <p style={{ fontSize: 15, margin: "0 0 12px" }}>Move <b>{modal.league.name}</b> to the trash?</p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 20px" }}>
              The league will be hidden from players immediately. You can restore it from the Trash tab within 30 days. After that, it will be permanently deleted along with its registrations, schedule, and scores.
            </p>
            <div style={S.row}>
              <button
                style={{ ...S.btn("primary"), background: "#A32D2D", minWidth: 140 }}
                onClick={() => doDeleteLeague(modal.league.id)}
                disabled={currentActionId === "soft-delete-league"}>
                {currentActionId === "soft-delete-league" ? <><Spinner /> Moving…</> : "Move to Trash"}
              </button>
              <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "soft-delete-league"}>Cancel</button>
            </div>
          </Modal>
        )}
        {modal?.type === "confirmRebalance" && (() => {
          const w = modal.weekData;
          const lid = modal.leagueId;
          const regsForLeague = getLeagueRegs(lid);
          let inCount = 0, subCount = 0, maybeCount = 0, outCount = 0, noneCount = 0;
          regsForLeague.forEach(r => {
            const ci = getCheckIn(lid, w.week, r.playerId);
            const s = ci?.status;
            if (s === "in") inCount++;
            else if (s === "sub") subCount++;
            else if (s === "maybe") maybeCount++;
            else if (s === "out") outCount++;
            else noneCount++;
          });
          const activeCount = inCount + subCount + maybeCount + noneCount;
          const existingScoresCount = (w.courts || [])
            .flatMap(ct => ct.matches)
            .filter(m => db.scores[`${lid}_${w.week}_${m.id}`])
            .length;
          return (
            <Modal title={`Rebalance Week ${w.week}`} onClose={() => setModal(null)}>
              <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--color-text-secondary)" }}>
                Rebuild the court assignments for this week based on current RSVP status.
                Players marked <b>OUT</b> are removed; everyone else (including no-response) stays in.
              </p>
              <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 12px", marginBottom: 12, fontSize: 13 }}>
                <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Headcount for Week {w.week}:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ ...S.badge("success"), fontSize: 11 }}>✓ {inCount} in</span>
                  {subCount > 0 && <span style={{ ...S.badge("purple"), fontSize: 11 }}>↔ {subCount} sub</span>}
                  <span style={{ ...S.badge("warning"), fontSize: 11 }}>? {maybeCount} maybe</span>
                  <span style={{ ...S.badge("danger"), fontSize: 11 }}>✗ {outCount} out</span>
                  {noneCount > 0 && <span style={{ ...S.badge("info"), fontSize: 11 }}>• {noneCount} no reply</span>}
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 600 }}>
                  {activeCount} player{activeCount!==1?"s":""} will be assigned to courts.
                </p>
              </div>
              {existingScoresCount > 0 && (
                <div style={{ padding: "12px 12px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                  ⚠ This week has {existingScoresCount} score{existingScoresCount!==1?"s":""} already entered. All will be cleared because the matches will be different after rebalancing.
                </div>
              )}
              <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
                <button style={S.btn("secondary")} onClick={() => setModal(null)}>Cancel</button>
                <button style={{ ...S.btn("primary"), background: "#534AB7" }} onClick={() => rebalanceWeek(lid, w.week)}>Rebalance</button>
              </div>
            </Modal>
          );
        })()}
        {modal?.type === "editWeek" && (() => {
          const w = modal.weekData;
          const lg = db.leagues[modal.leagueId];
          return (
            <Modal title={`Edit Week ${w.week}`} onClose={() => setModal(null)}>
              <EditWeekForm
                weekData={w}
                league={lg}
                onSubmit={(date, time, courtOverrides, applyTo) =>
                  updateWeekDateTime(modal.leagueId, w.week, date, time, courtOverrides, applyTo)
                }
                onCancel={() => setModal(null)} />
            </Modal>
          );
        })()}
        {modal?.type === "schedulePreview" && (
          <Modal title={`Review Schedule · ${modal.proposal.leagueName}`} onClose={() => setModal(null)}>
            <SchedulePreview
              preview={modal.proposal}
              league={db.leagues[modal.proposal.leagueId]}
              onAccept={() => commitScheduleProposal(modal.proposal)}
              onRetry={retryScheduleProposal}
              onCancel={() => setModal(null)} />
          </Modal>
        )}
        {modal?.type === "confirmDeletePlayer" && (() => {
          const p = modal.player;
          // Live leagues only — trashed leagues don't matter for the warning.
          const playerLeagues = Object.values(db.registrations)
            .filter(r => r.playerId === p.id)
            .map(r => db.leagues[r.leagueId])
            .filter(l => l && !l.deletedAt);
          return (
            <Modal title="Move Player to Trash" onClose={() => setModal(null)}>
              <p style={{ fontSize: 15, margin: "0 0 12px" }}>
                Move <b>{formatPlayerName(p)}</b> ({p.email}) to the trash?
              </p>
              {playerLeagues.length > 0 && (
                <div style={{ padding: "12px 12px", marginBottom: 16, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  Registered in {playerLeagues.length} league{playerLeagues.length!==1?"s":""}:
                  <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                    {playerLeagues.map(l => <li key={l.id} style={{ marginBottom: 4 }}>{l.name}</li>)}
                  </ul>
                  <p style={{ margin: "8px 0 0", fontSize: 12 }}>
                    Their registrations stay intact — if you restore them within 30 days, they'll snap back into these leagues automatically.
                  </p>
                </div>
              )}
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>
                The player will be hidden from rosters and unable to log in. You can restore from the Trash tab within 30 days; after that they'll be permanently deleted along with their registrations and check-ins.
              </p>
              <div style={S.row}>
                <button
                  style={{ ...S.btn("primary"), background: "#A32D2D", minWidth: 140 }}
                  onClick={() => deletePlayer(p.id)}
                  disabled={currentActionId === "soft-delete-player"}>
                  {currentActionId === "soft-delete-player" ? <><Spinner /> Moving…</> : "Move to Trash"}
                </button>
                <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "soft-delete-player"}>Cancel</button>
              </div>
            </Modal>
          );
        })()}
        {modal?.type === "confirmHardDeleteLeague" && (
          <Modal title="Delete League Forever" onClose={() => setModal(null)}>
            <p style={{ fontSize: 15, margin: "0 0 12px" }}>
              Permanently delete <b>{modal.league.name}</b>?
            </p>
            <p style={{ fontSize: 13, color: "#A32D2D", margin: "0 0 20px" }}>
              This removes the league plus all its registrations, schedule, scores, locked weeks, and check-ins. This action cannot be undone.
            </p>
            <div style={S.row}>
              <button
                style={{ ...S.btn("primary"), background: "#A32D2D", minWidth: 150 }}
                onClick={() => hardDeleteLeague(modal.league.id)}
                disabled={currentActionId === "hard-delete-league"}>
                {currentActionId === "hard-delete-league" ? <><Spinner /> Deleting…</> : "Delete Forever"}
              </button>
              <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "hard-delete-league"}>Cancel</button>
            </div>
          </Modal>
        )}
        {modal?.type === "confirmHardDeletePlayer" && (
          <Modal title="Delete Player Forever" onClose={() => setModal(null)}>
            <p style={{ fontSize: 15, margin: "0 0 12px" }}>
              Permanently delete <b>{formatPlayerName(modal.player)}</b>?
            </p>
            <p style={{ fontSize: 13, color: "#A32D2D", margin: "0 0 20px" }}>
              This removes the player plus all their registrations and check-ins. This action cannot be undone.
            </p>
            <div style={S.row}>
              <button
                style={{ ...S.btn("primary"), background: "#A32D2D", minWidth: 150 }}
                onClick={() => hardDeletePlayer(modal.player.id)}
                disabled={currentActionId === "hard-delete-player"}>
                {currentActionId === "hard-delete-player" ? <><Spinner /> Deleting…</> : "Delete Forever"}
              </button>
              <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "hard-delete-player"}>Cancel</button>
            </div>
          </Modal>
        )}

        <div style={S.header(league ? c.bg : undefined)} className="pwa-safe-top pwa-safe-x">
          <div style={S.row}>
            <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0" }} onClick={() => { if (league) setSelectedLeague(null); else setView("home"); }}>←</button>
            <h1 style={S.logo}>{league ? league.name : "Commissioner Panel"}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, opacity: 0.65 }}>{adminEmail}</span>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{saving ? "Saving…" : "●"}</span>
            <RefreshButton onClick={refresh} isRefreshing={currentActionId === "refresh"} disabled={!!currentActionId && currentActionId !== "refresh"} />
            {currentPlayer && (
              <button
                style={{ ...S.btnSm("secondary"), background: "rgba(255,255,255,0.2)", border: "0.5px solid rgba(255,255,255,0.5)", color: "#fff", fontSize: 11 }}
                onClick={() => { setSelectedLeague(null); setView("player"); }}
                title="Switch back to player view">
                👤 Player Mode
              </button>
            )}
            <button style={{ ...S.btnSm("secondary"), background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 11 }} onClick={logout}>Log Out</button>
          </div>
        </div>

        {league ? (
          <LeagueDetail league={league} db={db} regs={getLeagueRegs(league.id)} schedule={getLeagueSchedule(league.id)}
            getScore={getScore} getPlayerName={getPlayerName}
            getStandings={() => getStandings(league.id)}
            getCheckIn={getCheckIn}
            onEdit={() => setModal({ type: "editLeague", league })}
            onDelete={() => setModal({ type: "confirmDelete", league })}
            onToggleArchive={() => toggleArchiveLeague(league.id)}
            onGenerate={() => generateSchedule(league.id)}
            onAddPlayer={() => setModal({ type: "addPlayerToLeague", leagueId: league.id })}
            onRemovePlayer={pid => removePlayer(league.id, pid)}
            onTogglePaid={pid => togglePaid(league.id, pid)}
            onToggleLockWeek={(week) => toggleLockWeek(league.id, week)}
            isWeekLocked={(week) => isWeekLocked(league.id, week)}
            onEnterScore={match => setModal({ type: "enterScore", match, leagueId: league.id })}
            onEditWeekDateTime={weekData => setModal({ type: "editWeek", leagueId: league.id, weekData })}
            onRebalanceWeek={weekData => setModal({ type: "confirmRebalance", leagueId: league.id, weekData })} />
        ) : (
          <>
            <div style={S.tabBar}>
              {[["leagues","Leagues"],["players","Players"],["admins","Commissioners"],["trash","Trash"]].map(([k,label]) => {
                const showCount = k === "trash" && (trashedLeagues.length + trashedPlayers.length) > 0;
                return (
                  <button key={k} style={S.tab(adminTab===k)} onClick={() => setAdminTab(k)}>
                    {label}
                    {showCount && (
                      <span style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10, fontWeight: 700, borderRadius: 999, background: "#A32D2D", color: "#fff" }}>
                        {trashedLeagues.length + trashedPlayers.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {adminTab === "leagues" && (
              <div style={S.section}>
                <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 17 }}>All Leagues</h2>
                  <button style={S.btn("primary")} onClick={() => setModal({ type: "createLeague" })}>+ New League</button>
                </div>
                {leagues.length === 0 && <EmptyState msg="No leagues created yet." />}
                {leagues.length > 0 && (() => {
                  const groups = [
                    { key: "open",      label: "Registering" },
                    { key: "active",    label: "Active" },
                    { key: "completed", label: "Closed" },
                    { key: "archived",  label: "Archived" },
                  ];
                  return groups.map(group => {
                    const inGroup = sortLeagues(leagues.filter(l => (l.status || "open") === group.key));
                    if (inGroup.length === 0) return null;
                    return (
                      <div key={group.key} style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, padding: "0 2px" }}>
                          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            {group.label}
                          </h3>
                          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({inGroup.length})</span>
                        </div>
                        {inGroup.map(l => {
                          const lc = COLORS[l.color] || COLORS.csc;
                          const regs = getLeagueRegs(l.id);
                          const sched = getLeagueSchedule(l.id);
                          const archived = l.status === "archived";
                          return (
                            <div key={l.id} style={{ ...S.card, cursor: "pointer", borderLeft: `4px solid ${lc.bg}`, opacity: archived ? 0.6 : 1 }} onClick={() => setSelectedLeague(l.id)}>
                              <div style={S.row}>
                                <div style={{ flex: 1 }}>
                                  <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 16 }}>{l.name}</p>
                                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>{regs.length} players · {l.weeks} weeks · {sched.weeks?.length > 0 ? `${sched.weeks.length} weeks scheduled` : "No schedule yet"}</p>
                                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>Start: {formatDate(l.startDate)} · {l.gender || "Mixed"} · {l.format || "Singles"}</p>
                                </div>
                                <span style={{ fontSize: 20, color: lc.bg }}>›</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
            {adminTab === "players" && (
              <div style={S.section}>
                <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 17 }}>All Players</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...S.btnSm("secondary"), fontSize: 12 }} onClick={() => setModal({ type: "seedPlayers" })}>🧪 Seed Test Players</button>
                    <button style={S.btn("primary")} onClick={() => setModal({ type: "createPlayer" })}>+ New Player</button>
                  </div>
                </div>
                {players.length === 0 && <EmptyState msg="No players registered yet." />}
                {players.map(p => (
                  <div key={p.id} style={S.card}>
                    <div style={{ ...S.row, marginBottom: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 16, flexShrink: 0 }}>{playerInitial(p)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4 }}>
                          <p style={{ margin: 0, fontWeight: 600 }}>{formatPlayerName(p)}</p>
                          {p.gender && <span style={{ ...S.badge("info"), fontSize: 10 }}>{p.gender}</span>}
                          {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC Member</span>}
                          {p.paid ? <span style={{ ...S.badge("success"), fontSize: 10 }}>Paid</span> : <span style={{ ...S.badge("warning"), fontSize: 10 }}>Unpaid</span>}
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                      </div>
                    </div>
                    <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 10 }}>
                      <button
                        style={p.paid ? { ...S.btnSm("secondary"), color: "#854F0B", borderColor: "#854F0B", fontSize: 11 } : { ...S.btnSm("primary"), background: "#3B6D11", fontSize: 11 }}
                        onClick={() => togglePlayerPaid(p.id)}>
                        {p.paid ? "Undo Payment" : "Mark as Paid"}
                      </button>
                      <button style={S.btnSm("secondary")} onClick={() => setModal({ type: "editPlayer", player: p })}>Edit</button>
                      <button
                        style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11 }}
                        onClick={() => setModal({ type: "confirmDeletePlayer", player: p })}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {adminTab === "admins" && (
              <AdminsTab
                adminEmails={db.adminEmails || [SUPER_ADMIN]}
                currentAdminEmail={adminEmail}
                isSuperAdmin={adminEmail?.toLowerCase() === SUPER_ADMIN.toLowerCase()}
                onAdd={addAdminEmail}
                onRemove={removeAdminEmail}
              />
            )}
            {adminTab === "trash" && (
              <TrashTab
                trashedLeagues={trashedLeagues}
                trashedPlayers={trashedPlayers}
                onRestoreLeague={l => restoreLeague(l.id)}
                onRestorePlayer={p => restorePlayer(p.id)}
                onHardDeleteLeague={l => setModal({ type: "confirmHardDeleteLeague", league: l })}
                onHardDeletePlayer={p => setModal({ type: "confirmHardDeletePlayer", player: p })}
              />
            )}
          </>
        )}
        <VersionFooter />
        </div>
        </PullToRefresh>
      </ActionPendingProvider>
    );
  }

  // ─── PLAYER ───────────────────────────────────────────────────────────────
  if (view === "player") {
    const myRegs = Object.values(db.registrations).filter(r => r.playerId === currentPlayer.id);
    // Hide trashed leagues from the player view entirely — if a commissioner
    // accidentally deleted a league, players shouldn't see it half-broken.
    const myLeagues = sortLeagues(
      myRegs.map(r => db.leagues[r.leagueId]).filter(l => l && !isTrashed(l))
    );
    const playerGender = currentPlayer.gender;
    const unregistered = leagues.filter(l => {
      if (myRegs.find(r => r.leagueId === l.id)) return false;
      if ((l.status || "open") !== "open") return false;
      const leagueGender = l.gender || "Mixed";
      if (leagueGender === "Mixed") return true;
      if (leagueGender === "Men's") return playerGender === "Male";
      if (leagueGender === "Women's") return playerGender === "Female";
      return false;
    });
    return (
      <ActionPendingProvider value={currentActionId}>
        <PlayerView db={db} player={currentPlayer} myLeagues={myLeagues} unregistered={unregistered}
          playerTab={playerTab} setPlayerTab={setPlayerTab} modal={modal} setModal={setModal} toast={toast}
          getLeagueSchedule={getLeagueSchedule} getScore={getScore} getPlayerName={getPlayerName}
          getStandings={getStandings} registerForLeague={registerForLeague} submitScore={submitScore}
          isWeekLocked={isWeekLocked}
          getCheckIn={getCheckIn} setCheckIn={setCheckIn}
          adminEmails={db.adminEmails || [SUPER_ADMIN]}
          onSwitchToAdmin={() => { setAdminEmail(currentPlayer.email.toLowerCase()); setView("admin"); }}
          onLogout={logout} scoreModal={scoreModal}
          onRefresh={refresh} isRefreshing={currentActionId === "refresh"} />
      </ActionPendingProvider>
    );
  }
}
