# Next Up — v1.4.1 + v1.5.0

This doc is the working spec for the next two releases. Read `PROJECT.md` first for general context. Read this after.

**Status as of writing:** v1.4.0 is live in prod. Phase 4 is complete. Ross has chosen to do items 2 (backlog hygiene) and 3 (PWA polish) next, scoped as below.

**Two open decisions blocking start** — see Section 4 at the bottom.

---

## v1.4.1 — Backlog hygiene

**Theme:** silent fixes for latent bugs that haven't bitten yet but should be closed off. No new user-facing features. Patch-level bump (1.4.0 → 1.4.1).

**Estimated effort:** ~1 hour, mostly in `src/lib/supabase.js` and a small slice of `App.jsx`.

### Item A — Add memberships to player hard-delete cascade

**Problem:** `dbHardDeletePlayer` cleans up `pb_registrations` and `pb_checkins` but not `pb_memberships`. After the 30-day auto-purge runs on a soft-deleted player, the membership rows become orphaned — they reference a `playerId` that no longer exists.

Today (verified at v1.4.0 deploy): production has 32 players / 32 memberships and is balanced, so no orphans have accumulated yet. But once players start cycling through, this would create cruft.

**Fix:** Extend `dbHardDeletePlayer` to delete memberships where `key` ends with the player ID. Use JS-side filtering with `endsWith` rather than `LIKE "%_${playerId}"` to dodge the underscore-as-wildcard quirk.

**File:** `src/lib/supabase.js`, around line ~440 (the existing `dbHardDeletePlayer`).

**Implementation:**

```js
export async function dbHardDeletePlayer(playerId) {
  // 1. Delete the player itself + registrations + check-ins (existing).
  //    Note: the existing LIKE patterns here have the same underscore
  //    quirk as the league cascade. They've been benign in practice
  //    because player IDs are `player_N` and dependent keys reliably
  //    end in `_${playerId}`. Item B fixes the league side; the player
  //    side stays on LIKE for now since the risk profile is lower (no
  //    player_1 vs player_10 collision possible at end-of-string).
  //
  // Actually — on reflection, fix it here too while we're at it. Cheap.

  // Fetch all keys we might need to delete, filter in JS.
  const [regsRes, checkinsRes, memsRes] = await Promise.all([
    supabase.from("pb_registrations").select("key"),
    supabase.from("pb_checkins").select("key"),
    supabase.from("pb_memberships").select("key"),
  ]);
  if (regsRes.error) throw regsRes.error;
  if (checkinsRes.error) throw checkinsRes.error;
  if (memsRes.error) throw memsRes.error;

  const suffix = `_${playerId}`;
  const regKeys = (regsRes.data || []).map(r => r.key).filter(k => k.endsWith(suffix));
  const checkinKeys = (checkinsRes.data || []).map(r => r.key).filter(k => k.endsWith(suffix));
  const memKeys = (memsRes.data || []).map(r => r.key).filter(k => k.endsWith(suffix));

  // Run deletes. Player row, plus the filtered child rows.
  const ops = [supabase.from("pb_players").delete().eq("id", playerId)];
  if (regKeys.length > 0) ops.push(supabase.from("pb_registrations").delete().in("key", regKeys));
  if (checkinKeys.length > 0) ops.push(supabase.from("pb_checkins").delete().in("key", checkinKeys));
  if (memKeys.length > 0) ops.push(supabase.from("pb_memberships").delete().in("key", memKeys));

  const results = await Promise.all(ops);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}
```

**Why `endsWith` is safe here:** membership keys are `${clubId}_${playerId}`. The player ID `player_5` ends the string. `endsWith("_player_5")` matches `club_1_player_5` ✓ but NOT `club_1_player_55` ✗ (because of the underscore in the suffix). Same for `pb_registrations` keys `${leagueId}_${playerId}`. And for `pb_checkins` keys `${leagueId}_w${week}_${playerId}`.

**Test:** Hard-delete one of the test players from the Trash tab. Verify their memberships are gone in the DB.

### Item B — Fix the LIKE underscore bug in `dbHardDeleteLeague`

**Problem:** `dbHardDeleteLeague` uses `like("key", "${id}_%")` for several child tables. The `_` matches any single character in SQL `LIKE`, so deleting `league_1` could also match `league_10`, `league_11`, etc.

