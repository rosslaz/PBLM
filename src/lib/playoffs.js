// ─── Playoffs (v1.16.0) — D+D Weekly Partners only ──────────────────────────
//
// Two weeks after the 14-week regular season:
//
//   Week 1 (semifinals)  seeds 1&2 v 7&8   and   seeds 3&4 v 5&6
//   Week 2 (finals)      the two winners play for the title,
//                        the two losers play for 3rd place
//
// Every matchup is a best-of-5 series: first team to 3 game wins takes it.
// Teams are fixed for the whole playoffs — seeds 1 and 2 partner each other,
// and so on — which is the point: the regular season decides who you play with.
//
// WHERE IT LIVES. The bracket is stored on the league's schedule row as
// `schedule.playoffs`, deliberately NOT in `schedule.weeks`. Everything that
// adds up the regular season — standings, drop weeks, the Partners matrix, the
// roster-drift notice, the stats dashboard's queries — reads `weeks`, so none
// of it can count a playoff game by accident. Playoff rounds borrow week
// numbers 15 and 16 (league.weeks + 1 and + 2) purely so scores, locks and
// check-ins can reuse the existing row keys:
//
//   score    `${leagueId}_15_w15_c0_m2`   (round 1, semifinal 1, game 3)
//   lock     `${leagueId}_w15`
//   check-in `${leagueId}_w15_${playerId}`
//
// Match objects keep the same shape as every other doubles match, so
// CourtWeekCard, ScoreForm and the score toast work on them unchanged. A court
// carries a `series` descriptor; that's what switches CourtWeekCard into
// series mode (game numbers, "if needed", running series score).
//
// Everything in this file is pure: no React, no database.

export const PLAYOFF_BEST_OF = 5;
export const PLAYOFF_WINS_NEEDED = Math.ceil(PLAYOFF_BEST_OF / 2); // 3
export const PLAYOFF_SEEDS = 8;

// Seed numbers are 1-based, as people say them.
export const SEMIFINALS = [
  { key: "sf1", label: "Semifinal 1", seedsA: [1, 2], seedsB: [7, 8] },
  { key: "sf2", label: "Semifinal 2", seedsA: [3, 4], seedsB: [5, 6] },
];

// Playoffs are a per-league opt-in, and only exist for the format built around
// fixed seeds: 8 players, so 4 teams of 2.
export function playoffsEnabled(league) {
  return league?.competitionType === "dd_partners" && !!league.playoffs;
}

// YYYY-MM-DD + n days, computed at local noon so a daylight-saving change in
// between can't shift the result a day (the bug queued for v1.17.0 in the
// regular-season generators).
export function addDaysISO(iso, n) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + n);
  const pad = v => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// The two playoff rounds sit right after the regular season.
export function playoffWeekNumbers(league) {
  const base = league?.weeks || 14;
  return [base + 1, base + 2];
}

// Default dates and time: one and two weeks after the last regular week, at
// that week's start time.
export function defaultPlayoffSchedule(regularWeeks) {
  const real = (regularWeeks || []).filter(w => !w.placeholder && w.date);
  const last = real.reduce((a, w) => (!a || w.week > a.week ? w : a), null);
  return {
    dates: last ? [addDaysISO(last.date, 7), addDaysISO(last.date, 14)] : ["", ""],
    time: last?.time || "",
  };
}

const teamFromSeeds = (seeds, nums) => nums.map(n => seeds[n - 1]);

// Five game rows for one series. ids follow the w{week}_c{court}_m{index}
// pattern every other match uses, so score keys need no special handling.
function seriesMatches({ week, round, courtIdx, label, team1, team2, date }) {
  return Array.from({ length: PLAYOFF_BEST_OF }, (_, g) => ({
    id: `w${week}_c${courtIdx}_m${g}`,
    team1,
    team2,
    sitOut: null,
    week,
    court: `${label} · Game ${g + 1}`,
    date,
    format: "doubles",
    round,
    game: g + 1,
    playoff: true,
  }));
}

function seriesCourt({ week, round, courtIdx, series, team1, team2, date }) {
  return {
    courtName: series.label,
    players: [...team1, ...team2],
    round,
    series: { ...series, bestOf: PLAYOFF_BEST_OF },
    matches: seriesMatches({ week, round, courtIdx, label: series.label, team1, team2, date }),
  };
}

