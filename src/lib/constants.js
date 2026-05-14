// ─── App-wide constants ─────────────────────────────────────────────────────
// Brand palette, color themes, court sizing rules, check-in options, and the
// hardcoded primary commissioner email. These are pure data with no React
// dependencies — safe to import anywhere.

// ─── App metadata ──────────────────────────────────────────────────────────
// Surfaced in the About modal (accessible from the avatar menu). Update on
// every release. Versioning follows semver:
//   - Patch (0.9.x): UX tweaks, bug fixes, single-feature polish
//   - Minor (0.x.0): new features affecting workflow
//   - Major (x.0.0): reserved for the 1.0 milestone (per Ross's direction)
// Keep this in sync with `version` in package.json.
export const APP_INFO = {
  version: "0.11.0",
  createdBy: "Ross Lazar",
  // CSC = Cranbrook Swim Club. Spelled out here so newcomers to the About
  // modal don't have to decode the acronym.
  description: "League Manager for CSC Pickleball at Cranbrook Swim Club — schedules, scoring, standings.",
};

export const SUPER_ADMIN = "ross.lazar@gmail.com";

// Court sizing rules
export const MAX_COURTS = 8;
export const MIN_PER_COURT = 4;
export const MAX_PER_COURT = 5;

// Court name helpers
export function courtName(i) { return `Court ${i + 1}`; }
export function courtNames(count) {
  return Array.from({ length: count }, (_, i) => courtName(i));
}
// Backward-compat constant referencing the default 4-court setup
export const COURT_NAMES = courtNames(4);

// CSC Pickleball brand palette — drawn from the club logo
export const CSC = {
  blue:        "#1B6CC1",  // primary royal blue (logo background)
  blueDark:    "#0E3A6B",  // dark blue (logo text/title)
  blueLight:   "#E5F0FA",  // pale blue tint for backgrounds
  green:       "#7FC93D",  // bright lime (logo dolphin/swoosh)
  greenDark:   "#4F8C1B",  // accessible green for text/badges
  yellow:      "#FFE82E",  // pickleball ball yellow
};

// Per-league themes
export const COLORS = {
  // CSC primary — used as the default theme everywhere
  csc:    { bg: CSC.blue,   light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
  // Other per-league themes for visual differentiation
  green:  { bg: CSC.greenDark, light: "#EAF6DC", accent: CSC.green, text: "#1F3D08" },
  coral:  { bg: "#D85A30", light: "#FAECE7", accent: "#993C1D", text: "#4A1B0C" },
  purple: { bg: "#534AB7", light: "#EEEDFE", accent: "#7F77DD", text: "#26215C" },
  amber:  { bg: "#BA7517", light: "#FAEEDA", accent: "#EF9F27", text: "#412402" },
  // Backward-compat aliases for any existing leagues created with old keys
  teal:   { bg: CSC.blue, light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
  blue:   { bg: CSC.blue, light: CSC.blueLight, accent: CSC.green, text: CSC.blueDark },
};
export const LEAGUE_COLORS = ["csc", "green", "coral", "purple", "amber"];
export const COURT_COLORS = [CSC.blue, CSC.greenDark, "#D85A30", "#534AB7"];

// Check-in status options shown to players
export const CHECKIN_OPTS = [
  { key: "in",    label: "In",    color: "#3B6D11", bg: "#EAF3DE", icon: "✓" },
  { key: "maybe", label: "Maybe", color: "#854F0B", bg: "#FAEEDA", icon: "?" },
  { key: "sub",   label: "Sub",   color: "#534AB7", bg: "#EEEDFE", icon: "↔" },
  { key: "out",   label: "Out",   color: "#A32D2D", bg: "#FCEBEB", icon: "✗" },
];

// League status ordering for display (active first, archived last)
export const STATUS_ORDER = { active: 0, open: 1, completed: 2, archived: 3 };

// Localstorage key for session persistence
export const SESSION_KEY = "pickleball_session_v1";
// Stores the email of the last player to log in on this device. Persists
// across logout so the login screen can pre-fill it / offer one-tap re-entry.
// Cleared only when explicitly cleared via the "Use a different email" link
// or when the browser clears localStorage entirely.
export const LAST_EMAIL_KEY = "pickleball_last_email_v1";

// How long soft-deleted leagues/players stay in the trash before auto-purge.
// Records carrying `data.deletedAt` older than this are hard-deleted (with
// full cascade) on the next loadDB.
export const TRASH_RETENTION_DAYS = 30;

// ─── Spacing scale ──────────────────────────────────────────────────────────
// Canonical spacing values used throughout the app. Built on a 4px grid with
// 8px as the dominant step. All paddings, margins, and gaps should snap to
// one of these — ad-hoc values like 6, 10, 14 sneak in and create visual
// inconsistency that becomes especially noticeable with system fonts.
//
// Usage: import { SPACE } from "./lib/constants.js"
//        padding: `${SPACE.lg}px ${SPACE.xl}px`
//        gap: SPACE.sm
//        marginBottom: SPACE.md
//
// Rounding rules when migrating off-scale values:
//   - 4 → xs, 6 → sm, 8 → sm
//   - 10 → md, 12 → md, 14 → md or lg (pick lg if it's edge padding)
//   - 16 → lg, 18 → lg, 20 → xl
//   - 24 → xxl, 28 → xxl, 32 → xxxl
// When the original value has a specific visual reason (e.g. the score
// input field's "14px 6px"), leave it alone — the scale is a default,
// not a straitjacket.
export const SPACE = {
  xs:   4,   // tight gaps inside pills/badges
  sm:   8,   // small gaps, tight padding
  md:   12,  // standard form gaps, between related items
  lg:   16,  // card padding, between cards
  xl:   20,  // page side padding, between major sections
  xxl:  24,  // section breaks, modal padding
  xxxl: 32,  // hero-level spacing
};