**Audit status (at v1.4.0 deploy):** No live league has been corrupted. There are 4 orphan rows in `pb_checkins` and `pb_locked_weeks` referencing leagues that no longer exist (`league_1`, `league_2`, `league_3`). Those are pre-existing artifacts from earlier cascade versions — not from the LIKE bug actually firing. Live leagues `league_7` and `league_8` are clean.

**Fix:** Mirror what `dbHardDeleteClub` already does. Fetch all keys, filter in JS by prefix `${id}_`, delete the matched ones with `.in("key", keys)`.

**File:** `src/lib/supabase.js`, around line ~240 (the existing `dbHardDeleteLeague`).

**Implementation:**

```js
export async function dbHardDeleteLeague(id) {
  // Pull all child-table keys and filter in JS. Avoids the SQL LIKE
  // underscore-as-wildcard quirk (e.g. "league_1_%" matching league_10
  // and league_11's keys too).
  const [regsRes, scoresRes, locksRes, checkinsRes] = await Promise.all([
    supabase.from("pb_registrations").select("key"),
    supabase.from("pb_scores").select("key"),
    supabase.from("pb_locked_weeks").select("key"),
    supabase.from("pb_checkins").select("key"),
  ]);
  for (const r of [regsRes, scoresRes, locksRes, checkinsRes]) {
    if (r.error) throw r.error;
  }

  const prefix = `${id}_`;
  const filterByPrefix = (rows) =>
    (rows || []).map(r => r.key).filter(k => k.startsWith(prefix));

  const regKeys = filterByPrefix(regsRes.data);
  const scoreKeys = filterByPrefix(scoresRes.data);
  const lockKeys = filterByPrefix(locksRes.data);
  const checkinKeys = filterByPrefix(checkinsRes.data);

  // Build the parallel delete ops.
  const ops = [
    supabase.from("pb_leagues").delete().eq("id", id),
    supabase.from("pb_schedules").delete().eq("league_id", id),
  ];
  if (regKeys.length > 0) ops.push(supabase.from("pb_registrations").delete().in("key", regKeys));
  if (scoreKeys.length > 0) ops.push(supabase.from("pb_scores").delete().in("key", scoreKeys));
  if (lockKeys.length > 0) ops.push(supabase.from("pb_locked_weeks").delete().in("key", lockKeys));
  if (checkinKeys.length > 0) ops.push(supabase.from("pb_checkins").delete().in("key", checkinKeys));

  const results = await Promise.all(ops);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}
```

**Performance note:** This pulls all keys from four tables on every hard-delete instead of using SQL `LIKE`. At current scale (single-digit league counts, low double-digit registrations) the difference is negligible. If the app ever grows to thousands of leagues we'd revisit (e.g. with proper foreign-key column instead of compound keys, or use SQL `LIKE` with the underscore escaped as `\_`).

