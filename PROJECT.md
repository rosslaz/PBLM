# Pickleball League Manager — Project Reference

**Current version: 1.15.2** — deployed and live. Docs verified against the
running code and the production database on this date.

This is the canonical handoff. Read this first, then `NEXT-UP.md` for planned
work. `SETUP.md` covers standing up a fresh instance.

> **On trusting this document.** These docs have drifted badly twice. An earlier
> version claimed there was no service worker (there was), named a manifest file
> that didn't exist, and described a single-JSON-blob architecture three major
> versions after it was replaced. That cost real time — a working service worker
> was nearly rewritten from scratch on the strength of a stale sentence.
>
> **When the docs and the code disagree, the code wins.** Read the actual files
> before acting on anything here.

---

## 1. What this is

A multi-tenant web app for running pickleball leagues. Built originally for CSC
Pickleball at Cranbrook Swim Club, then generalised so any club can sign up via
a public join code. It now runs two clubs (CSC Pickleball and Dink & Drink).

Three views:

- **Home** — pre-login. Email login, "Create a club", "Join with a code".
- **Player** — their leagues, schedules, scores, standings, weekly check-ins.
- **Commissioner** — leagues, players, commissioners, club settings, trash.

---

## 2. Tech stack

- **React 18** — hooks only. No router: `view` is a string in `App.jsx`.
- **Vite 5** — no plugins beyond `@vitejs/plugin-react`.
- **Supabase Postgres** — RLS enabled, permissive `anon_all` policy.
- **Vercel** — auto-deploys from GitHub `main`. No staging.
- **PWA** — installable, hand-written caching service worker (no `vite-plugin-pwa`).
- **No backend code.** Pure SPA + DB.
- **Styling:** inline styles via `styles.js` (`S.*`). CSS variables drive
  light/dark through `prefers-color-scheme`. No CSS framework.
- **Dependencies:** `@supabase/supabase-js`, `react`, `react-dom`. That's all.

---

## 3. Infrastructure

| Resource | Identifier |
|---|---|
| **Local path** | `C:\Users\rossl\Projects\PBLM\pickleball-deploy\` |
| **GitHub** | `rosslaz/PBLM` (public) |
| **Vercel project** | `pblm` (`prj_JjBT11hq8ONMUUzCDwATU2OaWLkL`) |
| **Vercel team** | `team_5fZejjoHm5i4299zoa2MYheI` |
| **Supabase project_id** | `uarbvnraljoktlkugchd` |
| **Supabase URL** | `https://uarbvnraljoktlkugchd.supabase.co` |

