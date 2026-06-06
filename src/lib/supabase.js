// ─── Supabase client and storage helpers ────────────────────────────────────
// All `dbXxx` functions follow a write-first pattern: every write hits
// Supabase first (awaited). The caller is responsible for re-fetching state
// after a successful write so React never shows data that isn't in the DB.
import { createClient } from "@supabase/supabase-js";
import { LEAGUE_COLORS, TRASH_RETENTION_DAYS } from "./constants.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local");
}

export const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "", {
  auth: { persistSession: false }, // app handles its own auth
});

// ─── Full snapshot loader ───────────────────────────────────────────────────
// Also runs the 30-day trash auto-purge: any league, player, or club whose
// `data.deletedAt` is older than TRASH_RETENTION_DAYS gets hard-deleted (with
// full cascade) before the snapshot is built. This makes purge opportunistic —
// it happens on the next loadDB after the retention window passes, with no
// background job needed.
export async function loadDB() {
  await purgeExpiredTrash();
  return loadDBSnapshot();
}

// Find every league/player/club in the trash whose retention window has
// passed, hard-delete them (cascading their dependent rows). Returns true if
// anything was purged. Tolerant of errors per row — one failure doesn't block
// others.
//
// Order matters: purge clubs first so their leagues are removed in bulk via
// dbHardDeleteClub's cascade. Whatever leagues remain (i.e. soft-deleted in
// a still-live club) are processed individually. Players go last and are
// independent of either (identity is global).
async function purgeExpiredTrash() {
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = (record) => {
    const d = record.data?.deletedAt;
    if (!d) return false;
    const t = Date.parse(d);
    return Number.isFinite(t) && t < cutoffMs;
  };

  const [clubs, leagues, players] = await Promise.all([
    supabase.from("pb_clubs").select("id, data"),
    supabase.from("pb_leagues").select("id, data"),
    supabase.from("pb_players").select("id, data"),
  ]);
  if (clubs.error || leagues.error || players.error) {
    console.error("[purgeExpiredTrash] skipped:",
      clubs.error || leagues.error || players.error);
    return false;
  }

  const expiredClubs = (clubs.data || []).filter(expired);
  const expiredLeagues = (leagues.data || []).filter(expired);
  const expiredPlayers = (players.data || []).filter(expired);
  if (expiredClubs.length === 0
      && expiredLeagues.length === 0
      && expiredPlayers.length === 0) {
    return false;
  }

  console.log(
    `[purgeExpiredTrash] purging ${expiredClubs.length} clubs,`,
    `${expiredLeagues.length} leagues, ${expiredPlayers.length} players`
  );

  // Cascade each one (intentionally not wrapped in Promise.all so a single
  // failure doesn't block the rest). Errors are logged but swallowed;
  // whatever didn't purge today will try again tomorrow.
  //
  // Process clubs first — their cascade handles any leagues + memberships
  // for that club, so the leagues loop below has less to do.
  for (const row of expiredClubs) {
    try { await dbHardDeleteClub(row.id); }
    catch (e) { console.error(`[purgeExpiredTrash] club ${row.id}:`, e); }
  }
  for (const row of expiredLeagues) {
    try { await dbHardDeleteLeague(row.id); }
    catch (e) { console.error(`[purgeExpiredTrash] league ${row.id}:`, e); }
  }
  for (const row of expiredPlayers) {
    try { await dbHardDeletePlayer(row.id); }
    catch (e) { console.error(`[purgeExpiredTrash] player ${row.id}:`, e); }
  }
  return true;
}