**Optional cleanup of existing orphans:** Run this SQL via Supabase MCP (with Ross's explicit OK):

```sql
-- Orphan check-ins for leagues that don't exist
DELETE FROM pb_checkins
WHERE NOT EXISTS (
  SELECT 1 FROM pb_leagues l
  WHERE pb_checkins.key LIKE l.id || '_%'
);

-- Orphan locked_weeks for leagues that don't exist
DELETE FROM pb_locked_weeks
WHERE NOT EXISTS (
  SELECT 1 FROM pb_leagues l
  WHERE pb_locked_weeks.key LIKE l.id || '_%'
);
```

Run as a one-time fix. Don't bake into app code — auto-purge handles it going forward.

**Test:** Create a throwaway "league_99" with some registrations, hard-delete it, verify no other leagues were affected. Or just trust the unit logic since the prod risk is zero with current league IDs.

### Item C — Tighten home screen "Active Leagues"

**Problem:** When there's no active club (home screen, pre-login), `leagues` falls back to all non-trashed leagues across all clubs. Today CSC is the only real club so this doesn't matter, but it's a privacy/noise issue once multiple unrelated clubs exist.

**Ross's recommendation (from chat):** Show the leagues list only when there's exactly one live club in the DB. Otherwise the home screen shows nothing in the "Active Leagues" section. Single-club deployments (CSC) keep their current experience; multi-club deployments don't leak.

**File:** `src/App.jsx` (the home-view branch around line ~1095) or `src/components/HomeView.jsx`.

**Implementation option (in HomeView.jsx):**

```jsx
// Top of HomeView, compute whether to render the leagues list.
// Only show it when there's exactly one live club — preserves CSC's
// home-screen behavior, hides cross-club leakage once multiple
// independent clubs exist.
const liveClubCount = Object.values(db.clubs || {}).filter(c => c && !c.deletedAt).length;
const showActiveLeaguesSection = liveClubCount === 1;

// Then in the JSX:
{showActiveLeaguesSection && leagues.length > 0 && (
  <div>
    <h3>...</h3>
    {/* existing rendering */}
  </div>
)}
```

Don't break anything else — the leagues prop is still passed in. We're just gating the rendered section, not the underlying data flow.

**Test:** With production state (1 live club), the leagues section still shows. To verify the hide behavior, create a second club on prod via "Create a Club" (a throwaway), reload — the leagues list should disappear. Then delete the second club and verify it returns.

### v1.4.1 commit + deploy

```powershell
cd "C:\Users\rossl\Desktop\AI Projects\PBLM\pickleball-deploy"
# Update package.json version to 1.4.1
# Update src/lib/constants.js APP_INFO.version to 1.4.1
npm run build  # verify
git add -A
git commit -m "v1.4.1 - cascade fixes + home-screen scoping

- dbHardDeleteLeague: fix LIKE underscore-wildcard bug; use JS-side
  startsWith filter for child rows
- dbHardDeletePlayer: include pb_memberships in cascade; use endsWith
  filter to dodge the same underscore quirk
- HomeView: only show Active Leagues section when single live club
  in DB. Prevents cross-club league leakage on home screen when
  multiple clubs exist; CSC's experience unchanged.
- One-time SQL cleanup of orphan checkins + locked_weeks rows for
  leagues that no longer exist (4 rows total, all pre-v1.0 era)"
git push
```

---

## v1.5.0 — PWA polish

**Theme:** make the app feel like a real installable PWA. Specifically: works offline (gracefully), surfaces cached data, blocks writes when disconnected, and tells the user when there's a new version.

**Explicitly OUT of scope:** push notifications. That's a separate ~1-2 week phase (VAPID keys, server endpoint, permission flow, scheduling logic). Defer.

**Estimated effort:** 3-4 hours. Most of it is wiring `vite-plugin-pwa`.

### Item D — Service worker for app shell caching

**Problem:** Close the browser tab while offline → reopen → see "no internet connection" error from the browser, not the app. With a service worker that caches the app shell, the user would see the app UI (with stale data) even when offline.

**Approach:** Use [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/). It generates the service worker, manages the manifest, and handles asset hashing automatically.

**Files:**

1. Install: `npm install -D vite-plugin-pwa`
2. `vite.config.js` — register the plugin
3. `public/manifest.json` — already exists, but may need updates to match plugin expectations
4. `src/main.jsx` — register the service worker on app load (or let the plugin auto-register)

**Implementation sketch for `vite.config.js`:**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["csc-pickleball.png", "icons/*.png"],
      manifest: {
        name: "CSC Pickleball League Manager",
        short_name: "CSC Pickleball",
        description: "League manager for pickleball clubs",
        theme_color: "#1B6CC1",
        background_color: "#1B6CC1",
        display: "standalone",
        icons: [
          // pull from public/icons/ — confirm paths exist
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Cache strategies:
        runtimeCaching: [
          {
            // Supabase API: NetworkOnly. Never cache live data.
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
            handler: "NetworkOnly",
          },
          {
            // App shell + JS/CSS: cache-first
            urlPattern: ({ request }) =>
              request.destination === "script" ||
              request.destination === "style" ||
              request.destination === "document",
            handler: "CacheFirst",
          },
        ],
      },
    }),
  ],
});
```

**Read the docs first** (`https://vite-pwa-org.netlify.app/`) — the plugin has opinions about how it integrates with the existing manifest. If `public/manifest.json` is already present and good, the plugin can be told to skip generation and just use it.

**Test:**

1. Build and serve (`npm run build && npm run preview`).
2. Open DevTools → Application → Service Workers — verify SW is registered.
3. Go offline (DevTools → Network → Offline).
4. Reload the page — app shell should load (data won't, that's Item E).
5. Online again — works normally.

### Item E — Cache last DB snapshot

**Problem:** Even with SW, opening the app offline shows a loading spinner forever because `loadDB()` fails. We should show the last-known snapshot from localStorage immediately, with a banner indicating it's stale.

**Files:**
- `src/lib/supabase.js` — `loadDB()` writes successful snapshots to localStorage
- `src/App.jsx` — on initial load, fall back to cached snapshot if `loadDB()` fails

**Implementation in `supabase.js`:**

