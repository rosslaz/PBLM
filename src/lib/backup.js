// ─── Club backup export (v1.15.1) ───────────────────────────────────────────
//
// Why this exists: until v1.15.1, nothing kept a copy of the league data
// outside Supabase. A mis-click (the old roster-change schedule wipe), a bad
// manual SQL edit, or anyone holding the public anon key could destroy a
// season with no way back. A downloadable snapshot is the cheap stopgap until
// real auth and server-side backups exist.
//
// SCOPE: one club. A club admin gets their own club's rows and nothing else —
// handing a CSC commissioner a file full of Dink & Drink members' emails and
// phone numbers would be a privacy leak, even though the open RLS policies
// technically let them read it today. Someone who runs two clubs downloads
// each one separately.
//
// FORMAT: rows exactly as they sit in the tables (`id`/`key`/`league_id` plus
// `data`), grouped by table name. That makes a restore a plain upsert per
// table — no translation layer to get wrong under pressure. Soft-deleted
// (trashed) records are included on purpose: they're still recoverable in the
// app for 30 days, so the backup should be able to bring them back too.
//
// Pure functions apart from downloadJSON, which touches the DOM.
import { APP_INFO } from "./constants.js";
import { todayISO } from "./format.js";

export const BACKUP_FORMAT = "pblm-club-backup";
export const BACKUP_FORMAT_VERSION = 1;

// Build the backup object for `clubId` from a loadDB() snapshot.
//
// Compound keys are matched with JS startsWith, never SQL LIKE (see the
// underscore-trap note in supabase.js). The trailing `_` / `_w` in each prefix
// is what stops league_1 from matching league_10's rows.
export function buildClubBackup(snapshot, clubId) {
  const club = snapshot?.clubs?.[clubId];
  if (!club) throw new Error("Club not found — nothing to back up.");

  const leagueIds = Object.entries(snapshot.leagues || {})
    .filter(([, l]) => l?.clubId === clubId)
    .map(([id]) => id);
  const leagueSet = new Set(leagueIds);
  const ownedBy = (key, suffix = "_") => leagueIds.some(lid => key.startsWith(`${lid}${suffix}`));

  const memberships = Object.entries(snapshot.memberships || {})
    .filter(([key]) => key.startsWith(`${clubId}_`));
  const registrations = Object.entries(snapshot.registrations || {})
    .filter(([key, r]) => leagueSet.has(r?.leagueId) || ownedBy(key));

  // Everyone with a membership (live or not) plus anyone registered in one of
  // the club's leagues — the latter covers a player whose membership row has
  // gone but who still appears on a schedule.
  const playerIds = new Set([
    ...memberships.map(([, m]) => m?.playerId),
    ...registrations.map(([, r]) => r?.playerId),
  ].filter(Boolean));

  const tables = {
    pb_clubs: [{ id: clubId, data: club }],
    pb_memberships: memberships.map(([key, data]) => ({ key, data })),
    pb_players: [...playerIds]
      .filter(id => snapshot.players?.[id])
      .map(id => ({ id, data: snapshot.players[id] })),
    pb_leagues: leagueIds.map(id => ({ id, data: snapshot.leagues[id] })),
    pb_registrations: registrations.map(([key, data]) => ({ key, data })),
    pb_schedules: leagueIds
      .filter(id => snapshot.schedules?.[id])
      .map(id => ({ league_id: id, data: snapshot.schedules[id] })),
    pb_scores: Object.entries(snapshot.scores || {})
      .filter(([key]) => ownedBy(key))
      .map(([key, data]) => ({ key, data })),
    pb_locked_weeks: Object.keys(snapshot.lockedWeeks || {})
      .filter(key => ownedBy(key, "_w"))
      .map(key => ({ key })),
    pb_checkins: Object.entries(snapshot.checkIns || {})
      .filter(([key]) => ownedBy(key, "_w"))
      .map(([key, data]) => ({ key, data })),
  };

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_INFO.version,
    exportedAt: new Date().toISOString(),
    club: { id: clubId, name: club.name || "" },
    counts: Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length])),
    tables,
  };
}

// "pickleball-backup-dink-drink-2026-10-27.json"
export function backupFilename(clubName, dateISO = todayISO()) {
  const slug = String(clubName || "club")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "club";
  return `pickleball-backup-${slug}-${dateISO}.json`;
}

// Hand the browser a JSON file to save. On desktop this lands in Downloads;
// on iOS (including the installed PWA) it opens the share sheet, from which
// "Save to Files" keeps it.
export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
