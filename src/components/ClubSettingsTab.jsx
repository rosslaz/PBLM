import { useEffect, useState } from "react";
import { S } from "../styles.js";
import { SPACE, CSC } from "../lib/constants.js";

// ─── Club settings tab (Phase 4 / v1.3.0) ──────────────────────────────────
// Session 1: rename only.
// Session 2 will add regenerate-code, transfer-ownership, and delete-club
// sections to this same tab.
//
// Permission model:
//   - Rename: any admin (or the owner).
//   - Regenerate code: any admin (Session 2).
//   - Transfer ownership: only the owner (Session 2).
//   - Delete club: only the owner (Session 2).
//
// The UI gates by `isAdmin` / `isOwner` props; the DB-layer functions
// don't enforce these (consistent with how league/player admin actions
// work today). If/when we add a real auth backend, those gates move
// server-side.
//
// Props:
//   club:    the active club's data object (must be present)
//   isAdmin: bool — current user is an admin (or owner) of this club
//   isOwner: bool — current user is the owner of this club
//   onRename(newName): wired in App.jsx to dbUpdateClub
export function ClubSettingsTab({ club, isAdmin, isOwner, onRename }) {
  if (!club) {
    return (
      <div style={S.section}>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          No active club selected.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    // Defensive: this tab shouldn't be reachable without admin access in
    // the first place, since the admin panel is itself admin-gated. But
    // future routing changes could surface it; show a friendly message
    // rather than rendering forms that the user can't actually submit.
    return (
      <div style={S.section}>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          You don't have admin access to this club.
        </p>
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: SPACE.sm }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Club Settings</h2>
      </div>
      <p style={{ margin: `0 0 ${SPACE.lg}px`, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Manage <b>{club.name}</b>'s public details. More options (regenerate join code, transfer ownership, delete club) are coming soon.
      </p>

      <RenameSection club={club} onRename={onRename} />
    </div>
  );
}

function RenameSection({ club, onRename }) {
  // Local form state. Reset whenever the club's name changes from
  // elsewhere (another tab, another device) — this is rare but possible
  // since the parent re-renders on every DB reload.
  const [draftName, setDraftName] = useState(club.name || "");
  const [error, setError] = useState("");
  useEffect(() => { setDraftName(club.name || ""); }, [club.name]);

  const trimmed = draftName.trim();
  const isDirty = trimmed !== (club.name || "").trim();
  const isValid = trimmed.length >= 2 && trimmed.length <= 60;

  function handleSave() {
    if (!isValid) {
      if (trimmed.length < 2) setError("Club name must be at least 2 characters.");
      else if (trimmed.length > 60) setError("Club name should be 60 characters or less.");
      return;
    }
    if (!isDirty) return;
    setError("");
    onRename(trimmed);
  }

  return (
    <div style={{ ...S.card, padding: `${SPACE.lg}px ${SPACE.lg}px`, marginBottom: SPACE.lg }}>
      <div style={{ marginBottom: SPACE.sm }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Rename
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          This name is what players see when they open the app. Renaming doesn't change your join code or affect anyone's access.
        </p>
      </div>
      <label style={S.label}>Club name</label>
      <div style={{ display: "flex", gap: SPACE.sm }}>
        <input
          style={{ ...S.input, flex: 1 }}
          type="text"
          value={draftName}
          onChange={e => { setDraftName(e.target.value); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
        />
        <button
          style={{ ...S.btn("primary"), background: CSC.blue, opacity: (isDirty && isValid) ? 1 : 0.5 }}
          disabled={!isDirty || !isValid}
          onClick={handleSave}>
          Save
        </button>
      </div>
      {error && (
        <p style={{ margin: `${SPACE.sm}px 0 0`, padding: `${SPACE.sm}px ${SPACE.md}px`, background: "#FCEBEB", color: "#A32D2D", borderRadius: 6, fontSize: 13 }}>
          {error}
        </p>
      )}
    </div>
  );
}