// Original snapshot builder, extracted so loadDB can re-run it after purge.
async function loadDBSnapshot() {
  const tables = await Promise.all([
    supabase.from("pb_leagues").select("*"),
    supabase.from("pb_players").select("*"),
    supabase.from("pb_registrations").select("*"),
    supabase.from("pb_schedules").select("*"),
    supabase.from("pb_scores").select("*"),
    supabase.from("pb_locked_weeks").select("*"),
    supabase.from("pb_config").select("*").eq("id", 1),
    supabase.from("pb_checkins").select("*"),
    // Phase 2 / v1.1.0 — multi-tenancy. Clubs are the top-level scope;
    // memberships are the many-to-many link between players and clubs.
    supabase.from("pb_clubs").select("*"),
    supabase.from("pb_memberships").select("*"),
  ]);

  const [leaguesRes, playersRes, regsRes, schedRes, scoresRes, locksRes, configRes, checkinsRes,
         clubsRes, membershipsRes] = tables;

  // Fail loud if any table errors — better than silently returning empty data
  for (const r of tables) {
    if (r.error) {
      console.error("[loadDB] Supabase error:", r.error);
      throw r.error;
    }
  }

  const cfg = configRes.data?.[0] || {};
  const nextId = cfg.next_id || { league: 1, player: 1 };

  const leagueMap = {}, playerMap = {}, regMap = {}, scheduleMap = {}, scoreMap = {}, lockedMap = {}, checkInMap = {};
  const clubMap = {}, membershipMap = {};
  leaguesRes.data.forEach(r => { leagueMap[r.id] = r.data; });
  playersRes.data.forEach(r => { playerMap[r.id] = r.data; });
  regsRes.data.forEach(r => { regMap[r.key] = r.data; });
  schedRes.data.forEach(r => { scheduleMap[r.league_id] = r.data; });
  scoresRes.data.forEach(r => { scoreMap[r.key] = r.data; });
  locksRes.data.forEach(r => { lockedMap[r.key] = true; });
  (checkinsRes.data || []).forEach(r => { checkInMap[r.key] = r.data; });
  (clubsRes.data || []).forEach(r => { clubMap[r.id] = r.data; });
  (membershipsRes.data || []).forEach(r => { membershipMap[r.key] = r.data; });

  console.log(
    `[loadDB] players=${playersRes.data.length} leagues=${leaguesRes.data.length}`,
    `regs=${regsRes.data.length} checkins=${checkinsRes.data?.length || 0}`,
    `clubs=${clubsRes.data?.length || 0} memberships=${membershipsRes.data?.length || 0}`,
    `nextId=`, nextId
  );

  return {
    leagues: leagueMap, players: playerMap, registrations: regMap,
    schedules: scheduleMap, scores: scoreMap, lockedWeeks: lockedMap,
    checkIns: checkInMap,
    clubs: clubMap, memberships: membershipMap,
    nextId,
  };
}

// ─── Atomic action helpers ──────────────────────────────────────────────────
async function getCurrentNextId() {
  const { data, error } = await supabase
    .from("pb_config").select("next_id").eq("id", 1).single();
  if (error) throw error;
  return data.next_id || { league: 1, player: 1 };
}

export async function dbCreatePlayer(playerData) {
  // Read current nextId from DB (avoids stale closure issues)
  const nextId = await getCurrentNextId();
  const id = `player_${nextId.player}`;
  const player = { ...playerData, id, createdAt: new Date().toISOString() };
  const newNextId = { ...nextId, player: nextId.player + 1 };

  console.log("[dbCreatePlayer] writing", id, player);

  const { error: pErr } = await supabase
    .from("pb_players").upsert({ id, data: player });
  if (pErr) { console.error("[dbCreatePlayer] player error:", pErr); throw pErr; }

  const { error: cErr } = await supabase
    .from("pb_config").update({ next_id: newNextId }).eq("id", 1);
  if (cErr) { console.error("[dbCreatePlayer] config error:", cErr); throw cErr; }

  console.log("[dbCreatePlayer] success");
  return id;
}

export async function dbUpdatePlayer(id, patch) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_players").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, ...patch };
  const { error } = await supabase.from("pb_players").upsert({ id, data: updated });
  if (error) throw error;
}