Env vars (Vercel + `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Deploy: commit → push to `main` → Vercel builds → live in ~1–2 min.

---

## 4. Tooling notes for the next session

- **Filesystem MCP** — read/write on Ross's Windows machine. `str_replace` is
  **not** available, but **`edit_file` is** (line-based, supports `dryRun`).
  Prefer `edit_file` for surgical edits; `write_file` for full rewrites.
  `App.jsx` is ~100KB, so full rewrites of it are expensive and risky.
- **`edit_file` gotcha:** box-drawing characters (`─`) and some Unicode in
  comments often fail to match. Anchor on plain-ASCII code lines instead.
- **`dryRun: true` is the way to probe** whether a string exists in a file
  without a full read — much cheaper than reading a 100KB file.
- **Device folder access** — since v1.15.2 the project folder is a *connected
  folder*, so finished files can be copied across whole (stage → write) instead
  of replaying dozens of `edit_file` calls. Prefer that for multi-file releases.
- **Supabase MCP** — full DB access.
- **Vercel MCP** — deployment state. Preview URLs are SSO-protected and can't be
  fetched directly.
- **A sandbox with Python/Node IS available** (`bash_tool`) — separate from
  Ross's machine, but invaluable for verifying algorithms, computing contrast
  ratios, and generating images before shipping anything.

**Verify the filesystem path by reading a file, not by trusting a directory
listing.** A stale `list_allowed_directories` result once pointed at
`C:\Users\rossl\Desktop\AI Projects\...` and caused a false alarm. The real root
is `C:\Users\rossl\Projects\`.

**No build tool for Ross's repo.** Ross builds and tests locally and reports
back. Never claim a build passes.

Ross is on **Windows / PowerShell**. Don't paste bash.

---

## 5. File structure

```
pickleball-deploy/
├── index.html                ← entry, SW registration, update handshake
├── vite.config.js
├── package.json              ← version source of truth
├── schema.sql                ← the 10 tables
├── PROJECT.md  NEXT-UP.md  SETUP.md
├── public/
│   ├── sw.js                 ← caching service worker
│   ├── manifest.webmanifest
│   ├── app-logo.png          ← neutral app logo (login screen)
│   ├── dink-drink.png        ← a club logo, served from /public
│   ├── csc-pickleball.png    ← legacy CSC wordmark (unused on shared surfaces)
│   ├── csc-mark.png          ← legacy CSC mark (unused on shared surfaces)
│   ├── favicon.png
│   └── icons/                ← icon-192, icon-512, icon-512-maskable, apple-touch-icon
└── src/
    ├── main.jsx
    ├── App.jsx               ← ~100KB — routing, actions, all modals
    ├── styles.js             ← S.* style objects, genderBadgeStyle
    ├── index.css             ← CSS vars, resets, PWA safe-area classes
    ├── lib/
    │   ├── a11y.js           ← pressable(): keyboard support for clickable boxes
    │   ├── backup.js         ← club-scoped JSON export (v1.15.1)
    │   ├── constants.js      ← APP_INFO.version, palette, COLORS, SPACE,
    │   │                        MIN/MAX_PER_COURT, storage keys, retention
    │   ├── clubs.js          ← isClubOwner/isClubAdmin, getClubsForPlayer,
    │   │                        findClubByCode, generateJoinCode, resolveActiveClub
    │   ├── format.js         ← name/date/phone formatting, court name+time
    │   │                        resolution, openPlayWeeks, isOpenPlay
    │   ├── session.js        ← localStorage session, remembered email + club,
    │   │                        useIsMobile, sortLeagues, buildDisplayWeeks
    │   ├── scheduling.js     ← court distribution, match generation, ladder
    │   │                        rotation, D+D Weekly Partners template
    │   ├── scoring.js        ← standingsPoints() PF cap + leaguePoints() Points
    │   └── supabase.js       ← client + all dbXxx functions + loadDB + cache
    └── components/           ← ~26 files, see below
```

**Components:** `ui.jsx` (Modal, Toast, EmptyState, AppMark, CSCMark,
VersionFooter, RefreshButton, PullToRefresh, AvatarMenu, PWAInstallBanner),
`StatusBanners.jsx`, `Spinner.jsx`, `HomeView.jsx`, `PlayerView.jsx`,
`LeagueDetail.jsx`, `CourtWeekCard.jsx`, `OpenPlayWeeks.jsx`,
`PartnersMatrix.jsx`,
`CheckInRow.jsx`, `CheckInSummary.jsx`, `StandingsTable.jsx`,
`SchedulePreview.jsx`, `ScoreForm.jsx`, `PlayerForm.jsx`, `LeagueForm.jsx`,
`EditWeekForm.jsx`, `AddPlayerToLeague.jsx`, `LeagueContactsModal.jsx`,
`LeagueRegistrationCard.jsx`, `AdminsTab.jsx`, `ClubSettingsTab.jsx`,
`ClubSwitcher.jsx`, `TrashTab.jsx`, `CreateClubModal.jsx`, `JoinClubModal.jsx`.

**Where things live:**

- **All app state** is `useState` in `App.jsx`. No Redux, no context store. The
  single source of truth is the in-memory `db` object mirroring a Supabase snapshot.
- **All `dbXxx` functions** are in `src/lib/supabase.js`. Pure async, no React.
- **All modals** render from `App.jsx`, gated on `modal?.type === "..."`.
- **The `action()` wrapper** in `App.jsx` wraps writes: offline guard → set
  action id → write → `reload()` → toast.

---

## 6. Data model

10 tables. Every one: **string PK** + **JSONB `data`** holding the full record.

| Table | PK | Holds |
|---|---|---|
| `pb_config` | `id` (always `1`) | `next_id.club/league/player` counters |
| `pb_clubs` | `club_1` | name, ownerEmail, adminEmails[], joinCode, logoUrl, deletedAt |
| `pb_memberships` | `${clubId}_${playerId}` | player ↔ club link, deletedAt |
| `pb_players` | `player_1` | global identity: name, email, phone, gender, deletedAt |
| `pb_leagues` | `league_1` | settings, weeks, format, competitionType, clubId, deletedAt |
| `pb_schedules` | `league_id` (column) | `{ weeks: [...] }` for one league |
| `pb_registrations` | `${leagueId}_${playerId}` | registration + `paid` |
| `pb_scores` | `${leagueId}_${week}_${matchId}` | homeScore, awayScore |
| `pb_locked_weeks` | `${leagueId}_w${week}` | existence = locked |
| `pb_checkins` | `${leagueId}_w${week}_${playerId}` | in/maybe/sub/out, setByAdmin |

### Identity model

- **Players are global.** One row per human regardless of club count.
  `db.players[id]` lookups are **never** club-filtered — historical scores must
  still resolve names for players who've left.
- **Clubs are the top-level scope.** Leagues carry `data.clubId`.
- **Memberships** are the many-to-many link.
- **Roles per club:** Owner (exactly one, implicitly also an admin), Admin
  (in `adminEmails[]`), Member (has a live membership row).

### ⚠️ The compound-key underscore trap

IDs contain underscores (`league_1`), and compound keys concatenate them. **SQL
`LIKE 'league_1_%'` is wrong** — `_` is a single-character wildcard, so it also
matches `league_10_...`.

This caused real bugs, fixed across v1.4.1 and v1.5.1. **No `LIKE` remains
anywhere in the codebase.** The rule: pull candidate keys and filter in JS via
`keysWithPrefix` / `keysWithSuffix` / `scoreKeysForLeagueWeek`. Fully documented
in a block comment at the top of `supabase.js`.

### Production snapshot (verified this session)

| | |
|---|---|
| Clubs | **2 live** — CSC Pickleball, Dink & Drink (logo `/dink-drink.png`) |
| Leagues | **1 live** — `league_19` "Dink & Drink Season 3", `dd_partners`, 14 weeks, **7 locked**, 56 scores (week 8 in progress) |
| Partner progress | Through week 8: 10 pairs partnered twice, 12 once, 6 not yet — no pair over 2, so the template's guarantee is holding |

Earlier CSC leagues and the Test club have since been deleted. Re-query rather
than trusting these numbers — they move faster than the docs do.

**Known data quirks:** none outstanding. Dink & Drink's `logoUrl` was missing
its leading slash and has been corrected.

---

## 7. Core patterns

### Write-first / read-back

Every mutation: await the DB write → `loadDB()` → `setDB(fresh)`. No optimistic
updates. React never shows data that isn't in Postgres.

**Consequence:** the app only re-reads after its *own* writes. Changes made
elsewhere (another device, another tab, direct SQL) don't propagate on their
own — which is why `silentRefresh()` exists (see below).

### Staleness-aware background refresh (v1.10.0)

`silentRefresh(maxAgeMs = 20000)` refetches only if the snapshot is older than
the threshold. Fires on in-app navigation (tab switches, opening a league) and
on window focus / visibility change. Silent: no spinner, no toast on failure.

Guarded by `busyRef` so a background fetch can't land after a write's own
`reload()` and overwrite fresh data with stale data.

### Action IDs

`action(fn, successMsg, actionId)` sets `currentActionId` before the write and
clears it after. Buttons check it via `useIsActionPending` for inline spinners.

**Three functions deliberately bypass `action()`** and manage their own
spinner/reload: `deleteClub()`, `seedTestPlayers()`, and `downloadBackup()`
(v1.15.1 — a read, but it re-fetches and has its own offline check). Older
notes listed the schedule commit here; it goes through `action()`. **If you add
a guard to `action()`, check whether these need it too** — the v1.5.0 offline
block had to be added separately for this reason.

### Soft delete + auto-purge

Soft delete stamps `data.deletedAt`. The Trash tab offers Restore or Delete
Forever. `purgeExpiredTrash()` runs at the top of every `loadDB()` and
hard-deletes anything past `TRASH_RETENTION_DAYS` (30) with full cascade. No
cron — opportunistic, on the next load after expiry.

Cascade order: **clubs first** (their cascade sweeps leagues + memberships in
bulk), then leftover leagues, then players.

Clubs have **no in-app restore** — deliberate, and the modal says so.

### Multi-tenancy scoping

```js
const leagues = allLeagues.filter(l =>
  !isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
);
const players = allPlayers.filter(p =>
  !isTrashed(p) && (!activeClubId || clubMemberIds.has(p.id))
);
```

The `!activeClubId ||` fallback on `players` is **load-bearing**. Without it the
home screen has no active club → `players` is `[]` → **email login fails for
everyone.** That bug shipped in v1.1.0 and lived until v1.3.0. Don't reintroduce it.

### Duplicate-account prevention (v1.8.0)

Email is the de-facto identity key (it's how login works), but nothing in the
schema enforces uniqueness. `findLivePlayerByEmail()` is checked by **both**
`createClub()` and `createPlayer()` before creating a player — otherwise one
person becomes two records with one club each and no way to switch between them.
That happened in production twice before it was fixed.

### Roster changes never touch the schedule (v1.15.1)

Until v1.15.1, `dbRegisterForLeague` and `dbRemovePlayerFromLeague` reset the
league's schedule to `{ weeks: [] }`. That put an irreversible wipe behind an
ordinary Remove button: one mis-tap mid-season blanked every week and the
standings, and the schedule couldn't be rebuilt (players are shuffled into
courts at random; scores are keyed by position, so they mean nothing without
it). Worse, the regenerate guard asked the *schedule* which weeks were locked —
an empty schedule said "none", so the next Generate deleted every score.

Now:

- **Adding or removing a player leaves the schedule exactly as it was.**
  `LeagueDetail` compares each **unlocked** week's players with the roster and
  shows an amber "Roster changed since the schedule was generated" notice naming
  who's missing and who's no longer registered. Locked weeks are history, not
  plans; a player marked `out` for a week isn't counted as missing from it.
  Updating the schedule is always explicit: Rebalance a week, or
  Replace/Regenerate the season.
- **"Has this league started?" reads the rows, not the schedule.**
  `leagueHasLockedWeek()` / `leagueHasScores()` in `App.jsx` scan the
  `pb_locked_weeks` / `pb_scores` keys (JS `startsWith`, never `LIKE`). The
  regenerate guard uses them, so an empty or damaged schedule can't hide locks.
- **A locked placeholder week still shows Unlock**, so a stray lock row left by
  the old wipe can't block regeneration forever.
- **Ladder:** a player who has left drops out of the next week's rotation
  rather than blocking generation with an error.

### Backups (v1.15.1)

Commissioner → Settings → **Download backup** saves the active club's data as
JSON (`lib/backup.js`). It re-fetches first (never exports a stale snapshot),
refuses to run offline, and is **club-scoped** — a club admin never receives
another club's members' emails and phones. Rows are written exactly as they sit
in the tables (`id`/`key`/`league_id` + `data`), grouped by table name, so a
restore is a plain upsert per table. Trashed records are included. There is no
in-app restore.

---

## 8. Competition types

Four, all set on `league.data.competitionType`:

| Value | Label | Shape |
|---|---|---|
| `mixer` | **Round-Robin** | Full season generated at once; courts rotate weekly |
| `ladder` | **Ladder** | One week at a time; courts derived from last week's results |
| `open` | **Open Play** | No courts, scores, or standings — weekly RSVP only |
| `dd_partners` | **D+D Weekly Partners** | Fixed 8 players, 14 weeks, new partner weekly |

### Open Play (v1.7.0)

No schedule rows at all. Weeks are **derived on the fly** from
`startDate + weeks` via `openPlayWeeks(league)` — nothing is written to
`pb_schedules`, and there's no generate step. Reuses `CheckInRow` (player) and
`CheckInSummary` (commissioner) so the RSVP experience is identical to court
leagues; the courts are simply gone.

### D+D Weekly Partners (v1.9.0)

Fixed 8 players, 14 weeks. Each week the 8 are re-paired into 4 teams; teams
split into two sides and each plays both teams opposite, 2 games per matchup,
opponents swapping between rounds while partners stay. 8 games per week, each
matchup on its own court (4 court groups per week).

**Why the schedule is a hard-coded table.** The constraints are exact:
14 weeks × 4 teams = 56 = 28 possible pairs × 2, so **every pair must partner
exactly twice with zero slack**. Add the rule that a pair's second week together
must face neither team they faced the first time, and repeating a single
1-factorization **provably fails** — the second time a pair is together the
other three teams are identical, they've already played two of them, and only
one legal opponent remains where two are needed. Two different interlocking
1-factorizations are required.

The table in `scheduling.js` was found by backtracking search and verified
exhaustively (28 distinct pairs, each exactly twice, zero repeated opponent
teams). Since the format is always 8 players and always 14 weeks, **there is
nothing to solve at runtime.** Players are shuffled into the template's seats at
generation, so retry reshuffles the season while the guarantees hold — they're
invariant under relabelling.

The 8-player cap is enforced **at registration**, not at generation, because a
9th player can't be absorbed by regenerating.

**The roster locks once the season starts** (any locked week or entered score,
v1.15.1): the Remove button is hidden and `removePlayer()` refuses. Each week is
one slice of a single 14-week rotation across exactly these 8 people, so there's
no regenerating around a departure without discarding results. A "replace player
for the remaining weeks" feature is the candidate fix (see `NEXT-UP.md`).

**No Rebalance and no hand-editing for D+D** (v1.15.1). Both rebuilt an edited
court with `buildCourtMatches` — the generic doubles template, 3 games with
rotating partners — silently turning a D+D week into something else. The
Rebalance button is hidden for D+D, `computeRebalanceProposal()` refuses it, and
the schedule preview disables "Edit courts" (Try Again reshuffles safely).

**Every player is on two courts per week** (one per round). Anything asking
"which court is this player on?" must use `filter`, not `find` — the player hero
card used `find` until v1.15.1 and never nudged about unscored Round 2 games.

**D+D is also the only format that ranks on Points** rather than Win% — see
section 9 — and the only one with **drop weeks** and a **Partners tab**.

### The Partners matrix (v1.14.x)

`PartnersMatrix.jsx` renders an N×N grid of how many times each pair has
partnered, shown as a tab in both the commissioner and player views.

**Which weeks count is the whole subtlety.** D+D generates all 14 weeks up
front, so counting the full schedule would show every pair at 2 from day one
and convey nothing. Only **locked weeks plus the current one** (the first still
unlocked) are counted; future weeks are excluded. The current week's pairings
are highlighted amber rather than hidden, since "who am I with this week" is
the main reason to open it.

Pairs are read off `match.team1` / `match.team2` and deduped with a Set — the
same pair appears many times across a week (two games per matchup, each team
playing in both rounds). Reading teams off matches rather than `court.players`
keeps it correct for any doubles format.

Column headers use initials derived from the formatted display name, with a
trailing index on collisions (`TP1`, `TP2`).

---

## 9. Scoring and standings

Two separate scoring systems live in `lib/scoring.js`. They are **not** the same
rule and are not meant to reconcile — see the warning at the end.

### PF / PA cap — every format

`standingsPoints(home, away)`:

- **Winner's PF caps at 11, loser's at 9.** A 15–13 counts as 11–9.
- `Math.min`, so lopsided games keep their real margin: **11–4 counts as 11–4.**
- Points against are the opponent's capped points for.

Applied in **both** `getStandings()` and the ladder's `rankCourtPlayers()`
through the one shared helper — ladder movement has to agree with the table it
feeds.

### Points — D+D Weekly Partners only

`leaguePoints(rawScore, won)`:

- **Half a point per point scored, plus 2 for winning.**
- An 11–6 gives the winners **7.5** each and the losers **3.0**.
- Caps differ by side: **winner 11 → 7.5 max**, **loser 10 → 5.0 max**.
  Losing 15–13 banks 5.0.
- The loser's cap is 10 rather than 11 so a losing scoreline can never match
  the winner's 5.5 scoring half.

Computed for every format (it costs nothing) but only surfaces for
`dd_partners`, where it leads the sort with Win%, +/− and wins as tiebreakers.
Every other format keeps Win% as the headline.

`formatPoints()` rounds at the display edge, because Points accumulate as floats
and 7.499999 must not render inconsistently.

### Drop weeks — D+D Weekly Partners only

Only a player's **best 12 of 14 weeks** count. `dropsForLockedWeeks()` phases
the allowance in: **0 drops below 6 locked weeks, 1 from 6, 2 from 12.** Applying
two drops from week one would leave everyone on zero.

This is why `buildSorted()` tallies **per week** rather than as running totals —
you can't subtract a week from a total you never broke down. Formats without
drops use the same path with an allowance of zero.

A dropped week is excluded from **every** stat, not just Points. Leaving its
wins or PF in would let a discarded week decide a tie through Win% or +/−.

> **Sit-outs are absorbed by the drops.** A missed week banks 0, which makes it
> the player's lowest and therefore the first thing dropped. That's usually the
> intent of a drop-week rule, but it does mean **missing up to two weeks carries
> no standings cost at all.** If that ever needs changing, the fix is excluding
> sat-out weeks from the drop pool so drops only apply to weeks actually played.

Every registered player gets a seeded empty tally for every locked week, so a
missed week exists as a real zero. Without that it would be invisible rather
than droppable, and drops would silently eat a *played* week instead.

### The per-week tally is load-bearing (v1.15.0)

`buildSorted()` keeps a `Map(weekNumber -> tally)` per player, where a tally is
`{ wins, losses, pointsFor, pointsAgainst, points, partners:Set }`. **Two
features depend on it and a third could:**

1. **Drop weeks** need per-week Points to know which weeks to discard.
2. **The standings drill-down** renders those same tallies directly — expand a
   row and you get Week / Partner / Pts / W / L / PF / PA, with dropped weeks
   struck through.

The drill-down deliberately reads the stored tallies rather than re-walking the
schedule, so **the expanded rows cannot disagree with the row they expand out
of.** Anything added here — streaks, head-to-head, a weekly grid — should read
from `row.weekly` for the same reason.

`partners` is a Set because rotating-doubles formats can pair a player with
more than one person in a week; D+D fixes partners for the whole week, so it
holds exactly one there. The Partner column only renders when some week has
one, keeping singles leagues clean.

> ### ⚠️ The two caps are different, on purpose
>
> PF caps the loser at **9**; Points caps the loser at **10**. So a 15–13 shows
> **PF 9** next to **Points 5.0** — and 9 ÷ 2 ≠ 5. A player checking the
> arithmetic across columns will find it doesn't work.
>
> This is intended, not a bug, and the standings footnote says so. If it ever
> needs to reconcile, the clean fix is moving the PF loser cap from 9 to 10 —
> that would affect no score under 10.

### Both are standings-time transforms, never storage-time

Raw scores stay in `pb_scores` and display as entered, so either rule can be
tuned or reverted and standings simply recompute. Capping on write would have
destroyed the originals permanently.

### Other standings rules

- **Only locked weeks count.** The commissioner locks a week to admit its scores.
- Players whose check-in was `sub` or `out` earn nothing for that week — no
  points, no Points, no win, no loss, and their match count doesn't rise, so
  Win% reflects only weeks they played.
- **`rankCourtPlayers()` does not know about check-ins**, so ladder rotation
  ignores sit-outs. No live ladder leagues exist, so it hasn't mattered yet.

---

## 10. PWA architecture

Hand-written. There is no `vite-plugin-pwa`. (Earlier docs got this wrong and
nearly caused a needless rewrite.)

**`public/sw.js`** — versioned cache; precaches the app shell; **network-first**
for navigations so deploys land immediately; **cache-first** for Vite's
content-hashed `/assets/*`; ignores all cross-origin (so Supabase never touches
the SW); never intercepts non-GET.

### Why `skipWaiting()` is absent

A new SW installs, precaches, and **waits**. `index.html` detects it → fires
`pwa:update-ready` → `<UpdateBanner>` appears → the user clicks Reload →
`SKIP_WAITING` is posted → the worker activates → `controllerchange` reloads.

The pre-v1.5.0 worker called `skipWaiting()` with a comment saying it was safe
"because we're not caching anything." True then, **fatal once caching exists**:
it can serve new assets to a page running old code, and it makes the banner
pointless. **Don't add it back.**

> **Practical consequence:** after a deploy, your browser keeps running the old
> bundle until you reload. If a shipped change appears to be missing, **check
> the version in the footer first** — that distinguishes "not deployed" from
> "not loaded." This wasted time once already this session.

### Noticing new versions (v1.15.2)

Browsers only re-check `sw.js` on a navigation (or about once a day). This app
is a single page that never navigates, and an installed PWA can sit suspended
for days — so a phone could run an old build long after a deploy. `index.html`
now calls `reg.update()` whenever the app returns to the foreground
(`visibilitychange` / `focus`, throttled to once a minute) and hourly while it's
open. A changed `sw.js` then flows through the normal installed → waiting →
banner path.

**First install no longer reloads the page.** The first worker's
`clients.claim()` also fires `controllerchange`, and the handler used to reload
on it — so every first visit reloaded itself about a second in, wiping anything
already typed. The handler now only reloads when there was a controller before
(i.e. a real update).

Club logos in `/public` (`/csc-pickleball.png`, `/dink-drink.png`) are in the
precache list, since a club's logo is in the header on every screen.

Verified end to end in a headless browser: first visit doesn't reload; after a
simulated deploy, refocusing shows the banner; Reload swaps to the new cache and
deletes the old one.

### Offline

`loadDB()` caches each snapshot to localStorage. On boot, if the live fetch
fails, `App.jsx` renders the cached snapshot behind an amber "Offline — showing
data from X ago" banner. **Writes are hard-blocked** while offline.

Queueing was considered and rejected: write-first/read-back means a write is
only real once the server confirms it, and queueing needs conflict resolution
and ordering guarantees this app doesn't have. Read-only offline is honest.

### Safe areas (v1.8.0)

The app draws under the iOS status bar
(`apple-mobile-web-app-status-bar-style: black-translucent`), so whichever
element is topmost must pad for the notch. The `.pwa-banner-stack` wrapper owns
that inset when a banner is showing, and the header drops its own via
`.pwa-has-banner`. Before this, banners rendered **inside** the notch strip —
visible but untappable, because iOS owns that region.

---

## 11. Branding

The app shell is **club-neutral**. Shared surfaces (login screen, app icon,
manifest, About modal, empty states) use `AppMark` — a generic inline-SVG
pickleball — and the name "Pickleball League Manager".

**Club identity is per-club**, via `club.data.logoUrl`, rendered by `ClubLogo`
in the header and club switcher. Set from Commissioner → Settings.

**Why the login screen can't be club-branded:** no club is known at that point.
Branding it with one club's logo misrepresents the app to every other club.

Logos are currently bundled in `/public` and referenced by path. The field is a
plain string, so switching to uploaded Supabase Storage URLs later needs no
schema change and no migration.

**League colours were darkened a step in v1.15.2** so white header and button
text clears 4.5:1: green `#4F8C1B → #3F7A12` (also `CSC.greenDark`, which is
court 2's colour), coral `#D85A30 → #C24E26`, amber `#BA7517 → #9E6312`. Same
hues; existing leagues pick them up automatically since leagues store the colour
*key*, not the hex. CSC blue and purple already passed.

---

## 12. Accessibility

### v1.15.2 — measured render audit: 1,544 failures → 0

The app was rendered in headless Chromium against a fixture database shaped
exactly like production (two clubs, a D+D league mid-season, a Round-Robin, an
Open Play, a Ladder, trashed records), across **26 screens × light and dark**.
Every visible text run was measured against its *composited* background
(walking up through translucent layers and ancestor opacity) and checked
against WCAG AA (4.5:1, or 3:1 for large text). Decorative glyphs marked
`aria-hidden` and disabled controls are exempt.

| | Light | Dark |
|---|---|---|
| Before (v1.15.1) | 894 | 650 |
| After (v1.15.2) | **0** | **0** |

Most of it was a handful of tokens, not components:

- **`--color-text-secondary` / `--color-text-tertiary`** were 4.4:1 and
  2.1–2.5:1 on the surfaces they actually sit on (the grey page and cards).
  Now `#57534e` / `#6b645f` in light; tertiary `#9d9691` in dark.
- **Semantic text tokens** — `--color-text-danger/-warning/-success/-info/-purple`.
  The light values are the existing hexes; each has a lighter dark-mode twin,
  because `#A32D2D` etc. measured 2.2–3.3:1 on near-black. **Use these whenever
  coloured text sits on a themed surface.** Text on a hardcoded pale tint
  (badges, amber notices) keeps its hardcoded pair.
- **`accentText(hex)` / `accentTint(hex)`** in `styles.js` — league-coloured
  text mixed toward the theme's text colour (`--accent-mix`), and league tints
  mixed into the card colour (`--tint-mix`). Used for the viewer's own row in
  Standings and the Partners matrix (was a pale hardcoded `c.light` under theme
  text: **1.1:1** in dark), the league banner, and court-name labels.
- **`headerBtn`** — buttons on coloured headers use a translucent *black*
  fill. The old translucent white lightened the header under white text
  (2.9–3.6:1). Header text is no longer opacity-dimmed.
- Opacity used as "de-emphasis" (past Open Play weeks, trashed cards, hint
  lines) was removed — it took whole cards below 4.5:1.

### Keyboard (v1.15.2)

Week headers, the RSVP summary bar, mobile standings cards, league cards and
add-player rows were `<div onClick>`s: unreachable by Tab, inert to Enter. They
now spread `pressable(onActivate, { expanded, label })` from `lib/a11y.js`
(role, tabIndex, `aria-expanded`, Enter/Space — ignoring keys that belong to a
nested button). Desktop standings rows got a real `<button>` around the player
name whose click bubbles to the row. A global `:focus-visible` ring makes focus
visible. Score-form labels are now tied to their inputs. All verified with
scripted Tab/Enter/Space runs in a real browser.

### The rule, restated

> **A hardcoded background paired with theme-variable text is always a dark-mode
> bug — and so is hardcoded coloured text on a themed background.** Either both
> are hardcoded (badge pairs) or both adapt (tokens, `accentText`/`accentTint`).

### History

A contrast audit in v1.10.0 (ratios computed, not eyeballed) found and fixed
four failures. The general rule it exposed:

> **A hardcoded background paired with theme-variable text is always a dark-mode
> bug.** Either both are hardcoded (like the badge pairs, which were fine all
> along) or both adapt.

Worst offender: week headers used pale hardcoded backgrounds while their
contents inherited theme text colours — **1.09:1** in dark mode, i.e. invisible.
Now translucent tints over the themed surface.

Also fixed: court labels drawing a colour on a tint of itself (2.37:1 dark);
RSVP buttons using dark semantic colours on a near-black surface (2.47:1);
white-on-court-colour chips (3.87:1). Added `--color-input-border`, a
theme-aware translucent token, because the divider tokens measured under 2:1 on
controls (WCAG 1.4.11 wants 3:1).

---

## 13. Version history

| Version | What landed |
|---|---|
| v1.0.x | Season-progress gating; league descriptions |
| **v1.1.0** | **Multi-tenancy** — clubs + memberships. *(Shipped the player-login bug.)* |
| **v1.2.0** | Public club creation + join-by-code |
| **v1.3.0** | Club switcher + Settings tab; fixed the v1.1.0 login bug |
| **v1.4.0** | Regenerate code, transfer ownership, delete club |
| **v1.4.1** | Cascade fixes; first `LIKE` underscore bug; orphan cleanup |
| **v1.5.0** | PWA: caching SW, offline read, write block, update banner |
| **v1.5.1** | Last two `LIKE` bugs — none remain |
| **v1.6.0** | Commissioner-set RSVPs; rebalance routed through the preview editor |
| **v1.7.0** | Open Play competition type |
| **v1.8.0** | Per-club logos; duplicate-account fixes; PWA banner safe-area; neutral branding; remembered club |
| **v1.9.0** | D+D Weekly Partners; staleness-aware refresh |
| **v1.9.1** | D+D: one court per matchup |
| **v1.10.0** | Players see all courts; contrast audit; capped standings points |
| **v1.11.0** | Points stat for D+D (0.5/point + 2 for a win); D+D ranks on it |
| **v1.12.0** | Drop weeks for D+D — best 12 of 14 count |
| **v1.13.0** | Completed weeks move below the active ones; first open week auto-expands |
| **v1.14.0** | Partners matrix tab for D+D |
| **v1.14.1** | Partners matrix columns use initials rather than numbers |
| **v1.15.0** | Weekly drill-down: expand a standings row for its per-week stats |
| **v1.15.1** | Code-review fixes: roster changes no longer wipe the schedule; D+D roster locks once the season starts; no Rebalance or hand-editing for D+D; hero card sees both D+D rounds; club backup download |
| **v1.15.2** | Polish: render-audited contrast (1,544 → 0 failures, both themes); keyboard access; capacity labels; PWA update check on resume, no first-visit reload; lint clean; `npm audit fix`; dropped legacy `app_config` table, pinned trigger `search_path` |

**Version policy:** patch = fixes, minor = features, major = milestones.
Bump **three** files: `package.json`, `src/lib/constants.js` (`APP_INFO.version`),
and `public/sw.js` (`CACHE_VERSION`) on any release that changes assets.
**Update `PROJECT.md`, `NEXT-UP.md` and `SETUP.md` in the same breath** — see
section 15.

---

## 14. Known issues

1. **No real authentication.** Email-only, no password. Anyone knowing a
   member's email can sign in as them. RLS is permissive (`anon_all`), so the
   anon key grants full read/write on every table. **This was defensible with
   one club. There are now two.** See `NEXT-UP.md` — it's the top item.

2. **No duplicate-email constraint in the schema.** The app-layer guards cover
   all creation paths, but nothing stops it at the DB level.

3. **`App.jsx` is ~100KB.** Not broken, just heavy — every edit is expensive.

4. **PF and Points use different loser caps** (9 vs 10), so the two columns
   don't reconcile on long games. Deliberate, documented in the standings
   footnote, but a likely source of "is this a bug?" questions.

5. **Ladder rotation ignores check-ins.** `rankCourtPlayers()` never receives
   them, so an absent player is ranked on empty results and drifts down a
   court. Moot today — there are no live ladder leagues.

6. **Drop weeks forgive absences entirely.** See section 9.

7. **No push notifications.** Genuinely a separate project (VAPID keys, push
   endpoint, permission flow).

8. **Open findings from the October 2026 code review** are queued as v1.16.0
   in `NEXT-UP.md` section 0 (the polish batch shipped in v1.15.2) — notably schedule dates landing a day early after
   the spring clock change (every generator except Open Play), success toasts
   after failed saves, an ID-allocation race on sign-up, and trashed players
   staying on league rosters.

---

## 15. Working with Ross

- **Update these docs as part of every release**, not periodically. They are
  bumped in the same commit as the code, or the commit immediately after.
  This is a standing instruction. Twice this project let the docs drift far
  enough to actively mislead — one version claimed there was no service worker
  when there was, and nearly caused a working one to be rewritten. Patching one
  release at a time takes a couple of minutes; catching up six takes an hour
  and still misses things.
- **Windows / PowerShell.** No bash.
- **Push back with reasoning** when a plan is wrong. Don't be relentlessly positive.
- **DB reads: unrestricted. DB writes: require an explicit yes per call.**
- **Verify before destructive SQL** — dry-run the SELECT, show what changes, then act.
- **Ross builds and tests locally.** Never claim a build passes.
- **Screenshots are the fastest debugging tool** for UI issues — one localised a
  contrast bug in seconds that description alone hadn't.
- **Be direct.** Skip filler.

---

## 16. Quick reference

```powershell
cd "C:\Users\rossl\Projects\PBLM\pickleball-deploy"
npm run dev                      # localhost:5173 — NO service worker
npm run build ; npm run preview  # required for any PWA testing
git add -A ; git commit -m "vX.Y.Z - description" ; git push
```

**Add a `dbXxx` function:** write it in `supabase.js` (read-then-write for
updates so other fields survive) → export → import in `App.jsx` → wrap in `action()`.

**Add a modal:** conditional block in `App.jsx` → `setModal({ type, ...data })`
from the triggering component.

---

## 17. Glossary

**Club** — top-level tenant. One owner, optional admins, members via memberships.
**Membership** — player ↔ club link; soft-deletable ("left the club").
**League** — a competition inside a club.
**Round-Robin** (stored as `mixer`) — full schedule upfront, courts rotate.
**Ladder** — generated weekly, courts from last week's results.
**Open Play** — RSVP only; no courts, scores, or standings.
**D+D Weekly Partners** — fixed 8 players, 14 weeks, new partner each week.
**Court** — a group of players who play each other; in D+D, one matchup.
**Locked week** — marked complete. **Only locked weeks count toward standings.**
**Check-in** — weekly RSVP: in / maybe / sub / out. `sub` and `out` earn no points.
**Trash** — soft-deleted records; 30 days, then auto-purged on the next `loadDB()`.
**Action ID** — string identifying an in-flight write, so one button can spin alone.
