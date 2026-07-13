# Pickleball League Manager — Project Reference

**Last updated:** v1.5.0 deployed. Docs refreshed against the live code.

This is the canonical handoff for any future session. Read this first, then
`NEXT-UP.md` for planned work. `SETUP.md` covers standing up a fresh instance.

> **A note on trusting this document.** A previous version of these docs drifted
> from reality and actively misled the next session — it claimed there was no
> service worker (there was), pointed at a manifest filename that didn't exist,
> and undercounted an orphan-row audit. **When the docs and the code disagree,
> the code wins.** Read the actual files before acting on anything here.

---

## 1. What this is

A multi-tenant web app for running pickleball leagues at clubs. Built for Ross
Lazar's club (CSC Pickleball at Cranbrook Swim Club) and generalized so any club
can sign up via a public join-code flow.

Three views:

- **Home** — pre-login. Email login, "Create a club", "Join with a code".
- **Player** — their leagues, schedules, scores, standings, weekly check-ins.
- **Commissioner** (admin) — leagues, players, commissioners, club settings, trash.

Real usage today: **10 players, 1 club (CSC), 2 live leagues** (Men's and Women's
Summer, both `open`, neither started). The app has run real seasons.

---

## 2. Tech stack

- **React 18** — functional components + hooks. No router: `view` is a string in `App.jsx`.
- **Vite 5** — dev/build. No plugins beyond `@vitejs/plugin-react`.
- **Supabase Postgres** — RLS on, permissive `anon_all` policy.
- **Vercel** — auto-deploys from GitHub `main`. No staging.
- **PWA** — installable, hand-written caching service worker (no `vite-plugin-pwa`).
- **No backend code.** Pure SPA + DB. All logic lives in `App.jsx` and `src/lib/`.
- **Styling:** inline styles via `styles.js` (`S.*` objects). CSS variables drive
  light/dark via `prefers-color-scheme`. No CSS framework.
- **Dependencies:** `@supabase/supabase-js`, `react`, `react-dom`. That's it.

---

## 3. Deployment + infrastructure

| Resource | Identifier |
|---|---|
| **Local path** | `C:\Users\rossl\Projects\PBLM\pickleball-deploy\` |
| **GitHub** | `rosslaz/PBLM` |
| **Vercel project** | `pblm` (`prj_JjBT11hq8ONMUUzCDwATU2OaWLkL`) |
| **Vercel team** | `team_5fZejjoHm5i4299zoa2MYheI` |
| **Supabase project_id** | `uarbvnraljoktlkugchd` |
| **Supabase URL** | `https://uarbvnraljoktlkugchd.supabase.co` |

