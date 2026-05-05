import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase Client ──────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPER_ADMIN = "ross.lazar@gmail.com";

// Date/time display helpers — render in the device's local format.
// Stored values are wall-clock at the venue, so we just reformat for display.
function formatDate(iso) {
  if (!iso) return "";
  // Parse "2025-09-15" as local-noon to avoid the UTC-midnight-becomes-prev-day bug
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function formatTime(hhmm) {
  if (!hhmm) return "";
  // Parse "18:00" as today at that local time, then format with locale conventions
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}
function formatDateTime(iso, hhmm) {
  const datePart = formatDate(iso);
  const timePart = formatTime(hhmm);
  if (datePart && timePart) return `${datePart} · ${timePart}`;
  return datePart || timePart || "";
}

// Display name helper: "Jane S." from a player record.
// Backward-compat: if a player only has the legacy single-field `name`, returns
// it as-is. New players store firstName + lastName separately.
function formatPlayerName(p) {
  if (!p) return "Unknown";
  if (p.firstName) {
    const initial = p.lastName ? `${p.lastName[0].toUpperCase()}.` : "";
    return initial ? `${p.firstName} ${initial}` : p.firstName;
  }
  return p.name || "Unknown";
}
function playerInitial(p) {
  if (!p) return "?";
  return (p.firstName?.[0] || p.name?.[0] || "?").toUpperCase();
}
function playerFullName(p) {
  if (!p) return "Unknown";
  if (p.firstName) return `${p.firstName} ${p.lastName || ""}`.trim();
  return p.name || "Unknown";
}
// ─── Session persistence (browser localStorage) ─────────────────────────────
const SESSION_KEY = "pickleball_session_v1";
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) { return {}; }
}
function saveSession(s) {
  try {
    if (!s || (!s.playerId && !s.adminEmail)) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch (_) {}
}

// For commissioners viewing a ladder league, build placeholder week stubs
// for any weeks not yet generated, so the schedule UI shows the full season.
// Mixer leagues already contain all weeks from generation.
// Stored placeholders (from commissioner editing date/time before generation)
// are kept as-is.
function buildDisplayWeeks(league, schedule) {
  const real = (schedule?.weeks || []);
  const totalWeeks = league.weeks || 0;
  // Index existing weeks by number (covers both real generated weeks and stored placeholders)
  const existing = {};
  real.forEach(w => { existing[w.week] = w; });
  const startDate = league.startDate;
  const out = [];
  for (let n = 1; n <= totalWeeks; n++) {
    if (existing[n]) {
      out.push(existing[n]);
      continue;
    }
    // Synthesize a placeholder using the previous week's date if possible
    let dateStr;
    const prev = out[out.length - 1];
    if (prev?.date) {
      const d = new Date(prev.date);
      d.setDate(d.getDate() + 7);
      dateStr = d.toISOString().split("T")[0];
    } else if (startDate) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + (n - 1) * 7);
      dateStr = d.toISOString().split("T")[0];
    } else {
      dateStr = "";
    }
    out.push({ week: n, date: dateStr, time: null, courts: [], placeholder: true });
  }
  return out;
}

// Sort leagues for display: active first, then open/completed (newest first within),
// then archived last. Returns a new array.
const STATUS_ORDER = { active: 0, open: 1, completed: 2, archived: 3 };
function sortLeagues(leagues) {
  return [...leagues].sort((a, b) => {
    const sa = STATUS_ORDER[a.status || "open"] ?? 1;
    const sb = STATUS_ORDER[b.status || "open"] ?? 1;
    if (sa !== sb) return sa - sb;
    // Within the same status, newest first
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

function playerSearchString(p) {
  if (!p) return "";
  const parts = [p.firstName, p.lastName, p.name, p.email].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_ANON_KEY || "", {
  auth: { persistSession: false }, // app handles its own auth
});

// ─── Data layer ───────────────────────────────────────────────────────────────
// Pattern: every write hits Supabase first (awaited). Only after a successful
// write do we re-fetch state and update React. This means React never shows
// data that isn't in the database. No optimistic updates, no diff tracking,
// no module-level caches that can desync from reality.

async function loadDB() {
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

// ─── Atomic action helpers — each does write(s) then returns ─────────────────
async function getCurrentNextId() {
  const { data, error } = await supabase
    .from("pb_config").select("next_id").eq("id", 1).single();
  if (error) throw error;
  return data.next_id || { league: 1, player: 1 };
}

async function dbCreatePlayer(playerData) {
  // Read current nextId from DB (avoids stale closure issues)
  const nextId = await getCurrentNextId();
  const id = `player_${nextId.player}`;
  const player = { ...playerData, id, createdAt: new Date().toISOString() };
  const newNextId = { ...nextId, player: nextId.player + 1 };

  console.log("[dbCreatePlayer] writing", id, player);

  // Upsert player row
  const { error: pErr } = await supabase
    .from("pb_players").upsert({ id, data: player });
  if (pErr) { console.error("[dbCreatePlayer] player error:", pErr); throw pErr; }

  // Update nextId in config
  const { error: cErr } = await supabase
    .from("pb_config").update({ next_id: newNextId }).eq("id", 1);
  if (cErr) { console.error("[dbCreatePlayer] config error:", cErr); throw cErr; }

  console.log("[dbCreatePlayer] success");
  return id;
}

async function dbUpdatePlayer(id, patch) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_players").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, ...patch };
  const { error } = await supabase.from("pb_players").upsert({ id, data: updated });
  if (error) throw error;
}

async function dbTogglePlayerPaid(id) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_players").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, paid: !existing.data.paid };
  const { error } = await supabase.from("pb_players").upsert({ id, data: updated });
  if (error) throw error;
}

async function dbCreateLeague(leagueData, colorIndex) {
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

async function dbUpdateLeague(id, patch) {
  const { data: existing, error: e1 } = await supabase
    .from("pb_leagues").select("data").eq("id", id).single();
  if (e1) throw e1;
  const updated = { ...existing.data, ...patch };
  const { error } = await supabase.from("pb_leagues").upsert({ id, data: updated });
  if (error) throw error;
}

async function dbDeleteLeague(id) {
  // Cascade: delete league + its registrations + schedule + scores in parallel
  const results = await Promise.all([
    supabase.from("pb_leagues").delete().eq("id", id),
    supabase.from("pb_schedules").delete().eq("league_id", id),
    supabase.from("pb_registrations").delete().like("key", `${id}_%`),
    supabase.from("pb_scores").delete().like("key", `${id}_%`),
  ]);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}

async function dbRegisterForLeague(leagueId, playerId) {
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

async function dbRemovePlayerFromLeague(leagueId, playerId) {
  const key = `${leagueId}_${playerId}`;
  const { error: rErr } = await supabase
    .from("pb_registrations").delete().eq("key", key);
  if (rErr) throw rErr;
  const { error: sErr } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: { weeks: [] } });
  if (sErr) throw sErr;
}

async function dbToggleRegPaid(leagueId, playerId) {
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

async function dbWriteWeekDateTime(leagueId, weekNum, date, time) {
  // Read the current schedule, mutate just the week's date/time, write back.
  // If the week doesn't exist yet (e.g. ladder placeholder), append a stub.
  const { data, error: e1 } = await supabase
    .from("pb_schedules").select("data").eq("league_id", leagueId).single();
  if (e1 && e1.code !== "PGRST116") throw e1; // PGRST116 = no rows
  const sched = data?.data || { weeks: [] };
  const existing = sched.weeks || [];
  const found = existing.find(w => w.week === weekNum);
  let weeks;
  if (found) {
    weeks = existing.map(w =>
      w.week === weekNum ? { ...w, date, time: time || null } : w
    );
  } else {
    // Append placeholder stub so the edit persists even before generation
    weeks = [...existing, { week: weekNum, date, time: time || null, courts: [], placeholder: true }]
      .sort((a, b) => a.week - b.week);
  }
  const { error: e2 } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: { ...sched, weeks } });
  if (e2) throw e2;
}

async function dbWriteSchedule(leagueId, scheduleData) {
  const { error } = await supabase
    .from("pb_schedules").upsert({ league_id: leagueId, data: scheduleData });
  if (error) throw error;
}

async function dbWriteScore(leagueId, week, matchId, homeScore, awayScore) {
  const key = `${leagueId}_${week}_${matchId}`;
  const data = { homeScore: +homeScore, awayScore: +awayScore, submittedAt: new Date().toISOString() };
  const { error } = await supabase.from("pb_scores").upsert({ key, data });
  if (error) throw error;
}

async function dbToggleLockWeek(leagueId, week) {
  const key = `${leagueId}_w${week}`;
  // Check if already locked
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

async function dbSetCheckIn(leagueId, week, playerId, status) {
  const key = `${leagueId}_w${week}_${playerId}`;
  const data = { leagueId, week, playerId, status, updatedAt: new Date().toISOString() };
  if (status === null) {
    const { error } = await supabase.from("pb_checkins").delete().eq("key", key);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("pb_checkins").upsert({ key, data });
    if (error) throw error;
  }
}

async function dbDeletePlayer(playerId) {
  // Cascade: delete the player + all their registrations + check-ins
  const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
    supabase.from("pb_players").delete().eq("id", playerId),
    supabase.from("pb_registrations").delete().like("key", `%_${playerId}`),
    supabase.from("pb_checkins").delete().like("key", `%_${playerId}`),
  ]);
  if (e1 || e2 || e3) throw (e1 || e2 || e3);
}

