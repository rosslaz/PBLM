# Pickleball League Manager — Project Reference

**Last updated:** as of v1.4.0 deployment (Phase 4 Session 2 complete)

This document is the canonical handoff for any future Claude session. Read this first. The companion doc `NEXT-UP.md` covers the next two planned releases (v1.4.1 + v1.5.0).

---

## 1. What this is

A multi-tenant web app for running pickleball leagues at clubs. Built originally for Ross Lazar's home club (CSC Pickleball at Cranbrook Swim Club) and now generalized so any club can sign up via a public join-code flow.

Users see one of three views:

- **Home** — pre-login. Email login, "Create a club", "Join with a code".
- **Player** — what registered players see. Their leagues, schedules, scores, standings, check-ins.
- **Commissioner** (a.k.a. admin) — full management. Leagues, players, commissioners, club settings, trash.

Real users today: ~31 players in one club (CSC). The app has been used to run real seasons.

---

## 2. Tech stack

- **React 18** (functional components, hooks, no router — view state is a simple string in `App.jsx`)
- **Vite 5** for dev/build
- **Supabase Postgres + RLS (anon policy)** for storage
- **`@supabase/supabase-js`** client; the app handles its own auth (email-only — see Known Issues)
- **Vercel** for hosting (auto-deploys from GitHub `main`)
- **No backend code** — pure SPA + DB. All "business logic" runs in `App.jsx` and helpers.
- **PWA** — installable, has a manifest, currently no service worker

Inline styles via a `styles.js` module rather than CSS-in-JS framework. CSS variables drive color themes (light/dark via `prefers-color-scheme`).

---

## 3. Deployment + infrastructure

| Resource | Identifier |
|---|---|
| **GitHub repo** | `rosslaz/PBLM` |
| **Vercel project** | `pblm` (id `prj_JjBT11hq8ONMUUzCDwATU2OaWLkL`) |
| **Vercel team** | `team_5fZejjoHm5i4299zoa2MYheI` |
| **Supabase project_id** | `uarbvnraljoktlkugchd` |
| **Supabase URL** | `https://uarbvnraljoktlkugchd.supabase.co` |
| **Production URL** | (Vercel default — check Vercel project for current) |
| **Local Windows path** | `C:\Users\rossl\Desktop\AI Projects\PBLM\pickleball-deploy\` |

Deploy flow: commit + push to `main` → Vercel detects and builds → live in 1-2 min. There is no staging.

### Env vars (in Vercel + `.env.local`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## 4. Tooling for the next Claude

The active tool environment in recent sessions:

- **Filesystem MCP** — direct read/write on Ross's Windows machine. `Filesystem:read_file` and `Filesystem:write_file`. Allowed dirs are `C:\Users\rossl\Desktop\AI Projects`, `pungctual`, `PBLM`. **No `str_replace` available** — full-file overwrites only.
- **Supabase MCP** — full DB access for reads and writes.
- **Vercel MCP** — deploy + read deployment state.
- **Google Drive MCP** — available but unused so far.

What's missing vs. earlier sessions:

- **No sandbox / bash tool** — can't run `npm run build` or `npm install` here. Ross does that locally.
- **No view tool for files** — use `Filesystem:read_file` instead.
- **No `str_replace`** — every edit means re-writing the whole file. App.jsx is ~80KB; this is the heaviest write. If a write times out, restart the Filesystem MCP server and retry.

Ross's machine: Windows, PowerShell. Don't paste bash one-liners.

---

## 5. File structure

```
pickleball-deploy/
├── package.json                 (version source of truth)
├── .env.local                   (Supabase creds — never commit)
├── index.html
├── vite.config.js
├── public/
│   ├── csc-pickleball.png       (logo)
│   ├── manifest.json            (PWA manifest)
│   └── icons/                   (PWA icons)
└── src/
    ├── main.jsx
    ├── App.jsx                  (~80KB — ALL routing + actions + modals live here)
    ├── styles.js                (S.* style objects, genderBadgeStyle)
    ├── index.css                (CSS variables, base resets, PWA safe-area)
    ├── lib/
    │   ├── constants.js         (CSC palette, COLORS, MIN/MAX_PER_COURT, SPACE, APP_INFO version)
    │   ├── clubs.js             (isClubOwner, isClubAdmin, getClubsForPlayer, generateJoinCode, ...)
    │   ├── format.js            (formatPlayerName, formatPhone, formatDate, playerFitsLeagueGender)
    │   ├── session.js           (localStorage helpers, useIsMobile, sortLeagues)
    │   ├── scheduling.js        (distributePlayersToCourts, doublesMatches, generateCourtSchedule, laddderRotate, ...)
    │   └── supabase.js          (~30KB — supabase client + all dbXxx functions + loadDB)
    └── components/
        ├── ui.jsx               (Modal, Toast, EmptyState, VersionFooter, RefreshButton, PullToRefresh, AvatarMenu, PWAInstallBanner)
        ├── Spinner.jsx          (Spinner + ActionPendingProvider context)
        ├── PlayerForm.jsx
        ├── LeagueForm.jsx
        ├── EditWeekForm.jsx
        ├── ScoreForm.jsx
        ├── AddPlayerToLeague.jsx
        ├── CheckInRow.jsx
        ├── CheckInSummary.jsx
        ├── CourtWeekCard.jsx
        ├── StandingsTable.jsx
        ├── LeagueRegistrationCard.jsx
        ├── LeagueContactsModal.jsx
        ├── LeagueDetail.jsx
        ├── SchedulePreview.jsx
        ├── AdminsTab.jsx
        ├── ClubSettingsTab.jsx   (Rename + Regenerate + Transfer + Delete sections)
        ├── ClubSwitcher.jsx      (header dropdown)
        ├── CreateClubModal.jsx
        ├── JoinClubModal.jsx
        ├── TrashTab.jsx
        ├── HomeView.jsx
        └── PlayerView.jsx
