import { useState } from "react";
import { S } from "../styles.js";
import { SPACE, CSC } from "../lib/constants.js";
import { findClubByCode, normalizeJoinCode } from "../lib/clubs.js";
import { PlayerForm } from "./PlayerForm.jsx";

// ─── Join-with-Code modal (Phase 3 / v1.2.0) ───────────────────────────────
// Multi-step:
//   1. Enter code → look up in db.clubs
//   2. Show "Join {Club}?" with confirmation
//   3. Email check — if it matches an existing live player, treat as a
//      "sign in + add membership" flow (just one button). Otherwise, show
//      the PlayerForm to create a new account.
//
// The parent App.jsx handles the actual writes through onSubmit(payload).
// Payloads:
//   { kind: "existing", clubId, player }            — log in existing player + add membership
//   { kind: "new",      clubId, playerData }        — create new player + add membership
//
// Props:
//   db                      — read-only access to clubs/players for lookup
//   onSubmit(payload)       — fires after final confirmation
//   onCancel                — close the modal
export function JoinClubModal({ db, onSubmit, onCancel }) {
  // Steps: "code" → "confirm" → "email" → "create" (if email is new)
  const [step, setStep] = useState("code");
  const [codeInput, setCodeInput] = useState("");
  const [foundClub, setFoundClub] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [matchedPlayer, setMatchedPlayer] = useState(null);
  const [error, setError] = useState("");

  function lookupCode() {
    const club = findClubByCode(db.clubs || {}, codeInput);
    if (!club) {
      setError("That code doesn't match any club. Double-check with the person who shared it.");
      return;
    }
    setError("");
    setFoundClub(club);
    setStep("confirm");
  }

  function checkEmail() {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    const existing = Object.values(db.players || {}).find(p =>
      p.email?.toLowerCase() === trimmed && !p.deletedAt
    );
    if (existing) {
      // Already a member of this club? Just confirm and proceed — the
      // upsert will be a no-op and they'll log in cleanly.
      setMatchedPlayer(existing);
      // Skip straight to submit-existing — there's nothing else to ask.
      onSubmit({ kind: "existing", clubId: foundClub.id, player: existing });
      return;
    }
    // New email → collect player info
    setStep("create");
  }

  // ─ Step 1: enter code ────────────────────────────────────────────────
  if (step === "code") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
          Enter the join code your club shared with you. Codes look like <code>CSC-2026-2Q2H</code>.
        </p>
        <div>
          <label style={S.label}>Join code</label>
          <input
            style={{ ...S.input, fontFamily: "monospace", letterSpacing: "0.5px", textTransform: "uppercase" }}
            type="text"
            placeholder="ABC-2026-1234"
            value={codeInput}
            onChange={e => { setCodeInput(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") lookupCode(); }}
            autoFocus
          />
          <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Capitalization, spaces, and dashes don't matter.
          </p>
        </div>
        {error && (
          <p style={{ margin: 0, padding: `${SPACE.sm}px ${SPACE.md}px`, background: "#FCEBEB", color: "#A32D2D", borderRadius: 6, fontSize: 13 }}>
            {error}
          </p>
        )}
        <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm }}>
          <button style={S.btn("secondary")} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...S.btn("primary"), opacity: normalizeJoinCode(codeInput) ? 1 : 0.5 }}
            disabled={!normalizeJoinCode(codeInput)}
            onClick={lookupCode}>
            Look up code
          </button>
        </div>
      </div>
    );
  }

  // ─ Step 2: confirm club ──────────────────────────────────────────────
  if (step === "confirm" && foundClub) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <div style={{
          padding: `${SPACE.lg}px ${SPACE.lg}px`,
          background: CSC.blueLight, color: CSC.blueDark,
          borderRadius: 8, textAlign: "center",
        }}>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>You're joining</p>
          <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 20, fontWeight: 700 }}>
            {foundClub.name}
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          You'll be added as a player. The club's commissioner will see you on their roster and can add you to leagues.
        </p>
        <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm }}>
          <button style={S.btn("secondary")} onClick={() => setStep("code")}>← Back</button>
          <button style={S.btn("primary")} onClick={() => setStep("email")}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ─ Step 3: enter email (to detect existing vs new) ──────────────────
  if (step === "email" && foundClub) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          background: CSC.blueLight, color: CSC.blueDark,
          borderRadius: 8, fontSize: 12,
        }}>
          Joining <b>{foundClub.name}</b>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text-secondary)" }}>
          What's your email? We'll check if you already have an account.
        </p>
        <div>
          <label style={S.label}>Email *</label>
          <input
            style={S.input}
            type="email"
            placeholder="you@email.com"
            value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") checkEmail(); }}
            autoFocus
          />
        </div>
        {error && (
          <p style={{ margin: 0, padding: `${SPACE.sm}px ${SPACE.md}px`, background: "#FCEBEB", color: "#A32D2D", borderRadius: 6, fontSize: 13 }}>
            {error}
          </p>
        )}
        <div style={{ ...S.row, justifyContent: "flex-end", gap: SPACE.sm }}>
          <button style={S.btn("secondary")} onClick={() => setStep("confirm")}>← Back</button>
          <button style={S.btn("primary")} onClick={checkEmail}>Continue</button>
        </div>
      </div>
    );
  }

  // ─ Step 4: create new player ─────────────────────────────────────────
  if (step === "create" && foundClub) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          background: CSC.blueLight, color: CSC.blueDark,
          borderRadius: 8, fontSize: 12,
        }}>
          New account · Joining <b>{foundClub.name}</b>
        </div>
        <PlayerForm
          initial={{ email: emailInput }}
          onSubmit={(playerData) => onSubmit({ kind: "new", clubId: foundClub.id, playerData })}
          onCancel={() => setStep("email")}
        />
      </div>
    );
  }

  return null;
}
