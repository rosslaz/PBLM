// ─── Session, sorting helpers, and the mobile-detection hook ────────────────
import { useState, useEffect } from "react";
import { SESSION_KEY, LAST_EMAIL_KEY, STATUS_ORDER } from "./constants.js";

// ─── Session persistence (browser localStorage) ─────────────────────────────
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) { return {}; }
}

export function saveSession(s) {
  try {
    if (!s || (!s.playerId && !s.adminEmail)) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch (_) {}
}

// ─── Remembered email (separate from session) ───────────────────────────────
// We track the last successful login email separately so that logging out
// clears the active session but the next login attempt can be pre-filled or
// done with a single tap. Keeps "stay signed in everywhere" working even
// across explicit logouts, browser-restart edge cases, and quick switches
// between admin and player modes.
export function loadLastEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || "";
  } catch (_) { return ""; }
}

export function saveLastEmail(email) {
  try {
    if (!email) localStorage.removeItem(LAST_EMAIL_KEY);
    else localStorage.setItem(LAST_EMAIL_KEY, email.toLowerCase().trim());
  } catch (_) {}
}

// Sort leagues for display: active first, then open/completed (newest first
// within), then archived last. Returns a new array.
export function sortLeagues(leagues) {
  return [...leagues].sort((a, b) => {
    const sa = STATUS_ORDER[a.status || "open"] ?? 1;
    const sb = STATUS_ORDER[b.status || "open"] ?? 1;
    if (sa !== sb) return sa - sb;
    // Within the same status, newest first
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

// For commissioners viewing a ladder league, build placeholder week stubs
// for any weeks not yet generated, so the schedule UI shows the full season.
// Round-Robin leagues already contain all weeks from generation.
// Stored placeholders (from commissioner editing date/time before generation)
// are kept as-is.
export function buildDisplayWeeks(league, schedule) {
  const real = (schedule?.weeks || []);
  const totalWeeks = league.weeks || 0;
  // Index existing weeks by number (covers both real generated weeks and stored placeholders)
  const existing = {};
  real.forEach(w => { existing[w.week] = w; });
  const startDate = league.startDate;
  const out = [];
  for (let n = 1; n <= totalWeeks; n++) {
    if (existing[n]) {
      out.push(existing[n]);
      continue;
    }
    // Synthesize a placeholder using the previous week's date if possible
    let dateStr;
    const prev = out[out.length - 1];
    if (prev?.date) {
      const d = new Date(prev.date);
      d.setDate(d.getDate() + 7);
      dateStr = d.toISOString().split("T")[0];
    } else if (startDate) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + (n - 1) * 7);
      dateStr = d.toISOString().split("T")[0];
    } else {
      dateStr = "";
    }
    out.push({ week: n, date: dateStr, time: null, courts: [], placeholder: true });
  }
  return out;
}

// Detect mobile viewport (< 640px). Updates live on resize/orientation change.
export function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < breakpoint
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [breakpoint]);
  return isMobile;
}
