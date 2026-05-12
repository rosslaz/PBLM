import { useState, useEffect } from "react";
import { S } from "../styles.js";
import { CHECKIN_OPTS } from "../lib/constants.js";

// Compact row inside a week card showing the player's own check-in selector.
export function CheckInRow({ current, currentSubName, onSet, isLocked }) {
  const [subName, setSubName] = useState(currentSubName || "");
  // Keep local input in sync when the parent value changes (e.g. after reload)
  useEffect(() => { setSubName(currentSubName || ""); }, [currentSubName]);

  function handleClick(opt) {
    const active = current === opt.key;
    if (active) {
      // Clicking the active option clears it
      onSet(null);
      if (opt.key === "sub") setSubName("");
      return;
    }
    if (opt.key === "sub") {
      // Persist immediately with whatever name they've typed (can be empty)
      onSet("sub", subName);
    } else {
      onSet(opt.key);
    }
  }

  function handleSubNameBlur() {
    // Save the typed name when the field loses focus, but only if Sub is the active status
    if (current === "sub" && subName !== (currentSubName || "")) {
      onSet("sub", subName);
    }
  }

  return (
    <div style={{ margin: "12px 16px 0", padding: "8px 10px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>Your availability:</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {CHECKIN_OPTS.map(opt => {
            const active = current === opt.key;
            return (
              <button
                key={opt.key}
                disabled={isLocked}
                onClick={() => handleClick(opt)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${active ? opt.color : "var(--color-border-secondary)"}`,
                  background: active ? opt.color : opt.bg,
                  color: active ? "#fff" : opt.color,
                  borderRadius: 999, cursor: isLocked ? "not-allowed" : "pointer",
                  opacity: isLocked ? 0.5 : 1,
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 13 }}>{opt.icon}</span>
                {opt.label}
              </button>
            );
          })}
        </div>
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
            style={{ ...S.input, flex: 1, fontSize: 13, padding: "4px 8px" }}
          />
        </div>
      )}
    </div>
  );
}
