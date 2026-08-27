// ─── Scoring rules ──────────────────────────────────────────────────────────
// How a raw game score converts into the points that count toward standings.
//
// Games are played to 11, win by 2, so a close game can run well past 11 —
// 15-13, 17-15, and so on. Counting those raw totals would quietly reward
// players for long games rather than good ones: two players who trade a
// 15-13 both bank more points than two who finish 11-4, even though the
// second game was the more decisive win.
//
// So points are capped per game:
//   winner  ->  11 points for
//   loser   ->   9 points for
//
// A 15-13 is recorded in the database as 15-13 and displayed as 15-13; it
// simply counts as 11-9. Blowouts are unaffected: an 11-4 counts as 11-4,
// because 4 is already under the loser's cap.
//
// Points against are just the opponent's capped points for, so every game
// contributes a consistent 20 points across both sides.
//
// IMPORTANT: this is a standings-time transform, never a storage-time one.
// The raw score is always what gets written to pb_scores, so this rule can be
// changed, tuned, or reverted later and historical standings simply
// recompute. Capping on write would have destroyed the original scores.

export const MAX_POINTS_WINNER = 11;
export const MAX_POINTS_LOSER = 9;

// Convert one raw game score into the four capped values a match contributes.
//
// Returns points from each side's perspective:
//   { homePF, homePA, awayPF, awayPA }
//
// A tie can't occur — validatePickleballScore rejects it — but if one somehow
// reached the database it's treated as an away win, matching how `aWon` is
// computed everywhere else (`hs > as`).
export function standingsPoints(homeScore, awayScore) {
  const hs = Number(homeScore);
  const as = Number(awayScore);
  const homeWon = hs > as;

  const winnerRaw = homeWon ? hs : as;
  const loserRaw = homeWon ? as : hs;

  // Math.min, not a flat assignment: the loser's cap is an upper bound, not a
  // floor. An 11-4 loser keeps their 4 rather than being handed 9.
  const winnerPoints = Math.min(winnerRaw, MAX_POINTS_WINNER);
  const loserPoints = Math.min(loserRaw, MAX_POINTS_LOSER);

  return homeWon
    ? { homePF: winnerPoints, homePA: loserPoints, awayPF: loserPoints, awayPA: winnerPoints }
    : { homePF: loserPoints, homePA: winnerPoints, awayPF: winnerPoints, awayPA: loserPoints };
}