export async function dbCreateLeague(leagueData, colorIndex, clubId) {
  if (!clubId) throw new Error("dbCreateLeague: clubId is required");
  const nextId = await getCurrentNextId();
  const id = `league_${nextId.league}`;
  const league = {
    ...leagueData, id,
    clubId, // multi-tenancy: every league belongs to exactly one club
    color: LEAGUE_COLORS[colorIndex % LEAGUE_COLORS.length],
    createdAt: new Date().toISOString(),
  };
  const newNextId = { ...nextId, league: nextId.league + 1 };

  const { error: lErr } = await supabase
    .from("pb_leagues").upsert({ id, data: league });
  if (lErr) throw lErr;
  const { error: cErr } = await supabase
    .from("pb_config").update({ next_id: newNextId }).eq("id", 1);
  if (cErr) throw cErr;
  return id;
}

export async function dbUpdateLeague(id, patch) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_leagues").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, ...patch };
  const { error } = await supabase.from("pb_leagues").upsert({ id, data: updated });
  if (error) throw error;
}

// Soft-delete: stamps `deletedAt` on the league JSON. Registrations, schedules,
// and scores are left intact, so a restore brings the full league back. After
// TRASH_RETENTION_DAYS, the league + its dependent rows are hard-deleted by the
// auto-purge on next loadDB.
export async function dbSoftDeleteLeague(id) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_leagues").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, deletedAt: new Date().toISOString() };
  const { error } = await supabase.from("pb_leagues").upsert({ id, data: updated });
  if (error) throw error;
}

export async function dbRestoreLeague(id) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_leagues").select("data").eq("id", id).single();
  if (e1) throw e1;
  const { deletedAt, ...rest } = existing.data;
  const { error } = await supabase.from("pb_leagues").upsert({ id, data: rest });
  if (error) throw error;
}

// Hard-delete cascade: the original `dbDeleteLeague`. Used by the trash UI's
// "Delete Forever" button and the 30-day auto-purge.
export async function dbHardDeleteLeague(id) {
  const results = await Promise.all([
    supabase.from("pb_leagues").delete().eq("id", id),
    supabase.from("pb_schedules").delete().eq("league_id", id),
    supabase.from("pb_registrations").delete().like("key", `${id}_%`),
    supabase.from("pb_scores").delete().like("key", `${id}_%`),
    supabase.from("pb_locked_weeks").delete().like("key", `${id}_%`),
    supabase.from("pb_checkins").delete().like("key", `${id}_%`),
  ]);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}

export async function dbRegisterForLeague(leagueId, playerId) {
  const key = `${leagueId}_${playerId}`;
  const reg = { leagueId, playerId, key, paid: false, registeredAt: new Date().toISOString() };
  const { error: rErr } = await supabase
    .from("pb_registrations").upsert({ key, data: reg });
  if (rErr) throw rErr;
  // Reset schedule for that league since the roster changed
  const { error: sErr } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: { weeks: [] } });
  if (sErr) throw sErr;
}

export async function dbRemovePlayerFromLeague(leagueId, playerId) {
  const key = `${leagueId}_${playerId}`;
  const { error: rErr } = await supabase
    .from("pb_registrations").delete().eq("key", key);
  if (rErr) throw rErr;
  const { error: sErr } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: { weeks: [] } });
  if (sErr) throw sErr;
}

export async function dbToggleRegPaid(leagueId, playerId) {
  const key = `${leagueId}_${playerId}`;
  const { data: existing, error: e1 } = await supabase
    .from("pb_registrations").select("data").eq("key", key).single();
  if (e1) throw e1;
  const updated = {
    ...existing.data,
    paid: !existing.data.paid,
    paidAt: !existing.data.paid ? new Date().toISOString() : null,
  };
  const { error } = await supabase
    .from("pb_registrations").upsert({ key, data: updated });
  if (error) throw error;
}

