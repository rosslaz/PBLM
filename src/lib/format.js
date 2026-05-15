// ─── Display formatters ─────────────────────────────────────────────────────
// Pure functions for rendering names, dates, and times. All stored values are
// venue-local wall-clock (e.g. "18:00"); we just reformat for the device's
// locale conventions on display. No timezone conversion.

// "Jane S." from a player record.
// Backward-compat: if a player only has the legacy single-field `name`,
// returns it as-is. New players store firstName + lastName separately.
export function formatPlayerName(p) {
  if (!p) return "Unknown";
  if (p.firstName) {
    const initial = p.lastName ? `${p.lastName[0].toUpperCase()}.` : "";
    return initial ? `${p.firstName} ${initial}` : p.firstName;
  }
  return p.name || "Unknown";
}

export function playerInitial(p) {
  if (!p) return "?";
  return (p.firstName?.[0] || p.name?.[0] || "?").toUpperCase();
}

export function playerFullName(p) {
  if (!p) return "Unknown";
  if (p.firstName) return `${p.firstName} ${p.lastName || ""}`.trim();
  return p.name || "Unknown";
}

// For free-text search across player records
export function playerSearchString(p) {
  if (!p) return "";
  const parts = [p.firstName, p.lastName, p.name, p.email].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

// Date/time display helpers — render in the device's local format.
export function formatDate(iso) {
  if (!iso) return "";
  // Parse "2025-09-15" as local-noon to avoid the UTC-midnight-becomes-prev-day bug
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(hhmm) {
  if (!hhmm) return "";
  // Parse "18:00" as today at that local time, then format with locale conventions
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatDateTime(iso, hhmm) {
  const datePart = formatDate(iso);
  const timePart = formatTime(hhmm);
  if (datePart && timePart) return `${datePart} \u00b7 ${timePart}`;
  return datePart || timePart || "";
}

// ─── Court name + time resolution ───────────────────────────────────────────
// Three-tier cascade for resolving the displayed name and time for a court:
//   1. Per-week override on the court (court.customName / court.time)
//   2. League-level court config (league.courtConfig[courtIndex])
//   3. Fallback (generator's "Court N" / the week's default time)
//
// Why pass everything explicitly: pure functions, no surprise prop drilling,
// easy to test, easy to read at the call site.

export function resolveCourtName(court, courtIndex, league) {
  if (court?.customName) return court.customName;
  const cfg = league?.courtConfig?.[courtIndex];
  if (cfg?.name) return cfg.name;
  return court?.courtName || `Court ${courtIndex + 1}`;
}

// Returns the effective start time string ("HH:MM") for this court in this
// week, or null/undefined if none is set anywhere in the cascade.
// `weekTime` is the week's default time.
export function resolveCourtTime(court, courtIndex, league, weekTime) {
  if (court?.time) return court.time;
  const cfg = league?.courtConfig?.[courtIndex];
  if (cfg?.time) return cfg.time;
  return weekTime || null;
}

// Returns true when this court has any non-week-default override (used to
// decide whether to show the time stripe next to the court label).
export function courtHasTimeOverride(court, courtIndex, league, weekTime) {
  const t = resolveCourtTime(court, courtIndex, league, weekTime);
  if (!t) return false;
  return t !== weekTime;
}

// ─── Week eligibility ──────────────────────────────────────────────────────
// "Is this week today or earlier?" — used to gate player score entry to the
// current week and past weeks only, not future weeks. The commissioner
// bypasses this; only players are restricted.
//
// Uses lexicographic comparison on the ISO date string ("YYYY-MM-DD") because
// ISO ordering matches chronological ordering. todayISO() returns the local
// date, not UTC — players in different timezones see "today" as their own
// calendar day.
export function todayISO() {
  // Local-time YYYY-MM-DD. Date.toISOString() would give UTC and could be a
  // day off for users west of UTC late in the evening.
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isCurrentOrPastWeek(weekDate) {
  if (!weekDate) return false;
  return weekDate <= todayISO();
}

// "Is this week strictly before today?" — used to hide the check-in row on
// past weeks where RSVP is moot. Different from isCurrentOrPastWeek (which
// allows today and is used for score-entry gating).
export function isPastWeek(weekDate) {
  if (!weekDate) return false;
  return weekDate < todayISO();
}

// ─── Gender eligibility ────────────────────────────────────────────────────
// True when a player can join a league based on the league's gender setting.
// "Mixed" leagues accept anyone; "Men's" rejects only players known to be
// Female; "Women's" rejects only players known to be Male. Players with no
// gender on file (legacy records before gender was required) pass through
// every filter — the commissioner can see and decide. Used by both the
// commissioner's add-player flow and the player's join-league flow so the
// rule stays in one place.
export function playerFitsLeagueGender(playerGender, leagueGender) {
  const g = leagueGender || "Mixed";
  if (g === "Mixed") return true;
  // Be permissive when player gender isn't recorded — legacy data shouldn't
  // disappear silently. Only filter out the explicit opposite gender.
  if (!playerGender) return true;
  if (g === "Men's") return playerGender !== "Female";
  if (g === "Women's") return playerGender !== "Male";
  return true; // unrecognized league gender → permissive default
}

// ─── Phone number helpers ──────────────────────────────────────────────────
// Light handling — North America-friendly without being strict about it.
// We don't try to truly validate international numbers; we just want the
// commissioner to be able to copy a roster's worth of numbers into a
// messaging app to spin up a group thread.
//
// digitsOnly: strip everything that isn't 0-9. Used for the canonical form
//   stored in the DB and copied to the clipboard.
// formatPhone: best-effort pretty display. (248) 555-1234 for 10-digit
//   North American numbers; falls back to the raw input otherwise.
// isValidPhone: 10+ digits — strict enough to catch obvious nonsense,
//   loose enough not to reject international entries.
export function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}
export function isValidPhone(s) {
  return digitsOnly(s).length >= 10;
}
export function formatPhone(s) {
  const d = digitsOnly(s);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d[0] === "1") {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  // Anything else (international, malformed) → return as-entered so the
  // commissioner can read what's there and fix it manually if needed.
  return String(s || "");
}
