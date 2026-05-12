// ─── App-wide constants ─────────────────────────────────────────────────────
// Brand palette, color themes, court sizing rules, check-in options, and the
// hardcoded primary commissioner email. These are pure data with no React
// dependencies — safe to import anywhere.

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

// How long soft-deleted leagues/players stay in the trash before auto-purge.
// Records carrying `data.deletedAt` older than this are hard-deleted (with
// full cascade) on the next loadDB.
export const TRASH_RETENTION_DAYS = 30;
