// ─── Supabase client and storage helpers ────────────────────────────────────
// All `dbXxx` functions follow a write-first pattern: every write hits
// Supabase first (awaited). The caller is responsible for re-fetching state
// after a successful write so React never shows data that isn't in the DB.
import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN, LEAGUE_COLORS, TRASH_RETENTION_DAYS } from "./constants.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local");
}

export const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "", {
  auth: { persistSession: false }, // app handles its own auth
});

// ─── Full snapshot loader ───────────────────────────────────────────────────
// Also runs the 30-day trash auto-purge: any league or player whose
// `data.deletedAt` is older than TRASH_RETENTION_DAYS gets hard-deleted (with
// full cascade) before the snapshot is built. This makes purge opportunistic —
// it happens on the next loadDB after the retention window passes, with no
// background job needed.
export async function loadDB() {
  await purgeExpiredTrash();
  return loadDBSnapshot();
}

// Find every league/player in the trash whose retention window has passed,
// hard-delete them (cascading their dependent rows). Returns true if anything
// was purged. Tolerant of errors per row — one failure doesn't block others.
async function purgeExpiredTrash() {
  const cutoffMs = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = (record) => {
    const d = record.data?.deletedAt;
    if (!d) return false;
    const t = Date.parse(d);
    return Number.isFinite(t) && t < cutoffMs;
  };

  const [leagues, players] = await Promise.all([
    supabase.from("pb_leagues").select("id, data"),
    supabase.from("pb_players").select("id, data"),
  ]);
  if (leagues.error || players.error) {
    console.error("[purgeExpiredTrash] skipped:", leagues.error || players.error);
    return false;
  }

  const expiredLeagues = (leagues.data || []).filter(expired);
  const expiredPlayers = (players.data || []).filter(expired);
  if (expiredLeagues.length === 0 && expiredPlayers.length === 0) return false;

  console.log(
    `[purgeExpiredTrash] purging ${expiredLeagues.length} leagues, ${expiredPlayers.length} players`
  );

  // Cascade each one (intentionally not wrapped in Promise.all so a single
  // failure doesn't block the rest). Errors are logged but swallowed; whatever
  // didn't purge today will try again tomorrow.
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
  ]);

  const [leaguesRes, playersRes, regsRes, schedRes, scoresRes, locksRes, configRes, checkinsRes] = tables;

  // Fail loud if any table errors — better than silently returning empty data
  for (const r of tables) {
    if (r.error) {
      console.error("[loadDB] Supabase error:", r.error);
      throw r.error;
    }
  }

  const cfg = configRes.data?.[0] || {};
  const nextId = cfg.next_id || { league: 1, player: 1 };
  const adminEmails = (Array.isArray(cfg.admin_emails) && cfg.admin_emails.length)
    ? cfg.admin_emails
    : [SUPER_ADMIN];

  const leagueMap = {}, playerMap = {}, regMap = {}, scheduleMap = {}, scoreMap = {}, lockedMap = {}, checkInMap = {};
  leaguesRes.data.forEach(r => { leagueMap[r.id] = r.data; });
  playersRes.data.forEach(r => { playerMap[r.id] = r.data; });
  regsRes.data.forEach(r => { regMap[r.key] = r.data; });
  schedRes.data.forEach(r => { scheduleMap[r.league_id] = r.data; });
  scoresRes.data.forEach(r => { scoreMap[r.key] = r.data; });
  locksRes.data.forEach(r => { lockedMap[r.key] = true; });
  (checkinsRes.data || []).forEach(r => { checkInMap[r.key] = r.data; });

  console.log(
    `[loadDB] players=${playersRes.data.length} leagues=${leaguesRes.data.length}`,
    `regs=${regsRes.data.length} checkins=${checkinsRes.data?.length || 0} nextId=`, nextId
  );

  return {
    leagues: leagueMap, players: playerMap, registrations: regMap,
    schedules: scheduleMap, scores: scoreMap, lockedWeeks: lockedMap,
    checkIns: checkInMap,
    adminEmails, nextId,
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

export async function dbCreateLeague(leagueData, colorIndex) {
  const nextId = await getCurrentNextId();
  const id = `league_${nextId.league}`;
  const league = {
    ...leagueData, id,
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

export async function dbAddAdmin(email) {
  const { data: cfg, error: e1 } = await supabase
    .from("pb_config").select("admin_emails").eq("id", 1).single();
  if (e1) throw e1;
  const list = cfg.admin_emails || [SUPER_ADMIN];
  const lower = email.trim().toLowerCase();
  if (list.map(x => x.toLowerCase()).includes(lower)) {
    return { ok: false, reason: "already_admin" };
  }
  const { error } = await supabase
    .from("pb_config").update({ admin_emails: [...list, lower] }).eq("id", 1);
  if (error) throw error;
  return { ok: true };
}

export async function dbRemoveAdmin(email) {
  if (email.toLowerCase() === SUPER_ADMIN.toLowerCase()) {
    return { ok: false, reason: "super_admin" };
  }
  const { data: cfg, error: e1 } = await supabase
    .from("pb_config").select("admin_emails").eq("id", 1).single();
  if (e1) throw e1;
  const list = (cfg.admin_emails || [SUPER_ADMIN]).filter(
    e => e.toLowerCase() !== email.toLowerCase()
  );
  const { error } = await supabase
    .from("pb_config").update({ admin_emails: list }).eq("id", 1);
  if (error) throw error;
  return { ok: true };
}

export const defaultDB = () => ({
  leagues: {}, players: {}, registrations: {}, schedules: {},
  scores: {}, lockedWeeks: {}, checkIns: {}, adminEmails: [SUPER_ADMIN],
  nextId: { league: 1, player: 1 },
});