// Write a week's date + time, plus optional per-court name/time overrides.
// `courtOverrides` is an array indexed by court position, e.g.
//   [{ name: "8AM North", time: "08:00" }, { name: "", time: "08:00" }, ...]
// An empty/missing entry means "no override" — the court falls back to the
// week's date/time and the generator's default court name. To clear an
// override, pass { name: "", time: "" } for that position.
// If `courtOverrides` is undefined, only date/time are updated (existing
// court overrides are preserved).
// `applyTo` can be "this" (default — update only weekNum) or "all" (apply the
// same court overrides + time to every real, non-placeholder week).
export async function dbWriteWeekDateTime(leagueId, weekNum, date, time, courtOverrides, applyTo = "this") {
  const { data, error: e1 } = await supabase
    .from("pb_schedules").select("data").eq("league_id", leagueId).single();
  if (e1 && e1.code !== "PGRST116") throw e1;
  const sched = data?.data || { weeks: [] };
  const existing = sched.weeks || [];

  // Reusable function: apply name/time changes to one week's courts.
  // Returns a new courts array; falls through to the existing courts when
  // `courtOverrides` isn't provided.
  function applyCourtOverrides(courts) {
    if (!courtOverrides) return courts;
    return courts.map((ct, i) => {
      const o = courtOverrides[i];
      if (!o) return ct;
      const updated = { ...ct };
      // Empty string means "clear the override". Non-empty means "set".
      if (o.name !== undefined) {
        if (o.name) updated.customName = o.name;
        else delete updated.customName;
      }
      if (o.time !== undefined) {
        if (o.time) updated.time = o.time;
        else delete updated.time;
      }
      return updated;
    });
  }

  let weeks;
  if (applyTo === "all") {
    // Update this week's date/time, plus apply the same court overrides AND
    // time to every other real (non-placeholder) week. Other weeks keep
    // their own date — only time + court-overrides get copied.
    weeks = existing.map(w => {
      if (w.week === weekNum) {
        return { ...w, date, time: time || null, courts: applyCourtOverrides(w.courts || []) };
      }
      if (w.placeholder || !w.courts || w.courts.length === 0) return w;
      return {
        ...w,
        time: time || w.time || null,
        courts: applyCourtOverrides(w.courts),
      };
    });
    // If this week didn't exist, add it as a placeholder
    if (!existing.find(w => w.week === weekNum)) {
      weeks = [...weeks, { week: weekNum, date, time: time || null, courts: [], placeholder: true }]
        .sort((a, b) => a.week - b.week);
    }
  } else {
    // Just update this one week
    const found = existing.find(w => w.week === weekNum);
    if (found) {
      weeks = existing.map(w =>
        w.week === weekNum
          ? { ...w, date, time: time || null, courts: applyCourtOverrides(w.courts || []) }
          : w
      );
    } else {
      weeks = [...existing, { week: weekNum, date, time: time || null, courts: [], placeholder: true }]
        .sort((a, b) => a.week - b.week);
    }
  }

  const { error: e2 } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: { ...sched, weeks } });
  if (e2) throw e2;
}

export async function dbWriteSchedule(leagueId, scheduleData) {
  const { error } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: scheduleData });
  if (error) throw error;
}

export async function dbRebalanceWeek(leagueId, weekNum, newCourts) {
  // Atomic-ish rebalance: write the new courts for one week, and delete ALL
  // scores for that week (because match IDs are deterministic — w{N}_c{C}_m{M}
  // — and would otherwise be silently re-attributed to different matches with
  // the same ID after the rebuild).
  const { data, error: e1 } = await supabase
    .from("pb_schedules").select("data").eq("league_id", leagueId).single();
  if (e1) throw e1;
  const sched = data?.data || { weeks: [] };
  const weeks = (sched.weeks || []).map(w =>
    w.week === weekNum ? { ...w, courts: newCourts, placeholder: false } : w
  );
  if (!weeks.find(w => w.week === weekNum)) {
    weeks.push({ week: weekNum, date: "", time: null, courts: newCourts });
  }
  const results = await Promise.all([
    supabase.from("pb_schedules").upsert({ league_id: leagueId, data: { ...sched, weeks } }),
    supabase.from("pb_scores").delete().like("key", `${leagueId}_${weekNum}_%`),
  ]);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}

