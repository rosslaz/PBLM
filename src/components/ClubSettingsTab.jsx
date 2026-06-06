import { useEffect, useState } from "react";
import { S } from "../styles.js";
import { SPACE, CSC } from "../lib/constants.js";

// ─── Club settings tab (Phase 4 / v1.3.0 + v1.4.0) ──────────────────────────
// v1.3.0 Session 1: rename only.
// v1.4.0 Session 2: + regenerate join code, transfer ownership, delete club.
//
// Permission model:
//   - Rename:            any admin (or the owner).
//   - Regenerate code:   any admin (or the owner).
//   - Transfer ownership: only the owner.
//   - Delete club:       only the owner.
//
// The UI gates by `isAdmin` / `isOwner` props; the DB-layer functions
// don't enforce these (consistent with how league/player admin actions
// work today). If/when we add a real auth backend, those gates move
// server-side.
//
// Props:
//   club:                    the active club's data object (must be present)
//   isAdmin:                 bool — current user is an admin (or owner)
//   isOwner:                 bool — current user is the owner
//   onRename(newName):       wired in App.jsx to dbUpdateClub
//   onRegenerateRequest():   opens the regenerate-code confirmation modal
//   onTransferRequest(email): opens the transfer-ownership confirmation modal
//   onDeleteRequest():       opens the delete-club confirmation modal
export function ClubSettingsTab({
  club, isAdmin, isOwner,
  onRename,
  onRegenerateRequest,
  onTransferRequest,
  onDeleteRequest,
}) {
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
        Manage <b>{club.name}</b>'s public details, access, and ownership.
      </p>

      <RenameSection club={club} onRename={onRename} />
      <RegenerateCodeSection club={club} onRequest={onRegenerateRequest} />
      {/* Transfer + Delete are owner-only. We render placeholders when the
          current user isn't the owner so it's clear those options exist
          and where to look for them, without showing the actual UI. */}
      {isOwner ? (
        <TransferOwnershipSection club={club} onRequest={onTransferRequest} />
      ) : (
        <OwnerOnlyPlaceholder
          label="Transfer ownership"
          message="Only the club owner can transfer ownership." />
      )}
      {isOwner ? (
        <DeleteClubSection club={club} onRequest={onDeleteRequest} />
      ) : (
        <OwnerOnlyPlaceholder
          label="Delete club"
          message="Only the club owner can delete the club." />
      )}
    </div>
  );
}

// ─── Rename ───────────────────────────────────────────────────────────────
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

// ─── Regenerate Join Code ──────────────────────────────────────────────────
function RegenerateCodeSection({ club, onRequest }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!club.joinCode) return;
    navigator.clipboard.writeText(club.joinCode).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {/* clipboard might be blocked on insecure contexts; silently noop */}
    );
  }

  return (
    <div style={{ ...S.card, padding: `${SPACE.lg}px ${SPACE.lg}px`, marginBottom: SPACE.lg }}>
      <div style={{ marginBottom: SPACE.sm }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Join code
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          Share this code so new players can join your club. Regenerating creates a fresh code and immediately invalidates the old one.
        </p>
      </div>
      <div style={{ display: "flex", gap: SPACE.sm, alignItems: "center", marginBottom: SPACE.sm }}>
        <code style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 16, fontWeight: 700, letterSpacing: "1px",
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          background: CSC.blueLight, color: CSC.blueDark,
          borderRadius: 8, flex: 1,
          // Long codes shouldn't break the layout
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {club.joinCode || "—"}
        </code>
        <button
          style={{ ...S.btnSm("secondary"), padding: `${SPACE.sm}px ${SPACE.md}px`, fontSize: 12 }}
          disabled={!club.joinCode}
          onClick={copy}
          title="Copy join code to clipboard">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          style={{ ...S.btnSm("secondary"), color: "#854F0B", borderColor: "#854F0B", fontSize: 12 }}
          onClick={onRequest}>
          Regenerate code
        </button>
      </div>
    </div>
  );
}

// ─── Transfer Ownership ────────────────────────────────────────────────────
function TransferOwnershipSection({ club, onRequest }) {
  const admins = (club.adminEmails || []).filter(Boolean);
  // Email of the admin selected to receive ownership. Reset whenever the
  // admin list changes (e.g. someone got removed from another tab).
  const [selected, setSelected] = useState(admins[0] || "");
  useEffect(() => {
    if (!selected || !admins.includes(selected)) {
      setSelected(admins[0] || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.adminEmails?.join(",")]);

  const canTransfer = admins.length > 0 && selected;

  return (
    <div style={{ ...S.card, padding: `${SPACE.lg}px ${SPACE.lg}px`, marginBottom: SPACE.lg }}>
      <div style={{ marginBottom: SPACE.sm }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Transfer ownership
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          Hand the club over to one of its current admins. You'll keep admin access but lose the ability to remove other admins, transfer ownership, or delete the club. The new owner can transfer it back if needed.
        </p>
      </div>
      {admins.length === 0 ? (
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.md}px`, marginTop: SPACE.sm,
          background: "var(--color-background-secondary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 8, fontSize: 13, color: "var(--color-text-secondary)",
        }}>
          No admins to transfer to. Add an admin in the Commissioners tab first.
        </div>
      ) : (
        <>
          <label style={S.label}>Transfer to</label>
          <div style={{ display: "flex", gap: SPACE.sm }}>
            <select
              style={{ ...S.input, flex: 1 }}
              value={selected}
              onChange={e => setSelected(e.target.value)}>
              {admins.map(email => (
                <option key={email} value={email}>{email}</option>
              ))}
            </select>
            <button
              style={{ ...S.btn("primary"), background: "#854F0B", opacity: canTransfer ? 1 : 0.5 }}
              disabled={!canTransfer}
              onClick={() => onRequest(selected)}>
              Transfer
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Delete Club ───────────────────────────────────────────────────────────
function DeleteClubSection({ club, onRequest }) {
  return (
    <div style={{
      ...S.card,
      padding: `${SPACE.lg}px ${SPACE.lg}px`,
      marginBottom: SPACE.lg,
      borderLeft: "4px solid #A32D2D",
      background: "var(--color-background-primary)",
    }}>
      <div style={{ marginBottom: SPACE.sm }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#A32D2D", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Danger zone
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          Delete <b>{club.name}</b> and everything in it — leagues, schedules, scores, registrations, and memberships. Player accounts themselves are preserved (they may belong to other clubs).
        </p>
        <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
          The club moves to the trash for 30 days first, then is permanently deleted. <b>Restore is not available in-app</b> — if you change your mind during the 30-day window, contact support.
        </p>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          style={{ ...S.btn("primary"), background: "#A32D2D" }}
          onClick={onRequest}>
          Delete club
        </button>
      </div>
    </div>
  );
}

// ─── Placeholder for owner-only sections (shown to admins) ─────────────────
function OwnerOnlyPlaceholder({ label, message }) {
  return (
    <div style={{
      ...S.card,
      padding: `${SPACE.lg}px ${SPACE.lg}px`,
      marginBottom: SPACE.lg,
      opacity: 0.7,
    }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </p>
      <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12, color: "var(--color-text-secondary)" }}>
        {message}
      </p>
    </div>
  );
}