```

### Where things live

- **All app-level state** is `useState` in `App.jsx`. There's no Redux/Zustand/context store. The single source is the in-memory `db` object that mirrors a snapshot from Supabase.
- **All `dbXxx` functions** are in `src/lib/supabase.js`. They never call React; they're pure async DB ops.
- **All modals** are rendered from `App.jsx` (conditional on `modal?.type === "..."`). Components trigger them via callback props.
- **The action wrapper** in `App.jsx` (`async function action(fn, successMsg, actionId)`) wraps every write — sets a spinner ID, runs the write, calls `reload()` to re-fetch state, shows toast. Always use it unless you need fresh DB state mid-flow (the `deleteClub` action is the only exception today).

---

## 6. Data model

10 tables in Supabase. Every table follows the same convention: a **string PK column** (`id` or `key`) and a **JSONB `data` column**. The full record lives in `data`. Top-level columns exist only to make queries cheap.

### Tables

| Table | PK | Joins on | Holds |
|---|---|---|---|
| `pb_config` | `id` (always `1`) | — | Counters: `next_id.club/league/player` |
| `pb_clubs` | `id` (e.g. `club_1`) | — | Club name, owner email, admin emails, join code, deletedAt |
| `pb_memberships` | `key` = `${clubId}_${playerId}` | — | Player ↔ club join. Has deletedAt for soft-removal. |
| `pb_players` | `id` (e.g. `player_1`) | — | Global identity. First/last/email/phone/gender. deletedAt for trash. |
| `pb_leagues` | `id` (e.g. `league_1`) | `data.clubId` | League settings, weeks, color, deletedAt. |
| `pb_schedules` | `league_id` (col, not in JSON) | → pb_leagues.id | Whole season schedule (`{weeks: [...]}`). |
| `pb_registrations` | `key` = `${leagueId}_${playerId}` | — | Player registered in a league. Has `paid` bool. |
| `pb_scores` | `key` = `${leagueId}_${week}_${matchId}` | — | Match score (homeScore, awayScore, submittedAt). |
| `pb_locked_weeks` | `key` = `${leagueId}_w${week}` | — | Existence = locked. No data needed. |
| `pb_checkins` | `key` = `${leagueId}_w${week}_${playerId}` | — | Player's "in / maybe / sub / out" RSVP per week. |

### Identity model

- **Players are global.** One row in `pb_players` regardless of how many clubs the player belongs to. Identity is by `id`, lookup is by email.
- **Clubs are top-level scope.** Leagues, scores, schedules, etc. all reference the league which references the club.
- **Memberships are the many-to-many link** between players and clubs. A player joining a second club gets a second `pb_memberships` row, not a new player record.
- **Roles per club:**
  - **Owner** — `pb_clubs.data.ownerEmail`. Exactly one. Can rename, regenerate code, transfer ownership, delete club, add/remove admins.
  - **Admin** — `pb_clubs.data.adminEmails[]`. Owner is implicitly an admin (`isClubAdmin` returns true for the owner too). Admins can do everything except remove other admins, transfer ownership, delete the club.
  - **Member** — a player with a live membership row. Sees the player view scoped to that club.

### Production snapshot (verified at v1.4.0 deploy)

- **Clubs:** 2 total, 1 live (`club_1` = CSC Pickleball; `club_2` is the soft-deleted test club from Session 2 smoke testing — will auto-purge after 30 days)
- **Players:** 32 total, 32 live
- **Leagues:** 2 total, 2 live (`league_7` = "CSC Summer League - Men's", `league_8` = "CSC Summer League - Women's", both status `open`)
- **Memberships:** 32 total, 31 live
- **Registrations:** 1
- **Scores:** 0 (leagues haven't started)
- **Locked weeks:** 4
- **Check-ins:** 2
- **next_id:** `{club: 3, league: 13, player: 34}`
- **Orphan rows from pre-v1.0 cascade gaps:** 2 checkins for `league_1`, locked_weeks for `league_1/2/3` (4 rows total). Harmless — see `NEXT-UP.md` for cleanup plan.

---

## 7. Core architectural patterns

These are load-bearing. Anything new should follow them.

### Write-first / read-back

Every state-changing operation:
1. Awaits a DB write (`dbXxx`)
2. Calls `loadDB()` to fetch a fresh snapshot
3. Stores the new snapshot in `setDB(fresh)`

The `action(fn, successMsg, actionId)` wrapper in `App.jsx` does this automatically. No optimistic updates, no diffing, no caching — React never shows data that isn't already in the DB. This makes the app trivially correct across tabs/devices and worth the latency cost.

### Action IDs and pending state

`currentActionId` is a string identifier (or `null` when idle). The `action` wrapper sets it before the write and clears it after. Specific buttons can show their own per-button spinner by checking the ID via `useIsActionPending(actionId)`. Pass an explicit `actionId` to `action()` for any visible action; pass nothing (defaults to `"_generic"`) for background ops that just drive the global "Saving…" indicator in the header.

### Soft-delete pattern

The trash works the same way for everything that can be trashed (leagues, players, clubs):

1. **Soft delete** sets `data.deletedAt = new Date().toISOString()` on the row. The UI filters by `!deletedAt`, so soft-deleted records vanish from views but stay queryable by ID.
2. **Trash tab** shows the soft-deleted records and offers Restore or Delete Forever.
3. **Auto-purge** runs at the top of every `loadDB()`. Any soft-deleted record older than `TRASH_RETENTION_DAYS` (currently 30) is hard-deleted via the appropriate cascade function.

The cascade functions (`dbHardDeleteLeague`, `dbHardDeletePlayer`, `dbHardDeleteClub`) wipe dependent rows. The newer `dbHardDeleteClub` and `dbSoftDeleteClub` (v1.4.0) use **JS-side `startsWith` prefix filtering** rather than SQL `LIKE` to avoid the underscore-as-wildcard quirk; older functions use `LIKE` patterns which has a known bug (see Known Issues).

### Multi-tenancy

Every action that creates a league or player needs an `activeClubId`. The `action` wrappers in `App.jsx` enforce this with a "No active club selected" toast if `activeClubId` is null.

Filtering rule of thumb (from `App.jsx` lines ~310-340):

```js
// Live leagues — fall back to all when no active club (home screen)
const leagues = allLeagues.filter(l =>
  !isTrashed(l) && (!activeClubId || l.clubId === activeClubId)
);

