// ─── Playoffs (v1.17.0) — D+D Weekly Partners only ──────────────────────────
//
// One playoff night after the 14-week regular season. The final standings
// split the league into two groups of four:
//
//   Title group   seeds 1-4, playing for 1st-4th
//   5th-8th       seeds 5-8, playing for 5th-8th
//
// Each group plays all three ways of splitting four players into two teams,
// one game each, so everyone partners each player in the group once and plays
// against him twice:
//
//   Game 1   1&2 v 3&4        (seed numbers within the group: 1st, 2nd, ...)
//   Game 2   1&3 v 2&4
//   Game 3   1&4 v 2&3
//
// Games are to 15, win by 2 (PLAYOFF_GAME_TO). A game won counts as a win for
// both partners. The group is ranked by wins, then point differential (raw
// scores), then regular-season seed. The top of the title group is champion.
//
// This replaced v1.16.0's two-week bracket (fixed teams 1&2 v 7&8 and 3&4 v
// 5&6, best of 5) after the league voted for it. No league ever stored a
// bracket in the old shape, so there is nothing to migrate; playoffState()
// still recognises one so the commissioner could remove it.
//
// WHERE IT LIVES. The playoffs are stored on the league's schedule row as
// `schedule.playoffs`, deliberately NOT in `schedule.weeks`. Everything that
// adds up the regular season — standings, drop weeks, the Partners matrix, the
// roster-drift notice, the stats dashboard's queries — reads `weeks`, so none
// of it can count a playoff game by accident. The playoff night borrows week
// number 15 (league.weeks + 1) purely so scores, the lock and check-ins can
// reuse the existing row keys:
//
//   score    `${leagueId}_15_w15_c0_m2`   (title group, game 3)
//   lock     `${leagueId}_w15`
//   check-in `${leagueId}_w15_${playerId}`
//
// Match objects keep the shape of every other doubles match, plus `gameTo`,
// so CourtWeekCard, ScoreForm and the score toast work on them unchanged and
// score entry knows these games go to 15.
//
// Everything in this file is pure: no React, no database.

export const PLAYOFF_SEEDS = 8;
export const PLAYOFF_GAME_TO = 15;
export const PLAYOFF_FORMAT = "groups";

// Seed numbers are 1-based, as people say them.
export const PLAYOFF_GROUPS = [
  { key: "title", label: "Title group", seeds: [1, 2, 3, 4], firstPlace: 1 },
  { key: "places", label: "5th–8th", seeds: [5, 6, 7, 8], firstPlace: 5 },
];

// The three ways to split a group of four into two teams, as indexes into the
// group's players (best seed first).
export const PARTNER_COMBOS = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

// Playoffs are a per-league opt-in, and only exist for the 8-player format.
export function playoffsEnabled(league) {
  return league?.competitionType === "dd_partners" && !!league.playoffs;
}

// YYYY-MM-DD + n days, computed at local noon so a daylight-saving change in
// between can't shift the result a day.
export function addDaysISO(iso, n) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + n);
  const pad = v => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// The playoff night sits right after the regular season.
export function playoffWeekNumber(league) {
  return (league?.weeks || 14) + 1;
}

// Default date and time: one week after the last regular week, at that
// week's start time.
export function defaultPlayoffSchedule(regularWeeks) {
  const real = (regularWeeks || []).filter(w => !w.placeholder && w.date);
  const last = real.reduce((a, w) => (!a || w.week > a.week ? w : a), null);
  return { date: last ? addDaysISO(last.date, 7) : "", time: last?.time || "" };
}

// Both groups from a seed list (player ids, best first): who is in each and
// the three games they play. Used for the "if the season ended today" preview,
// the setup form, and to build the real thing.
export function playoffGroups(seeds) {
  return PLAYOFF_GROUPS.map(g => {
    const players = g.seeds.map(n => seeds[n - 1]);
    return {
      ...g,
      players,
      games: PARTNER_COMBOS.map(([a, b]) => ({
        team1: a.map(i => players[i]),
        team2: b.map(i => players[i]),
        seeds1: a.map(i => g.seeds[i]),
        seeds2: b.map(i => g.seeds[i]),
      })),
    };
  });
}

// Build the playoffs when the regular season is over.
//   seeds        player ids, best first (final standings order), exactly 8
//   seedPoints   matching standings Points, kept for display
//   league       for the week number
//   date         YYYY-MM-DD
//   time         "HH:MM" or ""
export function buildPlayoffs({ seeds, seedPoints, league, date, time, gameTo = PLAYOFF_GAME_TO, now }) {
  if (!Array.isArray(seeds) || seeds.length !== PLAYOFF_SEEDS || new Set(seeds).size !== PLAYOFF_SEEDS) {
    return { error: `Playoffs need ${PLAYOFF_SEEDS} different seeded players.` };
  }
  if (!date) return { error: "Pick a date for the playoff night." };
  const week = playoffWeekNumber(league);
  const courts = playoffGroups(seeds).map((g, ci) => ({
    courtName: g.label,
    players: g.players,
    round: 1,
    group: { key: g.key, label: g.label, seeds: g.seeds, firstPlace: g.firstPlace },
    // ids follow the w{week}_c{court}_m{index} pattern every other match
    // uses, so score keys need no special handling.
    matches: g.games.map((game, gi) => ({
      id: `w${week}_c${ci}_m${gi}`,
      team1: game.team1,
      team2: game.team2,
      sitOut: null,
      week,
      court: `${g.label} · Game ${gi + 1}`,
      date,
      format: "doubles",
      round: 1,
      game: gi + 1,
      gameTo,
      playoff: true,
    })),
  }));
  return {
    playoffs: {
      version: 2,
      format: PLAYOFF_FORMAT,
      createdAt: now || new Date().toISOString(),
      gameTo,
      seeds: [...seeds],
      seedPoints: seedPoints ? [...seedPoints] : null,
      rounds: [{ week, round: 1, name: "Playoff night", date, time: time || null, courts }],
    },
  };
}

