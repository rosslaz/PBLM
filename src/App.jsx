import { useState, useEffect, useCallback } from "react";

import { COLORS, CSC, MIN_PER_COURT, MAX_PER_COURT, courtName } from "./lib/constants.js";
import { formatDate, formatPlayerName, playerInitial, playerFitsLeagueGender, formatPhone } from "./lib/format.js";
import { useIsMobile, sortLeagues, loadSession, saveSession, saveLastEmail, loadLastClub, saveLastClub } from "./lib/session.js";
import {
  isClubOwner, isClubAdmin,
  getClubsForPlayer, getClubsWhereAdmin, getClubMemberIds,
  resolveActiveClub, generateJoinCode,
} from "./lib/clubs.js";
import {
  loadDB, loadCachedDB, defaultDB,
  dbCreateLeague, dbUpdateLeague,
  dbSoftDeleteLeague, dbRestoreLeague, dbHardDeleteLeague, dbDeleteLeagueScores,
  dbCreatePlayer, dbUpdatePlayer,
  dbSoftDeletePlayer, dbRestorePlayer, dbHardDeletePlayer,
  dbRegisterForLeague, dbRemovePlayerFromLeague, dbToggleRegPaid,
  dbWriteSchedule, dbWriteScore, dbWriteWeekDateTime, dbRebalanceWeek,
  dbToggleLockWeek, dbSetCheckIn,
  dbAddClubAdmin, dbRemoveClubAdmin, dbCreateMembership, dbCreateClub,
  dbUpdateClub, dbTransferOwnership, dbSoftDeleteClub,
} from "./lib/supabase.js";
import {
  distributePlayersToCourts, seededShuffle,
  generateCourtSchedule, assignBalancedCourts, laddderRotate, buildLadderWeek,
  buildCourtMatches, generateDDPartnersSchedule, DD_PARTNERS_PLAYERS, DD_PARTNERS_WEEKS,
} from "./lib/scheduling.js";
import { S, genderBadgeStyle } from "./styles.js";

import { Modal, Toast, EmptyState, VersionFooter, RefreshButton, PullToRefresh } from "./components/ui.jsx";
import { UpdateBanner, OfflineBanner } from "./components/StatusBanners.jsx";
import { PlayerForm } from "./components/PlayerForm.jsx";
import { LeagueForm } from "./components/LeagueForm.jsx";
import { EditWeekForm } from "./components/EditWeekForm.jsx";
import { ScoreForm } from "./components/ScoreForm.jsx";
import { AddPlayerToLeague } from "./components/AddPlayerToLeague.jsx";
import { LeagueContactsModal } from "./components/LeagueContactsModal.jsx";
import { LeagueDetail } from "./components/LeagueDetail.jsx";
import { AdminsTab } from "./components/AdminsTab.jsx";
import { ClubSettingsTab } from "./components/ClubSettingsTab.jsx";
import { ClubSwitcher } from "./components/ClubSwitcher.jsx";
import { TrashTab } from "./components/TrashTab.jsx";
import { SchedulePreview } from "./components/SchedulePreview.jsx";
import { HomeView } from "./components/HomeView.jsx";
import { PlayerView } from "./components/PlayerView.jsx";
import { ActionPendingProvider, Spinner } from "./components/Spinner.jsx";

// ─── Score toast picker ────────────────────────────────────────────────────
// The "Score submitted!" toast is generic. For the common case — a player
// just finished their own match and entered the score — it's much warmer
// to acknowledge their win or loss. We only celebrate when we're sure the
// submitter played in the match. Anyone else (commissioner-only logged in,
// or a player entering for a court they're not on) gets the neutral copy.
function buildScoreToast(match, homeScore, awayScore, currentPlayer) {
  if (!currentPlayer || !match) return "Score submitted!";
  const sideA = match.format === "doubles" ? (match.team1 || []) : [match.home];
  const sideB = match.format === "doubles" ? (match.team2 || []) : [match.away];
  const onSideA = sideA.includes(currentPlayer.id);
  const onSideB = sideB.includes(currentPlayer.id);
  if (!onSideA && !onSideB) return "Score submitted!";
  const aWon = +homeScore > +awayScore;
  const myWin = (onSideA && aWon) || (onSideB && !aWon);
  return myWin
    ? "🎉 Nice win! Score submitted."
    : "Score submitted — get 'em next time!";
}