// Players — same pattern. THIS IS LOAD-BEARING for home screen login.
// Without the (!activeClubId || ...) fallback, login lookup returns
// empty array on home screen. v1.3.0 bug fix.
const players = allPlayers.filter(p =>
  !isTrashed(p) && (!activeClubId || clubMemberIds.has(p.id))
);
```

Global identity is preserved via `db.players[id]` lookups, which never filter. This means `getPlayerName(pid)` works even for players who left the active club — important for historical scores.

### Session restore

Lives in two `useEffect`s in `App.jsx`. On boot:

1. Load DB snapshot
2. Read saved session from localStorage (`loadSession()`)
3. Validate: if saved player is trashed, drop them. If saved admin email isn't owner/admin of any club, drop the admin role.
4. Compute candidate accessible clubs, run `resolveActiveClub(savedId, candidates)`.
5. Set view based on what the user had access to.

The "Continue as Jane Smith" card on the home screen reads `loadLastEmail()` and finds the matching player.

### Modals

There is no modal library. Conditional rendering of a `<Modal>` component in `App.jsx`:

```jsx
{modal?.type === "confirmDelete" && (
  <Modal title="Move League to Trash" onClose={() => setModal(null)}>
    ...
  </Modal>
)}
```

Components trigger by calling props like `onDelete={() => setModal({ type: "confirmDelete", league })}`. The data needed for the modal goes in the modal state object.

---

## 8. UI / design conventions

### Brand palette (CSC Pickleball)

```js
CSC.blue        = "#1B6CC1"   // primary
CSC.blueDark    = "#0E3A6B"   // titles
CSC.blueLight   = "#E5F0FA"   // soft backgrounds
CSC.green       = "#7FC93D"   // accent (logo swoosh)
CSC.greenDark   = "#4F8C1B"   // accessible green for text
CSC.yellow      = "#FFE82E"   // pickleball ball
```

Five color themes for leagues (`COLORS.csc`, `green`, `coral`, `purple`, `amber`) — color is auto-assigned on league creation based on creation order.

### Typography

Body font: `Georgia, "Times New Roman", serif`. Yes, serif. It's intentional — feels club-like.

### Spacing

Use the `SPACE` scale in `lib/constants.js` (xs=4, sm=8, md=12, lg=16, xl=20, xxl=24, xxxl=32) for new code. Existing code mixes ad-hoc values (6, 10, 14) — the scale is a default, not a straitjacket.

### Buttons

`S.btn(variant, color)` and `S.btnSm(variant, color)` in `styles.js`. Variants are `"primary"` and `"secondary"`. Most destructive actions use `background: "#A32D2D"`, warnings use `"#854F0B"`, success uses `"#3B6D11"`.

### Dark mode

Inherited from `prefers-color-scheme`. Color tokens are in CSS variables (`--color-background-primary`, `--color-text-primary`, etc.). Brand colors stay constant.

### Layout

- Mobile-first. The `useIsMobile()` hook (returns true under 768px) is available but rarely used — most layouts just work responsively.
- The page is constrained to ~520px max-width on the home screen; full-width elsewhere.
- Header is sticky with PWA safe-area padding (`pwa-safe-top` class for the notch).

---

## 9. Version history

| Version | Phase | What landed |
|---|---|---|
| v1.0.0 | Phase 1 | Hide season-progress banner pre-start; LeagueRegistrationCard descriptions |
| v1.0.1 | Phase 1 | League description visible on schedule tab pre-start |
| v1.1.0 | **Phase 2** | **Multi-tenancy**. `pb_clubs` + `pb_memberships` tables, `activeClubId` scoping, club-aware filtering. (Latent bug: home-screen login broke — fixed in v1.3.0.) |
| v1.2.0 | **Phase 3** | **Public club creation + join-by-code**. CreateClubModal, JoinClubModal. Join code in AdminsTab. `cscMember` dropped from PlayerForm. |
| v1.3.0 | **Phase 4 Session 1** | **Club switcher** header dropdown, **Settings tab** with Rename. Fixed v1.1.0 player-login bug + v1.2.0 PlayerView header bug. |
| v1.4.0 | **Phase 4 Session 2** | **Regenerate code + Transfer ownership + Delete club**. New DB functions: `dbTransferOwnership`, `dbSoftDeleteClub`, `dbHardDeleteClub`. Cascade-aware auto-purge. |

Version bump policy (Ross's stated rule):
- **Patch** (x.y.Z): UX tweaks, fixes
- **Minor** (x.Y.0): new features
- **Major** (X.0.0): milestones

Each session in a phase has been a minor bump.

---

## 10. Known issues and tech debt

### Active

1. **No real auth** — login is email-only with no password. Anyone who knows a user's email can log in as them. Acceptable in trusted-club mode for v1.x. Phase 5 candidate: Supabase Auth.

2. **`LIKE` underscore-as-wildcard bug in legacy cascade functions** — `dbHardDeleteLeague`, `dbHardDeletePlayer` use SQL `LIKE "${id}_%"` patterns. The `_` matches "any single char" in SQL, so deleting `league_1` would also match keys for `league_10`, `league_11`, etc. **No evidence this has bitten production data so far** (audited at v1.4.0 deploy — see Section 6), but it's a real latent bug. v1.4.0's new club cascade functions correctly use JS-side `startsWith` instead. v1.4.1 will fix the legacy functions to match.

3. **`dbHardDeletePlayer` doesn't clean up memberships** — when a player is auto-purged after 30 days, their `pb_memberships` rows are left orphaned. Players don't reference back to memberships so the orphans are harmless from a query standpoint, but they shouldn't be there. v1.4.1 will fix.

4. **Home screen "Active Leagues" shows ALL clubs' leagues** — when no club is active (home screen), the leagues filter falls back to "all non-trashed leagues across all clubs". Fine while CSC is the only real club; latent leak if/when multi-club traffic grows. v1.4.1 will tighten.

5. **Orphan child rows from earlier cascade versions** — 4 rows total: 2 in `pb_checkins` for `league_1`, locked_weeks for `league_1`/`league_2`/`league_3`. These leagues no longer exist. Pre-existing artifacts, not from the LIKE bug. v1.4.1 can include a one-time SQL cleanup.

### Architectural

6. **`App.jsx` is huge (~80KB)** — has slowly accumulated. No structural problem, but every edit means a full-file overwrite via Filesystem MCP. Refactoring it into smaller files would be a multi-day project. Not urgent.

7. **No offline support** — closing the tab while offline shows a browser error. v1.5.0 will add a service worker + cached DB snapshot.

8. **No push notifications** — players have to open the app to see check-in reminders. Out of scope for now (real 1-2 week project; needs VAPID keys + push endpoint + permission flow).

---

## 11. Working with Ross

These are persistent preferences across sessions.

- **OS:** Windows. PowerShell. Don't paste bash.
- **Style:** No need to always be positive. Push back on suggestions if they're wrong, with solid reasoning.
- **Versioning:** Patch / Minor / Major as above. Don't conflate fix releases with feature releases.
- **DB writes:** Reads from Supabase MCP are unrestricted. **Writes require explicit "yes" per call.** Don't bundle.
- **Smoke testing:** Ross runs `npm run build` and `npm run dev` locally. He'll report errors. Don't claim "tests pass" without him saying so.
- **Deploy cadence:** Each release should sit in prod at least a session before piling more changes on, unless there's a known regression to fix.
- **Tone:** Direct and useful. Avoid filler.

---

## 12. Quick task reference

### Run locally

```powershell
cd "C:\Users\rossl\Desktop\AI Projects\PBLM\pickleball-deploy"
npm run dev      # localhost:5173
npm run build    # verify production build
```

### Deploy

```powershell
git add -A
git commit -m "vX.Y.Z - description"
git push
```

Vercel auto-builds from `main` push.

### Bump version

Edit two files:
- `package.json` → `"version": "X.Y.Z"`
- `src/lib/constants.js` → `APP_INFO.version: "X.Y.Z"`

### Add a new dbXxx function

1. Write the function in `src/lib/supabase.js` following the existing patterns. Always read-then-write for updates (preserves other fields).
2. Export it.
3. Import in `App.jsx`.
4. Wrap usage with `action(() => dbXxx(...), successMsg, actionId)`.

### Add a new modal

1. In `App.jsx`, add a conditional `{modal?.type === "newThing" && <Modal>...</Modal>}` in the appropriate view block.
2. In the component that triggers it, accept an `onRequest` prop and call `setModal({ type: "newThing", ...data })`.
3. The action handler inside the modal calls the real `action()`-wrapped function.

### Query Supabase directly

Use the Supabase MCP. Example:

```sql
SELECT id, data->>'name', data->>'deletedAt' FROM pb_clubs;
```

For destructive queries, ask Ross first.

---

## 13. Glossary

- **Club** — top-level tenant. Has one owner, optional admins, players who join via membership.
- **Membership** — row linking a player to a club. Can be soft-deleted ("left the club").
- **League** — a competition inside a club. Has a format (Singles/Doubles/Mixed), a type (mixer/ladder), N weeks, courts, players registered.
- **Mixer** — schedule generated upfront; courts rotate weekly to balance opponents.
- **Ladder** — week-by-week schedule; courts redistributed based on previous week's results.
- **Court** — 4 or 5 players play together on a court for a week. The roster rotates.
- **Week** — one game day. Has a date, optional time, and per-court overrides.
- **Locked week** — commissioner marked the week complete. Scores from locked weeks count toward standings; unlocked weeks don't.
- **Check-in** — player's "in / maybe / sub / out" RSVP per week. Affects standings (sub/out players don't earn points for that week's matches).
- **Trash** — soft-deleted records. Live for 30 days, then auto-purged on the next `loadDB()`.
- **Soft delete vs hard delete** — soft = stamp `deletedAt`, recoverable. Hard = actual DELETE FROM, gone forever.
- **Action ID** — string identifier for an in-flight write; lets specific buttons show their own spinner.

---

End of project reference. See `NEXT-UP.md` for the planned v1.4.1 and v1.5.0 work.