// ─── Group tables ───────────────────────────────────────────────────────────
// One row per player: wins, losses, points for and against (raw scores), and
// the differential. Order: wins, then differential, then seed. `tiebreak` on a
// row says what put it ahead of the row below when they finished level on
// wins — "diff" or "seed" — and is null otherwise.
export function groupTable(court, getScore, leagueId, seedOf) {
  const players = court?.players || [];
  const rows = Object.fromEntries(players.map(id => [id, { id, wins: 0, losses: 0, pf: 0, pa: 0, played: 0 }]));
  let scored = 0;
  for (const m of court?.matches || []) {
    const s = getScore(leagueId, m.week, m.id);
    if (!s) continue;
    scored++;
    const h = +s.homeScore, a = +s.awayScore, team1Won = h > a;
    for (const [team, won, pf, pa] of [[m.team1, team1Won, h, a], [m.team2, !team1Won, a, h]]) {
      for (const id of team) {
        const r = rows[id];
        if (!r) continue;
        r.played++; r.pf += pf; r.pa += pa;
        if (won) r.wins++; else r.losses++;
      }
    }
  }
  const table = Object.values(rows)
    .map(r => ({ ...r, diff: r.pf - r.pa, seed: seedOf(r.id) }))
    .sort((x, y) => y.wins - x.wins || y.diff - x.diff || (x.seed ?? 99) - (y.seed ?? 99));
  const first = court?.group?.firstPlace || 1;
  table.forEach((r, i) => {
    r.place = first + i;
    const next = table[i + 1];
    r.tiebreak = next && next.wins === r.wins ? (next.diff === r.diff ? "seed" : "diff") : null;
  });
  const total = (court?.matches || []).length;
  return { rows: table, scored, total, complete: total > 0 && scored === total };
}

// The whole playoff night's status in one pass.
//   stage: "scheduled" (no scores) | "inProgress" | "complete" | "legacy"
export function playoffState(playoffs, getScore, leagueId) {
  if (!playoffs) return null;
  if (playoffs.format !== PLAYOFF_FORMAT || !playoffs.rounds?.length) {
    // A v1.16.0 bracket. None was ever created; this keeps the tab from
    // breaking if one turns up, and offers removal.
    const scored = (playoffs.rounds || []).some(r => (r.courts || []).some(c => (c.matches || []).some(m => getScore(leagueId, m.week, m.id))));
    return { legacy: true, stage: "legacy", round: null, groups: [], hasScores: scored, scoredGames: 0, totalGames: 0, champion: null };
  }
  const round = playoffs.rounds[0];
  const seedOf = id => {
    const i = (playoffs.seeds || []).indexOf(id);
    return i >= 0 ? i + 1 : null;
  };
  const groups = (round.courts || []).map(court => ({
    key: court.group?.key,
    label: court.group?.label || court.courtName,
    seeds: court.group?.seeds || [],
    firstPlace: court.group?.firstPlace || 1,
    court,
    ...groupTable(court, getScore, leagueId, seedOf),
  }));
  const scoredGames = groups.reduce((t, g) => t + g.scored, 0);
  const totalGames = groups.reduce((t, g) => t + g.total, 0);
  const title = groups.find(g => g.key === "title") || groups[0];
  const stage = scoredGames === 0 ? "scheduled" : scoredGames < totalGames ? "inProgress" : "complete";
  return {
    round,
    groups,
    stage,
    scoredGames,
    totalGames,
    hasScores: scoredGames > 0,
    // The champion is known once the title group's three games are in, even
    // if the 5th-8th group is still playing.
    champion: title?.complete ? title.rows[0].id : null,
    titleComplete: !!title?.complete,
  };
}

// Seed number for a player (1-based), or null.
export function seedOf(playoffs, playerId) {
  const i = (playoffs?.seeds || []).indexOf(playerId);
  return i >= 0 ? i + 1 : null;
}

// Move the playoff night. Matches carry their own date (the score form and
// the hero card read it), so they're rewritten too.
export function withPlayoffDate(playoffs, date, time) {
  return {
    ...playoffs,
    rounds: playoffs.rounds.map(r => ({
      ...r,
      date: date || r.date,
      time: time || null,
      courts: (r.courts || []).map(c => ({ ...c, matches: c.matches.map(m => ({ ...m, date: date || m.date })) })),
    })),
  };
}

// A player's view of the night: their group, their row in its table, and
// their three games with partner and opponents. Null when they aren't in it.
export function playerPlayoffSpot(state, playerId, getScore, leagueId) {
  if (!state || state.legacy) return null;
  const group = state.groups.find(g => g.court.players.includes(playerId));
  if (!group) return null;
  const games = group.court.matches.map(m => {
    const onTeam1 = m.team1.includes(playerId);
    const mine = onTeam1 ? m.team1 : m.team2;
    const score = getScore(leagueId, m.week, m.id);
    return {
      match: m,
      partner: mine.find(p => p !== playerId),
      opponents: onTeam1 ? m.team2 : m.team1,
      score,
      won: score ? (onTeam1 ? +score.homeScore > +score.awayScore : +score.awayScore > +score.homeScore) : null,
    };
  });
  return {
    group,
    row: group.rows.find(r => r.id === playerId),
    games,
    next: games.find(g => !g.score) || null,
  };
}