```js
const DB_CACHE_KEY = "pickleball_db_snapshot_v1";

// Wrap successful loadDB to also cache the result. Add timestamp so the
// UI can show "last updated X minutes ago".
export async function loadDB() {
  await purgeExpiredTrash();
  const snapshot = await loadDBSnapshot();
  try {
    localStorage.setItem(DB_CACHE_KEY, JSON.stringify({
      snapshot,
      cachedAt: Date.now(),
    }));
  } catch (e) {
    // localStorage quota or disabled — non-fatal
    console.warn("[loadDB] could not cache snapshot:", e);
  }
  return snapshot;
}

export function loadCachedDB() {
  try {
    const raw = localStorage.getItem(DB_CACHE_KEY);
    if (!raw) return null;
    const { snapshot, cachedAt } = JSON.parse(raw);
    return { snapshot, cachedAt };
  } catch (e) {
    return null;
  }
}
```

**Implementation in `App.jsx`:**

```js
// Track when the displayed snapshot was fetched (null = live)
const [snapshotAge, setSnapshotAge] = useState(null);

// Modify the initial-load useEffect:
useEffect(() => {
  (async () => {
    try {
      const fresh = await loadDB();
      setDB(fresh);
      setSnapshotAge(null);
    } catch (e) {
      console.error("[initial load] failed:", e);
      // Try the cache before giving up
      const cached = loadCachedDB();
      if (cached) {
        setDB(cached.snapshot);
        setSnapshotAge(cached.cachedAt);
        showToast("Showing cached data — you appear to be offline", "error");
      } else {
        setDB(defaultDB());
        showToast("Could not load data — check Supabase credentials", "error");
      }
    }
  })();
}, []);
```

**Banner UI:**

In `App.jsx`, just below the header (in both admin and player views), conditionally render:

```jsx
{snapshotAge !== null && (
  <div style={{
    background: "#FAEEDA", color: "#854F0B",
    padding: "8px 16px", fontSize: 13, textAlign: "center",
    borderBottom: "0.5px solid #ECC580",
  }}>
    📡 Offline — showing data from {formatRelativeTime(snapshotAge)}
  </div>
)}
```

Where `formatRelativeTime` is a tiny helper that returns "a moment ago" / "5 minutes ago" / "2 hours ago" / "yesterday" etc. Put it in `lib/format.js`.

**Test:** Toggle DevTools offline → reload → verify cached data appears with banner.

### Item F — Block writes when offline

**Problem:** With caching in place, the user can see data offline. But they shouldn't be able to *write* — those writes would fail at Supabase and the user might not notice.

**Approach:** Check `navigator.onLine` at the top of `action()` in `App.jsx`. If offline, short-circuit with an error toast.

**Implementation in `App.jsx`:**

```js
async function action(fn, successMsg, actionId) {
  if (!navigator.onLine) {
    showToast("You're offline — changes can't be saved right now.", "error");
    return;
  }
  // ...existing implementation
}
```

**Edge cases:**

- `navigator.onLine` can be `true` but actual network unreachable. We accept this — the existing error handling in `action()` catches it (`showToast(e.message...)`).
- The check happens client-side and is bypassable. That's fine; it's a UX guard, not a security boundary.

**Test:** Go offline → try to mark a player as paid → see the toast → confirm no DB write attempted.

### Item G — Update banner when new build deployed

**Problem:** PWA users have the app cached. When you deploy a new version, they won't see it until they manually reload. Often they don't.

**Approach:** `vite-plugin-pwa` exposes a hook that fires when a new service worker is waiting to activate. Show a banner: "New version available · Reload".

**File:** Add a new component `src/components/UpdateBanner.jsx`, render it in `App.jsx` near the top of the page.

**Implementation:**

```jsx
// src/components/UpdateBanner.jsx
import { useState, useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(reg) {
      console.log("[SW] registered");
    },
    onRegisterError(err) {
      console.error("[SW] register error:", err);
    },
  });

  if (!needRefresh) return null;

  return (
    <div style={{
      background: "#1B6CC1", color: "#fff",
      padding: "10px 16px", textAlign: "center", fontSize: 13,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <span>A new version of the app is available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: "#fff", color: "#1B6CC1", border: "none",
          padding: "4px 12px", borderRadius: 4, fontWeight: 600,
          fontSize: 12, cursor: "pointer",
        }}>
        Reload
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{
          background: "transparent", color: "#fff",
          border: "0.5px solid rgba(255,255,255,0.4)",
          padding: "4px 12px", borderRadius: 4,
          fontSize: 12, cursor: "pointer",
        }}>
        Later
      </button>
    </div>
  );
}
```

