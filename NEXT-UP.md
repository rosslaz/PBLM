# Next Up — Backlog

**Status:** v1.15.1 — the data-safety fixes from the October 2026 full code
review. The rest of that review is queued below as **v1.16.0** (section 0);
nothing else is in progress.

Read `PROJECT.md` first for architecture. This is the candidate list, roughly
ordered by value per unit of risk.

---

## Recently shipped

**v1.6.0** — Commissioner can set any player's RSVP (players kept texting
"can't make it" instead of opening the app, leaving rebalance headcounts wrong).
Rebalance routed through the existing drag-and-drop preview editor, which also
gave a destructive action the preview it deserved.

**v1.7.0** — Open Play: RSVP-only leagues with no courts, scores, or standings.
Weeks derived on the fly rather than stored.

**v1.8.0** — Per-club logos; duplicate-account fixes in both creation paths;
PWA banner safe-area fix (banners were rendering inside the iOS notch strip,
visible but untappable); neutral app branding; remembered club across logout.

**v1.9.0 / v1.9.1** — D+D Weekly Partners (fixed 8 players, 14 weeks, verified
combinatorial template); staleness-aware background refresh; one court per matchup.

**v1.10.0** — Players see all courts (scoring still scoped to their own);
contrast audit with measured ratios; per-game standings points cap.

**v1.11.0** — Points stat for D+D Weekly Partners: half a point per point
scored plus 2 for a win, with per-side caps (winner 7.5, loser 5.0). D+D
standings now rank on it; every other format still ranks on Win%.

**v1.12.0** — Drop weeks for D+D: best 12 of 14 count, phasing in at 6 and 12
locked weeks. Standings now tally per week rather than as running totals.

**v1.13.0** — Completed weeks moved below the active ones with a labelled
divider, and the first still-open week auto-expands. Prompted by real usage —
four weeks in, the locked weeks had pushed the week needing scores below the
fold.

**v1.14.0 / v1.14.1** — Partners matrix tab for D+D: how many times each pair
has partnered, counting locked weeks plus the current one, with this week's
pairings highlighted. Columns keyed by initials.

**v1.15.0** — Weekly drill-down: expand any standings row for a week-by-week
breakdown (partner, Points, W, L, PF, PA), with dropped weeks struck through.
No new computation — it renders the per-week tallies the totals were already
summed from.

**v1.15.1** — Fixes from a full code review, aimed at the live D+D season.
Adding or removing a player no longer wipes the whole schedule (it used to, with
no warning, and the old regenerate guard then let a Generate delete every
score); an amber notice shows roster/schedule mismatches instead. D+D rosters
lock once the season starts. Rebalance and drag-editing are off for D+D (both
silently rebuilt weeks with the generic doubles template). The player hero card
now sees both D+D rounds. And a club-scoped **Download backup** in Settings.

**Data work** — orphan rows purged; three duplicate player records merged; a
junk club (created when someone pasted a join code into the club-name field)
trashed; the create-club form now catches that mistake as it's made.

---

## 0. v1.16.0 — before next season (from the October 2026 code review)

Every item here was confirmed against the code — and, where possible, the live
DB or a test run. None threatens the current season; all should land before the
next one starts.

1. **Schedule dates slip a day after the spring clock change.** The generators
   do `new Date("YYYY-MM-DD")` (UTC midnight) → local `setDate` →
   `toISOString()`. Reproduced: a Monday league starting 2027-01-11 shows
   Sundays from 2027-03-14 on. Affects `generateCourtSchedule`, the ladder path
   in `App.jsx`, `generateDDPartnersSchedule` and `buildDisplayWeeks` (twice),
   and through them score-entry and RSVP date gating. `openPlayWeeks()` already
   does it right (local noon) — extract one helper and use it everywhere. The
   current season is unaffected (fall-back is harmless in US time zones).
2. **Failed saves can show success.** `action()` swallows errors, and callers
   then act unconditionally: `toggleLockWeek` toasts "Week N unlocked." over the
   error; schedule and rebalance commits toast success and close the preview;
   `joinClub` logs you into the club anyway; forms close and lose their input.
   Make `action()` return true/false and gate on it.
