import { useState, useEffect } from "react";
import { S } from "../styles.js";
import { CHECKIN_OPTS } from "../lib/constants.js";

// Compact row inside a week card showing the player's own check-in selector.
// Rendered as a single-row segmented control: four equal-width segments,
// joined visually, never wraps. Tapping the active segment clears the
// selection. The Sub variant reveals a name input below the control without
// reflowing the segments themselves.
//
// Below the segmented control, a small caption explains what each state
// means so a first-time player doesn't have to guess.

// Caption text per status. The unset state still gets a caption to nudge
// the user toward selecting *something* — otherwise the row looks
// decorative rather than actionable.
const CAPTIONS = {
  null:  "Tap to let your court know if you're playing.",
  in:    "✓ You're confirmed for this week.",
  maybe: "? Heads-up to the commissioner — your spot stays held.",
  sub:   "↔ Your court spot will be filled by your sub.",
  out:   "✗ You'll be removed from this week's courts.",
};

export function CheckInRow({ current, currentSubName, onSet, isLocked }) {
  const [subName, setSubName] = useState(currentSubName || "");
  // Keep local input in sync when the parent value changes (e.g. after reload)
  useEffect(() => { setSubName(currentSubName || ""); }, [currentSubName]);

  function handleClick(opt) {
    const active = current === opt.key;
    if (active) {
      // Tap the active option to clear
      onSet(null);
      if (opt.key === "sub") setSubName("");
      return;
    }
    if (opt.key === "sub") {
      onSet("sub", subName);
    } else {
      onSet(opt.key);
    }
  }

  function handleSubNameBlur() {
    if (current === "sub" && subName !== (currentSubName || "")) {
      onSet("sub", subName);
    }
  }

  return (
    <div style={{ margin: "12px 16px 0", padding: "12px 12px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600, marginBottom: 8 }}>
        Your availability
      </div>
      {/* Segmented control: equal-width segments, shared horizontal border. */}
      <div
        role="radiogroup"
        aria-label="Check-in status"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${CHECKIN_OPTS.length}, 1fr)`,
          border: "1px solid var(--color-border-secondary)",
          borderRadius: 8,
          overflow: "hidden",
          opacity: isLocked ? 0.5 : 1,
        }}
      >
        {CHECKIN_OPTS.map((opt, i) => {
          const active = current === opt.key;
          const isFirst = i === 0;
          // Each segment shares its right border with the next segment's left,
          // so we render the right border on every segment except the last.
          const isLast = i === CHECKIN_OPTS.length - 1;
          return (
            <button
              key={opt.key}
              role="radio"
              aria-checked={active}
              disabled={isLocked}
              onClick={() => handleClick(opt)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "8px 4px",
                fontSize: 13,
                fontWeight: 600,
                background: active ? opt.color : "var(--color-background-primary)",
                color: active ? "#fff" : opt.color,
                // The segmented look: only the right edge of each segment
                // (except the last) shows a divider line.
                border: "none",
                borderRight: isLast ? "none" : "1px solid var(--color-border-secondary)",
                cursor: isLocked ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                // Smooth transition on tap so the color change feels intentional
                transition: "background-color 120ms ease, color 120ms ease",
              }}
            >
              <span style={{ fontSize: 14 }}>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      {current === "sub" && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 600, whiteSpace: "nowrap" }}>
            Sub's name:
          </label>
          <input
            type="text"
            value={subName}
            onChange={e => setSubName(e.target.value)}
            onBlur={handleSubNameBlur}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            disabled={isLocked}
            placeholder="e.g. John Smith"
            style={{ ...S.input, flex: 1, padding: "6px 10px" }}
          />
        </div>
      )}
      {/* Status caption — tells a new player what each state actually does.
          Keyed by current status so it animates from one explanation to the
          next as the player makes selections. */}
      <p
        key={current || "none"}
        style={{
          margin: "8px 0 0",
          fontSize: 12,
          color: "var(--color-text-secondary)",
          lineHeight: 1.4,
        }}>
        {CAPTIONS[current] || CAPTIONS.null}
      </p>
    </div>
  );
}