Render at the top of each view block in `App.jsx`:

```jsx
{view === "admin" && (
  <ActionPendingProvider value={currentActionId}>
    <PullToRefresh ...>
      <UpdateBanner />
      <div style={S.page}>
        ...
```

**Test:** Hard to verify locally without two deploys. Best confirmed in prod: deploy v1.5.0, then deploy a small v1.5.1 patch, check that PWA users see the banner.

### v1.5.0 commit + deploy

```powershell
# After all tests pass:
# Update package.json to 1.5.0
# Update src/lib/constants.js APP_INFO.version to 1.5.0
npm run build  # verify SW generation runs
git add -A
git commit -m "v1.5.0 - PWA polish

- Service worker via vite-plugin-pwa. App shell + assets cached;
  Supabase calls bypass cache (NetworkOnly).
- Cache last successful loadDB() snapshot in localStorage. On startup,
  if the live fetch fails, fall back to the cached snapshot and show
  an 'Offline — showing data from X ago' banner.
- Block writes when navigator.onLine is false. Toast instead of letting
  the request fail at Supabase.
- UpdateBanner: detect when a new service worker is waiting, show
  'A new version is available · Reload / Later' banner. Reload swaps
  in the new SW and refreshes."
git push
```

**Smoke test in prod:**
1. Install the PWA on iOS or Android.
2. Toggle airplane mode.
3. Open the app — should see cached data with the offline banner.
4. Try to mark anyone as paid — should see "You're offline" toast.
5. Re-enable network — refresh button should pull fresh data.

---

## Decisions Ross needs to make before starting

These are the two open questions from chat. The next session should confirm before writing code.

### Decision 1: Should we audit Supabase before fixing the LIKE bug?

**Asked already; partial answer obtained.** I ran the audit at the end of v1.4.0 deploy:

- 4 orphan rows found (`pb_checkins` for `league_1`, `pb_locked_weeks` for `league_1`/`2`/`3`)
- No live league has corrupted children
- The orphans look pre-v1.0 era, not from the LIKE bug actually firing

So practically: **no urgent damage to undo.** Item B can proceed as a forward-only fix, with the optional one-time SQL cleanup of orphans included as a polish step.

**Decision needed:** include the one-time cleanup SQL in the v1.4.1 deploy, or skip it (orphans are harmless)?

### Decision 2: Home screen leagues — confirm "single live club" approach?

My recommendation in chat: show the Active Leagues section only when there's exactly one live club in the DB. Ross hadn't explicitly confirmed when this doc was written.

**Alternative approaches:**
- **(a)** Show only when single club (recommended) — what's spec'd in Item C.
- **(b)** Never show on home screen — removes the public discovery surface. Probably wrong, makes the home page feel dead.
- **(c)** Show leagues for the last-used club, looked up via the saved email — most "smart" but most complex.

If Ross picks anything other than (a), update Item C's implementation accordingly.

---

## Suggested execution order

1. Confirm the two decisions above.
2. **v1.4.1 first** — small, low-risk, mostly invisible to users. Deploy, let it sit ~24 hours, watch for regressions.
3. **v1.5.0 second** — bigger surface area (new service worker, banner UI, cached snapshot). Test thoroughly locally before deploying. Don't pile on top of v1.4.1 if anything looks weird.

After both ship, the "low-risk polish" path is exhausted. The next meaningful work item is probably Phase 5 (real auth via Supabase Auth) or a stats-improvements phase — Ross to decide.

---

## Files this doc will touch (summary)

**v1.4.1:**
- `package.json` (version bump)
- `src/lib/constants.js` (APP_INFO.version bump)
- `src/lib/supabase.js` (dbHardDeleteLeague + dbHardDeletePlayer)
- `src/components/HomeView.jsx` (gate Active Leagues by live club count)
- One-time SQL via Supabase MCP (optional orphan cleanup)

**v1.5.0:**
- `package.json` (version bump + new dep `vite-plugin-pwa`)
- `src/lib/constants.js` (APP_INFO.version bump)
- `vite.config.js` (register VitePWA plugin)
- `public/manifest.json` (review, possibly update)
- `src/lib/supabase.js` (cache loadDB snapshot to localStorage; add `loadCachedDB`)
- `src/lib/format.js` (new `formatRelativeTime` helper)
- `src/App.jsx` (cached-fallback on initial load, offline banner, navigator.onLine guard in `action()`, render UpdateBanner)
- `src/components/UpdateBanner.jsx` (new file)
