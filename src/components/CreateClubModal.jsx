import { useState } from "react";
import { S } from "../styles.js";
import { SPACE, CSC } from "../lib/constants.js";
import { findClubByCode, normalizeJoinCode } from "../lib/clubs.js";
import { PlayerForm } from "./PlayerForm.jsx";

// Does this text look like a join code rather than a club name?
//
// Real case that motivated this (v1.8.0): a player was emailed CSC's join
// code, opened the app, tapped "Create a club", and pasted the code into the
// club-name field. He ended up alone in an empty club named "CSC-2026-2Q2H"
// while the club he meant to join carried on without him. Nothing in the app
// noticed, and he had no way to tell what went wrong.
//
// Two levels of confidence:
//   exact  — the text matches a real club's join code. We know for certain
//            what they meant and can name the club.
//   shape  — it merely looks like a code (PREFIX-YEAR-SUFFIX). Could be a
//            genuine name, so we phrase it as a question, not a correction.
function detectJoinCode(text, clubs) {
  const raw = (text || "").trim();
  if (!raw) return null;

  // Exact: does it resolve to an actual club?
  const match = findClubByCode(clubs || {}, raw);
  if (match) return { kind: "exact", club: match };

  // Shape: 3 letters/digits, a 4-digit year, then a 4-char suffix, in any
  // capitalization and with or without the dashes (normalizeJoinCode strips
  // them, so we test the normalized form and let the year anchor it).
  const normalized = normalizeJoinCode(raw);
  if (/^[A-Z0-9]{3}(19|20)\d{2}[A-Z0-9]{4}$/.test(normalized)) {
    return { kind: "shape" };
  }
  return null;
}

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
//   db       — read-only; used to recognize a pasted join code
//   onSubmit({ clubName, playerData }) — fires only after both steps pass
//   onSwitchToJoin — hands off to the join-with-code flow, carrying the
//                    code the user already typed so they don't retype it
//   onCancel — closes the modal
export function CreateClubModal({ db, onSubmit, onSwitchToJoin, onCancel }) {
  const [step, setStep] = useState(1);
  const [clubName, setClubName] = useState("");
  const [error, setError] = useState("");

  const codeDetection = detectJoinCode(clubName, db?.clubs);

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

        {/* Join-code nudge. Placed before the error so it reads as the more
            urgent signal — if this is firing, the name validation is beside
            the point. Non-blocking: creating a club with this name is still
            allowed, because we can't be certain and locking someone out of a
            legitimate name would be worse than the mistake we're preventing. */}
        {codeDetection && (
          <div style={{
            padding: `${SPACE.md}px ${SPACE.md}px`,
            background: "#FAEEDA",
            border: "0.5px solid #ECC580",
            borderRadius: 8,
            color: "#854F0B",
          }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              {codeDetection.kind === "exact"
                ? `That's the join code for ${codeDetection.club.name}.`
                : "That looks like a join code, not a club name."}
            </p>
            <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, lineHeight: 1.45 }}>
              {codeDetection.kind === "exact"
                ? `If you were given this code, you want to join ${codeDetection.club.name} — not create a new club. Creating one here would leave you on your own with an empty roster.`
                : "Join codes look like ABC-2026-1234. If someone sent you one, you want to join their club rather than create a new one."}
            </p>
            {onSwitchToJoin && (
              <button
                type="button"
                onClick={() => onSwitchToJoin(clubName.trim())}
                style={{
                  ...S.btnSm("primary", "#854F0B"),
                  marginTop: SPACE.sm,
                }}>
                {codeDetection.kind === "exact"
                  ? `Join ${codeDetection.club.name} instead`
                  : "Join a club with a code instead"}
              </button>
            )}
          </div>
        )}
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
