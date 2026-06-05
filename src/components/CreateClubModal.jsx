import { useState } from "react";
import { S } from "../styles.js";
import { SPACE, CSC } from "../lib/constants.js";
import { PlayerForm } from "./PlayerForm.jsx";

// ─── Create-a-Club modal (Phase 3 / v1.2.0) ────────────────────────────────
// Two-step flow:
//   Step 1: club name. Easy commitment — "just name your club."
//   Step 2: owner info (PlayerForm). The user filling this out becomes the
//           club's first owner + automatically a member.
//
// On submit, the parent App.jsx orchestrates the three writes (player,
// club, membership) and logs the new owner in to their new club.
//
// Props:
//   onSubmit({ clubName, playerData }) — fires only after both steps pass
//   onCancel — closes the modal
export function CreateClubModal({ onSubmit, onCancel }) {
  const [step, setStep] = useState(1);
  const [clubName, setClubName] = useState("");
  const [error, setError] = useState("");

  function next() {
    const trimmed = clubName.trim();
    if (!trimmed) {
      setError("Please give your club a name.");
      return;
    }
    if (trimmed.length < 2) {
      setError("Club name must be at least 2 characters.");
      return;
    }
    if (trimmed.length > 60) {
      setError("Club name should be 60 characters or less.");
      return;
    }
    setError("");
    setStep(2);
  }

  if (step === 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          background: CSC.blueLight, color: CSC.blueDark,
          borderRadius: 8, fontSize: 12,
        }}>
          Step 1 of 2 · Name your club
        </div>
        <div>
          <label style={S.label}>Club Name *</label>
          <input
            style={S.input}
            type="text"
            placeholder="e.g. Birmingham Tennis Club"
            value={clubName}
            onChange={e => { setClubName(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") next(); }}
            autoFocus
          />
          <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
            This is what your members will see when they open the app.
          </p>
        </div>
        {error && (
          <p style={{ margin: 0, padding: `${SPACE.sm}px ${SPACE.md}px`, background: "#FCEBEB", color: "#A32D2D", borderRadius: 6, fontSize: 13 }}>
            {error}
          </p>
        )}
        <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm, marginTop: SPACE.xs }}>
          <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
          <button style={S.btn("primary")} onClick={next}>Next →</button>
        </div>
      </div>
    );
  }

  // Step 2: owner info
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
      <div style={{
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        background: CSC.blueLight, color: CSC.blueDark,
        borderRadius: 8, fontSize: 12,
      }}>
        Step 2 of 2 · Tell us about yourself
        <span style={{ marginLeft: SPACE.sm, opacity: 0.75 }}>
          You'll be the owner of <b>{clubName.trim()}</b>.
        </span>
      </div>
      <PlayerForm
        onSubmit={(playerData) => onSubmit({ clubName: clubName.trim(), playerData })}
        onCancel={() => setStep(1)}
      />
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>
        ← <button
          type="button"
          onClick={() => setStep(1)}
          style={{ background: "none", border: "none", padding: 0, color: "var(--color-text-secondary)", fontFamily: "inherit", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
          Back to club name
        </button>
      </p>
    </div>
  );
}
