import { useState } from "react";
import { S } from "../styles.js";
import { SUPER_ADMIN, CSC } from "../lib/constants.js";

export function AdminsTab({ adminEmails, currentAdminEmail, isSuperAdmin, onAdd, onRemove }) {
  const [newEmail, setNewEmail] = useState("");
  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Commissioner Access</h2>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        These email addresses can log into the commissioner panel. The primary commissioner ({SUPER_ADMIN}) cannot be removed.
      </p>

      {isSuperAdmin && (
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

      {adminEmails.map(email => {
        const isPrimary = email.toLowerCase() === SUPER_ADMIN.toLowerCase();
        const isMe = email.toLowerCase() === currentAdminEmail?.toLowerCase();
        return (
          <div key={email} style={S.card}>
            <div style={S.row}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>
                {email[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>{email}</p>
                  {isPrimary && <span style={{ ...S.badge("info"), fontSize: 10 }}>Primary Commissioner</span>}
                  {isMe && <span style={{ ...S.badge("success"), fontSize: 10 }}>You</span>}
                </div>
              </div>
              {isSuperAdmin && !isPrimary && (
                <button
                  style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11, flexShrink: 0 }}
                  onClick={() => { if (confirm(`Remove ${email} as commissioner?`)) onRemove(email); }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