export async function dbWriteScore(leagueId, week, matchId, homeScore, awayScore) {
  const key = `${leagueId}_${week}_${matchId}`;
  const data = { homeScore: +homeScore, awayScore: +awayScore, submittedAt: new Date().toISOString() };
  const { error } = await supabase.from("pb_scores").upsert({ key, data });
  if (error) throw error;
}

export async function dbToggleLockWeek(leagueId, week) {
  const key = `${leagueId}_w${week}`;
  const { data: existing } = await supabase
    .from("pb_locked_weeks").select("key").eq("key", key);
  if (existing && existing.length > 0) {
    const { error } = await supabase.from("pb_locked_weeks").delete().eq("key", key);
    if (error) throw error;
    return false; // unlocked
  } else {
    const { error } = await supabase.from("pb_locked_weeks").upsert({ key });
    if (error) throw error;
    return true; // locked
  }
}

export async function dbSetCheckIn(leagueId, week, playerId, status, subName) {
  const key = `${leagueId}_w${week}_${playerId}`;
  const data = {
    leagueId, week, playerId, status,
    subName: status === "sub" ? (subName || "").trim() || null : null,
    updatedAt: new Date().toISOString(),
  };
  if (status === null) {
    const { error } = await supabase.from("pb_checkins").delete().eq("key", key);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("pb_checkins").upsert({ key, data });
    if (error) throw error;
  }
}

// Soft-delete: stamps `deletedAt` on the player JSON. Registrations and
// check-ins are preserved, so a restore returns the player to all their
// leagues. After TRASH_RETENTION_DAYS, the player + dependent rows are
// hard-deleted by the auto-purge on next loadDB.
export async function dbSoftDeletePlayer(playerId) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_players").select("data").eq("id", playerId).single();
  if (e1) throw e1;
  const updated = { ...existing.data, deletedAt: new Date().toISOString() };
  const { error } = await supabase.from("pb_players").upsert({ id: playerId, data: updated });
  if (error) throw error;
}

export async function dbRestorePlayer(playerId) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_players").select("data").eq("id", playerId).single();
  if (e1) throw e1;
  const { deletedAt, ...rest } = existing.data;
  const { error } = await supabase.from("pb_players").upsert({ id: playerId, data: rest });
  if (error) throw error;
}

// Hard-delete cascade: the original `dbDeletePlayer`. Used by the trash UI's
// "Delete Forever" button and the 30-day auto-purge.
export async function dbHardDeletePlayer(playerId) {
  // Cascade: delete the player + all their registrations + check-ins
  const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
    supabase.from("pb_players").delete().eq("id", playerId),
    supabase.from("pb_registrations").delete().like("key", `%_${playerId}`),
    supabase.from("pb_checkins").delete().like("key", `%_${playerId}`),
  ]);
  if (e1 || e2 || e3) throw (e1 || e2 || e3);
}

// ─── Club operations ────────────────────────────────────────────────────
// Phase 2 / v1.1.0 — multi-tenancy. Clubs are the top-level scope. Each
// has exactly one owner and an admin list. Per the access rules: any admin
// can ADD admins, but only the owner can REMOVE admins. This prevents a
// malicious admin from kicking other admins (or the owner) out.