// Projected or actual semifinal pairings from a seed list (player ids in seed
// order). Used both for the "if the season ended today" preview and for setup.
export function semifinalPairings(seeds) {
  return SEMIFINALS.map(sf => ({
    ...sf,
    teamA: teamFromSeeds(seeds, sf.seedsA),
    teamB: teamFromSeeds(seeds, sf.seedsB),
  }));
}

// Build the bracket when the regular season is over.
//   seeds        player ids, best first (final standings order), exactly 8
//   seedPoints   matching standings Points, kept for display
//   league       for the week numbers
//   dates        [round1, round2] as YYYY-MM-DD
//   time         "HH:MM" or ""
export function buildPlayoffs({ seeds, seedPoints, league, dates, time, now }) {
  if (!Array.isArray(seeds) || seeds.length !== PLAYOFF_SEEDS || new Set(seeds).size !== PLAYOFF_SEEDS) {
    return { error: `Playoffs need ${PLAYOFF_SEEDS} different seeded players.` };
  }
  if (!dates?.[0] || !dates?.[1]) return { error: "Pick a date for both playoff weeks." };
  if (dates[1] < dates[0]) return { error: "The finals can't be before the semifinals." };
  const [w1, w2] = playoffWeekNumbers(league);
  const courts = semifinalPairings(seeds).map((sf, ci) => seriesCourt({
    week: w1, round: 1, courtIdx: ci, date: dates[0],
    series: { key: sf.key, label: sf.label, seedsA: sf.seedsA, seedsB: sf.seedsB },
    team1: sf.teamA, team2: sf.teamB,
  }));
  return {
    playoffs: {
      version: 1,
      createdAt: now || new Date().toISOString(),
      bestOf: PLAYOFF_BEST_OF,
      seeds: [...seeds],
      seedPoints: seedPoints ? [...seedPoints] : null,
      rounds: [
        { week: w1, round: 1, name: "Semifinals", date: dates[0], time: time || null, courts },
        // Finals are a placeholder until both semis are decided — who plays
        // whom isn't known yet. The date is fixed now so players can plan.
        { week: w2, round: 2, name: "Finals", date: dates[1], time: time || null, courts: [] },
      ],
    },
  };
}

// ─── Series scoring ─────────────────────────────────────────────────────────
// Walk the games in order, counting wins until one side reaches 3. Each game
// comes back with a status:
//   counted    scored, and part of the series
//   pending    not scored yet, and still needed
//   notNeeded  the series was already decided before this game
//   extra      has a score, but the series was already decided before it —
//              only possible if an earlier game was edited afterwards; shown,
//              never counted
export function seriesState(court, getScore, leagueId) {
  const matches = court?.matches || [];
  const teamA = matches[0]?.team1 || [];
  const teamB = matches[0]?.team2 || [];
  let winsA = 0, winsB = 0, winner = null;
  const games = matches.map(match => {
    const score = getScore(leagueId, match.week, match.id);
    if (winner) return { match, score, status: score ? "extra" : "notNeeded" };
    if (!score) return { match, score: null, status: "pending" };
    const aWon = +score.homeScore > +score.awayScore;
    if (aWon) winsA++; else winsB++;
    if (winsA >= PLAYOFF_WINS_NEEDED) winner = "A";
    else if (winsB >= PLAYOFF_WINS_NEEDED) winner = "B";
    return { match, score, status: "counted", aWon };
  });
  const nextIndex = winner ? -1 : games.findIndex(g => g.status === "pending");
  return {
    key: court?.series?.key || null,
    label: court?.series?.label || court?.courtName || "",
    seedsA: court?.series?.seedsA || null,
    seedsB: court?.series?.seedsB || null,
    teamA, teamB, winsA, winsB,
    winner,
    decided: !!winner,
    winnerTeam: winner === "A" ? teamA : winner === "B" ? teamB : null,
    loserTeam: winner === "A" ? teamB : winner === "B" ? teamA : null,
    winnerSeeds: winner === "A" ? court?.series?.seedsA : winner === "B" ? court?.series?.seedsB : null,
    loserSeeds: winner === "A" ? court?.series?.seedsB : winner === "B" ? court?.series?.seedsA : null,
    games,
    nextIndex,
    played: winsA + winsB,
  };
}

// "Ryan M. & Alex G. lead 2–1", "Tied 1–1", "Ryan M. & Alex G. win 3–1".
export function seriesSummary(state, teamName) {
  if (!state) return "";
  const { winsA, winsB, decided, winner, teamA, teamB } = state;
  const hi = Math.max(winsA, winsB), lo = Math.min(winsA, winsB);
  if (decided) return `${teamName(winner === "A" ? teamA : teamB)} win ${hi}–${lo}`;
  if (winsA + winsB === 0) return `Best of ${PLAYOFF_BEST_OF} · first to ${PLAYOFF_WINS_NEEDED}`;
  if (winsA === winsB) return `Tied ${winsA}–${winsB}`;
  return `${teamName(winsA > winsB ? teamA : teamB)} lead ${hi}–${lo}`;
}