3. **ID allocation race.** `dbCreatePlayer/League/Club` read `next_id`, then
   `upsert` — two simultaneous sign-ups get the same `player_N` and the second
   silently overwrites the first. Switch creates to `insert` and retry on a
   unique violation, or use an atomic Postgres function (needs a DB change).
4. **The ← button from Commissioner mode leaves the home screen club-scoped**
   (`activeClubId` isn't cleared), so another club's player gets "No player
   found" on that device — the v1.1.0 login bug by a new route.
5. **Trashed players stay on league rosters** (`getLeagueRegs` doesn't filter
   them) and still count toward D+D's 8. Soft-delete is also global: one club
   trashing a shared player hides them from both, and either club's Delete
   Forever wipes the other's registrations. Trash should remove the
   *membership*, not the player.
6. **Input validation.** Emails aren't trimmed, lower-cased or format-checked
   on save; `updatePlayer` and the join flow can create duplicate emails; the
   league form accepts 0 weeks, a blank start date (which crashes generation),
   and switching an existing Round-Robin league to D+D. Live data is clean today.
7. **Stale state.** `PlayerView`'s selected league is set once, so a player
   added to their first league sees a blank page; week cards are keyed by week
   number only, so half-typed inline scores carry across leagues; `LeagueDetail`'s
   tab goes wrong after a competition-type change.

**Polish batch (any time):**

- **Dark mode** — ~12 spots break the hardcoded-background rule. Worst: the
  viewer's own row in Standings and the Partners matrix (`c.light` under theme
  text, 1.1:1), the winning digits in `ScoreForm`, the Open Play "this week"
  header, the league banner's Edit/Archive buttons, the join-code chip.
- **Keyboard** — week headers, standings rows, registration cards and
  add-player rows are clickable `div`/`tr`s with no role or key handler.
- **Capacity** — D+D shows "8 of 10"; Open Play shows "Full" at 20.
- **PWA** — call `reg.update()` on visibility change so a long-open installed
  app notices new versions; precache `/dink-drink.png`.
- **Supabase** — `ALTER FUNCTION … SET search_path = ''` on
  `touch_updated_at` and `pb_touch_updated_at` (advisor warnings); drop the
  empty legacy `app_config` table, which still has an anon full-access policy.
- **Dependencies** — `npm audit fix` (dev/Node-only advisories). Don't jump to
  Vite 8 or React 19 mid-season.
- **Lint** — 19 unused-variable warnings.

**Candidate feature: replace a D+D player for the remaining weeks.** Swap one
id for another in every unlocked week, keeping locked weeks as played. Now that
the roster locks mid-season, it's the only clean answer to someone quitting.

---

## A. Real authentication — the one that matters now

**Problem.** Login is email-only with no password. Type any member's email and
you're them. RLS is enabled but permissive (`anon_all`), so the anon key grants
full read/write on every table.

**This has changed character.** It was defensible when CSC was the only club.
**There are now two clubs and 39 players.** Any user of any club can read and
mutate every other club's data. The app is architected for multi-tenancy but
doesn't enforce it — that gap is the whole point of the Phase 2–4 work.

**Shape of the work.**

1. Supabase Auth with magic-link sign-in — no passwords to manage, and it maps
   cleanly onto the existing email-as-identity model.
2. Link `auth.users.id` → `pb_players`. Migration needed for 39 existing players
   (claim-by-email on first sign-in is probably cleanest).
3. **Rewrite the RLS policies.** This is the real work. Every table needs
   policies keyed on club membership.
4. Replace the localStorage session with Supabase's, keeping the club-switcher
   logic on top.

**Risk: high.** Touches identity, every table's access rules, and the login path
for real users. A phase, not a session. **Don't start it mid-season.**

**Verdict.** The right next major thing. Time it for the off-season.

---

## B. Small, cheap, worth doing