// Phase 3 / v1.2.0 — public club creation. Takes a club name + owner
// info + a join code (caller generates it client-side so it can show
// the code in the UI before/after creation). Bumps next_id.club. Returns
// the new clubId. Does NOT create the owner's player record or their
// membership — the caller is responsible for sequencing those, because
// the owner may already exist (e.g. some future "let an existing player
// create a second club" flow).
export async function dbCreateClub({ name, ownerEmail, joinCode }) {
  if (!name?.trim()) throw new Error("dbCreateClub: name is required");
  if (!ownerEmail?.trim()) throw new Error("dbCreateClub: ownerEmail is required");
  if (!joinCode?.trim()) throw new Error("dbCreateClub: joinCode is required");

  // Read+bump next_id.club. Same pattern as dbCreatePlayer for player IDs.
  const nextId = await getCurrentNextId();
  const clubCounter = nextId.club || 1;
  const id = `club_${clubCounter}`;
  const newNextId = { ...nextId, club: clubCounter + 1 };

  const club = {
    id,
    name: name.trim(),
    ownerEmail: ownerEmail.trim().toLowerCase(),
    adminEmails: [],
    joinCode: joinCode.trim(),
    createdAt: new Date().toISOString(),
  };

  const { error: cErr } = await supabase.from("pb_clubs").upsert({ id, data: club });
  if (cErr) throw cErr;
  const { error: nErr } = await supabase
    .from("pb_config").update({ next_id: newNextId }).eq("id", 1);
  if (nErr) throw nErr;

  return id;
}

export async function dbUpdateClub(id, patch) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_clubs").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, ...patch };
  const { error } = await supabase.from("pb_clubs").upsert({ id, data: updated });
  if (error) throw error;
}

// Any admin (or the owner) can add another admin. Returns
//   { ok: true } on success
//   { ok: false, reason: "already_admin" } when the email is already on
//     the list, or is already the owner (which makes them implicitly an
//     admin anyway).
export async function dbAddClubAdmin(clubId, email) {
  const lower = (email || "").trim().toLowerCase();
  if (!lower) return { ok: false, reason: "empty_email" };
  const { data: existing, error: e1 } = await supabase
    .from("pb_clubs").select("data").eq("id", clubId).single();
  if (e1) throw e1;
  const club = existing.data;
  if ((club.ownerEmail || "").toLowerCase() === lower) {
    return { ok: false, reason: "already_admin" }; // owner is already implicit admin
  }
  const list = club.adminEmails || [];
  if (list.map(x => (x || "").toLowerCase()).includes(lower)) {
    return { ok: false, reason: "already_admin" };
  }
  const updated = { ...club, adminEmails: [...list, lower] };
  const { error } = await supabase.from("pb_clubs").upsert({ id: clubId, data: updated });
  if (error) throw error;
  return { ok: true };
}

// Only the owner can remove an admin. The owner cannot be removed via
// this path — that's the dbTransferOwnership flow.
// The caller (App.jsx) is also responsible for checking that the
// invoker is the owner before calling; this DB-side check is defensive,
// not the authority.
export async function dbRemoveClubAdmin(clubId, email, invokerEmail) {
  const lower = (email || "").toLowerCase();
  if (!lower) return { ok: false, reason: "empty_email" };
  const { data: existing, error: e1 } = await supabase
    .from("pb_clubs").select("data").eq("id", clubId).single();
  if (e1) throw e1;
  const club = existing.data;
  const ownerLower = (club.ownerEmail || "").toLowerCase();
  if (lower === ownerLower) {
    return { ok: false, reason: "is_owner" };
  }
  if ((invokerEmail || "").toLowerCase() !== ownerLower) {
    return { ok: false, reason: "not_owner" };
  }
  const list = (club.adminEmails || []).filter(
    e => (e || "").toLowerCase() !== lower
  );
  const updated = { ...club, adminEmails: list };
  const { error } = await supabase.from("pb_clubs").upsert({ id: clubId, data: updated });
  if (error) throw error;
  return { ok: true };
}

