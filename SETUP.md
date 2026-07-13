# Pickleball League Manager — Setup & Deployment

**Stack:** React 18 + Vite 5 → Vercel · Supabase (Postgres) · PWA
**Current version:** 1.5.0

This guide covers standing up a fresh instance from scratch. If you're picking up
the existing CSC deployment, you want `PROJECT.md` instead — this file is for
first-time setup.

---

## Step 1 — Supabase (the database)

1. Go to **https://supabase.com**, create an account, click **New project**.
2. Name it (e.g. `pickleball`), pick a nearby region, set a DB password, create.
3. Wait ~1 minute for provisioning.

### Create the tables

4. In the project, open **SQL Editor** in the left sidebar.
5. Copy the entire contents of `schema.sql` from this repo, paste it in, click **Run**.

That creates **10 tables**:

| Table | Primary key | Stores |
|---|---|---|
| `pb_config` | `id` (always `1`) | ID counters (`next_id.club/league/player`) |
| `pb_clubs` | `id` (`club_1`) | Club name, owner email, admin emails, join code |
| `pb_memberships` | `key` (`${clubId}_${playerId}`) | Which players belong to which clubs |
| `pb_players` | `id` (`player_1`) | Player identity (name, email, phone, gender) |
| `pb_leagues` | `id` (`league_1`) | League settings, weeks, format, colour |
| `pb_schedules` | `league_id` | Whole-season schedule for one league |
| `pb_registrations` | `key` (`${leagueId}_${playerId}`) | Who's in which league + paid status |
| `pb_scores` | `key` (`${leagueId}_${week}_${matchId}`) | Match results |
| `pb_locked_weeks` | `key` (`${leagueId}_w${week}`) | Which weeks are locked (row exists = locked) |
| `pb_checkins` | `key` (`${leagueId}_w${week}_${playerId}`) | Weekly RSVP (in / maybe / sub / out) |

Every table follows the same shape: a **string primary key** plus a **JSONB `data`
column** holding the full record. Top-level columns exist only to make queries
cheap. Each record is its own row — there is no single monolithic JSON blob, and
deploying new code never rewrites existing rows.

### Get your API keys

6. Go to **Settings → API**.
7. Copy two values:
   - **Project URL** — `https://<project-id>.supabase.co`
   - **anon public** key — the long JWT under "Project API keys"

The anon key is safe to ship in the client bundle. RLS is enabled on every table
with a permissive `anon_all` policy — see the **Security** note at the bottom.

---

## Step 2 — Configure locally

1. Copy `.env.example` → `.env.local`
2. Fill in:

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

Create a club from the home screen, then refresh — if it's still there, Supabase
is wired up correctly.

**Note on the service worker:** `npm run dev` does not serve the service worker
properly. To test PWA behaviour (offline mode, caching, the update banner) you
must use a production build:

```powershell
npm run build
npm run preview
```

---

## Step 4 — Deploy to Vercel

1. Push to GitHub.
2. **https://vercel.com** → sign in with GitHub → **Add New → Project**.
3. Import the repo. Vercel auto-detects Vite; no build settings to change.
4. Before deploying, open **Environment Variables** and add both:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. **Deploy.**

Every subsequent push to `main` auto-deploys. There is no staging environment.

---

## Step 5 — Custom domain (optional)

Vercel → project → **Settings → Domains**. SSL is automatic.

---

## First run: creating your club

The app has no seeded data. On first load:

1. Home screen → **Create a club**
2. Enter the club name and your own player details — you become the **owner**.
3. You'll get a **join code** (e.g. `CSC-2026-2Q2H`). Share it with players so
   they can self-register via **Join with a code**.
4. Find the code any time under **Commissioners** (or **Settings** → Join code,
   where you can also regenerate it).

Owners can rename the club, regenerate the join code, add/remove admins, transfer
ownership, and delete the club. Admins can do everything except the last three.

---

## Project structure

