# Pickleball League Manager — Deployment Guide
## Stack: React + Vite → Vercel | Supabase (Postgres)

---

## Step 1 — Set up Supabase (the database)

1. Go to **https://supabase.com** and create a free account
2. Click **New project**, give it a name (e.g. `pickleball`), choose a region close to you, set a database password, click **Create project**
3. Wait ~1 minute for it to spin up

### Create the database tables

4. In your Supabase project, click **SQL Editor** in the left sidebar
5. Open the file `schema.sql` included in this project, copy the entire contents, paste into the SQL editor and click **Run**

You should see "Success" — this creates 7 tables:

| Table | Stores |
|---|---|
| `pb_leagues` | League definitions |
| `pb_players` | Player profiles |
| `pb_registrations` | Who is in which league + paid status |
| `pb_schedules` | Weekly court assignments per league |
| `pb_scores` | Individual match results |
| `pb_locked_weeks` | Which weeks are locked by admin |
| `pb_config` | Admin email list and ID counters |

Each table has its own rows — **no data is ever stored in a single JSON blob**. Refreshing the app or deploying new code never touches existing rows.

### Get your API keys

7. Go to **Settings → API** (gear icon in sidebar)
8. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long JWT string under "Project API keys"

---

## Step 2 — Configure the app locally

1. In the project folder, duplicate `.env.example` and rename it `.env.local`
2. Fill in your two values:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Step 3 — Run locally to test

```bash
# Install dependencies (only needed once)
npm install

# Start the dev server
npm run dev
```

Open **http://localhost:5173** in your browser.  
Test that data saves by creating a league — then refresh the page and confirm it's still there (it's now coming from Supabase).

---

## Step 4 — Deploy to Vercel

1. Push the project folder to a **GitHub repository**:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/pickleball-league.git
git push -u origin main
```

2. Go to **https://vercel.com** and sign in with GitHub
3. Click **Add New → Project**
4. Select your `pickleball-league` repository → click **Import**
5. Vercel auto-detects Vite — no build settings to change
6. Before clicking Deploy, click **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → your project URL
   - `VITE_SUPABASE_ANON_KEY` → your anon key
7. Click **Deploy**

Vercel gives you a live URL like `https://pickleball-league.vercel.app` in ~30 seconds.

---

## Step 5 — Custom domain (optional)

In Vercel → your project → **Settings → Domains**, add your own domain (e.g. `pickleball.yourclub.com`).  
Vercel handles the SSL certificate automatically.

---

## Project structure

```
pickleball-deploy/
├── index.html          ← HTML entry point
├── vite.config.js      ← Vite config
├── package.json        ← Dependencies
├── .env.example        ← Template for env vars (safe to commit)
├── .env.local          ← Your actual keys (DO NOT commit this)
├── .gitignore
└── src/
    ├── main.jsx        ← React root
    ├── App.jsx         ← The full app
    └── index.css       ← Global styles + CSS variables
```

---

## How the database works

All app state (leagues, players, schedules, scores, etc.) is stored as a single JSON object in one Supabase Postgres row. This keeps the setup simple — no schema migrations needed when the app changes. The `saveDB()` function does a PATCH to that row on every change.

If you ever want to inspect or back up your data:
- Supabase Dashboard → **Table Editor → app_config** — click the row to see the full JSON
- Or run `SELECT data FROM app_config WHERE id = 1;` in the SQL editor

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page on load | Check browser console for errors; verify env vars are set in Vercel |
| Data not saving | Check Supabase → Table Editor to confirm the row exists; re-run the SQL setup |
| "Failed to fetch" errors | Confirm your Supabase URL has no trailing slash and the anon key is correct |
| Changes not showing after deploy | Vercel auto-deploys on every git push to `main` |

---

## Installing as an app (PWA)

The app is installable on phones and desktops — it gets a home-screen / desktop icon and launches fullscreen without browser chrome.

**On iPhone (Safari):** Open the deployed URL → tap the Share button → "Add to Home Screen" → Add.

**On Android (Chrome):** Open the deployed URL → tap the menu (⋮) → "Install app" (or "Add to Home Screen"). On some Android setups Chrome will prompt automatically after a couple of visits.

**On desktop Chrome / Edge:** Visit the deployed URL → look for the install icon (⊕ or computer-with-down-arrow) on the right side of the address bar → Install.

The PWA needs HTTPS, which Vercel provides automatically. Installation does NOT work from `http://localhost` (browsers require HTTPS for service workers, with localhost as the only exception — but iOS Safari requires real HTTPS even for testing).

### What's included

- Installable on iOS, Android, desktop
- CSC logo as the home-screen icon (with Android maskable variant so it crops cleanly into circles/squircles)
- Launches in standalone mode (no browser chrome)
- Theme color matches the brand

### What's NOT included

- **Offline support.** The app needs an active internet connection. We don't cache the JS bundle, so refreshing while offline shows a network error (same as a regular website). Adding real offline support requires caching the app shell + queueing writes for when connectivity returns — meaningful work, not included.
- **Push notifications.** Would require server-side keys and permission flows.

### After a deploy: forcing PWA to update

Service workers can cache an old version even after you deploy new code. If players install the PWA and then you ship an update they don't see:

- They can pull-to-refresh inside the installed app
- Or close + relaunch the app
- As a last resort: uninstall and reinstall from the home screen

Our service worker doesn't actually cache anything yet, so this is rarely an issue today — but worth knowing if we add caching later.
