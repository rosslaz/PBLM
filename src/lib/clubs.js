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
