// ─── LeagueRegistrationCard ────────────────────────────────────────────────
// Rich league card used in two surfaces where a player chooses which league
// to join:
//   1. The Join League modal (opened from the avatar menu)
//   2. The player's empty state, when they're in no leagues yet
//
// Both surfaces use the same card so the experience of "which league should I
// pick" is consistent. The card shows enough information for the player to
// make an informed choice without clicking through: format, gender, dates,
// court count, current roster size vs. capacity, and the first few names of
// other registered players.
//
// Tapping the card calls onSelect(league) — the caller is responsible for
// confirming the join (we don't enroll the player on a single tap; a mistap
// is too easy on a phone).
import { S } from "../styles.js";
import { COLORS, MAX_PER_COURT } from "../lib/constants.js";
import { formatDate, formatPlayerName } from "../lib/format.js";

// How many roster names to show before "+ N more"
const ROSTER_PREVIEW_COUNT = 3;

export function LeagueRegistrationCard({ league, regs, players, onSelect }) {
  const lc = COLORS[league.color] || COLORS.csc;

  // Roster preview — first few registered players, then "+ N more". Skip
  // any registrations whose player record is missing (deleted etc.).
  const rosterPlayers = (regs || [])
    .map(r => players[r.playerId])
    .filter(Boolean);
  const previewNames = rosterPlayers.slice(0, ROSTER_PREVIEW_COUNT).map(formatPlayerName);
  const extraCount = Math.max(0, rosterPlayers.length - ROSTER_PREVIEW_COUNT);

  const capacity = (league.numCourts || 4) * MAX_PER_COURT;
  const filled = rosterPlayers.length;
  const full = filled >= capacity;

  return (
    <div
      style={{
        ...S.card,
        borderLeft: `4px solid ${lc.bg}`,
        cursor: full ? "not-allowed" : "pointer",
        opacity: full ? 0.6 : 1,
      }}
      onClick={() => { if (!full) onSelect(league); }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{league.name}</p>
        <span style={{
          ...S.badge(full ? "danger" : filled >= capacity * 0.8 ? "warning" : "success"),
          fontSize: 10,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {full ? "Full" : `${filled} of ${capacity}`}
        </span>
      </div>
      {/* Meta line: format · gender · weeks · start date */}
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
        {league.gender || "Mixed"} · {league.format || "Singles"} · {league.weeks} weeks · Starts {formatDate(league.startDate)}
      </p>
      {league.location && (
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
          📍 {league.location}
        </p>
      )}
      {/* Description: helps the player decide whether this league fits.
          Only shown when set — otherwise the card stays compact. The card
          itself is only rendered for open-registration leagues, so this
          surface is by definition pre-start. */}
      {league.description && league.description.trim() && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
          {league.description}
        </p>
      )}
      {/* Roster preview */}
      {previewNames.length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
          <span style={{ color: "var(--color-text-tertiary)" }}>Players: </span>
          {previewNames.join(", ")}{extraCount > 0 ? ` + ${extraCount} more` : ""}
        </p>
      )}
      {previewNames.length === 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          Be the first to join!
        </p>
      )}
    </div>
  );
}
