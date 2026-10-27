import { COLORS, SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";
import { EmptyState } from "./ui.jsx";

// ─── Partners matrix ────────────────────────────────────────────────────────
// Who has partnered with whom, and how often. Built for D+D Weekly Partners,
// where the whole point of the format is that every pair partners exactly
// twice across the season — so a grid of counts is the natural way to see
// where you are.
//
// WHICH WEEKS COUNT. D+D generates all 14 weeks up front, so counting the
// whole schedule would show every pair at 2 from day one and tell you
// nothing. Only weeks that have actually happened count: every locked week,
// plus the current one (the first still unlocked). Future weeks are excluded.
//
// The current week's pairings are highlighted rather than hidden, because
// "who am I with this week" is the question most people open this for. A pair
// can be both highlighted and on 2 — together again this week, for the
// second and final time.

// Every distinct partnership in one week, as sorted "a|b" keys.
//
// Deduped with a Set because the same pair appears many times across a week's
// matches: two games per matchup, and each team plays in both rounds. Reading
// teams off the matches rather than off court.players keeps this correct for
// any doubles format, not just D+D's fixed template.
function weekPartnerships(week) {
  const pairs = new Set();
  (week?.courts || []).forEach(ct => (ct.matches || []).forEach(m => {
    if (m.format !== "doubles") return;
    [m.team1, m.team2].forEach(team => {
      if (!Array.isArray(team) || team.length !== 2) return;
      pairs.add([...team].sort().join("|"));
    });
  }));
  return pairs;
}

const pairKey = (a, b) => [a, b].sort().join("|");

// Column headers use initials rather than numbers, so a square can be read
// without counting across to a key.
//
// Built from the already-formatted display name ("Ross L." -> "RL") so it
// follows whatever naming convention the rest of the app uses. Initials can
// collide with eight players, so any duplicates get a trailing index - the
// full name is still on the row label and in each cell's tooltip, making the
// header a pointer rather than the only identification.
function buildInitials(ids, getPlayerName) {
  const raw = ids.map(id => {
    const parts = String(getPlayerName(id) || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
  });
  const seen = {};
  raw.forEach(v => { seen[v] = (seen[v] || 0) + 1; });
  const used = {};
  return raw.map(v => {
    if (seen[v] === 1) return v;
    used[v] = (used[v] || 0) + 1;
    return `${v}${used[v]}`;
  });
}

export function PartnersMatrix({ playerIds, weeks, isWeekLocked, getPlayerName, color, myId }) {
  const c = color || COLORS.csc;
  const isMobile = useIsMobile();

  const realWeeks = (weeks || []).filter(w => !w.placeholder && (w.courts || []).length > 0);

  // The current week is the first one still unlocked. Once every week is
  // locked the season is over and nothing is "current".
  const currentWeek = realWeeks.find(w => !isWeekLocked(w.week)) || null;

  // Count only weeks that have happened: locked, plus the current one.
  const counts = {};            // pairKey -> times partnered
  const thisWeek = new Set();   // pairKey -> partnered in the current week
  let countedWeeks = 0;

  realWeeks.forEach(w => {
    const locked = isWeekLocked(w.week);
    const isCurrent = currentWeek && w.week === currentWeek.week;
    if (!locked && !isCurrent) return;   // future week - hasn't happened yet
    countedWeeks++;
    weekPartnerships(w).forEach(k => {
      counts[k] = (counts[k] || 0) + 1;
      if (isCurrent) thisWeek.add(k);
    });
  });

  if (playerIds.length === 0 || realWeeks.length === 0) {
    return <EmptyState msg="Partner history appears once the schedule is generated." />;
  }

  // Stable display order so the grid doesn't reshuffle between renders.
  const ordered = [...playerIds].sort((a, b) => getPlayerName(a).localeCompare(getPlayerName(b)));

  // How much of the season's pairing space has been used. For D+D every pair
  // should reach exactly 2 by week 14, so this doubles as a progress check.
  const totalPairs = (ordered.length * (ordered.length - 1)) / 2;
  let metOnce = 0, metTwice = 0;
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const n = counts[pairKey(ordered[i], ordered[j])] || 0;
      if (n === 1) metOnce++;
      else if (n >= 2) metTwice++;
    }
  }
  const neverMet = totalPairs - metOnce - metTwice;
  const initials = buildInitials(ordered, getPlayerName);

  // Cell styling. Hardcoded colour pairs rather than a fixed background with
  // theme-variable text - that combination is exactly what produced the
  // dark-mode contrast failures fixed in v1.10.0.
  function cellStyle(n, isCurrent, isSelf) {
    const base = {
      padding: isMobile ? "7px 0" : "9px 0",
      textAlign: "center",
      fontSize: isMobile ? 12 : 13,
      borderTop: "0.5px solid var(--color-border-tertiary)",
      borderLeft: "0.5px solid var(--color-border-tertiary)",
    };
    if (isSelf) {
      return { ...base, background: "var(--color-background-tertiary)", color: "var(--color-text-tertiary)" };
    }
    if (isCurrent) {
      // Playing together right now - the thing most people open this for.
      return { ...base, background: "#FAEEDA", color: "#854F0B", fontWeight: 700 };
    }
    if (n >= 2) {
      return { ...base, background: "#EAF3DE", color: "#3B6D11", fontWeight: 700 };
    }
    if (n === 1) {
      return { ...base, color: "var(--color-text-primary)", fontWeight: 600 };
    }
    return { ...base, color: "var(--color-text-tertiary)" };
  }

  const headCell = {
    padding: isMobile ? "6px 0" : "8px 0",
    textAlign: "center",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--color-text-secondary)",
    borderLeft: "0.5px solid var(--color-border-tertiary)",
  };

  return (
    <div>
      {/* What's being counted. Without this the grid looks wrong to anyone
          who knows the full 14-week schedule already exists. */}
      <div style={{
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--color-text-secondary)",
        marginBottom: SPACE.md,
        lineHeight: 1.5,
      }}>
        <b style={{ color: "var(--color-text-primary)" }}>
          Through {countedWeeks} week{countedWeeks !== 1 ? "s" : ""}
          {currentWeek ? ` (Week ${currentWeek.week} in progress)` : ""}.
        </b>{" "}
        Weeks that haven&apos;t been played yet aren&apos;t counted. In this format every pair partners exactly twice by the end of the season.
        <div style={{ marginTop: SPACE.xs }}>
          {metTwice} pair{metTwice !== 1 ? "s" : ""} done · {metOnce} once · {neverMet} not yet
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.md, marginBottom: SPACE.sm, fontSize: 11 }}>
        <LegendSwatch bg="#FAEEDA" fg="#854F0B" label="This week" />
        <LegendSwatch bg="#EAF3DE" fg="#3B6D11" label="Partnered twice" />
        <LegendSwatch bg="transparent" label="Not yet" border />
      </div>

      {/* The grid. Columns are numbered rather than named - eight name
          columns can't fit on a phone, and the numbers key off the row
          labels immediately to their left. */}
      <div style={{ overflowX: "auto", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
        <table className="tabular-nums" style={{ borderCollapse: "collapse", width: "100%", minWidth: isMobile ? 340 : 420, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: isMobile ? 116 : 180 }} />
            {ordered.map(id => <col key={id} />)}
          </colgroup>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              <th style={{ padding: isMobile ? "6px 8px" : "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Player
              </th>
              {ordered.map((id, i) => (
                <th key={id} style={headCell} title={getPlayerName(id)}>{initials[i]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((rowId, ri) => {
              const isMyRow = myId && rowId === myId;
              return (
                <tr key={rowId} style={{ background: isMyRow ? c.light : "transparent" }}>
                  <td style={{
                    padding: isMobile ? "7px 8px" : "9px 12px",
                    fontSize: isMobile ? 12 : 13,
                    borderTop: "0.5px solid var(--color-border-tertiary)",
                    color: isMyRow ? c.bg : "var(--color-text-primary)",
                    fontWeight: isMyRow ? 700 : 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    <span style={{ color: "var(--color-text-tertiary)", marginRight: 6, fontSize: 11 }}>{initials[ri]}</span>
                    {getPlayerName(rowId)}
                  </td>
                  {ordered.map(colId => {
                    const isSelf = rowId === colId;
                    const k = pairKey(rowId, colId);
                    const n = counts[k] || 0;
                    const isCurrent = !isSelf && thisWeek.has(k);
                    return (
                      <td
                        key={colId}
                        style={cellStyle(n, isCurrent, isSelf)}
                        title={isSelf
                          ? undefined
                          : `${getPlayerName(rowId)} + ${getPlayerName(colId)} — ${n} time${n !== 1 ? "s" : ""}${isCurrent ? " (together this week)" : ""}`}>
                        {isSelf ? "–" : n}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: SPACE.sm }}>
        Column initials match the row labels. Hover or tap a square for the full pairing.
      </p>
    </div>
  );
}

function LegendSwatch({ bg, fg, label, border }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3,
        background: bg,
        border: border ? "1px solid var(--color-border-secondary)" : "none",
        display: "inline-block",
        flexShrink: 0,
      }} />
      <span style={{ color: fg || "var(--color-text-secondary)" }}>{label}</span>
    </span>
  );
}