- **Duplicate-email constraint at the DB level.** The app-layer guards
  (`findLivePlayerByEmail`) cover every creation path today, but nothing stops a
  direct insert. A partial unique index on `lower(data->>'email')` where
  `deletedAt IS NULL` would make it structural.
- **A stale `buildCourtMatches` doc comment** in `scheduling.js` ended up above
  the D+D template block during an edit; it now describes the wrong function.
- **Decide whether PF and Points should reconcile.** They use different loser
  caps (9 vs 10), so a 15–13 shows PF 9 beside Points 5.0 and the arithmetic
  visibly doesn't work. Intended and documented, but if it draws questions,
  moving the PF loser cap to 10 aligns them and changes no score under 10.
- **Ladder rotation ignores check-ins.** `rankCourtPlayers()` never receives
  them, so an absent player ranks on empty results and drifts down a court
  rather than holding position. Needs a decision — hold or drop — before it's
  worth coding. No live ladder leagues, so there's no urgency.
- **Drop weeks currently forgive absences completely.** A missed week banks 0,
  so it's the first thing dropped. Usually the intent, but with 8 players and
  rotating partners an absence also disrupts someone else's matchup. If that
  starts to feel unfair, exclude sat-out weeks from the drop pool so drops only
  apply to weeks actually played.

---

## C. Stats and standings

Head-to-head records, streaks, per-court history, a season-summary view.

**But:** no season has yet run end to end. D+D Season 3 is the first with real
data (56 scores, 7 weeks locked).
Running one real season will teach more about what's missing than speculating
now. **Wait for data.**

---

## D. `App.jsx` decomposition

~100KB, and it's grown steadily. Splitting out the modals, the action layer, and
the view branches would make edits cheaper and safer.

**But:** multi-day, real regression risk across every flow, and it buys
developer ergonomics rather than user value. **Not urgent, not mid-season.**

Related: the per-competition-type branching in `LeagueDetail` and `PlayerView`
is now three branches deep (round-robin/ladder, open play, D+D). **If a fifth
competition type appears, that's the signal** to pull per-type rendering into
separate components rather than branching inline again.

---

## E. Push notifications — deferred

Check-in reminders would be genuinely useful, but it needs VAPID keys, a push
endpoint (i.e. actual server-side code, which this app has none of), a
permission flow, and scheduling. Realistically 1–2 weeks. **Out of scope until
something else justifies standing up a backend.**

---

## Suggested order

1. **B** — now. Cheap and mostly one-liners.
2. **0 (v1.16.0)** — before the next season starts; the date fix first if that
   season runs through March.
3. **Finish the current season.** D+D Season 3 is at week 8 of 14 and is the
   first format to run end to end. The last few releases all came from real
   usage rather than this list, which is the pattern to keep.
4. **A** — off-season, as a dedicated phase.
5. **C / D / E** — as the season motivates.

---

## Standing notes for whoever picks this up

- **Update these docs with every release.** Standing instruction from Ross, and
  the lesson of two bad drifts. Same commit as the code, or the next one.
- **Read the code, not just the docs.** These files have drifted badly twice.
  When they disagree with the code, the code wins.
- **The compound-key underscore trap is real.** `LIKE 'league_1_%'` matches
  `league_10_...`. No `LIKE` remains in the codebase — keep it that way.
- **Three functions bypass `action()`** (`deleteClub`, `seedTestPlayers`,
  `downloadBackup`). Any guard added to the wrapper must be added to them too.
  (Older notes listed the schedule commit here; it goes through `action()`.)
- **Roster changes never touch the schedule.** Don't reintroduce a reset in
  `dbRegisterForLeague` / `dbRemovePlayerFromLeague` — see `PROJECT.md` §7.
- **In D+D a player is on two courts a week.** "Which court is this player
  on?" must be `filter`, not `find`.
- **Don't reintroduce `skipWaiting()`** in `sw.js`. It's absent on purpose.
- **A hardcoded background with theme-variable text is always a dark-mode bug.**
- **After deploying, check the version footer** before believing a change is
  missing — the service worker deliberately serves the old bundle until reload.
- **Verify the filesystem path by reading a file**, not by trusting a directory
  listing.
