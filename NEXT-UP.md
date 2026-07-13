# Next Up — Backlog

**Status:** v1.5.0 is live. Everything previously planned in this file (v1.4.1
cascade fixes, v1.5.0 PWA polish) is **shipped**. Nothing is currently committed
or in progress.

Read `PROJECT.md` first for architecture. This file is the candidate list for
whatever comes next, roughly ordered by value-per-unit-risk.

---

## Recently shipped (for context)

**v1.4.1 — cascade fixes + scoping**
- `dbHardDeleteLeague`: SQL `LIKE` underscore-wildcard bug fixed (JS `startsWith`)
- `dbHardDeletePlayer`: now cascades to `pb_memberships`; same fix via `endsWith`
- HomeView: "Active Leagues" gated to single-club deployments
- One-time cleanup of 6 orphan rows (legacy `league_1/2/3` children)

**v1.5.0 — PWA polish**
- Caching service worker, hand-upgraded (deliberately *not* `vite-plugin-pwa`)
- Offline read from a cached DB snapshot, with a visible staleness banner
- Hard write-block when offline — all three mutation paths
- Update banner that waits for a user gesture instead of hot-swapping code

**Post-deploy data cleanup**
- Deduplicated two player records (Shannon Lamb ×2, a stray "R L" test account)
- No duplicate emails remain among live players

---

## Candidate work

### A. Real authentication (Supabase Auth) — the big one

**Problem.** Login is email-only with no password. Type any member's email and
you're them. There is no access control at all; RLS is permissive (`anon_all`), so
the anon key grants full read/write on every table.

This is fine for a trusted single club. It is **not** fine the moment a second,
unrelated club joins — which the entire multi-tenancy build (Phases 2–4) exists to
enable. Right now any user of any club could, with a little curiosity, read and
mutate every other club's data. That's the gap between what the app is architected
for and what it actually enforces.

**Shape of the work.**
1. Supabase Auth with magic-link (email) sign-in. No passwords to manage, and it
   maps cleanly onto the existing email-as-identity model.
2. Link `auth.users.id` → `pb_players`. Migration needed for the 10 existing players
   (invite flow, or claim-by-email on first sign-in).
3. **Rewrite the RLS policies.** This is the real work. Every table needs policies
   keyed on club membership: you can read/write a league only if you have a live
   membership in its club; only owners/admins can mutate club settings; etc.
4. Rework `App.jsx` session handling — replace the localStorage session with
   Supabase's, keep the club-switcher logic on top.

**Risk.** High. It touches identity, every table's access rules, and the login path
for real users mid-season. Genuinely a phase, not a session. **Do not start this
while a season is running.**

**Verdict.** The right next major thing, but time it for the off-season.

---

### B. Season-readiness polish — small, high value, low risk

The two live leagues are `open` and haven't started. Things worth having *before*
real scores start landing:

- **`dbRebalanceWeek` LIKE quirk.** The one surviving underscore-wildcard pattern.
  Blast radius is limited to the same league's other weeks, and rebalance rewrites
  that week anyway — but it's the same class of bug we just fixed everywhere else.
  ~20 minutes with the existing `keysWithPrefix` helper. Fix it before scores exist,
  because scores are exactly what it would eat.
- **Duplicate-email guard.** Nothing currently stops two player records sharing an
  email (that's how the Shannon dup happened). The login lookup takes whichever it
  finds first. Add a check in `dbCreatePlayer` / the create-player forms.
- **Hard-delete the two trashed strays** (`player_29`, `player_33`) instead of
  waiting 30 days, if you want the Trash tab clean.

**Verdict.** Do these. Cheap, and the rebalance fix in particular is much easier
before there's real data to lose.

---

### C. Stats & standings improvements

Ideas floated but never scoped: head-to-head records, win/loss streaks, per-court
performance history, a season-summary view.

**Caveat:** no season has actually run end-to-end on the current standings code
(0 scores in the DB). Running one real season will teach more about what's missing
than speculating now would. **Wait for real data.**

---

### D. `App.jsx` decomposition

~85KB, and every edit is a full-file overwrite through the Filesystem MCP. Splitting
out the modals, the action layer, and the view branches into separate modules would
make edits cheaper and safer.

**But:** it's a multi-day refactor with real regression risk across every flow, and
it buys developer ergonomics rather than user value. **Not urgent. Don't do it
mid-season.**

---

### E. Push notifications — explicitly deferred

Check-in reminders ("Week 3 is Thursday — are you in?") would be genuinely useful.
But it needs VAPID keys, a push endpoint (i.e. actual server-side code, which this
app has none of today), a permission flow, and scheduling logic.

Realistically 1–2 weeks. **Out of scope until something else justifies standing up a
backend.**

---

## Suggested order

1. **B (season-readiness polish)** — now, before the seasons start. Especially the
   rebalance fix.
2. **Run a real season.** Let the app do its job. Bugs and gaps will surface on their
   own, and they'll be better-prioritized than anything on this list.
3. **A (real auth)** — off-season, as a dedicated phase.
4. **C / D / E** — as motivated by what the season actually teaches.

---

## Standing notes for whoever picks this up

- **Read the code, not just the docs.** A previous version of these files claimed
  there was no service worker (there was), named a manifest that didn't exist, and
  miscounted an audit. Docs drift; the repo doesn't.
- **The compound-key underscore trap is real.** `LIKE 'league_1_%'` matches
  `league_10_...`. Use `keysWithPrefix` / `keysWithSuffix` in `supabase.js`.
- **Three functions bypass `action()`** (`deleteClub`, `seedTestPlayers`, the
  schedule commit). Any guard added to the wrapper must be added to them too — the
  v1.5.0 offline block needed all three.
- **Don't reintroduce `skipWaiting()`** in `sw.js`. It's absent on purpose.
- **Verify the filesystem path at session start** by reading a file, not by trusting
  a cached directory listing.
