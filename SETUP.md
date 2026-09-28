# Pickleball League Manager — Setup & Deployment

**Stack:** React 18 + Vite 5 → Vercel · Supabase (Postgres) · PWA
**Current version:** 1.11.0

This guide covers standing up a fresh instance from scratch. If you're picking
up the existing deployment, read `PROJECT.md` instead — this file is for
first-time setup.

---

## Step 1 — Supabase (the database)

1. Go to **https://supabase.com**, create an account, click **New project**.
2. Name it, pick a nearby region, set a DB password, create.
3. Wait ~1 minute for provisioning.

### Create the tables

4. Open **SQL Editor** in the left sidebar.
5. Paste the entire contents of `schema.sql` and click **Run**.

That creates **10 tables**:

| Table | Primary key | Stores |
|---|---|---|
| `pb_config` | `id` (always `1`) | ID counters (`next_id.club/league/player`) |
| `pb_clubs` | `id` (`club_1`) | Club name, owner, admins, join code, logo |
| `pb_memberships` | `${clubId}_${playerId}` | Which players belong to which clubs |
| `pb_players` | `id` (`player_1`) | Player identity (name, email, phone, gender) |
| `pb_leagues` | `id` (`league_1`) | League settings, weeks, format, competition type |
| `pb_schedules` | `league_id` | Whole-season schedule for one league |
| `pb_registrations` | `${leagueId}_${playerId}` | Who's in which league + paid status |
| `pb_scores` | `${leagueId}_${week}_${matchId}` | Match results |
| `pb_locked_weeks` | `${leagueId}_w${week}` | Row exists = week is locked |
| `pb_checkins` | `${leagueId}_w${week}_${playerId}` | Weekly RSVP |

Every table has the same shape: a **string primary key** plus a **JSONB `data`
column** holding the full record. Top-level columns exist only to make queries
cheap. Each record is its own row — there is no monolithic JSON blob, and
deploying new code never rewrites existing rows.

### Get your API keys

6. **Settings → API**, and copy two values:
   - **Project URL** — `https://<project-id>.supabase.co`
   - **anon public** key

The anon key is safe to ship in the client bundle. See the **Security** note at
the bottom for what that does and doesn't imply here.

---

## Step 2 — Configure locally

Copy `.env.example` → `.env.local` and fill in:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

`.env.local` is gitignored. Never commit it.

---

## Step 3 — Run locally

```powershell
npm install      # once
npm run dev      # http://localhost:5173
```

Create a club from the home screen, then refresh. If it's still there, Supabase
is wired up.

**The service worker does not work under `npm run dev`.** To test any PWA
behaviour — offline mode, caching, the update banner — use a production build:

```powershell
npm run build
npm run preview
```

---

## Step 4 — Deploy to Vercel

1. Push to GitHub.
2. **https://vercel.com** → sign in with GitHub → **Add New → Project**.
3. Import the repo. Vercel auto-detects Vite; no build settings to change.
4. Before deploying, add both **Environment Variables**:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. **Deploy.**

Every push to `main` auto-deploys. There is no staging environment.

Custom domain: Vercel → **Settings → Domains**. SSL is automatic.

---

## First run: creating your club

The app has no seeded data. On first load:

1. Home screen → **Create a club**
2. Enter the club name and your own player details — you become the **owner**.
3. You'll get a **join code** (e.g. `CSC-2026-2Q2H`). Share it with players.
4. Find or regenerate it any time under **Settings → Join code**.

**"Join with a code" creates the account and joins the club in one step** —
there's no separate sign-up. If someone already has an account on that email,
they're added to the new club rather than duplicated.

Owners can rename the club, set its logo, regenerate the join code, add/remove
admins, transfer ownership, and delete the club. Admins can do everything except
the last three.

---

## Competition types

Set per league at creation. Four options:

**Round-Robin** — the full season is generated at once and courts rotate weekly
so players face a spread of opponents.

**Ladder** — generated one week at a time; each week's courts are derived from
the previous week's results. The previous week must be locked before the next
can be generated.

**Open Play** — no courts, scores, or standings. Just a weekly in/out RSVP.
Weeks are derived from the start date and week count; there's no schedule to
generate. Good for pickup-style sessions where you only need a headcount.

**D+D Weekly Partners** — a fixed format: exactly **8 players, 14 weeks**, both
locked. Each week the 8 are re-paired into 4 teams; teams split into two sides
and each plays both teams opposite, two games per matchup, with opponents
swapping between rounds while partners stay. Over the season you partner with
everyone exactly twice, and never face the same opposing teams the second time.
The 8-player limit is enforced at registration, since a 9th can't be absorbed by
regenerating.

