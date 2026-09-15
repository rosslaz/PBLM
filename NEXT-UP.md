# Next Up — Backlog

**Status:** v1.10.0 is live. Everything previously in this file has shipped.
Nothing is currently in progress or uncommitted.

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

**Data work** — orphan rows purged; three duplicate player records merged; a
junk club (created when someone pasted a join code into the club-name field)
trashed; the create-club form now catches that mistake as it's made.

---

## A. Real authentication — the one that matters now

**Problem.** Login is email-only with no password. Type any member's email and
you're them. RLS is enabled but permissive (`anon_all`), so the anon key grants
full read/write on every table.

**This has changed character.** It was defensible when CSC was the only club.
**There are now three clubs and 39 players.** Any user of any club can read and
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
- **Fix Dink & Drink's `logoUrl`** — it's `dink-drink.png`, missing the leading
  slash. Works only because the SPA never leaves `/`. One-character fix in
  Settings.
- **`league_19` needs 4 more players** before it can generate.
- **A stale `buildCourtMatches` doc comment** in `scheduling.js` ended up above
  the D+D template block during an edit; it now describes the wrong function.

---

## C. Stats and standings

Head-to-head records, streaks, per-court history, a season-summary view.

**But:** no season has yet run end to end. There are 8 scores in the database.
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
2. **Run a real season.** The app has four competition types and almost no
   real scores. Actual use will prioritise better than this list can.
3. **A** — off-season, as a dedicated phase.
4. **C / D / E** — as the season motivates.

---

## Standing notes for whoever picks this up

- **Read the code, not just the docs.** These files have drifted badly twice.
  When they disagree with the code, the code wins.
- **The compound-key underscore trap is real.** `LIKE 'league_1_%'` matches
  `league_10_...`. No `LIKE` remains in the codebase — keep it that way.
- **Three functions bypass `action()`** (`deleteClub`, `seedTestPlayers`, the
  schedule commit). Any guard added to the wrapper must be added to them too.
- **Don't reintroduce `skipWaiting()`** in `sw.js`. It's absent on purpose.
- **A hardcoded background with theme-variable text is always a dark-mode bug.**
- **After deploying, check the version footer** before believing a change is
  missing — the service worker deliberately serves the old bundle until reload.
- **Verify the filesystem path by reading a file**, not by trusting a directory
  listing.
