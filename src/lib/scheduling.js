// ─── Scheduling algorithms ──────────────────────────────────────────────────
// Pure functions for distributing players across courts, generating match
// templates, and computing ladder rotations. No React or DB dependencies.
import { MIN_PER_COURT, MAX_PER_COURT, courtName } from "./constants.js";

// Try to split N players into court groups of 4–5 across up to `maxCourts` courts.
// Returns an array of group sizes, or null if no valid distribution exists.
export function distributePlayersToCourts(n, maxCourts = 4) {
  for (let nc = Math.min(maxCourts, Math.floor(n / MIN_PER_COURT)); nc >= 1; nc--) {
    const sizes = Array(nc).fill(MIN_PER_COURT);
    let remaining = n - nc * MIN_PER_COURT;
    let i = 0;
    while (remaining > 0 && i < nc) { if (sizes[i] < MAX_PER_COURT) { sizes[i]++; remaining--; } i++; }
    if (remaining === 0) return sizes;
  }
  return null;
}

// Deterministic shuffle using a linear congruential generator.
export function seededShuffle(arr, seed) {
  const a = [...arr]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Singles match generator: round-robin within a court group ──────────────
export function singlesMatches(group) {
  const matches = [];
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
      matches.push({ home: group[i], away: group[j] });
  return matches;
}

// ─── Doubles match templates ────────────────────────────────────────────────
// 4 players (no sit-outs): 3 matches, each pair partners once, opposes twice
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

export function doublesMatches(group, weekSeed) {
  const template = group.length === 5 ? DOUBLES_5_TEMPLATE : DOUBLES_4_TEMPLATE;
  // Rotate which player is "A","B" etc. per week so the sit-out order varies
  const rotated = seededShuffle(group, weekSeed);
  return template.map(m => ({
    sitOut: m.sit !== null ? rotated[m.sit] : null,
    team1: m.t1.map(i => rotated[i]),
    team2: m.t2.map(i => rotated[i]),
  }));
}

// Distribute players across courts with balanced gender mix.
// Each court gets men:women proportional to the global ratio, ±1.
// Players are pulled from the pre-shuffled queue in order, preserving the
// fairness-by-exposure ordering within each gender.
export function assignBalancedCourts(shuffledPlayers, sizes, playerGenders) {
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

// ─── Build a single court's matches ─────────────────────────────────────────
// Used both by the master generator (initial schedule) and by the schedule
// preview editor (recomputing matches after the commissioner moves players
// between courts). The function is intentionally stateless — it doesn't
// touch any opponent-frequency tracking — so it can be called any number of
// times for the same week/court without side effects.
//
// `weekNum` is 1-indexed (matches the convention used elsewhere — week 1
// for the first week of the season). `courtIdx` is 0-indexed.
// D+D Weekly Partners
//
// A fixed 8-player, 14-week format. Every week the 8 players are re-paired
// into 4 teams; the teams split into two sides, and each team plays both
// teams on the opposite side - two games per matchup, opponents swapping
// between the two rounds while partners stay put.
//
// Per week: 4 teams, 2 rounds, 2 matchups per round, 2 games each = 8 games.
//
// THE CONSTRAINTS, and why this is a hard-coded table rather than a solver:
//   - Each of the 28 possible pairs partners exactly twice
//     (14 weeks x 4 teams = 56 = 28 x 2 - an exact fit, no slack)
//   - The second time a pair is together they must face neither of the two
//     teams they faced the first time
//
// Those interact tightly. Repeating a 1-factorization outright fails: the
// second time a pair is together the other three teams are identical, they
// have already played two of them, and only one legal opponent remains where
// two are needed. A valid arrangement needs two DIFFERENT 1-factorizations
// whose weeks line up correctly.
//
// The table below was found by backtracking search and verified exhaustively:
// 28 distinct pairs, each appearing exactly twice, and zero pairs facing a
// repeated opponent team. Because the format is always exactly 8 players and
// always 14 weeks, there is nothing to solve at runtime - shipping a search to
// the browser would add failure modes and latency for a fixed answer.
//
// Indices 0-7 are seats, not people. Real players are shuffled into the seats
// at generation time, so the same table yields a different-looking season each
// time while the guarantees hold (they are symmetric under any relabelling).
//
//   teams - the 4 partnerships for that week, as seat-index pairs
//   sides - the two opposing sides, as indices INTO teams
export const DD_PARTNERS_TEMPLATE = [
  { teams: [[0,5],[1,2],[3,4],[6,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,6],[1,5],[2,3],[4,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,4],[1,3],[2,6],[5,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,1],[2,5],[3,6],[4,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,7],[1,5],[2,3],[4,6]], sides: [[0,3],[1,2]] },
  { teams: [[0,3],[1,7],[2,4],[5,6]], sides: [[0,1],[2,3]] },
  { teams: [[0,3],[1,4],[2,5],[6,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,1],[2,6],[3,4],[5,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,2],[1,4],[3,7],[5,6]], sides: [[0,1],[2,3]] },
  { teams: [[0,2],[1,7],[3,5],[4,6]], sides: [[0,1],[2,3]] },
  { teams: [[0,5],[1,6],[2,4],[3,7]], sides: [[0,1],[2,3]] },
  { teams: [[0,4],[1,6],[2,7],[3,5]], sides: [[0,1],[2,3]] },
  { teams: [[0,6],[1,3],[2,7],[4,5]], sides: [[0,1],[2,3]] },
  { teams: [[0,7],[1,2],[3,6],[4,5]], sides: [[0,1],[2,3]] },
];

export const DD_PARTNERS_PLAYERS = 8;
export const DD_PARTNERS_WEEKS = DD_PARTNERS_TEMPLATE.length; // 14
export const DD_PARTNERS_GAMES_PER_MATCHUP = 2;

// Build one week. Returns a week object in the shape the rest of the app
// expects, with the two ROUNDS occupying the courts slots - all 8 players are
// present for both rounds, so a court here means a round of play, and every
// player sees the whole week rather than just their own court.
export function buildDDPartnersWeek(seats, weekNum, dateStr) {
  const tpl = DD_PARTNERS_TEMPLATE[(weekNum - 1) % DD_PARTNERS_TEMPLATE.length];
  const teams = tpl.teams.map(([a, b]) => [seats[a], seats[b]]);
  const [sideA, sideB] = tpl.sides;

  // Round 1 pairs each side-A team with the same-position side-B team;
  // round 2 swaps them. Partners never change, opponents do.
  const rounds = [
    [[sideA[0], sideB[0]], [sideA[1], sideB[1]]],
    [[sideA[0], sideB[1]], [sideA[1], sideB[0]]],
  ];

  const courts = [];
  rounds.forEach((matchups, r) => {
    matchups.forEach(([t1, t2], mi) => {
      // Each matchup occupies its own physical court for that round, so a
      // court group here is exactly one matchup: 4 players, 2 games.
      // Flattening rounds x courts into a single list keeps the existing
      // court model intact - CourtWeekCard filters by court.players, so a
      // player sees exactly the two courts they are on (one per round)
      // rather than the whole week.
      const courtIdx = courts.length;              // 0..3 across the week
      const matches = [];
      for (let g = 0; g < DD_PARTNERS_GAMES_PER_MATCHUP; g++) {
        matches.push({
          // Keeps the established w{week}_c{court}_m{idx} shape so score keys
          // and every other consumer keep working untouched.
          id: `w${weekNum}_c${courtIdx}_m${g}`,
          team1: teams[t1],
          team2: teams[t2],
          sitOut: null,
          week: weekNum,
          court: `Round ${r + 1} \u00b7 Court ${mi + 1}`,
          date: dateStr,
          format: "doubles",
          round: r + 1,
          game: g + 1, // 1 or 2 - display only
        });
      }
      courts.push({
        courtName: `Round ${r + 1} \u00b7 Court ${mi + 1}`,
        players: [...teams[t1], ...teams[t2]],
        matches,
        round: r + 1,
      });
    });
  });

  return { week: weekNum, date: dateStr, courts };
}

// Full 14-week season. playerIds must be exactly 8.
export function generateDDPartnersSchedule(playerIds, startDate, seed) {
  if (playerIds.length !== DD_PARTNERS_PLAYERS) {
    return { error: `D+D Weekly Partners needs exactly ${DD_PARTNERS_PLAYERS} players. This league has ${playerIds.length}.` };
  }
  // Shuffle players into the seats so each generated season looks different.
  // The guarantees are invariant under relabelling, so this is free variety.
  const seats = seededShuffle(playerIds, seed ?? (Date.now() & 0xffffffff));

  const weeks = [];
  for (let w = 1; w <= DD_PARTNERS_WEEKS; w++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + (w - 1) * 7);
    weeks.push(buildDDPartnersWeek(seats, w, d.toISOString().split("T")[0]));
  }
  return { weeks };
}

export function buildCourtMatches(group, weekNum, courtIdx, format, dateStr) {
  const isDoubles = format === "Doubles" || format === "Mixed Doubles";
  const raw = isDoubles
    ? doublesMatches(group, weekNum * 1009 + courtIdx * 7 + 13)
    : singlesMatches(group);
  return raw.map((m, mi) => ({
    id: `w${weekNum}_c${courtIdx}_m${mi}`,
    ...m,
    week: weekNum,
    court: courtName(courtIdx),
    date: dateStr,
    format: isDoubles ? "doubles" : "singles",
  }));
}

// ─── Master schedule generator (for mixer leagues) ──────────────────────────
// Builds the entire season at once. Per-week-per-court edits are handled at
// the preview-modal level — they're applied to the proposal in memory and
// the algorithm here doesn't re-run after them. So this function has no
// "starting groups" parameter; it always runs from scratch.
export function generateCourtSchedule(playerIds, weeks, startDate, format = "Singles", numCourts = 4, playerGenders = {}) {
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

// ─── Ladder Scheduling ──────────────────────────────────────────────────────
// Compute weekly per-court standings (within one week's matches only).
export function rankCourtPlayers(courtData, scoresMap, leagueId, weekNum) {
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
// Rules:
//   - All courts: top 2 move up, bottom 2 move down
//   - 5-player court: 3rd place stays
//   - 4-player court: nobody stays in middle (top 2 + bottom 2 = 4)
//   - Top court: top 2 stay (no court above)
//   - Bottom court: bottom 2 stay (no court below)
// Returns array of new court groups (player IDs in each).
export function laddderRotate(prevWeekCourts, scoresMap, leagueId, weekNum, courtSizes) {
  const numCourts = prevWeekCourts.length;
  const ranked = prevWeekCourts.map(c => rankCourtPlayers(c, scoresMap, leagueId, weekNum));
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

  const newCourts = partitions.map((p, ci) => {
    const fromBelow = ci < numCourts - 1 ? partitions[ci + 1].moveUp   : [];
    const fromAbove = ci > 0             ? partitions[ci - 1].moveDown : [];
    return [...p.stay, ...fromBelow, ...fromAbove];
  });

  // Sanity: court sizes should match courtSizes (the configured target for this week)
  // If not, fall back to flattening + redistributing
  const sizesMatch = newCourts.every((c, i) => c.length === courtSizes[i]);
  if (!sizesMatch) {
    const flat = newCourts.flat();
    const out = [];
    let idx = 0;
    for (const sz of courtSizes) { out.push(flat.slice(idx, idx + sz)); idx += sz; }
    return out;
  }
  return newCourts;
}

// Build a single week object from court groups (used by ladder)
export function buildLadderWeek(courtGroups, weekNum, dateStr, format) {
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
