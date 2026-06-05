import { useState } from "react";
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";

// ─── Commissioner / club admins tab ────────────────────────────────────────
// Phase 2 / v1.1.0 — operates on the active club. The owner is shown at
// the top with a distinct "Owner" badge; additional admins follow.
//
// Permission model (per Ross's direction):
//   - Any admin (including the owner) can add new admins.
//   - Only the owner can remove admins. The owner cannot be removed from
//     this tab — that's the future "Transfer ownership" flow (Phase 4).
//
// Props:
//   - club: the active club's data object (with ownerEmail + adminEmails)
//   - currentAdminEmail: the logged-in admin's email (drives the "You" badge)
//   - isOwner: whether the logged-in admin owns this club (drives Remove buttons)
//   - isAdmin: whether the logged-in admin can add new admins (anyone with
//     access to this tab should already be true, but it's a defensive guard)
//   - onAdd(email), onRemove(email): wired in App.jsx to the club-scoped DB ops
export function AdminsTab({ club, currentAdminEmail, isOwner, isAdmin, onAdd, onRemove }) {
  const [newEmail, setNewEmail] = useState("");

  if (!club) {
    return (
      <div style={S.section}>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          No active club selected.
        </p>
      </div>
    );
  }

  const ownerEmail = club.ownerEmail || "";
  const adminEmails = club.adminEmails || [];
  const meLower = (currentAdminEmail || "").toLowerCase();

  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Commissioner Access</h2>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        These accounts can manage <b>{club.name || "this club"}</b>. The owner has full control and is the only person who can remove other admins.
      </p>

      {isAdmin && (
        <div style={{ ...S.card, marginBottom: 16, padding: "12px 16px" }}>
          <label style={S.label}>Add commissioner email</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }}
              type="email" placeholder="newcommissioner@email.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { onAdd(newEmail); setNewEmail(""); } }}
            />
            <button style={S.btn("primary")} onClick={() => { onAdd(newEmail); setNewEmail(""); }}>Add</button>
          </div>
        </div>
      )}

      {/* Owner row — always first, never removable here */}
      <AdminRow
        email={ownerEmail}
        roleBadge="Owner"
        roleBadgeStyle={S.badge("purple")}
        isMe={ownerEmail.toLowerCase() === meLower}
        showRemove={false}
        onRemove={onRemove}
      />

      {/* Additional admins */}
      {adminEmails.map(email => (
        <AdminRow
          key={email}
          email={email}
          roleBadge={null}
          isMe={email.toLowerCase() === meLower}
          // Only the owner sees Remove buttons. Self-remove is still shown
          // (an admin can step down) — but the actual permission gate is
          // enforced server-side, so the worst that can happen if this
          // were tampered with is a polite "not_owner" error toast.
          showRemove={isOwner}
          onRemove={onRemove}
        />
      ))}

      {adminEmails.length === 0 && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          No additional admins yet. The owner has full access on their own.
        </p>
      )}
    </div>
  );
}

function AdminRow({ email, roleBadge, roleBadgeStyle, isMe, showRemove, onRemove }) {
  if (!email) return null;
  return (
    <div style={S.card}>
      <div style={S.row}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>
          {email[0].toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>{email}</p>
            {roleBadge && <span style={{ ...(roleBadgeStyle || S.badge("info")), fontSize: 10 }}>{roleBadge}</span>}
            {isMe && <span style={{ ...S.badge("success"), fontSize: 10 }}>You</span>}
          </div>
        </div>
        {showRemove && (
          <button
            style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11, flexShrink: 0 }}
            onClick={() => { if (confirm(`Remove ${email} as commissioner?`)) onRemove(email); }}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