async function dbAddAdmin(email) {
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

async function dbRemoveAdmin(email) {
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

const defaultDB = () => ({
  leagues: {}, players: {}, registrations: {}, schedules: {},
  scores: {}, lockedWeeks: {}, checkIns: {}, adminEmails: [SUPER_ADMIN],
  nextId: { league: 1, player: 1 },
});

// ─── Court Schedule Generator ─────────────────────────────────────────────────
const MAX_COURTS = 8;
const MIN_PER_COURT = 4;
const MAX_PER_COURT = 5;
// Returns "Court 1", "Court 2", etc. for any index
function courtName(i) { return `Court ${i + 1}`; }
function courtNames(count) { return Array.from({ length: count }, (_, i) => courtName(i)); }
// Backward-compat constant referencing the default 4-court setup
const COURT_NAMES = courtNames(4);

function distributePlayersToCourts(n, maxCourts = 4) {
  // Try every court-count from largest possible down to 1
  for (let nc = Math.min(maxCourts, Math.floor(n / MIN_PER_COURT)); nc >= 1; nc--) {
    const sizes = Array(nc).fill(MIN_PER_COURT);
    let remaining = n - nc * MIN_PER_COURT;
    let i = 0;
    while (remaining > 0 && i < nc) { if (sizes[i] < MAX_PER_COURT) { sizes[i]++; remaining--; } i++; }
    if (remaining === 0) return sizes;
  }
  return null;
}

function seededShuffle(arr, seed) {
  const a = [...arr]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Singles match generator: round-robin within a court group ───────────────
function singlesMatches(group) {
  const matches = [];
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
      matches.push({ home: group[i], away: group[j] });
  return matches;
}

// ─── Doubles match templates ─────────────────────────────────────────────────
// 4 players (no sit-outs): 3 matches, each pair partners once, opposes twice
// Players are indexed 0,1,2,3 in the rotated court group.
const DOUBLES_4_TEMPLATE = [
  { sit: null, t1: [0,1], t2: [2,3] },
  { sit: null, t1: [0,2], t2: [1,3] },
  { sit: null, t1: [0,3], t2: [1,2] },
];

// 5 players (one sits each match): 5 matches, each pair partners once,
// each pair opposes twice. Solved by exhaustive search — all constraints
// satisfied. Players are indexed 0=A, 1=B, 2=C, 3=D, 4=E in rotated group.
const DOUBLES_5_TEMPLATE = [
  { sit: 0, t1: [1,2], t2: [3,4] }, // A sits, B+C vs D+E
  { sit: 1, t1: [0,3], t2: [2,4] }, // B sits, A+D vs C+E
  { sit: 2, t1: [0,4], t2: [1,3] }, // C sits, A+E vs B+D
  { sit: 3, t1: [0,2], t2: [1,4] }, // D sits, A+C vs B+E
  { sit: 4, t1: [0,1], t2: [2,3] }, // E sits, A+B vs C+D
];

function doublesMatches(group, weekSeed) {
  const template = group.length === 5 ? DOUBLES_5_TEMPLATE : DOUBLES_4_TEMPLATE;
  // Rotate which player is "A","B" etc. per week so the sit-out order varies
  const rotated = seededShuffle(group, weekSeed);
  return template.map(m => ({
    sitOut: m.sit !== null ? rotated[m.sit] : null,
    team1: m.t1.map(i => rotated[i]),
    team2: m.t2.map(i => rotated[i]),
  }));
}

// ─── Master schedule generator ───────────────────────────────────────────────
function generateCourtSchedule(playerIds, weeks, startDate, format = "Singles", numCourts = 4, playerGenders = {}) {
  const n = playerIds.length;
  const sizes = distributePlayersToCourts(n, numCourts);
  const minNeeded = MIN_PER_COURT;
  const maxAllowed = numCourts * MAX_PER_COURT;
  if (!sizes) return { error: `Cannot schedule ${n} players. Need ${minNeeded}–${maxAllowed} players (${MIN_PER_COURT}–${MAX_PER_COURT} per court, up to ${numCourts} court${numCourts!==1?"s":""}).` };

  const isDoubles = format === "Doubles" || format === "Mixed Doubles";
  const isMixedDoubles = format === "Mixed Doubles";

  // For singles, track opponent frequency to bias court assignments toward fairness.
  // For doubles, the within-court template already balances partners/opponents
  // perfectly each week, so we just need fair court group rotation.
  const oppCount = {};
  playerIds.forEach(a => { oppCount[a] = {}; playerIds.forEach(b => { if (a !== b) oppCount[a][b] = 0; }); });

  const schedule = [];
  for (let week = 0; week < weeks; week++) {
    const weekDate = new Date(startDate);
    weekDate.setDate(weekDate.getDate() + week * 7);
    const dateStr = weekDate.toISOString().split("T")[0];

    // Sort players by total opponent exposure so far, then shuffle within tiers
    const sorted = [...playerIds].sort((a, b) => {
      const aT = Object.values(oppCount[a]).reduce((s, v) => s + v, 0);
      const bT = Object.values(oppCount[b]).reduce((s, v) => s + v, 0);
      return aT - bT;
    });
    const shuffled = seededShuffle(sorted, week * 7919 + 31337);

    // For Mixed Doubles, partition into men/women queues so each court gets
    // a balanced mix. For other formats, fall back to the simple sequential split.
    let courtGroups;
    if (isMixedDoubles) {
      courtGroups = assignBalancedCourts(shuffled, sizes, playerGenders);
    } else {
      courtGroups = [];
      let idx = 0;
      for (const sz of sizes) {
        courtGroups.push(shuffled.slice(idx, idx + sz));
        idx += sz;
      }
    }

    const courts = [];
    for (let c = 0; c < sizes.length; c++) {
      const group = courtGroups[c];

      let rawMatches;
      if (isDoubles) {
        rawMatches = doublesMatches(group, week * 1009 + c * 7 + 13);
        // Update opponent frequency (each player on team1 opposes each on team2)
        rawMatches.forEach(m => {
          for (const a of m.team1) for (const b of m.team2) {
            oppCount[a][b] = (oppCount[a][b] || 0) + 1;
            oppCount[b][a] = (oppCount[b][a] || 0) + 1;
          }
        });
      } else {
        rawMatches = singlesMatches(group);
        rawMatches.forEach(m => {
          oppCount[m.home][m.away] = (oppCount[m.home][m.away] || 0) + 1;
          oppCount[m.away][m.home] = (oppCount[m.away][m.home] || 0) + 1;
        });
      }

      const matches = rawMatches.map((m, mi) => ({
        id: `w${week + 1}_c${c}_m${mi}`,
        ...m,
        week: week + 1,
        court: courtName(c),
        date: dateStr,
        format: isDoubles ? "doubles" : "singles",
      }));

      courts.push({ courtName: courtName(c), players: group, matches });
    }
    schedule.push({ week: week + 1, date: dateStr, courts });
  }
  return { weeks: schedule };
}

// Distribute players across courts with balanced gender mix.
// Each court gets men:women proportional to the global ratio, ±1.
// Players are pulled from the pre-shuffled queue in order, preserving the
// fairness-by-exposure ordering within each gender.
function assignBalancedCourts(shuffledPlayers, sizes, playerGenders) {
  const men = shuffledPlayers.filter(id => playerGenders[id] === "Male");
  const women = shuffledPlayers.filter(id => playerGenders[id] === "Female");
  const other = shuffledPlayers.filter(id => playerGenders[id] !== "Male" && playerGenders[id] !== "Female");
  const totalN = shuffledPlayers.length;
  const totalMen = men.length;

  // First, compute how many men each court "should" get based on its size and
  // the global ratio. Use largest-remainder method so the sum across courts
  // exactly equals totalMen — no leftovers, no overshoots.
  const rawTargets = sizes.map(sz => sz * totalMen / totalN);
  const flooredTargets = rawTargets.map(Math.floor);
  const assigned = flooredTargets.reduce((a, b) => a + b, 0);
  const leftover = totalMen - assigned;
  // Award the +1s to courts with the largest fractional remainders
  const remainders = rawTargets.map((r, i) => ({ i, frac: r - flooredTargets[i] }));
  remainders.sort((a, b) => b.frac - a.frac);
  const targetsMen = [...flooredTargets];
  for (let k = 0; k < leftover; k++) targetsMen[remainders[k].i]++;
  // Don't ever exceed court size
  for (let i = 0; i < sizes.length; i++) {
    if (targetsMen[i] > sizes[i]) targetsMen[i] = sizes[i];
  }

  const groups = [];
  let menUsed = 0, womenUsed = 0;

  for (let c = 0; c < sizes.length; c++) {
    const courtSize = sizes[c];
    let targetM = targetsMen[c];
    let targetW = courtSize - targetM;

    // Clamp to actually-available players (defensive)
    const remainingMen = men.length - menUsed;
    const remainingWomen = women.length - womenUsed;
    if (targetM > remainingMen) { targetM = remainingMen; targetW = courtSize - targetM; }
    if (targetW > remainingWomen) { targetW = remainingWomen; targetM = courtSize - targetW; }

    const group = [
      ...men.slice(menUsed, menUsed + targetM),
      ...women.slice(womenUsed, womenUsed + targetW),
    ];
    menUsed += targetM;
    womenUsed += targetW;
    groups.push(group);
  }

  // Distribute any unassigned "other"-gender players into the smallest courts
  let otherIdx = 0;
  while (otherIdx < other.length) {
    let smallest = 0;
    for (let c = 1; c < groups.length; c++) {
      if (groups[c].length < groups[smallest].length) smallest = c;
    }
    if (groups[smallest].length >= sizes[smallest]) break;
    groups[smallest].push(other[otherIdx++]);
  }

  // Top off any short courts from leftover men/women queues (safety net)
  for (let c = 0; c < groups.length; c++) {
    while (groups[c].length < sizes[c]) {
      if (menUsed < men.length) groups[c].push(men[menUsed++]);
      else if (womenUsed < women.length) groups[c].push(women[womenUsed++]);
      else break;
    }
  }

  return groups;
}

// ─── Ladder Scheduling ───────────────────────────────────────────────────────
// Compute weekly per-court standings (within one week's matches only).
// Returns { courtIndex → [playerId sorted top → bottom by +/-, then wins] }
function rankCourtPlayers(courtData, scoresMap, leagueId, weekNum) {
  // courtData is a single court object: { courtName, players, matches }
  const stats = {};
  courtData.players.forEach(pid => { stats[pid] = { wins: 0, losses: 0, pf: 0, pa: 0 }; });
  courtData.matches.forEach(match => {
    const score = scoresMap[`${leagueId}_${weekNum}_${match.id}`];
    if (!score) return;
    const sideA = match.format === "doubles" ? match.team1 : [match.home];
    const sideB = match.format === "doubles" ? match.team2 : [match.away];
    const aWon = score.homeScore > score.awayScore;
    sideA.forEach(pid => {
      if (!stats[pid]) return;
      stats[pid].pf += score.homeScore;
      stats[pid].pa += score.awayScore;
      if (aWon) stats[pid].wins++; else stats[pid].losses++;
    });
    sideB.forEach(pid => {
      if (!stats[pid]) return;
      stats[pid].pf += score.awayScore;
      stats[pid].pa += score.homeScore;
      if (!aWon) stats[pid].wins++; else stats[pid].losses++;
    });
  });
  // Sort top to bottom: +/- DESC, wins DESC
  return courtData.players
    .map(pid => ({ pid, ...stats[pid] }))
    .sort((a, b) => (b.pf - b.pa) - (a.pf - a.pa) || b.wins - a.wins)
    .map(s => s.pid);
}

// Move players up/down between courts based on previous-week rankings.
// rules:
//   - All courts: top 2 move up, bottom 2 move down
//   - 5-player court: 3rd place stays
//   - 4-player court: nobody stays in middle (top 2 + bottom 2 = 4)
//   - Top court: top 2 stay (no court above)
//   - Bottom court: bottom 2 stay (no court below)
// Returns array of new court groups (player IDs in each).
function laddderRotate(prevWeekCourts, scoresMap, leagueId, weekNum, courtSizes) {
  const numCourts = prevWeekCourts.length;
  const ranked = prevWeekCourts.map(c => rankCourtPlayers(c, scoresMap, leagueId, weekNum));
  // For each court, partition into: stayUp, stay, stayDown
  // stayUp = top 2 (will move up unless top court)
  // stayDown = bottom 2 (will move down unless bottom court)
  // stay = middle (everyone else)
  const partitions = ranked.map((players, ci) => {
    const isTop = ci === 0;
    const isBottom = ci === numCourts - 1;
    const top2 = players.slice(0, 2);
    const bottom2 = players.slice(-2);
    const middle = players.slice(2, players.length - 2);
    return {
      stay:    [...(isTop ? top2 : []), ...middle, ...(isBottom ? bottom2 : [])],
      moveUp:   isTop    ? [] : top2,
      moveDown: isBottom ? [] : bottom2,
    };
  });

  // Build new court compositions
  const newCourts = partitions.map((p, ci) => {
    const fromBelow = ci < numCourts - 1 ? partitions[ci + 1].moveUp   : [];
    const fromAbove = ci > 0             ? partitions[ci - 1].moveDown : [];
    return [...p.stay, ...fromBelow, ...fromAbove];
  });

  // Sanity: court sizes should match courtSizes (the configured target for this week)
  // If not, fall back to flattening + redistributing
  const sizesMatch = newCourts.every((c, i) => c.length === courtSizes[i]);
  if (!sizesMatch) {
    // Flatten in current order and assign by court size sequentially (shouldn't normally happen)
    const flat = newCourts.flat();
    const out = [];
    let idx = 0;
    for (const sz of courtSizes) { out.push(flat.slice(idx, idx + sz)); idx += sz; }
    return out;
  }
  return newCourts;
}

// Build a single week object from court groups (used by ladder)
function buildLadderWeek(courtGroups, weekNum, dateStr, format) {
  const isDoubles = format === "Doubles" || format === "Mixed Doubles";
  const courts = courtGroups.map((group, c) => {
    let rawMatches;
    if (isDoubles) rawMatches = doublesMatches(group, weekNum * 1009 + c * 7 + 13);
    else            rawMatches = singlesMatches(group);
    const matches = rawMatches.map((m, mi) => ({
      id: `w${weekNum}_c${c}_m${mi}`,
      ...m,
      week: weekNum,
      court: courtName(c),
      date: dateStr,
      format: isDoubles ? "doubles" : "singles",
    }));
    return { courtName: courtName(c), players: group, matches };
  });
  return { week: weekNum, date: dateStr, courts };
}

// ─── Color Themes ─────────────────────────────────────────────────────────────
// CSC Pickleball brand palette — drawn from the club logo
const CSC = {
  blue:        "#1B6CC1",  // primary royal blue (logo background)
  blueDark:    "#0E3A6B",  // dark blue (logo text/title)
  blueLight:   "#E5F0FA",  // pale blue tint for backgrounds
  green:       "#7FC93D",  // bright lime (logo dolphin/swoosh)
  greenDark:   "#4F8C1B",  // accessible green for text/badges
  yellow:      "#FFE82E",  // pickleball ball yellow
};

const COLORS = {
  // CSC primary — used as the default theme everywhere
  csc:    { bg: CSC.blue,   light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
  // Other per-league themes for visual differentiation
  green:  { bg: CSC.greenDark, light: "#EAF6DC", accent: CSC.green, text: "#1F3D08" },
  coral:  { bg: "#D85A30", light: "#FAECE7", accent: "#993C1D", text: "#4A1B0C" },
  purple: { bg: "#534AB7", light: "#EEEDFE", accent: "#7F77DD", text: "#26215C" },
  amber:  { bg: "#BA7517", light: "#FAEEDA", accent: "#EF9F27", text: "#412402" },
  // Backward-compat aliases for any existing leagues created with old keys
  teal:   { bg: CSC.blue, light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
  blue:   { bg: CSC.blue, light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
};
const LEAGUE_COLORS = ["csc", "green", "coral", "purple", "amber"];
const COURT_COLORS = [CSC.blue, CSC.greenDark, "#D85A30", "#534AB7"];

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "'Georgia','Times New Roman',serif" },
  header: (color) => ({ background: color || CSC.blue, color: "#fff", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }),
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px", margin: 0 },
  card: { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "16px 20px", marginBottom: 12 },
  btn: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 500 }),
  btnSm: (v = "primary", color) => ({ background: v === "primary" ? (color || CSC.blue) : "transparent", color: v === "primary" ? "#fff" : "var(--color-text-primary)", border: `0.5px solid ${v === "primary" ? "transparent" : "var(--color-border-secondary)"}`, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 500 }),
  input: { width: "100%", padding: "8px 12px", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" },
  label: { fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4, display: "block" },
  row: { display: "flex", gap: 12, alignItems: "center" },
  section: { padding: "16px 20px" },
  tabBar: { display: "flex", gap: 4, borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 20px", background: "var(--color-background-primary)", overflowX: "auto" },
  tab: (active, color) => ({ padding: "10px 16px", cursor: "pointer", fontSize: 14, border: "none", background: "transparent", fontFamily: "inherit", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)", borderBottom: active ? `2px solid ${color || CSC.blue}` : "2px solid transparent", fontWeight: active ? 500 : 400, whiteSpace: "nowrap" }),
  badge: (type) => { const m = { success: ["#EAF3DE","#3B6D11"], warning: ["#FAEEDA","#854F0B"], danger: ["#FCEBEB","#A32D2D"], info: ["#E6F1FB","#185FA5"], purple: ["#EEEDFE","#534AB7"] }; const [bg, c] = m[type] || m.info; return { background: bg, color: c, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, display: "inline-block" }; },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 },
  modalBox: { background: "var(--color-background-primary)", borderRadius: 16, padding: "24px", maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto" },
};

// ─── Shared UI components ──────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={S.modal} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modalBox}>
        <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--color-text-secondary)", padding: 0, lineHeight: 1 }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "#A32D2D" : CSC.blue, color: "#fff", borderRadius: 999, padding: "10px 20px", fontSize: 14, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>{toast.msg}</div>;
}

function EmptyState({ msg }) {
  return <div style={{ textAlign: "center", padding: "32px 0", color: "var(--color-text-secondary)", fontSize: 14 }}><div style={{ fontSize: 32, marginBottom: 8 }}>🏓</div><p style={{ margin: 0 }}>{msg}</p></div>;
}

// ─── Forms ────────────────────────────────────────────────────────────────────
function PlayerForm({ onSubmit, onCancel, initial }) {
  // Backward-compat: if editing a legacy player with only `name`, split it
  const [legacyFirst, legacyLast] = (() => {
    if (!initial?.name || initial?.firstName) return ["", ""];
    const parts = initial.name.trim().split(/\s+/);
    return [parts[0] || "", parts.slice(1).join(" ")];
  })();

  const [form, setForm] = useState({
    firstName: initial?.firstName ?? legacyFirst,
    lastName: initial?.lastName ?? legacyLast,
    email: initial?.email || "",
    phone: initial?.phone || "",
    gender: initial?.gender || "",
    cscMember: initial?.cscMember || false,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function handleSubmit() {
    if (!form.firstName.trim()) return alert("First name required");
    if (!form.lastName.trim()) return alert("Last name required");
    if (!form.email.trim()) return alert("Email required");
    if (!form.gender) return alert("Please select a gender");
    // Also write the derived name for any legacy code paths that still read it
    onSubmit({
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      name: `${form.firstName.trim()} ${form.lastName.trim()}`,
    });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>First Name *</label><input style={S.input} value={form.firstName} onChange={e => set("firstName", e.target.value)} placeholder="Jane" /></div>
        <div><label style={S.label}>Last Name *</label><input style={S.input} value={form.lastName} onChange={e => set("lastName", e.target.value)} placeholder="Smith" /></div>
      </div>
      <div><label style={S.label}>Email *</label><input style={S.input} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="jane@email.com" /></div>
      <div><label style={S.label}>Phone Number</label><input style={S.input} type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 000-0000" /></div>
      <div>
        <label style={S.label}>Gender *</label>
        <select style={S.input} value={form.gender} onChange={e => set("gender", e.target.value)}>
          <option value="">Select gender…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--color-background-secondary)", borderRadius: 8, border: "0.5px solid var(--color-border-secondary)", cursor: "pointer" }} onClick={() => set("cscMember", !form.cscMember)}>
        <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${form.cscMember ? CSC.blue : "var(--color-border-secondary)"}`, background: form.cscMember ? CSC.blue : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {form.cscMember && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>
        <div>
          <p style={{ margin: "0 0 1px", fontSize: 14, fontWeight: 500 }}>CSC Member</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>I am a current Community Sports Club member</p>
        </div>
      </div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>{initial ? "Save Changes" : "Create Account"}</button>
      </div>
    </div>
  );
}

function LeagueForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState({ name: initial?.name || "", weeks: initial?.weeks || 8, startDate: initial?.startDate || new Date().toISOString().split("T")[0], format: initial?.format || "Singles", gender: initial?.gender || "Mixed", competitionType: initial?.competitionType || "mixer", numCourts: initial?.numCourts || 4, location: initial?.location || "", description: initial?.description || "", status: initial?.status || "open" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function handleSubmit() {
    if (!form.name.trim()) return alert("League name required");
    onSubmit(form);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div><label style={S.label}>League Name *</label><input style={S.input} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Singles 2025" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Number of Weeks *</label><input style={S.input} type="number" min={1} max={52} value={form.weeks} onChange={e => set("weeks", +e.target.value)} /></div>
        <div><label style={S.label}>Start Date *</label><input style={S.input} type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Format</label><select style={S.input} value={form.format} onChange={e => set("format", e.target.value)}><option>Singles</option><option>Doubles</option><option>Mixed Doubles</option></select></div>
        <div>
          <label style={S.label}>Gender *</label>
          <select style={S.input} value={form.gender} onChange={e => set("gender", e.target.value)}>
            <option value="Mixed">Mixed</option>
            <option value="Men's">Men's</option>
            <option value="Women's">Women's</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={S.label}>Status</label><select style={S.input} value={form.status} onChange={e => set("status", e.target.value)}><option value="open">Open Registration</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option></select></div>
        <div>
          <label style={S.label}>Number of Courts *</label>
          <select style={S.input} value={form.numCourts} onChange={e => set("numCourts", +e.target.value)}>
            {Array.from({ length: MAX_COURTS }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n} court{n!==1?"s":""} (max {n * MAX_PER_COURT} players)</option>
            ))}
          </select>
        </div>
        <div><label style={S.label}>Location</label><input style={S.input} value={form.location} onChange={e => set("location", e.target.value)} placeholder="Community Center" /></div>
      </div>
      <div>
        <label style={S.label}>Competition Type *</label>
        <select style={S.input} value={form.competitionType} onChange={e => set("competitionType", e.target.value)}>
          <option value="mixer">Mixer — full schedule generated upfront, courts rotate for variety</option>
          <option value="ladder">Ladder — week-by-week, courts based on previous week's results</option>
        </select>
      </div>
      <div><label style={S.label}>Description</label><textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional…" /></div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>{initial ? "Save Changes" : "Create League"}</button>
      </div>
    </div>
  );
}

function EditWeekForm({ weekData, onSubmit, onCancel }) {
  const [date, setDate] = useState(weekData.date || "");
  const [time, setTime] = useState(weekData.time || "");
  function handleSubmit() {
    if (!date) return alert("Date is required.");
    onSubmit(date, time || null);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Adjust the date or start time for this week. Players will see the updated time on their schedule.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={S.label}>Date *</label>
          <input style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Start time</label>
          <input style={S.input} type="time" value={time} onChange={e => setTime(e.target.value)} placeholder="e.g. 18:00" />
        </div>
      </div>
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
        <button style={S.btn("primary")} onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}

function validatePickleballScore(h, a) {
  const hi = parseInt(h, 10), ai = parseInt(a, 10);
  if (isNaN(hi) || isNaN(ai)) return null;
  if (hi < 0 || ai < 0) return "Scores cannot be negative.";
  const winner = Math.max(hi, ai), loser = Math.min(hi, ai);
  if (winner < 11) return "Winner must reach at least 11.";
  if (winner === loser) return "Scores cannot be tied — someone must win.";
  if (winner === 11 && loser > 9) return "At 11, winner must lead by 2 (e.g. 11–9 or less).";
  if (winner > 11 && (winner - loser) !== 2) return "When over 11, winner must lead by exactly 2 (win by 2).";
  return "valid";
}

// Helper: get the two "side" labels for any match (singles → 1 player each side, doubles → 2)
function matchSides(match) {
  if (match.format === "doubles") {
    return { sideA: match.team1, sideB: match.team2 };
  }
  return { sideA: [match.home], sideB: [match.away] };
}

function ScoreForm({ match, leagueId, existing, getPlayerName, onSubmit, onClose }) {
  const [home, setHome] = useState(existing?.homeScore ?? "");
  const [away, setAway] = useState(existing?.awayScore ?? "");

  const { sideA, sideB } = matchSides(match);
  const labelA = sideA.map(getPlayerName).join(" + ");
  const labelB = sideB.map(getPlayerName).join(" + ");

  const validation = (home !== "" && away !== "") ? validatePickleballScore(home, away) : null;
  const isValid = validation === "valid";
  const errorMsg = validation && validation !== "valid" ? validation : null;

  function handleSubmit() {
    if (home === "" || away === "") return alert("Enter both scores.");
    if (!isValid) return alert(errorMsg);
    onSubmit(home, away); onClose();
  }

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <span style={{ ...S.badge("info"), marginBottom: 8, display: "inline-block" }}>{match.court} · Week {match.week} · {formatDate(match.date)}</span>
        <p style={{ margin: "8px 0 0", fontSize: 16, fontWeight: 600 }}>{labelA} vs {labelB}</p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>Play to 11, win by 2</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
        <div style={{ textAlign: "center" }}>
          <label style={{ ...S.label, textAlign: "center", whiteSpace: "normal" }}>{labelA}</label>
          <input style={{ ...S.input, textAlign: "center", fontSize: 32, padding: "14px 8px", border: `2px solid ${home !== "" && away !== "" ? (isValid ? "#3B6D11" : "#A32D2D") : "var(--color-border-secondary)"}` }} type="number" min={0} max={99} value={home} onChange={e => setHome(e.target.value)} />
        </div>
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 22, paddingBottom: 12 }}>–</div>
        <div style={{ textAlign: "center" }}>
          <label style={{ ...S.label, textAlign: "center", whiteSpace: "normal" }}>{labelB}</label>
          <input style={{ ...S.input, textAlign: "center", fontSize: 32, padding: "14px 8px", border: `2px solid ${home !== "" && away !== "" ? (isValid ? "#3B6D11" : "#A32D2D") : "var(--color-border-secondary)"}` }} type="number" min={0} max={99} value={away} onChange={e => setAway(e.target.value)} />
        </div>
      </div>
      {errorMsg && <p style={{ textAlign: "center", color: "#A32D2D", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#FCEBEB", borderRadius: 6 }}>{errorMsg}</p>}
      {isValid && <p style={{ textAlign: "center", color: "#3B6D11", fontSize: 13, margin: "0 0 12px", padding: "6px 12px", background: "#EAF3DE", borderRadius: 6 }}>
        {parseInt(home,10) > parseInt(away,10) ? labelA : labelB} wins!
      </p>}
      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onClose}>Cancel</button>
        <button style={{ ...S.btn("primary"), opacity: isValid ? 1 : 0.5 }} onClick={handleSubmit}>Submit Score</button>
      </div>
    </div>
  );
}

// ─── Check-In Row ─────────────────────────────────────────────────────────────
// Compact row inside a week card showing the player's own check-in selector.
const CHECKIN_OPTS = [
  { key: "in",    label: "In",    color: "#3B6D11", bg: "#EAF3DE", icon: "✓" },
  { key: "maybe", label: "Maybe", color: "#854F0B", bg: "#FAEEDA", icon: "?" },
  { key: "out",   label: "Out",   color: "#A32D2D", bg: "#FCEBEB", icon: "✗" },
];

function CheckInRow({ current, onSet, isLocked }) {
  return (
    <div style={{ margin: "12px 16px 0", padding: "8px 10px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>Your availability:</span>
        <div style={{ display: "flex", gap: 4 }}>
          {CHECKIN_OPTS.map(opt => {
            const active = current === opt.key;
            return (
              <button
                key={opt.key}
                disabled={isLocked}
                onClick={() => onSet(active ? null : opt.key)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${active ? opt.color : "var(--color-border-secondary)"}`,
                  background: active ? opt.color : opt.bg,
                  color: active ? "#fff" : opt.color,
                  borderRadius: 999, cursor: isLocked ? "not-allowed" : "pointer",
                  opacity: isLocked ? 0.5 : 1,
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 13 }}>{opt.icon}</span>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Check-In Summary (commissioner view) ─────────────────────────────────────
function CheckInSummary({ regs, getCheckInForPlayer, getPlayerName, getPlayerEmail, leagueId, leagueName, week, weekDate }) {
  const [expanded, setExpanded] = useState(false);
  const counts = { in: 0, out: 0, maybe: 0, none: 0 };
  const buckets = { in: [], maybe: [], out: [], none: [] };
  regs.forEach(r => {
    const ci = getCheckInForPlayer(r.playerId);
    const status = ci?.status || "none";
    counts[status]++;
    buckets[status].push(r.playerId);
  });

  function copyReport() {
    const lines = [
      `Week ${week} Check-In Report`,
      ``,
      `IN (${counts.in}):`,
      ...buckets.in.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `MAYBE (${counts.maybe}):`,
      ...buckets.maybe.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `OUT (${counts.out}):`,
      ...buckets.out.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `NO RESPONSE (${counts.none}):`,
      ...buckets.none.map(id => `  - ${getPlayerName(id)}`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => alert("Report copied to clipboard."),
      () => alert("Could not copy to clipboard.")
    );
  }

  // Build a mailto: URL targeting players who haven't responded yet
  function emailNoResponse() {
    const recipients = buckets.none
      .map(id => getPlayerEmail?.(id))
      .filter(e => e && e.includes("@"));
    if (recipients.length === 0) {
      alert("No outstanding players to remind — everyone has checked in!");
      return;
    }
    const subject = `${leagueName || "League"} — Please check in for Week ${week}${weekDate ? ` (${weekDate})` : ""}`;
    const body =
      `Hi,\n\n` +
      `Just a quick reminder to mark your availability for Week ${week}${weekDate ? ` (${weekDate})` : ""} of ${leagueName || "the league"}.\n\n` +
      `Please log in and select In, Maybe, or Out so we can plan the courts.\n\n` +
      `Thanks!`;
    // BCC recipients to keep emails private — use a single self-addressed To if needed.
    // Most mail clients accept all recipients in BCC and an empty To.
    const params = new URLSearchParams({
      bcc: recipients.join(","),
      subject,
      body,
    });
    // mailto spec uses ? for first param, & for the rest
    const url = `mailto:?${params.toString()}`;
    window.location.href = url;
  }

  // Email everyone in the league (any status) — useful for general announcements
  function emailEveryone() {
    const recipients = regs
      .map(r => getPlayerEmail?.(r.playerId))
      .filter(e => e && e.includes("@"));
    if (recipients.length === 0) { alert("No player emails available."); return; }
    const subject = `${leagueName || "League"} — Week ${week}${weekDate ? ` (${weekDate})` : ""}`;
    const params = new URLSearchParams({ bcc: recipients.join(","), subject, body: "" });
    window.location.href = `mailto:?${params.toString()}`;
  }

  return (
    <div style={{ margin: "12px 16px 0", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-secondary)", overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>Check-ins:</span>
          <span style={{ ...S.badge("success"), fontSize: 11 }}>✓ {counts.in} in</span>
          <span style={{ ...S.badge("warning"), fontSize: 11 }}>? {counts.maybe} maybe</span>
          <span style={{ ...S.badge("danger"), fontSize: 11 }}>✗ {counts.out} out</span>
          {counts.none > 0 && <span style={{ ...S.badge("info"), fontSize: 11 }}>• {counts.none} no reply</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {counts.none > 0 && (
            <button
              style={{ ...S.btnSm("primary", "#185FA5"), padding: "3px 10px", fontSize: 11 }}
              onClick={e => { e.stopPropagation(); emailNoResponse(); }}
              title={`Email the ${counts.none} player${counts.none!==1?"s":""} who haven't responded`}>
              ✉ Remind ({counts.none})
            </button>
          )}
          <button
            style={{ ...S.btnSm("secondary"), padding: "3px 10px", fontSize: 11 }}
            onClick={e => { e.stopPropagation(); emailEveryone(); }}
            title="Email all players in this league">
            ✉ All
          </button>
          <button
            style={{ ...S.btnSm("secondary"), padding: "3px 10px", fontSize: 11 }}
            onClick={e => { e.stopPropagation(); copyReport(); }}>
            Copy Report
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 12px 10px" }}>
          {[
            ["in", "In", "#3B6D11"],
            ["maybe", "Maybe", "#854F0B"],
            ["out", "Out", "#A32D2D"],
            ["none", "No response", "#78716c"],
          ].map(([k, label, color]) => (
            buckets[k].length > 0 && (
              <div key={k} style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color }}>{label} ({buckets[k].length})</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                  {buckets[k].map(id => getPlayerName(id)).join(", ")}
                </p>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Court Week Card ───────────────────────────────────────────────────────────
// myId: the current player's id (undefined for commissioner full view)
// myCourtPlayers: set of player IDs on the same court as myId this week (for edit gating)
// isLocked: commissioner has locked this week — players cannot edit, commissioner still can
// isAdmin: full commissioner access
function CourtWeekCard({ weekData, leagueId, leagueName, getScore, getPlayerName, getPlayerEmail, onEnterScore, onToggleLock, onEditDateTime, myId, myCourtPlayers, isLocked, isAdmin, myCheckIn, onSetCheckIn, regs, getCheckInForPlayer }) {
  const [expanded, setExpanded] = useState(false);
  const totalMatches = weekData.courts.reduce((s, c) => s + c.matches.length, 0);
  const scoredMatches = weekData.courts.reduce((s, c) => s + c.matches.filter(m => getScore(leagueId, m.week, m.id)).length, 0);
  const allScored = scoredMatches === totalMatches && totalMatches > 0;

  const headerBg = isLocked ? "#F1EFE8" : allScored ? "#EAF3DE" : "var(--color-background-secondary)";

  return (
    <div style={{ ...S.card, marginBottom: 12, padding: 0, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: headerBg, borderBottom: expanded ? "0.5px solid var(--color-border-tertiary)" : "none" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Week {weekData.week}</span>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {formatDateTime(weekData.date, weekData.time)}
          </span>
          {weekData.placeholder && <span style={{ ...S.badge("info"), fontSize: 10 }}>Not generated</span>}
          {isLocked && <span style={{ ...S.badge("warning"), fontSize: 10 }}>🔒 Locked</span>}
          {!isLocked && !weekData.placeholder && allScored && totalMatches > 0 && <span style={{ ...S.badge("success"), fontSize: 10 }}>Complete</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && onEditDateTime && (
            <button
              style={{ ...S.btnSm("secondary"), padding: "3px 10px", fontSize: 11 }}
              onClick={e => { e.stopPropagation(); onEditDateTime(weekData); }}
              title="Edit date and time">
              ✏ Edit
            </button>
          )}
          {isAdmin && onToggleLock && !weekData.placeholder && (
            <button
              style={{ ...S.btnSm(isLocked ? "primary" : "secondary", isLocked ? "#854F0B" : undefined), padding: "3px 10px", fontSize: 11 }}
              onClick={e => { e.stopPropagation(); onToggleLock(weekData.week); }}>
              {isLocked ? "Unlock" : "Lock Week"}
            </button>
          )}
          {!weekData.placeholder && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{scoredMatches}/{totalMatches} scored</span>}
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", display: "inline-block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
      </div>

      {expanded && (
        <div style={{ paddingBottom: 12 }}>
          {weekData.placeholder && (
            <div style={{ margin: "12px 16px 0", padding: "10px 14px", background: CSC.blueLight, border: `0.5px solid ${CSC.blue}40`, borderRadius: 8, fontSize: 13, color: CSC.blueDark }}>
              📅 This week's schedule has not been generated yet. Use the Generate button at the top of the schedule to create it.
            </div>
          )}
          {!weekData.placeholder && isLocked && !isAdmin && (
            <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "#FAEEDA", borderRadius: 6, fontSize: 12, color: "#854F0B" }}>
              This week has been locked by the commissioner. Scores can no longer be edited.
            </div>
          )}
          {/* Player's own check-in */}
          {myId && onSetCheckIn && (
            <CheckInRow current={myCheckIn?.status} isLocked={isLocked}
              onSet={status => onSetCheckIn(weekData.week, status)} />
          )}
          {/* Commissioner check-in summary */}
          {isAdmin && regs && getCheckInForPlayer && (
            <CheckInSummary regs={regs} getCheckInForPlayer={getCheckInForPlayer}
              getPlayerName={getPlayerName} getPlayerEmail={getPlayerEmail}
              leagueId={leagueId} leagueName={leagueName}
              week={weekData.week} weekDate={formatDate(weekData.date)} />
          )}
          {weekData.courts.map((court, ci) => {
            const courtColor = COURT_COLORS[ci] || CSC.blue;
            // For players: show only their own court; for commissioner: show all courts
            const onMyCourt = myId ? court.players.includes(myId) : true;
            if (myId && !onMyCourt) return null;
            return (
              <div key={court.courtName} style={{ margin: "12px 16px 0" }}>
                {/* Court label */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: courtColor + "18", border: `0.5px solid ${courtColor}40` }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: courtColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12, color: courtColor, letterSpacing: "0.5px" }}>{court.courtName.toUpperCase()}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {court.players.map(id => getPlayerName(id)).join(" · ")}
                  </span>
                </div>
                {/* Match rows */}
                {court.matches.map(match => {
                  const score = getScore(leagueId, match.week, match.id);
                  const hasScore = !!score;
                  const sideAWon = hasScore && score.homeScore > score.awayScore;
                  const { sideA, sideB } = matchSides(match);
                  const myOnSideA = myId && sideA.includes(myId);
                  const myOnSideB = myId && sideB.includes(myId);
                  const myInMatch = myOnSideA || myOnSideB;
                  const mySat = myId && match.sitOut === myId;
                  const myWon = hasScore && ((myOnSideA && sideAWon) || (myOnSideB && !sideAWon));
                  // Player can edit any match on their own court (not just ones they're in)
                  // unless the week is locked. Commissioner can always edit.
                  const playerCanEdit = onMyCourt && !isLocked;
                  const canEdit = isAdmin || playerCanEdit;

                  const labelA = sideA.map(getPlayerName).join(" + ");
                  const labelB = sideB.map(getPlayerName).join(" + ");

                  return (
                    <div key={match.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, marginBottom: 4, background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: myOnSideA ? 700 : 400, textAlign: "right", color: myOnSideA ? "var(--color-text-primary)" : "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {labelA}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        {hasScore ? (
                          <>
                            <span style={{ fontSize: 17, fontWeight: 700, color: sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.homeScore}</span>
                            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
                            <span style={{ fontSize: 17, fontWeight: 700, color: !sideAWon ? CSC.blue : "var(--color-text-secondary)", minWidth: 20, textAlign: "center" }}>{score.awayScore}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "0 6px" }}>vs</span>
                        )}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: myOnSideB ? 700 : 400, color: myOnSideB ? "var(--color-text-primary)" : "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {labelB}
                      </span>
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
                        {mySat && <span style={{ ...S.badge("info"), fontSize: 10 }}>You sit</span>}
                        {myInMatch && hasScore && <span style={S.badge(myWon ? "success" : "danger")}>{myWon ? "W" : "L"}</span>}
                        {isLocked && hasScore && isAdmin && <span style={{ ...S.badge("warning"), fontSize: 10 }}>🔒</span>}
                        {canEdit ? (
                          <button style={{ ...S.btnSm(hasScore ? "secondary" : "primary", hasScore ? undefined : courtColor), padding: "3px 10px", fontSize: 11 }}
                            onClick={() => onEnterScore(match)}>
                            {hasScore ? "Edit" : "Score"}
                          </button>
                        ) : (
                          !hasScore && <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>–</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Standings ────────────────────────────────────────────────────────────────
function StandingsTable({ standings, getPlayerName, color, myId, pendingWeeks = 0 }) {
  const c = color || COLORS.csc;
  if (standings.length === 0) return <EmptyState msg={pendingWeeks > 0 ? `${pendingWeeks} week${pendingWeeks!==1?"s":""} of scores entered, but the commissioner hasn't locked any weeks yet. Standings appear once weeks are locked.` : "No results yet. Standings appear after the commissioner locks completed weeks."} />;
  return (
    <div>
      {pendingWeeks > 0 && (
        <div style={{ padding: "8px 12px", background: "#FAEEDA", borderRadius: 6, fontSize: 12, color: "#854F0B", marginBottom: 12 }}>
          ⏳ {pendingWeeks} week{pendingWeeks!==1?"s":""} of unlocked scores not yet counted. Standings update once the commissioner locks each week.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {[["Player","36%"],["+/-","16%"],["W","12%"],["L","12%"],["PF","12%"],["PA","12%"]].map(([h,w]) => (
                <th key={h} style={{ padding: h==="Player"?"8px 12px":"8px", textAlign: h==="Player"?"left":"center", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", width: w }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const isMe = myId && s.id === myId;
              const diff = s.pointsFor - s.pointsAgainst;
              return (
                <tr key={s.id} style={{ background: isMe ? c.light : i%2===0 ? "transparent" : "var(--color-background-secondary)", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: isMe?700:400, color: isMe?c.bg:"var(--color-text-primary)" }}>
                    <span style={{ marginRight: 8, color: "var(--color-text-tertiary)", fontSize: 12 }}>#{i+1}</span>
                    {getPlayerName(s.id)}
                    {isMe && <span style={{ ...S.badge("info"), marginLeft: 8, fontSize: 10 }}>You</span>}
                  </td>
                  <td style={{ padding:"10px 8px",textAlign:"center",color:diff>=0?CSC.blue:"#A32D2D",fontWeight:700,fontSize:15 }}>{diff>0?"+":""}{diff}</td>
                  <td style={{ padding:"10px 8px",textAlign:"center",fontWeight:600,color:CSC.blue }}>{s.wins}</td>
                  <td style={{ padding:"10px 8px",textAlign:"center",color:"#A32D2D" }}>{s.losses}</td>
                  <td style={{ padding:"10px 8px",textAlign:"center",color:"var(--color-text-secondary)" }}>{s.pointsFor}</td>
                  <td style={{ padding:"10px 8px",textAlign:"center",color:"var(--color-text-secondary)" }}>{s.pointsAgainst}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>Only locked weeks count. Ranked by +/- (points for minus points against). Wins are the tiebreaker. PF=Points For · PA=Points Against</p>
    </div>
  );
}

// ─── Add Player to League ──────────────────────────────────────────────────────
function AddPlayerToLeague({ players, leagueId, existing, onRegister, onCreatePlayer, onClose }) {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  const available = useMemo(() => {
    const q = search.toLowerCase();
    return players.filter(p => !existingSet.has(p.id) && playerSearchString(p).includes(q));
  }, [players, existingSet, search]);
  if (showNew) return <PlayerForm onSubmit={async d => { const id = await onCreatePlayer(d); if (id) await onRegister(leagueId, id); onClose(); }} onCancel={() => setShowNew(false)} />;
  return (
    <div>
      <input style={{ ...S.input, marginBottom: 12 }} placeholder="Search players…" value={search} onChange={e => setSearch(e.target.value)} />
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {available.map(p => (
          <div key={p.id} style={{ ...S.card, marginBottom: 8, cursor: "pointer", padding: "12px 16px" }} onClick={() => { onRegister(leagueId, p.id); onClose(); }}>
            <div style={S.row}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>{playerInitial(p)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{formatPlayerName(p)}</p>
                  {p.gender && <span style={{ ...S.badge("info"), fontSize: 10 }}>{p.gender}</span>}
                  {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC</span>}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}</p>
              </div>
            </div>
          </div>
        ))}
        {available.length === 0 && <p style={{ fontSize: 14, color: "var(--color-text-secondary)", textAlign: "center", padding: "16px 0" }}>No available players found.</p>}
      </div>
      <button style={{ ...S.btn("secondary"), width: "100%", marginTop: 12 }} onClick={() => setShowNew(true)}>+ Create New Player</button>
    </div>
  );
}

// ─── League Detail (commissioner) ─────────────────────────────────────────────
function LeagueDetail({ league, db, regs, schedule, getScore, getPlayerName, getStandings, onEdit, onDelete, onToggleArchive, onGenerate, onAddPlayer, onRemovePlayer, onTogglePaid, onToggleLockWeek, isWeekLocked, onEnterScore, onEditWeekDateTime, getCheckIn }) {
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
        <div style={{ ...S.row, justifyContent: "space-between" }}>
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
            {/* Court capacity visualizer */}
            <div style={{ ...S.card, marginBottom: 16, padding: "14px 16px", background: "var(--color-background-secondary)" }}>
              <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Court Assignments</span>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{n} of {maxPlayers} players (ideal: {MAX_PER_COURT} per court)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(numCourts, 4)}, 1fr)`, gap: 8 }}>
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
              return weeks.map(w => <CourtWeekCard key={w.week} weekData={w} leagueId={league.id} leagueName={league.name} getScore={getScore} getPlayerName={getPlayerName} getPlayerEmail={getPlayerEmail} onEnterScore={onEnterScore} onToggleLock={onToggleLockWeek} onEditDateTime={onEditWeekDateTime} isLocked={isWeekLocked(w.week)} isAdmin regs={regs} getCheckInForPlayer={(pid) => getCheckIn(league.id, w.week, pid)} />);
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [db, setDB] = useState(null);
  const [view, setView] = useState("home");
  const [adminTab, setAdminTab] = useState("leagues");
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [playerTab, setPlayerTab] = useState("schedule");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [adminEmail, setAdminEmail] = useState(null); // email of logged-in commissioner
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

  // Reload from DB — call after every successful write
  const reload = useCallback(async () => {
    try {
      const fresh = await loadDB();
      setDB(fresh);
    } catch (e) {
      console.error("[reload] failed:", e);
      showToast("Database error — see console", "error");
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const fresh = await loadDB();
        setDB(fresh);
      } catch (e) {
        console.error("[initial load] failed:", e);
        setDB(defaultDB()); // fall back to empty so the UI renders
        showToast("Could not load data — check Supabase credentials", "error");
      }
    })();
  }, []);

  // Restore login session once db is loaded
  useEffect(() => {
    if (!db || sessionRestored) return;
    const sess = loadSession();
    if (sess.playerId && db.players[sess.playerId]) {
      setCurrentPlayer(db.players[sess.playerId]);
      // If they were last in admin view and are still authorized, drop them there
      if (sess.adminEmail && adminEmailSetLower.has(sess.adminEmail.toLowerCase())) {
        setAdminEmail(sess.adminEmail);
        setView(sess.view === "admin" ? "admin" : "player");
      } else {
        setView("player");
      }
    } else if (sess.adminEmail) {
      // Admin-only session (no player record) — verify they're still authorized
      if (adminEmailSetLower.has(sess.adminEmail.toLowerCase())) {
        setAdminEmail(sess.adminEmail);
        setView("admin");
      }
    }
    setSessionRestored(true);
  }, [db, sessionRestored]);

  // Persist session whenever the relevant state changes (after restore)
  useEffect(() => {
    if (!sessionRestored) return;
    if (currentPlayer || adminEmail) {
      saveSession({
        playerId: currentPlayer?.id || null,
        adminEmail: adminEmail || null,
        view, // remember whether they were in player or admin mode
      });
    } else {
      saveSession(null); // logged out
    }
  }, [currentPlayer, adminEmail, view, sessionRestored]);

  // Keep currentPlayer fresh: when db reloads (e.g. after profile edit), pick up changes.
  // We only depend on `db.players` (not the whole db) and only compare the single
  // player record we care about. This avoids running this effect on every action
  // that changes scores/schedules/etc.
  const dbPlayers = db?.players;
  useEffect(() => {
    if (!currentPlayer || !dbPlayers) return;
    const fresh = dbPlayers[currentPlayer.id];
    if (fresh && fresh !== currentPlayer) {
      // db.players[id] is a new object reference after every reload, so we
      // do a focused stringify here only when references differ.
      if (JSON.stringify(fresh) !== JSON.stringify(currentPlayer)) {
        setCurrentPlayer(fresh);
      }
    }
  }, [dbPlayers, currentPlayer]);

  // Wrap every action: set saving, run write, reload from DB, clear saving
  async function action(fn, successMsg) {
    setSaving(true);
    try {
      await fn();
      await reload();
      if (successMsg) showToast(successMsg);
    } catch (e) {
      console.error("[action] failed:", e);
      showToast(e.message || "Operation failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!db) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",minHeight:300,color:"var(--color-text-secondary)",fontFamily:"Georgia,serif",fontSize:18 }}>Loading…</div>;

  const leagues = Object.values(db.leagues);
  const players = Object.values(db.players);
  const sortedLeagues = sortLeagues(leagues);

  // Pre-index registrations by leagueId so getLeagueRegs is O(1) lookup.
  // Object.values + filter on every call was O(N) per call, multiplied across
  // all the league cards rendered. This single pass replaces all of them.
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
  // Lowercase admin email set, computed once per render (used for auth checks)
  const adminEmailSetLower = new Set((db.adminEmails || [SUPER_ADMIN]).map(e => e.toLowerCase()));

  function getStandings(leagueId) {
    const regs = getLeagueRegs(leagueId);
    const sched = getLeagueSchedule(leagueId);
    const stats = {};
    regs.forEach(r => { stats[r.playerId] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; });
    (sched.weeks || []).forEach(w => {
      // Only include locked weeks — commissioner must lock the week before its
      // scores count toward the standings
      if (!isWeekLocked(leagueId, w.week)) return;
      w.courts.forEach(ct => ct.matches.forEach(match => {
        const score = getScore(leagueId, match.week, match.id);
        if (!score) return;
        const { homeScore: hs, awayScore: as } = score;
        // sideA = team1 / home, sideB = team2 / away
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
    return Object.entries(stats).map(([id, s]) => ({ id, ...s })).sort((a, b) => { const da = a.pointsFor - a.pointsAgainst, dbb = b.pointsFor - b.pointsAgainst; return dbb - da || b.wins - a.wins; });
  }

  const getCheckIn = (leagueId, week, playerId) =>
    db.checkIns?.[`${leagueId}_w${week}_${playerId}`] || null;

  // status = "in" | "out" | "maybe" | null (clears)
  async function setCheckIn(leagueId, week, playerId, status) {
    await action(() => dbSetCheckIn(leagueId, week, playerId, status));
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
  async function doDeleteLeague(id) {
    await action(() => dbDeleteLeague(id), "League deleted.");
    setSelectedLeague(null); setModal(null);
  }

  async function updateWeekDateTime(leagueId, weekNum, date, time) {
    await action(() => dbWriteWeekDateTime(leagueId, weekNum, date, time), `Week ${weekNum} updated.`);
    setModal(null);
  }

  async function generateSchedule(leagueId) {
    const league = db.leagues[leagueId];
    const playerIds = getLeagueRegs(leagueId).map(r => r.playerId);
    const numCourts = league.numCourts || 4;
    const sizes = distributePlayersToCourts(playerIds.length, numCourts);
    if (!sizes) {
      const maxAllowed = numCourts * MAX_PER_COURT;
      showToast(`Cannot schedule ${playerIds.length} players. Need ${MIN_PER_COURT}–${maxAllowed} players (${MIN_PER_COURT}–${MAX_PER_COURT} per court, up to ${numCourts} court${numCourts!==1?"s":""}).`, "error");
      return;
    }

    const isLadder = league.competitionType === "ladder";

    if (!isLadder) {
      // ─── Mixer: full schedule generated at once (existing behavior) ─────
      // Build a quick playerId → gender map so the scheduler can balance Mixed Doubles courts
      const playerGenders = {};
      playerIds.forEach(pid => { playerGenders[pid] = db.players[pid]?.gender; });
      const result = generateCourtSchedule(playerIds, league.weeks, league.startDate, league.format, numCourts, playerGenders);
      if (result.error) { showToast(result.error, "error"); return; }
      // Preserve any commissioner-edited date/time from the existing schedule
      const existingByWeek = {};
      (db.schedules[leagueId]?.weeks || []).forEach(w => { existingByWeek[w.week] = w; });
      result.weeks = result.weeks.map(w => {
        const prev = existingByWeek[w.week];
        if (prev && (prev.date !== w.date || prev.time)) {
          return { ...w, date: prev.date || w.date, time: prev.time || null };
        }
        return w;
      });
      await action(() => dbWriteSchedule(leagueId, result));
      const courtsCount = result.weeks[0]?.courts.length || 0;
      const sz = result.weeks[0]?.courts.map(c => c.players.length) || [];
      showToast(`Schedule generated! ${courtsCount} courts (${sz.join(", ")} players) × ${league.weeks} weeks`);
      return;
    }

    // ─── Ladder: generate one week at a time ────────────────────────────
    const existingSched = db.schedules[leagueId] || { weeks: [] };
    const existingWeeks = existingSched.weeks || [];

    // Find the next week to generate. A "real" week has courts; a placeholder
    // (from commissioner editing date/time before generation) doesn't.
    const realWeeks = existingWeeks.filter(w => !w.placeholder && w.courts.length > 0);
    const nextWeekNum = realWeeks.length + 1;

    if (nextWeekNum > league.weeks) {
      showToast(`All ${league.weeks} weeks already generated.`, "error");
      return;
    }

    // Use the placeholder's date/time if the commissioner already set one,
    // otherwise compute the default (start date + N*7 days)
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
    if (realWeeks.length === 0) {
      // Week 1: random court assignment, gender-balanced for Mixed Doubles
      const shuffled = seededShuffle(playerIds, Date.now() & 0xffffffff);
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
      // Subsequent weeks: require previous week to be locked
      const prevWeek = realWeeks[realWeeks.length - 1];
      const prevLocked = isWeekLocked(leagueId, prevWeek.week);
      if (!prevLocked) {
        showToast(`Lock Week ${prevWeek.week} first, then generate Week ${nextWeekNum}.`, "error");
        return;
      }
      // Sanity check: roster matches previous week's players
      const prevPlayers = new Set(prevWeek.courts.flatMap(c => c.players));
      const currentPlayers = new Set(playerIds);
      if (prevPlayers.size !== currentPlayers.size || ![...prevPlayers].every(p => currentPlayers.has(p))) {
        showToast("Roster has changed since last week. Ladder rotation requires the same players.", "error");
        return;
      }
      courtGroups = laddderRotate(prevWeek.courts, db.scores, leagueId, prevWeek.week, sizes);
    }

    const newWeek = buildLadderWeek(courtGroups, nextWeekNum, dateStr, league.format);
    if (timeStr) newWeek.time = timeStr;
    // Replace any existing placeholder for this week, otherwise append
    const otherWeeks = existingWeeks.filter(w => w.week !== nextWeekNum);
    const newSched = { weeks: [...otherWeeks, newWeek].sort((a, b) => a.week - b.week) };
    await action(() => dbWriteSchedule(leagueId, newSched));
    showToast(`Week ${nextWeekNum} generated! ${courtGroups.length} courts (${courtGroups.map(g => g.length).join(", ")} players)`);
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

  async function deletePlayer(playerId) {
    const p = db.players[playerId]; if (!p) return;
    await action(() => dbDeletePlayer(playerId), `Player "${formatPlayerName(p)}" deleted.`);
    setModal(null);
  }

  async function registerForLeague(leagueId, playerId) {
    const key = `${leagueId}_${playerId}`;
    if (db.registrations[key]) { showToast("Already registered!", "error"); return; }
    await action(() => dbRegisterForLeague(leagueId, playerId), "Registered successfully!");
    setModal(null);
  }

  async function submitScore(leagueId, week, matchId, homeScore, awayScore) {
    await action(() => dbWriteScore(leagueId, week, matchId, homeScore, awayScore), "Score submitted!");
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
    return <HomeView leagues={leagues} players={players} db={db}
      onAdmin={(email) => { setAdminEmail(email); setView("admin"); }}
      onPlayerLogin={p => { setCurrentPlayer(p); setView("player"); }}
      onCreatePlayer={createPlayer} toast={toast} modal={modal} setModal={setModal}
      registerForLeague={registerForLeague} />;
  }

  // ─── COMMISSIONER ─────────────────────────────────────────────────────────
  if (view === "admin") {
    const league = selectedLeague ? db.leagues[selectedLeague] : null;
    const c = league ? (COLORS[league.color] || COLORS.csc) : COLORS.teal;
    return (
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
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
              <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Players to be added:</p>
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
        {modal?.type === "confirmDelete" && <Modal title="Delete League" onClose={() => setModal(null)}><p style={{ fontSize: 15, margin: "0 0 20px" }}>Delete <b>{modal.league.name}</b>? This cannot be undone.</p><div style={S.row}><button style={{ ...S.btn("primary"), background: "#A32D2D" }} onClick={() => doDeleteLeague(modal.league.id)}>Delete</button><button style={S.btn("secondary")} onClick={() => setModal(null)}>Cancel</button></div></Modal>}
        {modal?.type === "editWeek" && (() => {
          const w = modal.weekData;
          return (
            <Modal title={`Edit Week ${w.week}`} onClose={() => setModal(null)}>
              <EditWeekForm
                weekData={w}
                onSubmit={(date, time) => updateWeekDateTime(modal.leagueId, w.week, date, time)}
                onCancel={() => setModal(null)} />
            </Modal>
          );
        })()}
        {modal?.type === "confirmDeletePlayer" && (() => {
          const p = modal.player;
          const playerLeagues = Object.values(db.registrations)
            .filter(r => r.playerId === p.id)
            .map(r => db.leagues[r.leagueId])
            .filter(Boolean);
          return (
            <Modal title="Delete Player" onClose={() => setModal(null)}>
              <p style={{ fontSize: 15, margin: "0 0 12px" }}>
                Delete <b>{formatPlayerName(p)}</b> ({p.email})?
              </p>
              {playerLeagues.length > 0 && (
                <div style={{ padding: "10px 12px", marginBottom: 16, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                  ⚠ This player is registered in {playerLeagues.length} league{playerLeagues.length!==1?"s":""}:
                  <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                    {playerLeagues.map(l => <li key={l.id} style={{ marginBottom: 2 }}>{l.name}</li>)}
                  </ul>
                  <p style={{ margin: "8px 0 0", fontSize: 12 }}>
                    They will be removed from all of them. Existing schedules will still show their name on past matches; regenerate the schedule for each active league afterward.
                  </p>
                </div>
              )}
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 16px" }}>
                This permanently deletes the player and all their registrations and check-ins. Past scores remain in the database.
              </p>
              <div style={S.row}>
                <button style={{ ...S.btn("primary"), background: "#A32D2D" }} onClick={() => deletePlayer(p.id)}>Delete Player</button>
                <button style={S.btn("secondary")} onClick={() => setModal(null)}>Cancel</button>
              </div>
            </Modal>
          );
        })()}

        <div style={S.header(league ? c.bg : undefined)}>
          <div style={S.row}>
            <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0" }} onClick={() => { if (league) setSelectedLeague(null); else setView("home"); }}>←</button>
            <h1 style={S.logo}>{league ? league.name : "Commissioner Panel"}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, opacity: 0.65 }}>{adminEmail}</span>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{saving ? "Saving…" : "●"}</span>
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
            onEditWeekDateTime={weekData => setModal({ type: "editWeek", leagueId: league.id, weekData })} />
        ) : (
          <>
            <div style={S.tabBar}>
              {[["leagues","Leagues"],["players","Players"],["admins","Commissioners"]].map(([k,label]) => <button key={k} style={S.tab(adminTab===k)} onClick={() => setAdminTab(k)}>{label}</button>)}
            </div>
            {adminTab === "leagues" && (
              <div style={S.section}>
                <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 17 }}>All Leagues</h2>
                  <button style={S.btn("primary")} onClick={() => setModal({ type: "createLeague" })}>+ New League</button>
                </div>
                {leagues.length === 0 && <EmptyState msg="No leagues created yet." />}
                {leagues.length > 0 && (() => {
                  // Group leagues by status
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
                      <div key={group.key} style={{ marginBottom: 18 }}>
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
                    <div style={{ ...S.row, marginBottom: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 16, flexShrink: 0 }}>{playerInitial(p)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 2 }}>
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
          </>
        )}
      </div>
    );
  }

  // ─── PLAYER ───────────────────────────────────────────────────────────────
  if (view === "player") {
    const myRegs = Object.values(db.registrations).filter(r => r.playerId === currentPlayer.id);
    const myLeagues = sortLeagues(myRegs.map(r => db.leagues[r.leagueId]).filter(Boolean));
    const playerGender = currentPlayer.gender;
    const unregistered = leagues.filter(l => {
      if (myRegs.find(r => r.leagueId === l.id)) return false;
      // Players can only join leagues that are in open registration.
      // Commissioner can still manually add players to any league anytime.
      if ((l.status || "open") !== "open") return false;
      const leagueGender = l.gender || "Mixed"; // default existing leagues to Mixed
      if (leagueGender === "Mixed") return true;
      if (leagueGender === "Men's") return playerGender === "Male";
      if (leagueGender === "Women's") return playerGender === "Female";
      return false;
    });
    return <PlayerView db={db} player={currentPlayer} myLeagues={myLeagues} unregistered={unregistered}
      playerTab={playerTab} setPlayerTab={setPlayerTab} modal={modal} setModal={setModal} toast={toast}
      getLeagueSchedule={getLeagueSchedule} getScore={getScore} getPlayerName={getPlayerName}
      getStandings={getStandings} registerForLeague={registerForLeague} submitScore={submitScore}
      isWeekLocked={isWeekLocked}
      getCheckIn={getCheckIn} setCheckIn={setCheckIn}
      adminEmails={db.adminEmails || [SUPER_ADMIN]}
      onSwitchToAdmin={() => { setAdminEmail(currentPlayer.email.toLowerCase()); setView("admin"); }}
      onBack={() => setView("home")} onLogout={logout} scoreModal={scoreModal} />;
  }
}


// ─── Commissioners Tab ─────────────────────────────────────────────────────────
function AdminsTab({ adminEmails, currentAdminEmail, isSuperAdmin, onAdd, onRemove }) {
  const [newEmail, setNewEmail] = useState("");
  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Commissioner Access</h2>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        These email addresses can log into the commissioner panel. The primary commissioner ({SUPER_ADMIN}) cannot be removed.
      </p>

      {isSuperAdmin && (
        <div style={{ ...S.card, marginBottom: 16, padding: "14px 16px" }}>
          <label style={S.label}>Add commissioner email</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }}
              type="email" placeholder="newcommissioner@email.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { onAdd(newEmail); setNewEmail(""); } }}
            />
            <button style={S.btn("primary")} onClick={() => { onAdd(newEmail); setNewEmail(""); }}>Add</button>
          </div>
        </div>
      )}

      {adminEmails.map(email => {
        const isPrimary = email.toLowerCase() === SUPER_ADMIN.toLowerCase();
        const isMe = email.toLowerCase() === currentAdminEmail?.toLowerCase();
        return (
          <div key={email} style={S.card}>
            <div style={S.row}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>
                {email[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>{email}</p>
                  {isPrimary && <span style={{ ...S.badge("info"), fontSize: 10 }}>Primary Commissioner</span>}
                  {isMe && <span style={{ ...S.badge("success"), fontSize: 10 }}>You</span>}
                </div>
              </div>
              {isSuperAdmin && !isPrimary && (
                <button
                  style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11, flexShrink: 0 }}
                  onClick={() => { if (confirm(`Remove ${email} as commissioner?`)) onRemove(email); }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────
function HomeView({ leagues, players, db, onPlayerLogin, onCreatePlayer, toast, modal, setModal, registerForLeague }) {
  const [loginEmail, setLoginEmail] = useState("");
  const [loginError, setLoginError] = useState("");
  function handlePlayerLogin() {
    const p = players.find(p => p.email.toLowerCase() === loginEmail.toLowerCase().trim());
    if (!p) { setLoginError("No player found with that email."); return; }
    onPlayerLogin(p);
  }

  return (
    <div style={S.page}>
      <Toast toast={toast} />
      {modal?.type === "newPlayer" && <Modal title="Create Player Account" onClose={() => setModal(null)}><PlayerForm onSubmit={async d => { await onCreatePlayer(d); setModal(null); }} onCancel={() => setModal(null)} /></Modal>}
      <div style={{ background: CSC.blue, color: "#fff", padding: "32px 24px 28px", textAlign: "center" }}>
        <img
          src="/csc-pickleball.png"
          alt="CSC Pickleball"
          style={{ maxWidth: 320, width: "85%", height: "auto", display: "block", margin: "0 auto 12px", borderRadius: 8 }}
        />
        <p style={{ margin: 0, color: "#fff", opacity: 0.92, fontSize: 14, fontWeight: 500, letterSpacing: "0.3px" }}>League Manager</p>
      </div>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 17 }}>Player Login</h2>
          <label style={S.label}>Email address</label>
          <input style={S.input} type="email" placeholder="you@email.com" value={loginEmail} onChange={e => { setLoginEmail(e.target.value); setLoginError(""); }} onKeyDown={e => e.key === "Enter" && handlePlayerLogin()} />
          {loginError && <p style={{ color: "#A32D2D", fontSize: 13, margin: "6px 0 0" }}>{loginError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn("primary"), flex: 1 }} onClick={handlePlayerLogin}>Log In as Player</button>
            <button style={S.btn("secondary")} onClick={() => setModal({ type: "newPlayer" })}>New Account</button>
          </div>
        </div>


        {/* Court legend */}
        <div style={{ ...S.card, padding: "12px 16px", marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>How scheduling works</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {COURT_NAMES.map((name, i) => <div key={name} style={{ textAlign: "center" }}>
              <div style={{ height: 28, borderRadius: 6, background: COURT_COLORS[i], display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>4–5</span></div>
              <p style={{ margin: "4px 0 0", fontSize: 10, color: COURT_COLORS[i], fontWeight: 600 }}>{name}</p>
            </div>)}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>Each week, players rotate to new court groups. All players within a court play each other. Matchmaking balances opponents across the season.</p>
        </div>
        {leagues.length > 0 && (
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--color-text-secondary)" }}>Active Leagues</h3>
            {sortLeagues(leagues.filter(l => l.status !== "archived")).map(l => {
              const lc = COLORS[l.color] || COLORS.csc;
              const regs = Object.values(db.registrations).filter(r => r.leagueId === l.id);
              const archived = l.status === "archived";
              return (
                <div key={l.id} style={{ ...S.card, borderLeft: `4px solid ${lc.bg}`, marginBottom: 8, opacity: archived ? 0.6 : 1 }}>
                  <div style={S.row}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 15 }}>{l.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{l.gender || "Mixed"} · {regs.length} players · {l.weeks} weeks · Starts {formatDate(l.startDate)}</p>
                    </div>
                    <span style={S.badge(l.status==="active"?"success":l.status==="archived"?"warning":"info")}>{l.status==="archived"?"📦 archived":l.status||"open"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PLAYER VIEW ──────────────────────────────────────────────────────────────
function PlayerView({ db, player, myLeagues, unregistered, playerTab, setPlayerTab, modal, setModal, toast, getLeagueSchedule, getScore, getPlayerName, getStandings, registerForLeague, submitScore, isWeekLocked, getCheckIn, setCheckIn, adminEmails, onSwitchToAdmin, onBack, onLogout, scoreModal }) {
  const [selectedLeagueId, setSelectedLeagueId] = useState(myLeagues[0]?.id || null);
  const selectedLeague = selectedLeagueId ? db.leagues[selectedLeagueId] : null;
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

      <div style={S.header(c.bg)}>
        <div style={S.row}>
          <button style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 20, padding: "0 8px 0 0" }} onClick={onBack}>←</button>
          <div>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>Playing as</p>
            <h1 style={{ ...S.logo, fontSize: 16 }}>{playerFullName(player)}</h1>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {adminEmails.map(e => e.toLowerCase()).includes(player.email.toLowerCase()) && (
            <button
              style={{ ...S.btnSm("secondary"), background: "rgba(255,255,255,0.2)", border: "0.5px solid rgba(255,255,255,0.5)", color: "#fff", fontSize: 11 }}
              onClick={onSwitchToAdmin}>
              ⚙ Commissioner Mode
            </button>
          )}
          <button style={{ ...S.btnSm("secondary"), background: "rgba(255,255,255,0.15)", border: "0.5px solid rgba(255,255,255,0.4)", color: "#fff" }} onClick={() => setModal({ type: "joinLeague" })}>+ Join League</button>
          <button style={{ ...S.btnSm("secondary"), background: "rgba(255,255,255,0.1)", border: "0.5px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: 11 }} onClick={onLogout} title="Log out">Log Out</button>
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
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--color-text-secondary)" }}>
          <p style={{ fontSize: 15 }}>You're not in any leagues yet.</p>
          <button style={{ ...S.btn("primary"), marginTop: 12 }} onClick={() => setModal({ type: "joinLeague" })}>Join a League</button>
        </div>
      )}

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
                  <div style={{ padding: "10px 14px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 13, color: "#854F0B" }}>
                    📦 This league has been archived. Your matches are visible for reference, but scores and check-ins can no longer be edited.
                  </div>
                )}
                {myWeeks.length === 0 && <EmptyState msg="No schedule yet. Check back after the commissioner generates this season's schedule." />}
                {myWeeks.map(w => <CourtWeekCard key={w.week} weekData={w} leagueId={selectedLeagueId} getScore={getScore} getPlayerName={getPlayerName} onEnterScore={match => setModal({ type: "enterScore", match, leagueId: selectedLeagueId })} myId={player.id} isLocked={isWeekLocked(selectedLeagueId, w.week) || selectedLeague.status === "archived"} myCheckIn={getCheckIn(selectedLeagueId, w.week, player.id)} onSetCheckIn={(week, status) => setCheckIn(selectedLeagueId, week, player.id, status)} />)}
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