// Phase 4 / v1.4.0 — transfer ownership of a club to one of its current
// admins. The new owner must already be in `adminEmails` (the UI gates this);
// we still verify on the DB side. The previous owner becomes a regular admin
// so they retain access. No-op if the target is already the owner.
//
// Returns { ok: true } on success, or { ok: false, reason } if the target
// isn't currently an admin of the club.
export async function dbTransferOwnership(clubId, newOwnerEmail) {
  const lower = (newOwnerEmail || "").trim().toLowerCase();
  if (!lower) return { ok: false, reason: "empty_email" };

  const { data: existing, error: e1 } = await supabase
    .from("pb_clubs").select("data").eq("id", clubId).single();
  if (e1) throw e1;
  const club = existing.data;
  const oldOwnerLower = (club.ownerEmail || "").toLowerCase();

  if (lower === oldOwnerLower) {
    // Already owner — no-op, but successful.
    return { ok: true };
  }

  const oldAdmins = (club.adminEmails || []).map(e => (e || "").toLowerCase());
  if (!oldAdmins.includes(lower)) {
    return { ok: false, reason: "not_admin" };
  }

  // Promote: remove the new owner from adminEmails, demote the old owner
  // into adminEmails so they retain access. Edge case: if the old owner
  // happened to also be in adminEmails (shouldn't, but defend), dedupe.
  const newAdmins = oldAdmins.filter(e => e !== lower && e !== oldOwnerLower);
  if (oldOwnerLower) newAdmins.push(oldOwnerLower);

  const updated = { ...club, ownerEmail: lower, adminEmails: newAdmins };
  const { error } = await supabase.from("pb_clubs").upsert({ id: clubId, data: updated });
  if (error) throw error;
  return { ok: true };
}

// Phase 4 / v1.4.0 — soft-delete a club. Cascades to its leagues and
// memberships (sets deletedAt on each). Identity records (pb_players) are
// NOT touched — they're global and may belong to other clubs.
//
// After TRASH_RETENTION_DAYS, dbHardDeleteClub will fully purge everything
// via the auto-purge on next loadDB.
//
// We deliberately don't expose an in-app restore for clubs. If a user
// regrets the deletion within the retention window, support can clear the
// `deletedAt` field on pb_clubs, pb_leagues (where data.clubId matches),
// and pb_memberships (where key starts with the clubId prefix) manually.
export async function dbSoftDeleteClub(clubId) {
  if (!clubId) throw new Error("dbSoftDeleteClub: clubId is required");
  const now = new Date().toISOString();

  // 1. Stamp the club itself
  const { data: existing, error: e1 } = await supabase
    .from("pb_clubs").select("data").eq("id", clubId).single();
  if (e1) throw e1;
  if (existing.data.deletedAt) {
    // Already trashed — nothing to do
    return;
  }
  const clubUpdated = { ...existing.data, deletedAt: now };
  const { error: e2 } = await supabase
    .from("pb_clubs").upsert({ id: clubId, data: clubUpdated });
  if (e2) throw e2;

  // 2. Cascade to all of this club's leagues. We pull all leagues and
  // filter in JS rather than relying on a LIKE pattern, because the clubId
  // is embedded in the JSON `data.clubId` field, not the row id.
  const { data: allLeagues, error: e3 } = await supabase
    .from("pb_leagues").select("id, data");
  if (e3) throw e3;
  const clubLeagues = (allLeagues || []).filter(l =>
    l.data?.clubId === clubId && !l.data?.deletedAt
  );
  for (const l of clubLeagues) {
    const lUpdated = { ...l.data, deletedAt: now };
    const { error } = await supabase
      .from("pb_leagues").upsert({ id: l.id, data: lUpdated });
    if (error) throw error;
  }

  // 3. Cascade to memberships. Filter by key prefix in JS rather than
  // SQL LIKE so we don't hit the underscore-as-wildcard quirk (e.g.
  // "club_1_%" would also match "club_10_...").
  const { data: allMemberships, error: e4 } = await supabase
    .from("pb_memberships").select("key, data");
  if (e4) throw e4;
  const clubMemberships = (allMemberships || []).filter(m =>
    m.key.startsWith(`${clubId}_`) && !m.data?.deletedAt
  );
  for (const m of clubMemberships) {
    const mUpdated = { ...m.data, deletedAt: now };
    const { error } = await supabase
      .from("pb_memberships").upsert({ key: m.key, data: mUpdated });
    if (error) throw error;
  }
}