Env vars (Vercel + `.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

Deploy: commit → push to `main` → Vercel builds → live in ~1–2 min.

---

## 4. Tooling notes for the next session

- **Filesystem MCP** — read/write on Ross's Windows machine. **No `str_replace`**:
  every edit is a full-file overwrite. `App.jsx` is ~85KB — the heaviest write. If
  a write times out, restart the MCP server and retry.
- **Supabase MCP** — full DB access.
- **Vercel MCP** — deployment state.

**Verify the allowed directories at the start of a session** by attempting a read,
not by trusting a cached listing. A previous session got a stale
`list_allowed_directories` result pointing at `C:\Users\rossl\Desktop\AI Projects\...`
and briefly believed its edits had gone to the wrong tree. The real root is
`C:\Users\rossl\Projects\`.

**No sandbox / bash tool.** Can't run `npm run build`. Ross builds and tests
locally and reports back. Don't claim tests pass without him saying so.

Ross is on **Windows / PowerShell**. Don't paste bash.

---

## 5. File structure

```
pickleball-deploy/
├── index.html                ← entry + SW registration + update handshake
├── vite.config.js            ← minimal: just @vitejs/plugin-react
├── package.json              ← version source of truth
├── schema.sql                ← the 10 tables (run in Supabase SQL editor)
├── migration_add_checkins.sql
├── test_players_20.sql       ← (in repo root, one level up)
├── .env.example / .env.local
├── PROJECT.md  NEXT-UP.md  SETUP.md
├── public/
│   ├── sw.js                 ← caching service worker (v1.5.0+)
│   ├── manifest.webmanifest  ← NOTE: .webmanifest, not manifest.json
│   ├── csc-pickleball.png    ← logo   ├── csc-mark.png   ├── favicon.png
│   └── icons/                ← icon-192, icon-512, icon-512-maskable, apple-touch-icon
└── src/
    ├── main.jsx
    ├── App.jsx               ← ~85KB — ALL routing, actions, modals
    ├── styles.js             ← S.* style objects, genderBadgeStyle
    ├── index.css             ← CSS vars, resets, PWA safe-area classes
    ├── lib/
    │   ├── constants.js      ← APP_INFO.version, CSC palette, COLORS, SPACE,
    │   │                        MIN/MAX_PER_COURT, storage keys, TRASH_RETENTION_DAYS
    │   ├── clubs.js          ← isClubOwner/isClubAdmin, getClubsForPlayer,
    │   │                        getClubsWhereAdmin, generateJoinCode, resolveActiveClub
    │   ├── format.js         ← formatPlayerName, formatDate, formatPhone,
    │   │                        formatRelativeTime, playerFitsLeagueGender, todayISO
    │   ├── session.js        ← localStorage session, useIsMobile, sortLeagues
    │   ├── scheduling.js     ← distributePlayersToCourts, doublesMatches,
    │   │                        generateCourtSchedule, laddderRotate, buildLadderWeek
    │   └── supabase.js       ← client + ALL dbXxx functions + loadDB + snapshot cache
    └── components/
        ├── ui.jsx            ← Modal, Toast, EmptyState, VersionFooter,
        │                        RefreshButton, PullToRefresh, AvatarMenu, PWAInstallBanner
        ├── StatusBanners.jsx ← UpdateBanner + OfflineBanner (v1.5.0)
        ├── Spinner.jsx       ← Spinner + ActionPendingProvider
        ├── HomeView.jsx  PlayerView.jsx  LeagueDetail.jsx
        ├── PlayerForm.jsx  LeagueForm.jsx  EditWeekForm.jsx  ScoreForm.jsx
        ├── AddPlayerToLeague.jsx  LeagueContactsModal.jsx
        ├── CheckInRow.jsx  CheckInSummary.jsx  CourtWeekCard.jsx
        ├── StandingsTable.jsx  LeagueRegistrationCard.jsx  SchedulePreview.jsx
        ├── AdminsTab.jsx  ClubSettingsTab.jsx  ClubSwitcher.jsx  TrashTab.jsx
        └── CreateClubModal.jsx  JoinClubModal.jsx
```

**Where things live:**

- **All app state** is `useState` in `App.jsx`. No Redux/context store. The single
  source of truth is the in-memory `db` object mirroring a Supabase snapshot.
- **All `dbXxx` functions** are in `src/lib/supabase.js`. Pure async DB ops, no React.
- **All modals** render from `App.jsx`, gated on `modal?.type === "..."`. Components
  trigger them via callback props.
- **The `action()` wrapper** in `App.jsx` wraps writes: sets a spinner ID → runs the
  write → `reload()` → toast. Use it unless you need fresh DB state mid-flow.

---

## 6. Data model

10 tables. Every one: **string PK** (`id` or `key`) + **JSONB `data`** holding the
full record. Top-level columns exist only to make queries cheap.

| Table | PK | Holds |
|---|---|---|
| `pb_config` | `id` (always `1`) | `next_id.club/league/player` counters |
| `pb_clubs` | `id` (`club_1`) | name, ownerEmail, adminEmails[], joinCode, deletedAt |
| `pb_memberships` | `${clubId}_${playerId}` | player ↔ club link, deletedAt |
| `pb_players` | `id` (`player_1`) | global identity: name, email, phone, gender, deletedAt |
| `pb_leagues` | `id` (`league_1`) | settings, weeks, format, colour, `data.clubId`, deletedAt |
| `pb_schedules` | `league_id` (column) | `{ weeks: [...] }` for one league |
| `pb_registrations` | `${leagueId}_${playerId}` | registration + `paid` |
| `pb_scores` | `${leagueId}_${week}_${matchId}` | homeScore, awayScore |
| `pb_locked_weeks` | `${leagueId}_w${week}` | existence = locked (no payload) |
| `pb_checkins` | `${leagueId}_w${week}_${playerId}` | in / maybe / sub / out |

### Identity model

- **Players are global.** One `pb_players` row per human, regardless of how many
  clubs they're in. `db.players[id]` lookups are **never** club-filtered — historical
  scores must still resolve names for players who've left.
- **Clubs are the top-level scope.** Leagues carry `data.clubId`.
- **Memberships** are the many-to-many link. Joining a second club adds a membership
  row, not a new player.
- **Roles (per club):**
  - **Owner** — `ownerEmail`. Exactly one. Can rename, regenerate code, add/remove
    admins, transfer ownership, delete the club.
  - **Admin** — in `adminEmails[]`. The owner is *implicitly* an admin
    (`isClubAdmin` returns true for them). Admins can do everything except remove
    admins, transfer ownership, or delete the club.
  - **Member** — has a live membership row.

### ⚠️ The compound-key underscore trap

IDs contain underscores (`league_1`, `club_2`, `player_7`), and compound keys
concatenate them. **SQL `LIKE 'league_1_%'` is wrong** — in `LIKE`, `_` matches any
single character, so it also matches `league_10_...`, `league_11_...`.

This caused a real (if never-triggered) bug in the hard-delete cascades, fixed in
v1.4.1. The correct approach, used throughout `supabase.js` now: pull candidate keys
and filter in JS with `startsWith` / `endsWith` (see `keysWithPrefix` /
`keysWithSuffix`). **Any new code touching compound keys must do the same.**

One `LIKE` pattern survives on purpose: `dbRebalanceWeek`'s score delete. It's
documented in-code as out of scope — blast radius is limited to the same league's
other weeks, and rebalance rewrites that week anyway. Worth tightening eventually.

### Production snapshot (verified at v1.5.0 + cleanup)

| | |
|---|---|
| Clubs | 1 live (`club_1` CSC Pickleball) |
| Players | **10 live**, all real, no duplicate emails; 2 trashed (dedup strays) |
| Leagues | 2 live (`league_7` Men's, `league_8` Women's — both `open`); 2 trashed ("Test" ×2) |
| Memberships | 10 live |
| Registrations | 1 |
| Scores / locked weeks / check-ins | 0 (seasons haven't started) |
| `next_id` | `{club: 3, league: 15, player: 34}` |

Orphan rows: **none.** 6 legacy orphans (leagues 1–3) were cleaned out post-v1.4.1.

---

## 7. Core patterns

These are load-bearing. New code should follow them.

### Write-first / read-back

Every mutation: await the DB write → `loadDB()` → `setDB(fresh)`. No optimistic
updates, no diffing, no local mutation. React never shows data that isn't in
Postgres. Costs a round-trip; buys correctness across tabs and devices.

### Action IDs

`currentActionId` is a string (or `null`). `action(fn, successMsg, actionId)` sets it
before the write, clears it after. Buttons check it via `useIsActionPending` to show
their own inline spinner. Omit the ID (`"_generic"`) for background ops that only
need the header's "Saving…" indicator.

**Three functions deliberately bypass `action()`** because they manage their own
spinner/reload: `deleteClub()`, `seedTestPlayers()`, and the schedule-commit path.
If you add a guard to `action()`, check whether these need it too — the v1.5.0
offline block had to be added in three places for exactly this reason.

### Soft delete + auto-purge

1. **Soft delete** stamps `data.deletedAt`. The UI filters on `!deletedAt`; the record
   vanishes but stays queryable by ID.
2. **Trash tab** offers Restore or Delete Forever.
3. **Auto-purge** runs at the top of every `loadDB()`. Anything soft-deleted longer
   than `TRASH_RETENTION_DAYS` (30) is hard-deleted with full cascade. No cron job —
   it's opportunistic, on the next load after expiry.

Cascade order in `purgeExpiredTrash`: **clubs first** (their cascade sweeps their
leagues + memberships in bulk), then leftover leagues, then players.

Clubs have **no in-app restore** — deliberate. The confirmation modal says so and
directs the user to contact support. Recovery is a manual `deletedAt` clear via SQL.

### Multi-tenancy scoping

```js
// Live leagues — fall back to ALL when no active club (home screen)
const leagues = allLeagues.filter(l =>
  !isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
);

// Players — SAME PATTERN. This fallback is LOAD-BEARING.
const players = allPlayers.filter(p =>
  !isTrashed(p) && (!activeClubId || clubMemberIds.has(p.id))
);
```

Without the `!activeClubId ||` fallback on `players`, the home screen has no active
club → `players` is `[]` → **the email login lookup fails for everyone.** That bug
shipped in v1.1.0 and lived in production until v1.3.0. Don't reintroduce it.

### Session restore

Two `useEffect`s in `App.jsx`. On boot: load DB → read saved session → validate
(trashed player? admin email still an admin anywhere?) → resolve the active club →
set the view. The "Continue as…" card on the home screen reads `loadLastEmail()`.

### Modals

No library. `{modal?.type === "x" && <Modal>…</Modal>}` in `App.jsx`. Components
trigger via `setModal({ type: "x", ...data })`. The payload carries whatever the
modal needs.

---

## 8. PWA architecture (v1.5.0)

**Read this before touching anything PWA-related.** It's hand-written — there is no
`vite-plugin-pwa`. Earlier docs got this wrong and nearly caused a needless rewrite.

### The three moving parts

1. **`public/manifest.webmanifest`** — static file. Name, icons, standalone display,
   theme colour. Complete; needs no changes.

2. **`public/sw.js`** — hand-written caching service worker:
   - Versioned cache (`CACHE_VERSION`); `activate` deletes non-matching caches.
   - Precaches the app shell on install (HTML, manifest, icons, logo).
   - **Network-first** for navigations/HTML → new deploys land immediately; falls
     back to the cached shell offline.
   - **Cache-first** for `/assets/*` → Vite content-hashes these, so the bytes at a
     given URL never change. New builds emit new hashes → natural cache miss.
   - **Ignores everything cross-origin.** Supabase never touches the SW.
   - **Never intercepts non-GET.** Writes always hit the network.

3. **`index.html`** — registration + the update handshake (kept out of the React
   bundle so it works even when the bundle is what's updating).

### The update flow — and why `skipWaiting()` is absent

`sw.js` deliberately does **not** call `skipWaiting()` on install:

1. New SW installs → precaches → **waits**.
2. `index.html` detects it → dispatches `pwa:update-ready`.
3. `<UpdateBanner>` renders: *"A new version is available · Reload / Later"*.
4. Reload → `window.__pwaApplyUpdate()` → posts `SKIP_WAITING` to the worker.
5. Worker activates → `controllerchange` → page reloads.

The pre-v1.5.0 worker *did* call `skipWaiting()`, with a comment saying it was
"safe because we're not caching anything." True then. **Fatal once you cache:** an
immediately-activating worker can serve new assets to a page running old code
(version skew), and it makes the update banner meaningless. Don't add it back.

### Offline behaviour

- **Data cache is separate from the SW.** Every successful `loadDB()` writes the
  snapshot + a timestamp to localStorage (`DB_CACHE_KEY`). On boot, if the live fetch
  fails, `App.jsx` falls back to that snapshot and sets `snapshotAge`.
- `<OfflineBanner>` shows *"Offline — showing data from X ago"*. Staleness is
  **visible by design** — a silently-stale cache is worse than no cache.
- **Writes are hard-blocked offline** (`navigator.onLine` check). Toast, no request.
- On the `online` event, the app auto-refreshes back to live data.

**Why block instead of queue:** write-first/read-back means a write is only real once
the server confirms it. Queueing would show changes that haven't happened, then need
conflict resolution and ordering guarantees this app doesn't have. Offline is
strictly read-only. That matches actual usage — a player on court wants to *see*
their court assignment; they'll enter scores when they have signal.

### Testing

Service workers don't work under `npm run dev`. Use `npm run build && npm run preview`.
The update banner can't be tested from a single build — temporarily bump
`CACHE_VERSION`, rebuild, and refresh once.

---

## 9. UI conventions

**Palette** (`CSC` in constants.js): blue `#1B6CC1` (primary), blueDark `#0E3A6B`,
blueLight `#E5F0FA`, green `#7FC93D`, greenDark `#4F8C1B`, yellow `#FFE82E`.

Five per-league themes (`csc`, `green`, `coral`, `purple`, `amber`), auto-assigned by
creation order.

**Semantic colours:** destructive `#A32D2D`, warning `#854F0B`, success `#3B6D11`.

**Typography:** `Georgia, "Times New Roman", serif`. Intentional — reads club-like.

**Spacing:** use the `SPACE` scale (xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 ·
xxxl 32). Older code has ad-hoc values; the scale is a default, not a straitjacket.

**Buttons:** `S.btn(variant, color)` / `S.btnSm(...)`. Variants `"primary"` / `"secondary"`.

**Dark mode:** via `prefers-color-scheme` and CSS variables. Brand colours are constant.

**Layout:** mobile-first. Home screen caps at ~520px; other views are full-width.
Sticky header with PWA safe-area padding (`pwa-safe-top`).

---

## 10. Version history

| Version | What landed |
|---|---|
| v1.0.0 / v1.0.1 | Season-progress banner gating; league descriptions pre-start |
| **v1.1.0** | **Multi-tenancy.** `pb_clubs` + `pb_memberships`, `activeClubId` scoping. *(Shipped the player-login bug.)* |
| **v1.2.0** | **Public club creation + join-by-code.** CreateClub/JoinClub modals. |
| **v1.3.0** | **Club switcher + Settings tab (rename).** Fixed the v1.1.0 login bug and a v1.2.0 header bug. |
| **v1.4.0** | **Regenerate code · Transfer ownership · Delete club.** `dbTransferOwnership`, `dbSoftDeleteClub`, `dbHardDeleteClub`; cascade-aware auto-purge. |
| **v1.4.1** | **Cascade fixes.** LIKE underscore bug in `dbHardDeleteLeague`; memberships added to `dbHardDeletePlayer`; Active Leagues gated to single-club. Plus a one-time cleanup of 6 orphan rows. |
| **v1.5.0** | **PWA polish.** Caching SW (hand-upgraded, not `vite-plugin-pwa`); offline read from cached snapshot; hard write-block offline; update banner. |

**Version policy:** patch = fixes/tweaks · minor = features · major = milestones.

Bump **two** files: `package.json` and `src/lib/constants.js` (`APP_INFO.version`).

---

## 11. Known issues

1. **No real auth.** Email-only, no password. Anyone knowing a member's email can
   log in as them. Deliberate for trusted-club use; the leading Phase 5 candidate.

2. **`dbRebalanceWeek` LIKE quirk.** Same underscore bug as the (fixed) cascades,
   scoped to one league's own weeks. Documented in-code as out of scope. Low blast
   radius, still real.

3. **`App.jsx` is ~85KB.** Not broken, just heavy — every edit is a full-file
   overwrite. Splitting it is a multi-day job with real regression risk. Not urgent.

4. **No push notifications.** Genuinely a separate 1–2 week project (VAPID keys,
   push endpoint, permission flow, scheduling).

5. **Two trashed player records** (`player_29` Shannon dup, `player_33` "R L" stray)
   sit in the Trash tab. They'll auto-purge after 30 days; harmless.

---

## 12. Working with Ross

- **Windows / PowerShell.** No bash.
- **Push back with reasoning** when a plan is wrong. No need to be relentlessly positive.
- **DB reads:** unrestricted. **DB writes: require an explicit "yes" per call.** Don't bundle.
- **Verify before destructive SQL.** Dry-run the SELECT, show what will change, then act.
- **Ross builds and tests locally.** Don't claim a build passes.
- **Let a release settle** before stacking the next one on top.
- **Be direct.** Skip filler.

---

## 13. Quick reference

**Run / build**
```powershell
cd "C:\Users\rossl\Projects\PBLM\pickleball-deploy"
npm run dev                      # localhost:5173 (NO service worker)
npm run build ; npm run preview  # required for any PWA testing
```

**Deploy**
```powershell
git add -A ; git commit -m "vX.Y.Z - description" ; git push
```

**Add a `dbXxx` function:** write it in `supabase.js` (read-then-write for updates so
other fields survive) → export → import in `App.jsx` → wrap in `action()`.

**Add a modal:** conditional block in `App.jsx` → `setModal({ type, ...data })` from
the triggering component.

**Query the DB:**
```sql
SELECT id, data->>'name', data->>'deletedAt' FROM pb_clubs;
```

---

## 14. Glossary

**Club** — top-level tenant. One owner, optional admins, members via memberships.
**Membership** — player ↔ club link. Soft-deletable ("left the club").
**League** — a competition inside a club. Format (Singles/Doubles/Mixed), type
(mixer/ladder), N weeks, courts.
**Mixer** — full schedule generated upfront; courts rotate weekly for variety.
**Ladder** — generated a week at a time; courts redistributed from last week's results.
**Court** — 4–5 players who play each other for a week. Groups rotate.
**Week** — one game day. Has a date, optional time, per-court overrides.
**Locked week** — commissioner marked it complete. **Only locked weeks count toward
standings.**
**Check-in** — weekly RSVP: in / maybe / sub / out. `sub` and `out` players earn no
points for that week.
**Trash** — soft-deleted records. 30 days, then auto-purged on the next `loadDB()`.
**Action ID** — string identifying an in-flight write, so one button can show its own spinner.