```
pickleball-deploy/
├── index.html                ← entry point + service-worker registration
├── vite.config.js
├── package.json              ← version source of truth
├── schema.sql                ← run this in Supabase SQL Editor
├── .env.example              ← template (safe to commit)
├── .env.local                ← your keys (NEVER commit)
├── PROJECT.md                ← architecture reference — read this first
├── NEXT-UP.md                ← planned work
├── SETUP.md                  ← this file
├── public/
│   ├── sw.js                 ← service worker (caching, v1.5.0+)
│   ├── manifest.webmanifest  ← PWA manifest
│   ├── csc-pickleball.png    ← logo
│   ├── favicon.png
│   └── icons/                ← PWA icons (192, 512, maskable, apple-touch)
└── src/
    ├── main.jsx
    ├── App.jsx               ← ~85KB: all routing, actions, and modals
    ├── styles.js             ← S.* style objects
    ├── index.css             ← CSS variables, resets, PWA safe-area
    ├── lib/                  ← constants, clubs, format, session,
    │                            scheduling, supabase (all dbXxx functions)
    └── components/           ← ~25 components (see PROJECT.md for the map)
```

---

## How data flows

**Write-first / read-back.** Every mutation:

1. Awaits a DB write (`dbXxx` in `src/lib/supabase.js`)
2. Re-fetches a full snapshot via `loadDB()`
3. Stores it in React state

No optimistic updates. React never shows data that isn't already in Postgres.
This costs a round-trip per write and buys correctness across tabs and devices.

**Soft deletes.** Leagues, players, and clubs are trashed by stamping
`data.deletedAt`, not by deleting rows. They vanish from the UI, stay recoverable
from the **Trash** tab for 30 days, then get hard-deleted (with full cascade)
automatically on the next `loadDB()`.

To inspect data directly: Supabase → **Table Editor**, or the SQL editor, e.g.

```sql
SELECT id, data->>'name', data->>'deletedAt' FROM pb_clubs;
```

---

## PWA

The app installs to a home screen and launches without browser chrome.

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app
- **Desktop Chrome/Edge:** install icon in the address bar

Requires HTTPS — Vercel provides it. iOS Safari needs real HTTPS even for testing,
so you can't fully verify install behaviour from `localhost`.

### What works offline (v1.5.0+)

The service worker caches the app shell, and every successful load caches the last
DB snapshot to localStorage. If you open the app with no connection:

- The app **boots and renders** from cache (rather than showing a network error)
- You can **read** your schedule, courts, standings, and roster
- An amber banner says **"Offline — showing data from X ago"**
- **Writes are blocked** with a clear toast — offline is strictly read-only

This is deliberate. The data layer is write-first/read-back: a write only counts
once the server confirms it. Queueing mutations offline would mean showing changes
that haven't happened, then reconciling later — that needs conflict resolution and
ordering guarantees this app doesn't have. A blocked write is honest; a silently
lost one is not.

**Not included:** push notifications (needs VAPID keys, a push endpoint, and a
permission flow — a genuinely separate project).

### Updates after a deploy

Handled properly as of v1.5.0. A new build's service worker installs, precaches,
and then **waits** — it does not take over mid-session. The app detects it and
shows a blue **"A new version is available · Reload"** banner. Only when the user
clicks Reload does the new worker activate and the page refresh.

This is why `sw.js` deliberately does **not** call `skipWaiting()` on install:
activating immediately could serve new assets to a page still running old code,
and would make the banner pointless.

If a user ever gets genuinely stuck on an old build, uninstalling and reinstalling
the PWA clears the cache.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page | Check the browser console; confirm env vars are set in Vercel |
| "Could not load data" | Verify `VITE_SUPABASE_URL` (no trailing slash) and the anon key |
| Data not saving | Confirm `schema.sql` ran; check the tables exist in Table Editor |
| Service worker not registering | You're on `npm run dev` — use `npm run build && npm run preview` |
| Changes not live after deploy | Vercel deploys on push to `main`; check the Deployments tab |
| Stuck on an old version in the PWA | Uninstall and reinstall from the home screen |

---

## Security note

There is **no real authentication.** Login is email-only with no password: enter an
email that matches a player record and you're in. Anyone who knows a member's email
can sign in as them.

This is a deliberate trade-off for a trusted single-club context, not an oversight.
RLS is enabled but the policy is permissive (`anon_all`), so the anon key grants
full read/write on all tables. Do not put anything sensitive in this database.

Adding real auth (Supabase Auth) is the leading candidate for the next major phase.