// ─── Type-to-confirm helper for Delete Club ────────────────────────────────
// The "Delete Club" modal renders this so the user must type the word
// "delete" (case-insensitive) before the destructive button activates.
// We use a short fixed word rather than the club name because club names
// can be long ("Birmingham Country Club Pickleball League"); typing the
// whole thing on mobile is friction without a meaningful safety gain.
function DeleteClubConfirm({ onConfirm, onCancel, saving }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === "delete";
  return (
    <>
      <label style={S.label}>Type <b>delete</b> below to confirm</label>
      <input
        style={{ ...S.input, marginBottom: 16 }}
        type="text"
        value={typed}
        onChange={e => setTyped(e.target.value)}
        placeholder="delete"
        autoFocus
        autoComplete="off"
      />
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onCancel} disabled={saving}>Cancel</button>
        <button
          style={{ ...S.btn("primary"), background: "#A32D2D", minWidth: 150, opacity: matches ? 1 : 0.5 }}
          onClick={onConfirm}
          disabled={!matches || saving}>
          {saving ? <><Spinner /> Deleting…</> : "Delete forever"}
        </button>
      </div>
    </>
  );
}

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
  // Phase 2 / v1.1.0 — multi-tenancy. The "active club" determines what
  // leagues, rosters, and admin permissions the rest of the UI sees.
  // It's resolved at session restore (or login) from saved state +
  // memberships, and the player can switch later (Phase 3 club switcher).
  const [activeClubId, setActiveClubId] = useState(null);
  const [sessionRestored, setSessionRestored] = useState(false);
  // v1.5.0 — offline mode. null when we're showing live data; an epoch-ms
  // timestamp when we're rendering the cached localStorage snapshot because
  // the live fetch failed. Drives <OfflineBanner /> and nothing else — the
  // write block is a separate, independent check on navigator.onLine, so a
  // stale snapshot can never be the basis for a mutation even if this state
  // somehow got out of sync.
  const [snapshotAge, setSnapshotAge] = useState(null);
  // v1.8.0 — lifted out of <UpdateBanner> so this component knows whether a
  // banner is on screen. That matters for iOS safe-area handling: whichever
  // element is topmost has to pad for the notch, and it's the banner stack
  // when a banner is showing, the header otherwise.
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    function onUpdateReady() { setUpdateReady(true); }
    window.addEventListener("pwa:update-ready", onUpdateReady);
    return () => window.removeEventListener("pwa:update-ready", onUpdateReady);
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  function logout() {
    setCurrentPlayer(null);
    setAdminEmail(null);
    setSelectedLeague(null);
    setActiveClubId(null);
    setView("home");
    saveSession(null);
    showToast("Logged out");
  }

  // Re-fetch live state. On success we're definitionally back online, so
  // clear the offline flag. On failure we keep whatever we're already showing
  // (live or cached) rather than blanking the UI — a failed refresh shouldn't
  // destroy the data the user is looking at.
  const reload = useCallback(async () => {
    try {
      const fresh = await loadDB();
      setDB(fresh);
      setSnapshotAge(null);
    } catch (e) {
      console.error("[reload] failed:", e);
      showToast("Database error — see console", "error");
    }
  }, []);

  // Initial load. Three outcomes:
  //   1. Live fetch works                  → render live data
  //   2. Live fetch fails, cache exists    → render cached snapshot + banner
  //   3. Live fetch fails, no cache        → empty state + error toast
  //
  // Case 2 is the offline path: the service worker served the app shell from
  // cache, React booted, but Supabase is unreachable. We show the last known
  // state read-only rather than an infinite spinner.
  useEffect(() => {
    (async () => {
      try {
        const fresh = await loadDB();
        setDB(fresh);
        setSnapshotAge(null);
      } catch (e) {
        console.error("[initial load] failed:", e);
        const cached = loadCachedDB();
        if (cached) {
          console.log("[initial load] falling back to cached snapshot from", new Date(cached.cachedAt));
          setDB(cached.snapshot);
          setSnapshotAge(cached.cachedAt);
        } else {
          setDB(defaultDB());
          showToast("Could not load data — check your connection", "error");
        }
      }
    })();
  }, []);

  // When the browser regains connectivity, quietly try to get back to live
  // data. No toast on failure — this fires on flaky networks and nagging the
  // user about every blip is worse than silently staying on the snapshot.
  useEffect(() => {
    function onOnline() {
      if (snapshotAge === null) return; // already live
      (async () => {
        try {
          const fresh = await loadDB();
          setDB(fresh);
          setSnapshotAge(null);
          showToast("Back online — data refreshed.");
        } catch (e) {
          console.warn("[online] refresh failed, staying on snapshot:", e);
        }
      })();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [snapshotAge]);

  // Restore login session once db is loaded.
  // For Phase 2 the admin check is club-scoped: a saved adminEmail is
  // accepted only if it's an owner/admin of at least one club. The active
  // club is then resolved from saved id + accessible clubs.
  useEffect(() => {
    if (!db || sessionRestored) return;
    const sess = loadSession();
    // Block session restore for trashed players — they shouldn't log back in
    // just because a saved session is still in localStorage.
    const savedPlayer = sess.playerId ? db.players[sess.playerId] : null;
    const playerIsLive = savedPlayer && !savedPlayer.deletedAt;

    // Compute which clubs are accessible to this restored session so we
    // can pick an active club.
    const candidates = [];
    if (playerIsLive) {
      getClubsForPlayer(db.memberships, db.clubs, savedPlayer.id)
        .forEach(c => candidates.push(c));
    }
    if (sess.adminEmail) {
      // Admin clubs may overlap with member clubs — dedupe by id.
      const adminClubs = getClubsWhereAdmin(db.clubs, sess.adminEmail);
      adminClubs.forEach(c => {
        if (!candidates.find(x => x.id === c.id)) candidates.push(c);
      });
    }
    const resolved = resolveActiveClub(sess.activeClubId || loadLastClub(), candidates);

    if (sess.playerId && playerIsLive) {
      setCurrentPlayer(savedPlayer);
      // Admin-email-on-player session: accept it only if that email actually
      // has admin/owner rights in some accessible club. Otherwise drop back
      // to plain player view.
      const adminClubs = sess.adminEmail
        ? getClubsWhereAdmin(db.clubs, sess.adminEmail)
        : [];
      if (sess.adminEmail && adminClubs.length > 0) {
        setAdminEmail(sess.adminEmail);
        setView(sess.view === "admin" ? "admin" : "player");
      } else {
        setView("player");
      }
    } else if (sess.adminEmail) {
      // Admin-only session (no player record). Restore only if there's at
      // least one club where this email is owner/admin.
      const adminClubs = getClubsWhereAdmin(db.clubs, sess.adminEmail);
      if (adminClubs.length > 0) {
        setAdminEmail(sess.adminEmail);
        setView("admin");
      }
    }
    setActiveClubId(resolved?.id || null);
    setSessionRestored(true);
  }, [db, sessionRestored]);

  useEffect(() => {
    if (!sessionRestored) return;
    if (currentPlayer || adminEmail) {
      saveSession({
        playerId: currentPlayer?.id || null,
        adminEmail: adminEmail || null,
        activeClubId: activeClubId || null,
        view,
      });
    } else {
      saveSession(null);
    }
  }, [currentPlayer, adminEmail, activeClubId, view, sessionRestored]);

  // Remember the active club independently of the session, so it survives
  // logout. Deliberately NOT cleared by logout() — that's the whole point:
  // signing back in should return you to the club you were last using rather
  // than whichever one happens to sort first.
  useEffect(() => {
    if (!sessionRestored) return;
    if (activeClubId) saveLastClub(activeClubId);
  }, [activeClubId, sessionRestored]);

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
  //
  // v1.5.0 — OFFLINE HARD BLOCK. Every mutation funnels through here, so this
  // one guard covers the entire app. If we're offline we refuse the write
  // outright rather than letting it fail at the network layer.
  //
  // Why block instead of queue: this app is write-first/read-back — a write is
  // only real once the server confirms it and we re-read. Queueing mutations
  // would mean showing the user a change that hasn't happened yet, then
  // reconciling later, which needs conflict resolution and ordering guarantees
  // that don't exist here. A clear "you're offline, this didn't save" is
  // honest; an optimistic write that silently loses is not. Offline is
  // read-only, by design.
  //
  // navigator.onLine is a coarse signal (true can still mean "no route to
  // Supabase"), which is fine: it's a UX guard, not a security boundary. When
  // it's wrong in the optimistic direction the write proceeds and the existing
  // catch below surfaces the real network error.
  async function action(fn, successMsg, actionId) {
    if (!navigator.onLine) {
      showToast("You're offline — changes can't be saved right now.", "error");
      return;
    }
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
  //
  // Note this is NOT blocked when offline: retrying is exactly what you want
  // to do when you think you're back on the network, and reload() handles the
  // failure case gracefully by keeping the current data.
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

  // Status bars rendered at the top of every view. The wrapper only exists
  // when something is actually showing — an empty one would still claim the
  // iOS safe-area inset and leave a dead strip under the status bar.
  //
  // `hasBanner` is also handed to the headers below so they can drop their
  // own inset: only the topmost element should pad for the notch.
  const hasBanner = updateReady || snapshotAge !== null;
  const statusBanners = hasBanner ? (
    <div className="pwa-banner-stack">
      <UpdateBanner
        ready={updateReady}
        onDismiss={() => setUpdateReady(false)} />
      <OfflineBanner
        cachedAt={snapshotAge}
        onRetry={refresh}
        isRetrying={currentActionId === "refresh"} />
    </div>
  ) : null;

  // Header top-padding class: the banner stack owns the notch inset when
  // it's present, so the header falls back to plain padding.
  const headerTopClass = hasBanner ? "pwa-has-banner" : "pwa-safe-top";

  // Split records by whether they've been soft-deleted. `leagues`/`players`
  // are the live ones every existing view reads from; trashed records are only
  // surfaced in the Trash tab. By-ID lookups (`db.leagues[id]`, `db.players[id]`)
  // still work for both — important so the Trash UI can read them and so any
  // stale references resolve.
  const isTrashed = r => !!r?.deletedAt;
  const allLeagues = Object.values(db.leagues);
  const allPlayers = Object.values(db.players);

  // Phase 2 / v1.1.0 — multi-tenancy. The "active club" determines which
  // leagues and players the rest of the UI sees. Everything below `leagues`
  // and `players` (rosters, standings, the commissioner panel) reads from
  // the filtered view. `allLeagues` and `allPlayers` are still available
  // for places that need cross-club visibility (currently only TrashTab,
  // which is scoped to live records in the active club too — see below).
  //
  // `db.players[id]` is a *global* identity lookup — getPlayerName et al.
  // must work for any player ID that appears in old scores/schedules, even
  // if that player isn't in the active club anymore. So we don't filter the
  // lookup itself, just the roster used for listing/filtering UIs.
  const activeClub = activeClubId ? db.clubs?.[activeClubId] : null;
  const clubMemberIds = activeClubId
    ? getClubMemberIds(db.memberships || {}, activeClubId)
    : new Set();

  // Phase 4 / v1.3.0 — list of clubs accessible to the current session,
  // used by the club switcher in the header. Combines membership clubs
  // (for players) with owner/admin clubs (for commissioners). A user who
  // is both a member and an admin of the same club only appears once.
  // Deleted clubs are filtered out by the underlying helpers.
  const accessibleClubs = (() => {
    const out = [];
    if (currentPlayer) {
      getClubsForPlayer(db.memberships || {}, db.clubs || {}, currentPlayer.id)
        .forEach(c => out.push(c));
    }
    if (adminEmail) {
      getClubsWhereAdmin(db.clubs || {}, adminEmail).forEach(c => {
        if (!out.find(x => x.id === c.id)) out.push(c);
      });
    }
    // Stable display order: alphabetical by name. Matches the player's
    // mental model better than createdAt, since they'll be picking by
    // name, not by when the club was made.
    return out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  })();

  const leagues = allLeagues.filter(l =>
    !isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
  );
  // A player belongs to the active club iff there's a live membership row.
  // Players without a club membership are filtered out of the roster but
  // still resolvable via db.players[id].
  //
  // BUGFIX (v1.3.0): when no club is active (home screen, pre-login), we
  // fall back to ALL non-trashed players. Without this, `players` is empty
  // on the home screen and HomeView's email-login lookup fails for every
  // address — which is the symptom that showed up as "No player found with
  // that email" right after Phase 2 shipped. The fallback parallels how
  // `leagues` above gracefully includes everything when activeClubId is
  // null. Once the user logs in, activeClubId becomes set and we narrow
  // back to the active club's roster, which is correct for the
  // commissioner Players tab.
  const players = allPlayers.filter(p =>
    !isTrashed(p) && (!activeClubId || clubMemberIds.has(p.id))
  );
  // Trash views are scoped to the active club too — a CSC admin doesn't
  // see BTC's trashed leagues or players.
  const trashedLeagues = allLeagues.filter(l =>
    isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
  );
  const trashedPlayers = allPlayers.filter(p =>
    isTrashed(p) && clubMemberIds.has(p.id)
  );
  const sortedLeagues = sortLeagues(leagues);

  // Pre-index registrations so league/player lookups are O(1). Single pass
  // through the registration list builds both indexes — used by getLeagueRegs
  // and by the Players tab's per-league payment summary.
  const regsByLeague = {};
  const regsByPlayer = {};
  Object.values(db.registrations).forEach(r => {
    (regsByLeague[r.leagueId] || (regsByLeague[r.leagueId] = [])).push(r);
    (regsByPlayer[r.playerId] || (regsByPlayer[r.playerId] = [])).push(r);
  });

  const getLeagueRegs = lid => regsByLeague[lid] || [];
  const getLeagueSchedule = lid => db.schedules[lid] || { weeks: [] };
  const getScore = (lid, week, mid) => db.scores[`${lid}_${week}_${mid}`] || null;
  const getPlayerName = id => formatPlayerName(db.players[id]);

  function getStandings(leagueId) {
    const regs = getLeagueRegs(leagueId);
    const sched = getLeagueSchedule(leagueId);
    const allLockedWeeks = (sched.weeks || []).filter(w => isWeekLocked(leagueId, w.week));

    // A player whose check-in for a given week is "sub" or "out" doesn't
    // get points or wins attributed for that week's matches — they didn't
    // actually play. "in", "maybe", and unset all count normally (maybe ≈
    // showed up since the match still has them on the court). This is a
    // per-week, per-player check; subs in Week 3 still earn points in
    // Week 4 if they show up there.
    function playerSatOutThisWeek(pid, week) {
      const ci = db.checkIns?.[`${leagueId}_w${week}_${pid}`];
      return ci?.status === "sub" || ci?.status === "out";
    }

    // Build a sorted standings array from a given subset of locked weeks.
    // Factored out so we can compute "now" and "before the most recent
    // locked week" snapshots with the same logic.
    function buildSorted(weeks) {
      const stats = {};
      regs.forEach(r => { stats[r.playerId] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
      weeks.forEach(w => {
        w.courts.forEach(ct => ct.matches.forEach(match => {
          const score = getScore(leagueId, match.week, match.id);
          if (!score) return;
          const { homeScore: hs, awayScore: as } = score;
          const sideA = match.format === "doubles" ? match.team1 : [match.home];
          const sideB = match.format === "doubles" ? match.team2 : [match.away];
          const aWon = hs > as;
          sideA.forEach(pid => {
            if (!stats[pid]) return;
            if (playerSatOutThisWeek(pid, match.week)) return;
            stats[pid].pointsFor += hs;
            stats[pid].pointsAgainst += as;
            if (aWon) stats[pid].wins++; else stats[pid].losses++;
          });
          sideB.forEach(pid => {
            if (!stats[pid]) return;
            if (playerSatOutThisWeek(pid, match.week)) return;
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

    const current = buildSorted(allLockedWeeks);

    // Previous-week snapshot for trend arrows. Only meaningful when at
    // least 2 weeks are locked — otherwise there's no "previous" state
    // to compare against (week 1's previous is everyone tied at zero).
    // Drop the most recently locked week (last in chronological/week order)
    // to compute what the standings looked like before it counted.
    let prevRankById = null;
    if (allLockedWeeks.length >= 2) {
      // Sort by week number to be sure we drop the latest, not an arbitrary one.
      const sortedLocked = [...allLockedWeeks].sort((a, b) => a.week - b.week);
      const previousWeeks = sortedLocked.slice(0, -1);
      const previous = buildSorted(previousWeeks);
      prevRankById = {};
      previous.forEach((row, i) => { prevRankById[row.id] = i + 1; });
    }

    return current.map((row, i) => ({
      ...row,
      // The trend value lives on each row so the view layer doesn't have to
      // do a separate lookup. null when no previous snapshot exists; a
      // signed number otherwise (positive = moved up, negative = moved down).
      trend: prevRankById && prevRankById[row.id] != null
        ? prevRankById[row.id] - (i + 1) // moved up = prevRank > currentRank
        : null,
    }));
  }

  const getCheckIn = (leagueId, week, playerId) =>
    db.checkIns?.[`${leagueId}_w${week}_${playerId}`] || null;

  // Player setting their OWN availability. setByAdmin is false, which also
  // clears the flag if the commissioner had previously set it for them.
  async function setCheckIn(leagueId, week, playerId, status, subName) {
    await action(() => dbSetCheckIn(leagueId, week, playerId, status, subName, { setByAdmin: false }));
  }

  // v1.6.0 — commissioner setting a player's availability on their behalf.
  // The motivating case: players text "can't make it Thursday" instead of
  // opening the app, and the commissioner needs the RSVP recorded so the
  // rebalance headcount is right.
  //
  // Stamped setByAdmin so the player's own view can show "the commissioner
  // set this for you" rather than silently displaying a status they never
  // chose. The player can still change it themselves at any time, which
  // clears the flag.
  //
  // Toast names the player and status — with several rows on screen it's
  // otherwise easy to mis-tap and not notice.
  async function setPlayerCheckIn(leagueId, week, playerId, status, subName) {
    const name = getPlayerName(playerId);
    const label = status === null
      ? `Cleared ${name}'s RSVP for Week ${week}.`
      : `${name} marked ${status.toUpperCase()} for Week ${week}.`;
    await action(
      () => dbSetCheckIn(leagueId, week, playerId, status, subName, {
        setByAdmin: true,
        adminEmail: adminEmail || currentPlayer?.email || null,
      }),
      label,
      `set-checkin-${playerId}-w${week}`
    );
  }

  // ─── Action wrappers — each writes to DB then reloads ─────────────────────
  async function createLeague(data) {
    if (!activeClubId) { showToast("No active club selected.", "error"); return; }
    await action(() => dbCreateLeague(data, leagues.length, activeClubId), `League "${data.name}" created!`);
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

  // ─── Rebalance: compute → preview → apply ───────────────────────────────
  // v1.6.0: rebalance now goes through the same preview modal as schedule
  // generation, which means the commissioner can drag players between courts
  // before committing. Previously it wrote straight to the DB from the
  // confirm modal with no chance to adjust.
  //
  // This also gives rebalance a proper preview of a destructive action — it
  // clears the week's scores, which was only ever mentioned in a warning line.
  //
  // Returns { error } or { proposal }. No DB writes.
  function computeRebalanceProposal(leagueId, weekNum) {
    const league = db.leagues[leagueId];
    const regs = getLeagueRegs(leagueId);
    const sched = getLeagueSchedule(leagueId);
    const week = sched.weeks?.find(w => w.week === weekNum);
    if (!week) return { error: "Week not found." };

    // Everyone except explicit "out". Maybe / sub / no-response all still get
    // a court — the commissioner would rather have a spot held than have to
    // rebuild when someone turns up.
    const activePlayerIds = regs
      .map(r => r.playerId)
      .filter(pid => getCheckIn(leagueId, weekNum, pid)?.status !== "out");

    if (activePlayerIds.length < MIN_PER_COURT) {
      return { error: `Only ${activePlayerIds.length} players available. Need at least ${MIN_PER_COURT}.` };
    }

    const numCourts = league.numCourts || 4;
    const sizes = distributePlayersToCourts(activePlayerIds.length, numCourts);
    if (!sizes) {
      const maxAllowed = numCourts * MAX_PER_COURT;
      return { error: `Cannot rebalance ${activePlayerIds.length} players. Need ${MIN_PER_COURT}–${maxAllowed} (${MIN_PER_COURT}–${MAX_PER_COURT} per court).` };
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

    const newCourts = courtGroups.map((group, c) => ({
      courtName: courtName(c),
      players: group,
      matches: buildCourtMatches(group, weekNum, c, league.format || "Singles", week.date),
    }));

    // How many scores this will clear — drives the red button + warning.
    let scoresCleared = 0;
    (week.courts || []).forEach(ct => ct.matches.forEach(m => {
      if (db.scores[`${leagueId}_${weekNum}_${m.id}`]) scoresCleared++;
    }));

    const sizeLabel = courtGroups.map(g => g.length).join(", ");
    const outCount = regs.length - activePlayerIds.length;

    return {
      proposal: {
        kind: "rebalance",
        leagueId,
        leagueName: league.name,
        weekNum,
        newCourts,
        scoresWiped: scoresCleared,
        // The preview renders `weeks`, so hand it this single week with
        // playerNames resolved for display.
        weeks: [{
          ...week,
          courts: newCourts.map(c => ({
            ...c,
            playerNames: c.players.map(pid => getPlayerName(pid)),
          })),
        }],
        summary: `Week ${weekNum}: ${courtGroups.length} court${courtGroups.length!==1?"s":""} (${sizeLabel} players)${outCount > 0 ? ` · ${outCount} marked out` : ""}`,
        warning: scoresCleared > 0
          ? `Applying will clear ${scoresCleared} score${scoresCleared!==1?"s":""} already entered for this week.`
          : null,
        // Rebalance shuffles randomly, so a retry gives a genuinely different
        // arrangement — worth offering.
        canRetry: true,
        successToast: `Week ${weekNum} rebalanced: ${courtGroups.length} court${courtGroups.length!==1?"s":""} (${sizeLabel} players)${scoresCleared > 0 ? `, ${scoresCleared} score${scoresCleared!==1?"s":""} cleared` : ""}.`,
      },
    };
  }

  // Open the rebalance preview. Replaces the old confirm-then-write modal.
  function rebalanceWeek(leagueId, weekNum) {
    const { error, proposal } = computeRebalanceProposal(leagueId, weekNum);
    if (error) { showToast(error, "error"); return; }
    setModal({ type: "schedulePreview", proposal });
  }

  // Write an accepted rebalance. `proposal.weeks[0].courts` is the edited
  // version if the commissioner dragged anyone around; we strip the display-
  // only playerNames before writing.
  async function commitRebalanceProposal(proposal) {
    const { leagueId, weekNum, successToast } = proposal;
    const edited = proposal.weeks[0]?.courts || proposal.newCourts;
    const courtsForDb = edited.map(({ playerNames, ...rest }) => rest);
    await action(
      () => dbRebalanceWeek(leagueId, weekNum, courtsForDb),
      undefined,
      "commit-schedule"
    );
    showToast(successToast);
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

    // Convenience: enrich each court with resolved playerNames for display.
    const withNames = (weeks) => weeks.map(w => ({
      ...w,
      courts: w.courts.map(c => ({
        ...c,
        playerNames: c.players.map(pid => getPlayerName(pid)),
      })),
    }));

    // ─── D+D Weekly Partners ──────────────────────────────────────
    // Fixed 8-player / 14-week format built from a precomputed template.
    // Nothing here is configurable, so it short-circuits ahead of all the
    // court-capacity machinery.
    if (league.competitionType === "dd_partners") {
      if (playerIds.length !== DD_PARTNERS_PLAYERS) {
        return { error: `D+D Weekly Partners needs exactly ${DD_PARTNERS_PLAYERS} players — no more, no less. This league has ${playerIds.length}.` };
      }
      const existingWeeks = db.schedules[leagueId]?.weeks || [];
      if (existingWeeks.some(w => isWeekLocked(leagueId, w.week))) {
        return { error: "Cannot regenerate: one or more weeks are locked. Unlock all weeks first." };
      }
      const result = generateDDPartnersSchedule(playerIds, league.startDate, seedOverride);
      if (result.error) return { error: result.error };
      const scoresWiped = Object.keys(db.scores).filter(k => k.startsWith(`${leagueId}_`)).length;
      return {
        proposal: {
          kind: "dd_partners",
          leagueId,
          leagueName: league.name,
          schedule: result,
          scoresWiped,
          isReplace: existingWeeks.length > 0 || scoresWiped > 0,
          weeks: withNames(result.weeks),
          summary: `${DD_PARTNERS_WEEKS} weeks · 8 players · new partners every week · 8 games per week`,
          warning: scoresWiped > 0
            ? `Accepting will clear ${scoresWiped} existing score${scoresWiped!==1?"s":""} from this league.`
            : null,
          // Players are shuffled into the template's seats, so a retry gives a
          // genuinely different season while keeping every guarantee.
          canRetry: true,
          successToast: `Season generated! ${DD_PARTNERS_WEEKS} weeks of weekly partners${scoresWiped > 0 ? `, ${scoresWiped} previous score${scoresWiped!==1?"s":""} cleared` : ""}`,
        },
      };
    }

    const numCourts = league.numCourts || 4;
    const sizes = distributePlayersToCourts(playerIds.length, numCourts);
    if (!sizes) {
      const maxAllowed = numCourts * MAX_PER_COURT;
      return { error: `Cannot schedule ${playerIds.length} players. Need ${MIN_PER_COURT}–${maxAllowed} players (${MIN_PER_COURT}–${MAX_PER_COURT} per court, up to ${numCourts} court${numCourts!==1?"s":""}).` };
    }

    const isLadder = league.competitionType === "ladder";

    if (!isLadder) {
      // ─── Round-Robin: full season at once ───────────────────────────────────
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
      // "Replace" if there's a prior schedule to overwrite. Scores existing
      // is the harder destructive trigger; either alone is enough to make
      // the button explicit.
      const isReplace = existingWeeks.length > 0 || scoresWiped > 0;
      return {
        proposal: {
          kind: "mixer",
          leagueId,
          leagueName: league.name,
          schedule: result,
          scoresWiped,
          isReplace,
          weeks: withNames(result.weeks),
          summary: `Round-Robin schedule: ${courtsCount} courts (${sz.join(", ")} players) × ${league.weeks} weeks`,
          warning: scoresWiped > 0 ? `Accepting will clear ${scoresWiped} existing score${scoresWiped!==1?"s":""} from this league.` : null,
          // Round-Robin generation is deterministic with the current seeding (the
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
      // Manual edits to court assignments are applied by the preview modal
      // in memory — they don't need to feed back into this function.
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

  // Write an accepted proposal to the DB.
  //
  // v1.5.1: the score wipe used to be a raw
  //     supabase.from("pb_scores").delete().like("key", `${leagueId}_%`)
  // right here in App.jsx — the same SQL LIKE underscore bug that was fixed in
  // the cascades (for league_1, that pattern also matches league_10's scores).
  // It now goes through dbDeleteLeagueScores(), so there is exactly ONE safe
  // implementation of "delete this league's scores" and no raw SQL in the view
  // layer. See the underscore-trap note at the top of lib/supabase.js.
  async function commitScheduleProposal(proposal) {
    if (!proposal) return;
    const { leagueId, schedule, scoresWiped, successToast } = proposal;
    await action(async () => {
      await dbWriteSchedule(leagueId, schedule);
      if (scoresWiped > 0) {
        await dbDeleteLeagueScores(leagueId);
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

  // Re-run the proposal generator. Only meaningful when the underlying
  // generator is non-deterministic — ladder Week 1 and rebalance both
  // shuffle randomly, so a retry gives a genuinely different arrangement.
  // Round-Robin generation is deterministic and doesn't offer the button.
  function retryScheduleProposal() {
    const cur = modal?.proposal;
    if (!cur) return;
    const { error, proposal } = cur.kind === "rebalance"
      ? computeRebalanceProposal(cur.leagueId, cur.weekNum)
      : computeScheduleProposal(cur.leagueId);
    if (error) { showToast(error, "error"); return; }
    setModal({ type: "schedulePreview", proposal });
  }

  async function removePlayer(leagueId, playerId) {
    await action(() => dbRemovePlayerFromLeague(leagueId, playerId), "Player removed. Regenerate schedule.");
  }

  // Create a player from the commissioner panel (Players tab, or the
  // add-player-to-league modal). Both are scoped to the active club.
  //
  // v1.8.0: if the email already belongs to a live player — typically someone
  // who plays at another club — add a membership to that existing record
  // instead of creating a duplicate. Returns the id either way, so callers
  // that immediately register the player into a league keep working.
  async function createPlayer(data) {
    if (!activeClubId) { showToast("No active club selected.", "error"); return null; }
    const displayName = data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : data.name;
    const existing = findLivePlayerByEmail(data?.email);

    if (existing) {
      // Already in this club? Nothing to do but say so — avoids a confusing
      // silent no-op when the commissioner re-adds someone.
      const alreadyMember = !!db.memberships?.[`${activeClubId}_${existing.id}`]
        && !db.memberships[`${activeClubId}_${existing.id}`].deletedAt;
      if (alreadyMember) {
        showToast(`${formatPlayerName(existing)} is already in this club.`, "error");
        setModal(null);
        return existing.id;
      }
      await action(
        () => dbCreateMembership(activeClubId, existing.id),
        `${formatPlayerName(existing)} already had an account — added them to this club.`
      );
      setModal(null);
      return existing.id;
    }

    let newId = null;
    await action(async () => {
      newId = await dbCreatePlayer(data);
      await dbCreateMembership(activeClubId, newId);
    }, `Player "${displayName}" created!`);
    setModal(null);
    return newId;
  }

  async function updatePlayer(id, data) {
    await action(() => dbUpdatePlayer(id, data), "Player updated!");
    setModal(null);
  }

  // ─── Phase 3 / v1.2.0: home-screen flows ────────────────────────────────
  // The createClub + joinClub flows are different from createPlayer in that
  // they run *before* the user has any session — no activeClubId is set yet.
  // They write all the necessary records (player, club, membership) and
  // then immediately log the user in and set the active club.

  // Look up a live player by email. Returns the player record or null.
  //
  // v1.8.0 — added to stop duplicate accounts. Email is the de-facto identity
  // key in this app (it's how login works), but nothing in the schema enforces
  // uniqueness, so any flow that creates a player from an email has to check
  // first. Without this, one person ends up as two records with one club each
  // and no way to switch between them — which is exactly what happened when a
  // club owner created a second club using their existing email.
  //
  // Searches ALL players, not the club-scoped list: the whole point is to find
  // someone who exists in a different club.
  function findLivePlayerByEmail(email) {
    const target = (email || "").trim().toLowerCase();
    if (!target) return null;
    return Object.values(db.players || {}).find(
      p => p.email?.toLowerCase() === target && !p.deletedAt
    ) || null;
  }

  // Home-screen "Create a Club" — creates the club + the owner's player
  // record + their membership, then signs the new owner in to their new
  // club. On any DB error mid-sequence, we surface the error and abort;
  // partial state (e.g. a player created but no club) is recoverable on
  // retry (the orphaned player just lives in db.players with no club, and
  // the next attempt will create everything fresh).
  //
  // v1.8.0: if the owner's email already belongs to a live player, we reuse
  // that record instead of creating a second one. A person who runs two clubs
  // is still one person.
  async function createClub({ clubName, playerData }) {
    const joinCode = generateJoinCode(clubName);
    const existingPlayer = findLivePlayerByEmail(playerData?.email);
    let newPlayerId = existingPlayer?.id || null;
    let newClubId = null;
    await action(async () => {
      // Order matters: resolve the player first so we have their id confirmed
      // before we attach them as the club's owner. If club-create fails after
      // this, a newly-created player exists but is in no club — they'd hit the
      // "no clubs" empty state on next login and can retry.
      if (!newPlayerId) {
        newPlayerId = await dbCreatePlayer(playerData);
      }
      newClubId = await dbCreateClub({
        name: clubName,
        ownerEmail: playerData.email,
        joinCode,
      });
      await dbCreateMembership(newClubId, newPlayerId);
    });
    if (!newPlayerId || !newClubId) {
      // Toast already surfaced the error via the action wrapper.
      return;
    }
    showToast(
      existingPlayer
        ? `${clubName} created and added to your account. Join code: ${joinCode}`
        : `Welcome to ${clubName}! Your join code is ${joinCode} — find it any time in the Commissioners tab.`
    );
    // Log them in immediately. reload() inside `action` already happened,
    // so db now contains the new records.
    if (playerData.email) saveLastEmail(playerData.email);
    setActiveClubId(newClubId);
    setCurrentPlayer(existingPlayer || { ...playerData, id: newPlayerId });
    setView("player");
    setModal(null);
  }

  // Home-screen "Join with Code" — two paths:
  //   - existing: the player already has a record. Just add a new
  //     membership in the joined club and log them in.
  //   - new: create a new player record + membership and log in.
  async function joinClub(payload) {
    if (!payload?.clubId) return;
    const club = db.clubs?.[payload.clubId];
    if (!club) { showToast("That club is no longer available.", "error"); return; }

    if (payload.kind === "existing") {
      const existing = payload.player;
      // Edge case: they're already in this club. Re-create-membership is
      // a clean upsert (resets joinedAt and clears any deletedAt), which
      // is fine semantically — "re-joining" returns them to live status.
      await action(async () => {
        await dbCreateMembership(payload.clubId, existing.id);
      });
      showToast(`Welcome back! You've joined ${club.name}.`);
      if (existing.email) saveLastEmail(existing.email);
      setActiveClubId(payload.clubId);
      setCurrentPlayer(existing);
      setView("player");
      setModal(null);
      return;
    }

    if (payload.kind === "new") {
      let newPlayerId = null;
      await action(async () => {
        newPlayerId = await dbCreatePlayer(payload.playerData);
        await dbCreateMembership(payload.clubId, newPlayerId);
      });
      if (!newPlayerId) return;
      showToast(`Welcome to ${club.name}!`);
      if (payload.playerData.email) saveLastEmail(payload.playerData.email);
      setActiveClubId(payload.clubId);
      setCurrentPlayer({ ...payload.playerData, id: newPlayerId });
      setView("player");
      setModal(null);
      return;
    }
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
    // D+D Weekly Partners is a hard 8. The whole season template is built
    // around exactly that many players, so a 9th can't be accommodated later
    // by regenerating — block it at the door rather than at generation time.
    const lg = db.leagues[leagueId];
    if (lg?.competitionType === "dd_partners") {
      const count = getLeagueRegs(leagueId).length;
      if (count >= DD_PARTNERS_PLAYERS) {
        showToast(`This league is full — D+D Weekly Partners is exactly ${DD_PARTNERS_PLAYERS} players.`, "error");
        return;
      }
    }
    await action(() => dbRegisterForLeague(leagueId, playerId), "Registered successfully!");
    setModal(null);
  }

  async function submitScore(leagueId, week, matchId, homeScore, awayScore, match) {
    await action(
      () => dbWriteScore(leagueId, week, matchId, homeScore, awayScore),
      buildScoreToast(match, homeScore, awayScore, currentPlayer),
      "submit-score"
    );
    setModal(null);
  }

  // Inline variant — called from the per-row entry in the schedule list.
  // Uses a per-match action ID so each row's ✓ button can show its own
  // spinner independently. No modal is open, so no setModal cleanup.
  async function submitScoreInline(leagueId, homeScore, awayScore, match, actionId) {
    await action(
      () => dbWriteScore(leagueId, match.week, match.id, homeScore, awayScore),
      buildScoreToast(match, homeScore, awayScore, currentPlayer),
      actionId
    );
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

  // Add/remove admins on the currently active club. The DB-layer functions
  // enforce the per-role permissions (any admin can add, only owner can
  // remove). These wrappers are passed to AdminsTab, which is already
  // scoped to the current club by the time it's mounted.
  // ─── Phase 4 / v1.3.0: club switcher + settings ─────────────────────────
  // Switch the active club. Used by the header dropdown in both admin and
  // player views. Caller is responsible for passing a clubId that's
  // actually accessible to the current user; we defensively validate by
  // re-checking against memberships / admin-clubs here, since a stale
  // dropdown could otherwise switch to a club the user no longer belongs
  // to (e.g. their admin access was revoked from another device).
  //
  // Side effects:
  //   - clears selectedLeague so we don't leave the admin staring at a
  //     league that doesn't belong to the new club
  //   - clears the modal in case a club-scoped action was mid-flight
  //   - the session-persist effect picks up the new activeClubId
  //     automatically on the next render
  function switchClub(clubId) {
    if (!clubId || clubId === activeClubId) return;
    // Validate the user can actually access this club.
    const accessible = [];
    if (currentPlayer) {
      getClubsForPlayer(db.memberships || {}, db.clubs || {}, currentPlayer.id)
        .forEach(c => accessible.push(c));
    }
    if (adminEmail) {
      getClubsWhereAdmin(db.clubs || {}, adminEmail).forEach(c => {
        if (!accessible.find(x => x.id === c.id)) accessible.push(c);
      });
    }
    if (!accessible.find(c => c.id === clubId)) {
      showToast("That club is no longer available.", "error");
      return;
    }
    setSelectedLeague(null);
    setModal(null);
    setActiveClubId(clubId);
    // Toast tells the user the switch happened — important since the
    // dropdown closes immediately and they might second-guess that the
    // click landed.
    const club = db.clubs[clubId];
    if (club) showToast(`Switched to ${club.name}.`);
  }

  // v1.8.0 — per-club logo. Stored as a plain string on the club record so
  // the same field works whether it points at a bundled /public asset or a
  // future uploaded URL. Passing null clears it.
  async function setClubLogo(logoUrl) {
    if (!activeClubId) { showToast("No active club selected.", "error"); return; }
    await action(
      () => dbUpdateClub(activeClubId, { logoUrl: logoUrl || null }),
      logoUrl ? "Club logo updated." : "Club logo removed."
    );
  }

  // Rename the active club. Admin-gated by the UI (ClubSettingsTab).
  async function renameClub(newName) {
    if (!activeClubId) { showToast("No active club selected.", "error"); return; }
    const trimmed = (newName || "").trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      showToast("Club name must be between 2 and 60 characters.", "error");
      return;
    }
    if (trimmed === db.clubs[activeClubId]?.name) return; // no-op
    await action(() => dbUpdateClub(activeClubId, { name: trimmed }), `Club renamed to "${trimmed}".`);
  }

  // ─── Phase 4 / v1.4.0: regenerate code, transfer, delete ────────────────

  // Regenerate the active club's join code. Any admin (or the owner) can do
  // this; the old code stops working immediately. The new code is generated
  // client-side via generateJoinCode (same helper used by createClub) so
  // the prefix stays consistent with the current club name even after a
  // rename.
  async function regenerateJoinCode() {
    if (!activeClubId) { showToast("No active club.", "error"); return; }
    const newCode = generateJoinCode(activeClub?.name || "");
    await action(
      () => dbUpdateClub(activeClubId, { joinCode: newCode }),
      `New join code: ${newCode}`
    );
    setModal(null);
  }

  // Transfer ownership to one of the current admins. The DB layer validates
  // that the target is actually an admin; the UI gates this too via the
  // dropdown's admin list. On success, the next render automatically
  // updates isClubOwner/isClubAdmin for the current user since both check
  // against the freshly-loaded club.
  async function transferOwnership(newOwnerEmail) {
    if (!activeClubId) { showToast("No active club.", "error"); return; }
    if (!newOwnerEmail) { showToast("Select an admin to transfer to.", "error"); return; }
    let res;
    await action(async () => {
      res = await dbTransferOwnership(activeClubId, newOwnerEmail);
    });
    if (res?.ok) {
      showToast(`Ownership transferred to ${newOwnerEmail}. You're now a regular admin.`);
    } else if (res?.reason === "not_admin") {
      showToast("That user is no longer an admin of this club.", "error");
    } else if (res?.reason === "empty_email") {
      showToast("Please choose an admin to transfer to.", "error");
    }
    setModal(null);
  }

  // Soft-delete the active club. Cascades to its leagues + memberships
  // via dbSoftDeleteClub. After the delete, the deleted club is no longer
  // accessible, so we compute the post-delete accessible-clubs list and
  // either switch to a remaining club or log the user out.
  //
  // We don't use the standard `action()` wrapper here because we need to
  // compute the post-delete accessible-clubs list from FRESH db state
  // (after the cascade), and synchronous post-action state isn't available
  // through the wrapper. Instead we manage the spinner + reload + toast
  // inline.
  //
  // v1.5.0: because this bypasses `action()`, it also bypasses that
  // function's offline guard — so we repeat the check here. Every mutation
  // path must be blocked when offline, not just the ones that happen to go
  // through the wrapper.
  async function deleteClub() {
    if (!navigator.onLine) {
      showToast("You're offline — changes can't be saved right now.", "error");
      return;
    }
    if (!activeClubId) { showToast("No active club.", "error"); return; }
    const deletedClubId = activeClubId;
    const deletedClubName = activeClub?.name || "the club";

    setCurrentActionId("delete-club");
    try {
      await dbSoftDeleteClub(deletedClubId);
      const fresh = await loadDB();
      setDB(fresh);

      // Recompute accessible clubs from fresh state. Deleted clubs are
      // already filtered out by getClubsForPlayer/getClubsWhereAdmin (both
      // check !c.deletedAt).
      const accessible = [];
      if (currentPlayer) {
        getClubsForPlayer(fresh.memberships || {}, fresh.clubs || {}, currentPlayer.id)
          .forEach(c => accessible.push(c));
      }
      if (adminEmail) {
        getClubsWhereAdmin(fresh.clubs || {}, adminEmail).forEach(c => {
          if (!accessible.find(x => x.id === c.id)) accessible.push(c);
        });
      }

      setSelectedLeague(null);
      setModal(null);

      if (accessible.length > 0) {
        // Switch to the first remaining accessible club. Alphabetical
        // sort matches the switcher's display order so the choice is
        // predictable to the user.
        const sorted = [...accessible].sort(
          (a, b) => (a.name || "").localeCompare(b.name || "")
        );
        const next = sorted[0];
        setActiveClubId(next.id);

        // If they were in admin view but aren't an admin of the new club,
        // drop to player view (if they're a player there) or log out
        // (if they're admin-only with no remaining admin role).
        if (view === "admin") {
          const stillAdminHere = isClubAdmin(next, adminEmail);
          if (!stillAdminHere) {
            if (currentPlayer) {
              setView("player");
            } else {
              // Admin-only session with no admin role in any remaining
              // club. Log them out — they have no commissioner role left.
              setCurrentPlayer(null);
              setAdminEmail(null);
              setActiveClubId(null);
              setView("home");
              saveSession(null);
              showToast(`${deletedClubName} deleted. Logged out — you no longer have admin access anywhere.`);
              return;
            }
          }
        }
        showToast(`${deletedClubName} deleted. Switched to ${next.name}. Contact support within 30 days to recover.`);
      } else {
        // No remaining clubs — fully log out.
        setCurrentPlayer(null);
        setAdminEmail(null);
        setActiveClubId(null);
        setView("home");
        saveSession(null);
        showToast(`${deletedClubName} deleted. Contact support within 30 days to recover.`);
      }
    } catch (e) {
      console.error("[deleteClub] failed:", e);
      showToast(e.message || "Failed to delete club", "error");
    } finally {
      setCurrentActionId(null);
    }
  }

  async function addAdminEmail(email) {
    if (!email.trim()) return;
    if (!activeClubId) { showToast("No active club.", "error"); return; }
    let res;
    await action(async () => { res = await dbAddClubAdmin(activeClubId, email); });
    if (res?.ok) showToast(`${email.trim().toLowerCase()} added as commissioner.`);
    else if (res?.reason === "already_admin") showToast("Already a commissioner.", "error");
    else if (res?.reason === "empty_email") showToast("Please enter an email.", "error");
  }

  async function removeAdminEmail(email) {
    if (!activeClubId) { showToast("No active club.", "error"); return; }
    let res;
    await action(async () => { res = await dbRemoveClubAdmin(activeClubId, email, adminEmail); });
    if (res?.ok) showToast(`${email} removed.`);
    else if (res?.reason === "is_owner") showToast("Cannot remove the club owner.", "error");
    else if (res?.reason === "not_owner") showToast("Only the club owner can remove admins.", "error");
  }

  // Test data seeder — creates Test1..Test20 players (skips any that exist)
  //
  // v1.5.0: like deleteClub, this bypasses `action()` (it loops many writes
  // and manages its own spinner), so it needs its own offline guard.
  async function seedTestPlayers() {
    if (!navigator.onLine) {
      showToast("You're offline — changes can't be saved right now.", "error");
      return;
    }
    if (!activeClubId) { showToast("No active club selected.", "error"); return; }
    const existingEmails = new Set(players.map(p => p.email?.toLowerCase()).filter(Boolean));
    let added = 0, skipped = 0;
    setCurrentActionId("seed-test-players");
    try {
      for (let i = 1; i <= 20; i++) {
        const email = `test${i}@test.com`;
        if (existingEmails.has(email)) { skipped++; continue; }
        const newId = await dbCreatePlayer({
          firstName: `Test${i}`,
          lastName: "Player",
          name: `Test${i} Player`,
          email,
          // 248-555-01XX is in NANP's reserved-for-fiction range (any
          // area code + 555-0100..0199 line numbers). Safe for test data
          // and stays inside the 10-digit format the validator expects.
          phone: `248555${String(100 + i - 1).padStart(4, "0")}`,
          gender: i % 2 === 0 ? "Female" : "Male",
          cscMember: false,
        });
        // Auto-join the active club so the new test player is visible
        // in the commissioner's roster + can be added to leagues.
        await dbCreateMembership(activeClubId, newId);
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
        onSubmit={(h, a) => submitScore(modal.leagueId, modal.match.week, modal.match.id, h, a, modal.match)}
        onClose={() => setModal(null)} />
    </Modal>
  );

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (view === "home") {
    return (
      <ActionPendingProvider value={currentActionId}>
        <PullToRefresh onRefresh={refresh} isRefreshing={currentActionId === "refresh"}>
        {statusBanners}
        <HomeView leagues={leagues} players={players} db={db}
          hasBanner={hasBanner}
          onAdmin={(email) => {
            // Admin-only sign-in: prefer the club they were last in, falling
            // back to the first club where this email is owner/admin. If none,
            // leave activeClubId null — the commissioner panel will surface an
            // empty state.
            const adminClubs = getClubsWhereAdmin(db.clubs || {}, email);
            const club = resolveActiveClub(loadLastClub(), adminClubs);
            setActiveClubId(club?.id || null);
            setAdminEmail(email);
            setView("admin");
          }}
          onPlayerLogin={p => {
            // Remember this email on this device for next time, even if the
            // user later logs out. The login screen will pre-fill it.
            if (p?.email) saveLastEmail(p.email);
            // Land them back in the club they were last using. resolveActiveClub
            // validates the remembered id against the clubs they can actually
            // access, so a stale one (left the club, club deleted) silently
            // falls back to their first club rather than erroring.
            const myClubs = getClubsForPlayer(db.memberships || {}, db.clubs || {}, p.id);
            const club = resolveActiveClub(loadLastClub(), myClubs);
            setActiveClubId(club?.id || null);
            setCurrentPlayer(p);
            setView("player");
          }}
          onCreatePlayer={createPlayer}
          onCreateClub={createClub}
          onJoinClub={joinClub}
          toast={toast} modal={modal} setModal={setModal}
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
        {modal?.type === "addPlayerToLeague" && <Modal title="Add Player to League" onClose={() => setModal(null)}><AddPlayerToLeague players={players} leagueId={modal.leagueId} leagueGender={db.leagues[modal.leagueId]?.gender || "Mixed"} existing={getLeagueRegs(modal.leagueId).map(r => r.playerId)} onRegister={registerForLeague} onCreatePlayer={createPlayer} onClose={() => setModal(null)} /></Modal>}
        {modal?.type === "leagueContacts" && (
          <Modal title={`Contacts · ${db.leagues[modal.leagueId]?.name || "League"}`} onClose={() => setModal(null)}>
            <LeagueContactsModal
              regs={getLeagueRegs(modal.leagueId)}
              players={db.players}
              onClose={() => setModal(null)} />
          </Modal>
        )}
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
        {/* v1.6.0 — the old "confirmRebalance" modal was removed here.
            Rebalance now opens the SchedulePreview modal instead, so the
            commissioner can review AND drag players between courts before
            committing. The headcount summary that used to live in this
            modal is now the preview's `summary` line, and the
            scores-will-be-cleared warning is its `warning` field. */}
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
          <Modal
            title={
              modal.proposal.kind === "rebalance"
                ? `Rebalance Week ${modal.proposal.weekNum} · ${modal.proposal.leagueName}`
                : `${modal.proposal.isReplace ? "Replace" : "Review"} Schedule · ${modal.proposal.leagueName}`
            }
            onClose={() => setModal(null)}>
            <SchedulePreview
              preview={modal.proposal}
              league={db.leagues[modal.proposal.leagueId]}
              onAccept={(finalProposal) =>
                finalProposal.kind === "rebalance"
                  ? commitRebalanceProposal(finalProposal)
                  : commitScheduleProposal(finalProposal)}
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

        {/* ─── Phase 4 / v1.4.0: Settings tab modals ─────────────────────── */}
        {modal?.type === "confirmRegenerateCode" && (
          <Modal title="Regenerate Join Code" onClose={() => setModal(null)}>
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>
              Regenerate the join code for <b>{activeClub?.name}</b>?
            </p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>
              The current code{" "}
              <code style={{ fontFamily: "ui-monospace, Menlo, monospace", padding: "2px 6px", background: "var(--color-background-secondary)", borderRadius: 4, fontSize: 12 }}>
                {activeClub?.joinCode || "—"}
              </code>{" "}
              will stop working immediately. Anyone who tries to join your club will need the new code.
            </p>
            <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "_generic"}>Cancel</button>
              <button
                style={{ ...S.btn("primary"), background: "#854F0B", minWidth: 160 }}
                onClick={regenerateJoinCode}
                disabled={currentActionId === "_generic"}>
                {currentActionId === "_generic" ? <><Spinner /> Regenerating…</> : "Regenerate code"}
              </button>
            </div>
          </Modal>
        )}
        {modal?.type === "confirmTransferOwnership" && (
          <Modal title="Transfer Ownership" onClose={() => setModal(null)}>
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>
              Transfer ownership of <b>{activeClub?.name}</b> to <b>{modal.newOwnerEmail}</b>?
            </p>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>
              You'll become a regular admin. <b>{modal.newOwnerEmail}</b> will be able to remove other admins, transfer ownership again, or delete the club. This can be undone only by the new owner transferring back to you.
            </p>
            <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
              <button style={S.btn("secondary")} onClick={() => setModal(null)} disabled={currentActionId === "_generic"}>Cancel</button>
              <button
                style={{ ...S.btn("primary"), background: "#854F0B", minWidth: 170 }}
                onClick={() => transferOwnership(modal.newOwnerEmail)}
                disabled={currentActionId === "_generic"}>
                {currentActionId === "_generic" ? <><Spinner /> Transferring…</> : "Transfer ownership"}
              </button>
            </div>
          </Modal>
        )}
        {modal?.type === "confirmDeleteClub" && (() => {
          // Compute cascade impact for the warning. Both counts reflect
          // what's currently live in the club — anything already in the
          // trash doesn't count toward the "new" damage.
          const clubLiveLeagues = allLeagues.filter(l =>
            l.clubId === activeClubId && !l.deletedAt
          );
          const clubLiveMembershipCount = Object.values(db.memberships || {})
            .filter(m => m.clubId === activeClubId && !m.deletedAt)
            .length;
          return (
            <Modal title="Delete Club" onClose={() => setModal(null)}>
              <p style={{ fontSize: 14, margin: "0 0 12px" }}>
                Delete <b>{activeClub?.name}</b>?
              </p>
              <div style={{
                padding: "12px 14px", marginBottom: 12,
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 8, fontSize: 13,
              }}>
                <p style={{ margin: "0 0 6px", fontWeight: 600 }}>This will move to trash:</p>
                <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                  <li style={{ marginBottom: 4 }}>The club itself</li>
                  <li style={{ marginBottom: 4 }}>
                    {clubLiveLeagues.length} league{clubLiveLeagues.length !== 1 ? "s" : ""}
                    {clubLiveLeagues.length > 0 ? " (with all schedules, scores, registrations)" : ""}
                  </li>
                  <li>
                    {clubLiveMembershipCount} player membership{clubLiveMembershipCount !== 1 ? "s" : ""}
                    {" "}<span style={{ color: "var(--color-text-secondary)" }}>(player accounts themselves are preserved)</span>
                  </li>
                </ul>
              </div>
              <p style={{ fontSize: 13, color: "#A32D2D", margin: "0 0 16px" }}>
                After 30 days, everything is permanently deleted. <b>Restore is not available in-app</b> — if you change your mind during the 30-day window, contact support.
              </p>
              <DeleteClubConfirm
                onConfirm={deleteClub}
                onCancel={() => setModal(null)}
                saving={currentActionId === "delete-club"} />
            </Modal>
          );
        })()}

        {statusBanners}

        <div style={S.header(league ? c.bg : undefined)} className={`${headerTopClass} pwa-safe-x`}>
          <div style={S.row}>
            <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0" }} onClick={() => { if (league) setSelectedLeague(null); else setView("home"); }}>←</button>
            {league
              ? <h1 style={S.logo}>{league.name}</h1>
              : <ClubSwitcher
                  clubs={accessibleClubs.filter(cl => isClubAdmin(cl, adminEmail))}
                  activeClubId={activeClubId}
                  onSwitch={switchClub}
                  subtitle="Commissioner Panel" />}
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
            onShowContacts={() => setModal({ type: "leagueContacts", leagueId: league.id })}
            onRemovePlayer={pid => removePlayer(league.id, pid)}
            onTogglePaid={pid => togglePaid(league.id, pid)}
            onToggleLockWeek={(week) => toggleLockWeek(league.id, week)}
            isWeekLocked={(week) => isWeekLocked(league.id, week)}
            onEnterScore={match => setModal({ type: "enterScore", match, leagueId: league.id })}
            onSubmitScore={(home, away, match, actionId) => submitScoreInline(league.id, home, away, match, actionId)}
            onEditWeekDateTime={weekData => setModal({ type: "editWeek", leagueId: league.id, weekData })}
            onRebalanceWeek={weekData => rebalanceWeek(league.id, weekData.week)}
            onSetPlayerCheckIn={(week, playerId, status, subName) =>
              setPlayerCheckIn(league.id, week, playerId, status, subName)} />
        ) : (
          <>
            <div style={S.tabBar}>
              {[["leagues","Leagues"],["players","Players"],["admins","Commissioners"],["settings","Settings"],["trash","Trash"]].map(([k,label]) => {
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
                {players.map(p => {
                  // Payment is per-league, not per-player. Compute an
                  // at-a-glance summary across the player's live (non-
                  // archived) registrations so the commissioner can spot
                  // who still owes for which league without leaving this
                  // tab. The actual mark-paid action lives on the per-
                  // league screen where it's unambiguous.
                  const liveRegs = (regsByPlayer[p.id] || []).filter(r => {
                    const lg = db.leagues[r.leagueId];
                    return lg && lg.status !== "archived" && !lg.deletedAt;
                  });
                  const paidIn = liveRegs.filter(r => r.paid).length;
                  const totalIn = liveRegs.length;
                  return (
                  <div key={p.id} style={S.card}>
                    <div style={{ ...S.row, marginBottom: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 16, flexShrink: 0 }}>{playerInitial(p)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4 }}>
                          <p style={{ margin: 0, fontWeight: 600 }}>{formatPlayerName(p)}</p>
                          {p.gender && <span style={{ ...genderBadgeStyle(p.gender), fontSize: 10 }}>{p.gender}</span>}
                          {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC Member</span>}
                          {/* Per-league payment summary. No badge if the
                              player isn't in any live leagues. */}
                          {totalIn > 0 && (
                            paidIn === totalIn
                              ? <span style={{ ...S.badge("success"), fontSize: 10 }}>Paid · {totalIn} league{totalIn !== 1 ? "s" : ""}</span>
                              : <span style={{ ...S.badge("warning"), fontSize: 10 }}>Paid in {paidIn} of {totalIn}</span>
                          )}
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}{p.phone ? ` · ${formatPhone(p.phone)}` : ""}</p>
                      </div>
                    </div>
                    <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 10 }}>
                      <button style={S.btnSm("secondary")} onClick={() => setModal({ type: "editPlayer", player: p })}>Edit</button>
                      <button
                        style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11 }}
                        onClick={() => setModal({ type: "confirmDeletePlayer", player: p })}>
                        Delete
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
            {adminTab === "admins" && (
              <AdminsTab
                club={activeClub}
                currentAdminEmail={adminEmail}
                isOwner={isClubOwner(activeClub, adminEmail)}
                isAdmin={isClubAdmin(activeClub, adminEmail)}
                onAdd={addAdminEmail}
                onRemove={removeAdminEmail}
              />
            )}
            {adminTab === "settings" && (
              <ClubSettingsTab
                club={activeClub}
                isAdmin={isClubAdmin(activeClub, adminEmail)}
                isOwner={isClubOwner(activeClub, adminEmail)}
                onRename={renameClub}
                onSetLogo={setClubLogo}
                onRegenerateRequest={() => setModal({ type: "confirmRegenerateCode" })}
                onTransferRequest={(newOwnerEmail) => setModal({ type: "confirmTransferOwnership", newOwnerEmail })}
                onDeleteRequest={() => setModal({ type: "confirmDeleteClub" })}
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
    // Filter to leagues in the active club only. A player who's in
    // multiple clubs sees only the leagues of the club they're currently
    // viewing — switching clubs (Phase 3) will surface the other ones.
    // Trashed leagues are excluded entirely; players shouldn't see half-
    // deleted state.
    const myLeagues = sortLeagues(
      myRegs.map(r => db.leagues[r.leagueId]).filter(l =>
        l && !isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
      )
    );
    const unregistered = leagues.filter(l => {
      if (myRegs.find(r => r.leagueId === l.id)) return false;
      if ((l.status || "open") !== "open") return false;
      // A full fixed-size league shouldn't advertise itself as joinable.
      if (l.competitionType === "dd_partners"
          && getLeagueRegs(l.id).length >= DD_PARTNERS_PLAYERS) return false;
      // Shared with the commissioner's add-player flow so both surfaces
      // apply the same gender rule.
      return playerFitsLeagueGender(currentPlayer.gender, l.gender);
    }).sort((a, b) => {
      // Earliest start date first. Leagues missing a startDate go last so the
      // common case (well-formed leagues) reads top-to-bottom chronologically.
      const ad = a.startDate || "";
      const bd = b.startDate || "";
      if (!ad && !bd) return (a.name || "").localeCompare(b.name || "");
      if (!ad) return 1;
      if (!bd) return -1;
      if (ad !== bd) return ad.localeCompare(bd); // ISO YYYY-MM-DD sorts correctly as string
      return (a.name || "").localeCompare(b.name || "");
    });
    return (
      <ActionPendingProvider value={currentActionId}>
        {statusBanners}
        <PlayerView key={activeClubId || "no-club"}
          headerTopClass={headerTopClass}
          db={db} player={currentPlayer} myLeagues={myLeagues} unregistered={unregistered}
          accessibleClubs={getClubsForPlayer(db.memberships || {}, db.clubs || {}, currentPlayer.id)}
          activeClubId={activeClubId} onSwitchClub={switchClub}
          playerTab={playerTab} setPlayerTab={setPlayerTab} modal={modal} setModal={setModal} toast={toast}
          getLeagueSchedule={getLeagueSchedule} getScore={getScore} getPlayerName={getPlayerName}
          getStandings={getStandings} registerForLeague={registerForLeague} submitScore={submitScore} submitScoreInline={submitScoreInline}
          isWeekLocked={isWeekLocked}
          getCheckIn={getCheckIn} setCheckIn={setCheckIn}
          canSwitchToAdmin={isClubAdmin(activeClub, currentPlayer.email)}
          onSwitchToAdmin={() => { setAdminEmail(currentPlayer.email.toLowerCase()); setView("admin"); }}
          onLogout={logout} scoreModal={scoreModal}
          onRefresh={refresh} isRefreshing={currentActionId === "refresh"} />
      </ActionPendingProvider>
    );
  }
}
