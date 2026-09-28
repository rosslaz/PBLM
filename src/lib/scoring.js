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

// ─── League points (D+D Weekly Partners) ───────────────────────────────────
// A second, separate scoring system used by the D+D format, where standings
// rank on accumulated Points rather than win percentage.
//
//   0.5 points per point scored, plus a 2-point bonus for winning.
//
// Worked example, an 11-6 win: the winners each bank 0.5 x 11 + 2 = 7.5, the
// losers 0.5 x 6 = 3.0.
//
// CAPS. Long games are capped so they can't out-earn short ones, but the two
// sides cap at different places:
//
//   winner  ->  11  ->  0.5 x 11 + 2  =  7.5 max
//   loser   ->  10  ->  0.5 x 10      =  5.0 max
//
// So losing 15-13 banks 5.0, not the 6.5 an uncapped 13 would give. The loser
// caps at 10 rather than 11 so that a losing scoreline can never match a
// winning one's scoring half.
//
// NOTE: these caps are deliberately NOT the same as the PF/PA caps above
// (winner 11, loser 9). Points is its own system computed from the raw score.
// A 15-13 therefore shows PF 9 but Points 5.0 - the columns answer different
// questions and are not meant to reconcile arithmetically.
export const POINTS_PER_SCORE = 0.5;
export const WIN_BONUS = 2;
export const MAX_POINTS_SCORE_WINNER = 11;  // -> 7.5 with the bonus
export const MAX_POINTS_SCORE_LOSER = 10;   // -> 5.0
export const MAX_GAME_POINTS = MAX_POINTS_SCORE_WINNER * POINTS_PER_SCORE + WIN_BONUS; // 7.5

// League points earned by one player from one game.
//   rawScore - that player's side's ACTUAL score (not the capped PF)
//   won      - whether their side won
export function leaguePoints(rawScore, won) {
  const cap = won ? MAX_POINTS_SCORE_WINNER : MAX_POINTS_SCORE_LOSER;
  const scored = Math.min(Number(rawScore), cap);
  return scored * POINTS_PER_SCORE + (won ? WIN_BONUS : 0);
}

// Points carry a .5, so they're summed as floats. Round at the display edge to
// kill accumulated binary-float drift (0.1 + 0.2 territory) - 7.499999999 must
// never render as 7.5 in one place and 7.49 in another.
export function formatPoints(n) {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ─── Drop weeks (D+D Weekly Partners) ─────────────────────────────────────
// Only a player's best 12 of 14 weeks count toward final standings - their two
// lowest-scoring weeks are dropped.
//
// The allowance phases in rather than applying from week one. Dropping two
// weeks when only two have been played would leave everyone on zero, and
// mid-season standings would swing wildly as a single new result displaced a
// dropped one. So:
//
//   fewer than 6 locked weeks  ->  0 drops
//   6 to 11                    ->  1 drop
//   12 or more                 ->  2 drops
//
// Thresholds are on LOCKED weeks, not calendar weeks, so the allowance tracks
// what has actually been played and scored.
//
// Note this quietly absorbs absences: a week a player sat out earns 0 points,
// which makes it their lowest week and therefore the first one dropped. That's
// usually the intent of a drop-week rule, but it does mean missing up to two
// weeks carries no cost in the standings.
export const DROP_THRESHOLDS = [
  { minWeeks: 12, drops: 2 },
  { minWeeks: 6, drops: 1 },
];
export const MAX_DROPS = 2;

export function dropsForLockedWeeks(lockedWeekCount) {
  const rule = DROP_THRESHOLDS.find(t => lockedWeekCount >= t.minWeeks);
  return rule ? rule.drops : 0;
}

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