// Phase 4 / v1.4.0 — hard-delete a club and everything that belongs to it.
// Called only by the 30-day auto-purge. Not exposed to the UI — the only
// in-app delete path is the soft-delete above.
//
// Order of operations:
//   1. Hard-delete each league in the club (cascades to its scores,
//      registrations, schedules, locked_weeks, checkins via the existing
//      dbHardDeleteLeague).
//   2. Delete all memberships for the club.
//   3. Delete the club row itself.
//
// Player rows (pb_players) are global identity and are NOT touched here —
// players may belong to other clubs, and even if they don't, they can
// re-join a different club later.
export async function dbHardDeleteClub(clubId) {
  if (!clubId) throw new Error("dbHardDeleteClub: clubId is required");

  // 1. Cascade leagues. Filter in JS by data.clubId.
  const { data: allLeagues, error: e1 } = await supabase
    .from("pb_leagues").select("id, data");
  if (e1) throw e1;
  const clubLeagueIds = (allLeagues || [])
    .filter(l => l.data?.clubId === clubId)
    .map(l => l.id);
  for (const lid of clubLeagueIds) {
    await dbHardDeleteLeague(lid);
  }

  // 2. Delete memberships. Filter by key prefix in JS to dodge the LIKE
  // underscore quirk.
  const { data: allMemberships, error: e2 } = await supabase
    .from("pb_memberships").select("key");
  if (e2) throw e2;
  const clubMembershipKeys = (allMemberships || [])
    .filter(m => m.key.startsWith(`${clubId}_`))
    .map(m => m.key);
  if (clubMembershipKeys.length > 0) {
    const { error } = await supabase
      .from("pb_memberships").delete().in("key", clubMembershipKeys);
    if (error) throw error;
  }

  // 3. Delete the club row.
  const { error: e3 } = await supabase.from("pb_clubs").delete().eq("id", clubId);
  if (e3) throw e3;
}

// ─── Membership operations ──────────────────────────────────────────────
// A membership links a player to a club. Identity is global; club presence
// is a per-club membership row. Soft-delete via `deletedAt` so we can
// distinguish "left the club" from "never joined" without losing the join
// history.

export async function dbCreateMembership(clubId, playerId) {
  if (!clubId || !playerId) throw new Error("dbCreateMembership: clubId and playerId required");
  const key = `${clubId}_${playerId}`;
  const data = {
    clubId, playerId,
    joinedAt: new Date().toISOString(),
  };
  // Upsert so a re-join after a soft-delete cleanly resets joinedAt.
  const { error } = await supabase.from("pb_memberships").upsert({ key, data });
  if (error) throw error;
}

export async function dbRemoveMembership(clubId, playerId) {
  const key = `${clubId}_${playerId}`;
  // Read existing first to preserve joinedAt etc on the soft-delete record.
  const { data: existing, error: e1 } = await supabase
    .from("pb_memberships").select("data").eq("key", key).maybeSingle();
  if (e1) throw e1;
  if (!existing) return; // no-op if nothing to remove
  const updated = { ...existing.data, deletedAt: new Date().toISOString() };
  const { error } = await supabase.from("pb_memberships").upsert({ key, data: updated });
  if (error) throw error;
}

export const defaultDB = () => ({
  leagues: {}, players: {}, registrations: {}, schedules: {},
  scores: {}, lockedWeeks: {}, checkIns: {},
  clubs: {}, memberships: {},
  nextId: { league: 1, player: 1 },
});