This is also the only format that ranks on **Points** rather than win
percentage: half a point for every point you score, plus 2 for winning. An 11–6
is 7.5 for the winners and 3 for the losers. Long games are capped so they
can't out-earn short ones — a winner tops out at 7.5 and a loser at 5.

---

## Project structure

```
pickleball-deploy/
├── index.html                ← entry point + service-worker registration
├── vite.config.js
├── package.json              ← version source of truth
├── schema.sql                ← run this in Supabase
├── .env.example / .env.local
├── PROJECT.md  NEXT-UP.md  SETUP.md
├── public/
│   ├── sw.js                 ← caching service worker
│   ├── manifest.webmanifest
│   ├── app-logo.png          ← neutral app logo
│   ├── favicon.png
│   └── icons/                ← PWA icons (192, 512, maskable, apple-touch)
└── src/
    ├── main.jsx
    ├── App.jsx               ← routing, actions, and all modals
    ├── styles.js             ← S.* style objects
    ├── index.css             ← CSS variables, resets, PWA safe-area
    ├── lib/                  ← constants, clubs, format, session,
    │                            scheduling, scoring, supabase
    └── components/           ← ~25 components (see PROJECT.md)
```

---

## How data flows

**Write-first / read-back.** Every mutation awaits a DB write, re-fetches a full
snapshot via `loadDB()`, then updates React state. No optimistic updates. React
never shows data that isn't already in Postgres.

That costs a round-trip per write and buys correctness across tabs and devices.
Its one consequence: the app only re-reads after its *own* writes, so a
background refresh (on navigation and window focus) exists to catch changes made
elsewhere.

**Soft deletes.** Leagues, players, and clubs are trashed by stamping
`data.deletedAt`, not by deleting rows. They vanish from the UI, stay
recoverable from the **Trash** tab for 30 days, then get hard-deleted with full
cascade on the next load.

To inspect data directly: Supabase → **Table Editor**, or SQL:

```sql
SELECT id, data->>'name', data->>'deletedAt' FROM pb_clubs;
```

---

## Branding

The app shell is **club-neutral** — the login screen, app icon, and name are
generic, because at login time no club is known and branding it with one club's
logo would misrepresent the app to every other club.

**Each club sets its own logo** in Commissioner → **Settings → Club logo**, which
appears in the header and club switcher for that club's members only. Point it
at a file in `public/` (e.g. `/dink-drink.png`) — include the leading slash. The
field is a plain string, so switching to uploaded URLs later needs no migration.

---

## PWA

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app
- **Desktop Chrome/Edge:** install icon in the address bar

Requires HTTPS, which Vercel provides. iOS needs real HTTPS even for testing, so
install behaviour can't be verified from `localhost`.

### Offline

The service worker caches the app shell, and every successful load caches the
last DB snapshot to localStorage. Opening the app with no connection:

- It **boots and renders** from cache rather than erroring
- You can **read** schedules, courts, standings, and rosters
- An amber banner reads **"Offline — showing data from X ago"**
- **Writes are blocked** with a clear message

That's deliberate. Queueing writes would mean showing changes that haven't
happened and reconciling later, which needs conflict resolution this app doesn't
have. A blocked write is honest; a silently lost one isn't.

### Updates after a deploy

A new build's service worker installs, precaches, and then **waits**. The app
shows a blue **"A new version is available · Reload"** banner, and only when the
user clicks Reload does the new worker activate and the page refresh.

`sw.js` deliberately does **not** call `skipWaiting()`: activating immediately
could serve new assets to a page still running old code, and would make the
banner pointless.

> **If a change you just deployed seems missing, check the version in the app
> footer first.** That distinguishes "not deployed" from "not loaded." Hard
> refresh (`Ctrl+Shift+R`) or unregister the worker in DevTools → Application.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page | Check the console; confirm env vars are set in Vercel |
| "Could not load data" | Verify the URL (no trailing slash) and anon key |
| Data not saving | Confirm `schema.sql` ran; check tables exist |
| Service worker not registering | You're on `npm run dev` — use `build` + `preview` |
| Deployed change not visible | Check the version footer, then hard refresh |
| Stuck on an old version in the PWA | Uninstall and reinstall from the home screen |
| Club logo not showing | The path needs a leading slash: `/logo.png` |

---

## Security note

There is **no real authentication.** Login is email-only with no password: enter
an email that matches a player record and you're in. Anyone who knows a member's
email can sign in as them.

RLS is enabled but the policy is permissive (`anon_all`), so the anon key grants
full read/write on all tables — **including across clubs.** The app is
architected for multi-tenancy but does not currently enforce isolation.

This was a deliberate trade-off for a single trusted club. **It does not scale
to multiple unrelated clubs**, and adding real auth (Supabase Auth + per-club
RLS policies) is the top item in `NEXT-UP.md`. Don't put anything sensitive in
this database in the meantime.
