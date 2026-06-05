// ─── Club-scoped permission and lookup helpers ─────────────────────────────
// Phase 2 / v1.1.0: introduces multi-tenancy. Every league, every roster,
// every admin permission is now scoped to a club. The functions in this
// file are the canonical way to ask "is this person allowed?" and "what
// can this person see?"
//
// Identity is global (one player record = one human across all clubs they
// join), but membership and permission are per-club. A player joining a
// new club gets a new pb_memberships row, not a new player record.

// ─── Owner / admin checks ────────────────────────────────────────────────
// Owner is a superset of admin — anyone who is the owner is automatically
// also treated as an admin throughout the app. There's no separate "owner
// has admin rights" toggle.

export function isClubOwner(club, email) {
  if (!club || !email) return false;
  const lower = email.toLowerCase();
  return (club.ownerEmail || "").toLowerCase() === lower;
}

export function isClubAdmin(club, email) {
  if (!club || !email) return false;
  if (isClubOwner(club, email)) return true;
  const lower = email.toLowerCase();
  return (club.adminEmails || []).some(e => (e || "").toLowerCase() === lower);
}

// ─── Membership lookups ─────────────────────────────────────────────────
// `memberships` is the dictionary keyed by `${clubId}_${playerId}`, as
// loaded by loadDB(). Values include a `deletedAt` field; live entries
// have it as null/undefined.

function isLive(m) {
  return m && !m.deletedAt;
}

// All clubs a given player has a live membership in. Returns an array of
// club records (resolved via the `clubs` dict). Clubs that no longer
// exist (e.g. deleted clubs) are filtered out, so the result is always a
// list of usable club objects.
export function getClubsForPlayer(memberships, clubs, playerId) {
  if (!playerId) return [];
  return Object.values(memberships)
    .filter(m => isLive(m) && m.playerId === playerId)
    .map(m => clubs[m.clubId])
    .filter(Boolean);
}

// All clubs where a given email is owner or admin. Used when a
// commissioner-only session (no player record) signs in — we still need
// to put them in *some* club's context to show them anything.
export function getClubsWhereAdmin(clubs, email) {
  if (!email) return [];
  return Object.values(clubs)
    .filter(c => c && !c.deletedAt && isClubAdmin(c, email));
}

// Is `playerId` a live member of `clubId`?
export function isMember(memberships, clubId, playerId) {
  if (!clubId || !playerId) return false;
  return isLive(memberships[`${clubId}_${playerId}`]);
}

// Player IDs of every live member of a given club. Used to derive the
// club's player roster (since `db.players` is the global identity table,
// not per-club).
export function getClubMemberIds(memberships, clubId) {
  if (!clubId) return new Set();
  const ids = new Set();
  Object.values(memberships).forEach(m => {
    if (isLive(m) && m.clubId === clubId) ids.add(m.playerId);
  });
  return ids;
}

// ─── Join-code helpers ───────────────────────────────────────────────────
// Codes are shared verbally/in emails, so input is permissive: case is
// folded, whitespace and hyphens are stripped. Storage format is the
// canonical one we generated (e.g. "CSC-2026-2Q2H"), but the lookup
// compares the normalized form on both sides.

// Unambiguous alphabet for codes. Excludes I/L/O/0/1 (hand-transcription
// hazards). Used by generateJoinCode below.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Generate a fresh random join code. Format: PREFIX-YEAR-XXXX where XXXX
// is 4 random chars from the unambiguous alphabet. The prefix is derived
// from the club name (first 3 alphanumeric chars, uppercased). e.g.
// "Birmingham Tennis" → "BIR-2026-K7P3"
export function generateJoinCode(clubName) {
  const year = new Date().getFullYear();
  const prefix = (clubName || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "CLB";
  // 4-char suffix, ~1M unique values per prefix-year. Collision risk is
  // ignorable at the scale this app expects; if it ever matters we can
  // add a uniqueness retry loop.
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length);
    suffix += JOIN_CODE_ALPHABET[r];
  }
  return `${prefix}-${year}-${suffix}`;
}

export function normalizeJoinCode(raw) {
  if (!raw) return "";
  return String(raw).replace(/[\s-]+/g, "").toUpperCase();
}

// Find the club whose joinCode matches the given input (permissively).
// Returns the club record or null. Excludes soft-deleted clubs.
export function findClubByCode(clubs, code) {
  const target = normalizeJoinCode(code);
  if (!target) return null;
  return Object.values(clubs).find(c =>
    c && !c.deletedAt && normalizeJoinCode(c.joinCode) === target
  ) || null;
}

// ─── Active-club resolution ──────────────────────────────────────────────
// On login (or session restore), pick which club's data to show first.
// Priority:
//   1. The saved activeClubId from the previous session, IF the user
//      still has access (membership for players, ownership/adminship
//      for commissioner-only sessions).
//   2. The first candidate club, in stable sort order.
//   3. null — caller should render an empty state asking the user to
//      create or join a club.
//
// `candidates` is the precomputed list of clubs the user can see
// (typically getClubsForPlayer() merged with getClubsWhereAdmin() —
// callers can choose whichever fits the session type).
export function resolveActiveClub(savedId, candidates) {
  if (!candidates || candidates.length === 0) return null;
  if (savedId) {
    const saved = candidates.find(c => c.id === savedId);
    if (saved) return saved;
    // Saved club no longer accessible (membership revoked, club deleted) —
    // fall through to first available.
  }
  // Stable order: by createdAt ascending. Falls back to id for legacy
  // records without createdAt.
  const sorted = [...candidates].sort((a, b) => {
    const ac = a.createdAt || a.id || "";
    const bc = b.createdAt || b.id || "";
    return ac.localeCompare(bc);
  });
  return sorted[0];
}