// The whole bracket's status in one pass.
//   stage: "semis" | "awaitingFinals" | "finals" | "complete"
export function playoffState(playoffs, getScore, leagueId) {
  if (!playoffs?.rounds?.length) return null;
  const rounds = playoffs.rounds.map(r => {
    const series = (r.courts || []).map(c => seriesState(c, getScore, leagueId));
    return { ...r, series, setUp: (r.courts || []).length > 0, decided: series.length > 0 && series.every(s => s.decided) };
  });
  const [semis, finals] = rounds;
  const final = finals?.series.find(s => s.key === "final") || null;
  const third = finals?.series.find(s => s.key === "third") || null;
  const stage = !semis.decided ? "semis"
    : !finals?.setUp ? "awaitingFinals"
    : !finals.decided ? "finals"
    : "complete";
  return {
    rounds,
    stage,
    champions: final?.winnerTeam || null,
    runnersUp: final?.loserTeam || null,
    third: third?.winnerTeam || null,
    fourth: third?.loserTeam || null,
    hasScores: rounds.some(r => r.series.some(s => s.games.some(g => g.score))),
    finalsHaveScores: !!finals && finals.series.some(s => s.games.some(g => g.score)),
  };
}

// Seed number for a player (1-based), or null.
export function seedOf(playoffs, playerId) {
  const i = (playoffs?.seeds || []).indexOf(playerId);
  return i >= 0 ? i + 1 : null;
}

// Lower seed numbers first, so the team holding the best remaining seed is
// listed (and scored) as team 1.
const bestSeed = seeds => Math.min(...(seeds || [99]));
const bySeed = (x, y) => bestSeed(x.seeds) - bestSeed(y.seeds);

// Fill in the finals week once both semifinals are decided:
//   Championship — the two semifinal winners
//   3rd place    — the two semifinal losers
// Returns { round } (the finals round with courts) or { error }.
export function buildFinalsRound(playoffs, getScore, leagueId) {
  const state = playoffState(playoffs, getScore, leagueId);
  if (!state) return { error: "No playoffs to update." };
  const [semis, finals] = state.rounds;
  if (!semis.decided) return { error: "Both semifinals need a winner first." };
  if (finals.setUp) return { error: "The finals are already set." };
  const winners = semis.series.map(s => ({ team: s.winnerTeam, seeds: s.winnerSeeds })).sort(bySeed);
  const losers = semis.series.map(s => ({ team: s.loserTeam, seeds: s.loserSeeds })).sort(bySeed);
  const week = finals.week, date = finals.date;
  const courts = [
    seriesCourt({
      week, round: 2, courtIdx: 0, date,
      series: { key: "final", label: "Championship", seedsA: winners[0].seeds, seedsB: winners[1].seeds },
      team1: winners[0].team, team2: winners[1].team,
    }),
    seriesCourt({
      week, round: 2, courtIdx: 1, date,
      series: { key: "third", label: "3rd place", seedsA: losers[0].seeds, seedsB: losers[1].seeds },
      team1: losers[0].team, team2: losers[1].team,
    }),
  ];
  const { name, time } = playoffs.rounds[1];
  return { round: { week, round: 2, name, date, time, courts } };
}

// Change the dates/time of both rounds. Matches carry their own date (the
// score form and the hero card read it), so they're rewritten too.
export function withPlayoffDates(playoffs, dates, time) {
  return {
    ...playoffs,
    rounds: playoffs.rounds.map((r, i) => {
      const date = dates[i] || r.date;
      return {
        ...r,
        date,
        time: time || null,
        courts: (r.courts || []).map(c => ({ ...c, matches: c.matches.map(m => ({ ...m, date })) })),
      };
    }),
  };
}

// The round a player should be looking at right now, and their series in it:
// the latest round that's been set up and includes them. Returns null when
// they aren't in the playoffs.
export function playerPlayoffSpot(state, playerId) {
  if (!state) return null;
  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const r = state.rounds[i];
    const s = r.series.find(x => x.teamA.includes(playerId) || x.teamB.includes(playerId));
    if (s) return { round: r, series: s, onA: s.teamA.includes(playerId) };
  }
  return null;
}
