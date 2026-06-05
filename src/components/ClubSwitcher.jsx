import { useEffect, useRef, useState } from "react";
import { SPACE } from "../lib/constants.js";

// ─── Club switcher (Phase 4 / v1.3.0) ──────────────────────────────────────
// Header-mounted dropdown. Renders the active club's name as the page title;
// if the user belongs to multiple clubs, a chevron is shown and clicking
// opens a menu of all their accessible clubs.
//
// Single-club users see this as plain text — no interactivity, no chevron.
// Most CSC players will fall in this bucket and won't notice it exists,
// which is exactly the point.
//
// Props:
//   clubs:        array of club records the user can access. For an admin
//                 session, this is owner+admin clubs; for a player session,
//                 it's their membership clubs. The parent computes which.
//   activeClubId: which club is currently in focus. Highlighted in the menu.
//   onSwitch:     called with a clubId when the user picks a different club.
//                 Same id as active = noop (the menu just closes).
//   subtitle:     optional small text under the club name (e.g. "Playing
//                 as Jane Smith" in the player view).
//   color:        chevron color, defaults to white since the switcher
//                 always renders inside the colored header.
export function ClubSwitcher({ clubs, activeClubId, onSwitch, subtitle, color }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Click-outside-to-close. We bind to mousedown, not click, so the menu
  // closes before any click-target inside the page re-renders — avoids the
  // "menu blinks open then closed" pattern when the menu trigger itself
  // re-renders during state updates.
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape-to-close for keyboard users.
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const activeClub = clubs.find(c => c.id === activeClubId);
  const activeName = activeClub?.name || "Select a club";
  const hasMultiple = clubs.length > 1;

  // Non-interactive title for single-club users. Returns just the heading
  // styled the same as the trigger would be — no button, no chevron, no
  // pointer cursor. Subtitle still renders if provided.
  if (!hasMultiple) {
    return (
      <div>
        <h1 style={titleStyle}>{activeName}</h1>
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      </div>
    );
  }

  function pick(clubId) {
    setOpen(false);
    if (clubId !== activeClubId) onSwitch(clubId);
  }

  // The chevron color defaults to white because the switcher always sits
  // inside the colored page header. Override via prop if that ever changes.
  const chevronColor = color || "#fff";

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch club. Currently: ${activeName}`}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "inherit",
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: SPACE.xs,
        }}>
        <div>
          <h1 style={titleStyle}>
            {activeName}
            <span style={{
              marginLeft: SPACE.xs,
              fontSize: 14,
              opacity: 0.8,
              display: "inline-block",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
              color: chevronColor,
            }}>▾</span>
          </h1>
          {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
        </div>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: SPACE.sm,
            background: "var(--color-background-primary)",
            color: "var(--color-text-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            minWidth: 220,
            maxWidth: 320,
            zIndex: 200,
            overflow: "hidden",
          }}>
          <p style={{
            margin: 0,
            padding: `${SPACE.sm}px ${SPACE.md}px`,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--color-text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
          }}>
            Switch club
          </p>
          {clubs.map(club => {
            const isActive = club.id === activeClubId;
            return (
              <button
                key={club.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => pick(club.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: SPACE.sm,
                  padding: `${SPACE.md}px ${SPACE.md}px`,
                  background: isActive ? "var(--color-background-secondary)" : "transparent",
                  border: "none",
                  borderTop: "0.5px solid var(--color-border-tertiary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  color: "var(--color-text-primary)",
                  textAlign: "left",
                }}>
                <span style={{
                  fontWeight: isActive ? 700 : 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}>
                  {club.name}
                </span>
                {isActive && <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const titleStyle = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.3px",
  lineHeight: 1.2,
};

const subtitleStyle = {
  margin: "2px 0 0",
  fontSize: 12,
  opacity: 0.75,
};
