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
