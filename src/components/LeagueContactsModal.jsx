// ─── LeagueContactsModal ───────────────────────────────────────────────────
// Commissioner-facing helper for spinning up a league group thread in
// WhatsApp / iMessage / Telegram / whatever. Shows every registered
// player's name and phone, with one-tap actions:
//
//   - "Copy all" → copies a comma-separated list of canonical digit-only
//     numbers to the clipboard. WhatsApp, iMessage, etc all accept this
//     format when creating a new group.
//   - "Copy" next to each row → copies just that player's number.
//   - Tap a number directly → tel: link (desktop browsers and mobile
//     dialers will offer to call/text). On mobile this is the fastest
//     path to "text Joe directly about subbing."
//
// Players with no phone on file are listed at the bottom with a "no
// number" badge so the commissioner sees who they need to chase up.
import { useState } from "react";
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";
import { formatPlayerName, playerInitial, formatPhone, digitsOnly } from "../lib/format.js";
import { useIsMobile } from "../lib/session.js";

export function LeagueContactsModal({ regs, players, onClose }) {
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(null); // "all" | playerId | null

  // Resolve regs → player records, partition into "has phone" vs "missing."
  const rows = regs.map(r => players[r.playerId]).filter(Boolean);
  const withPhone = rows.filter(p => p.phone && digitsOnly(p.phone).length >= 10);
  const withoutPhone = rows.filter(p => !p.phone || digitsOnly(p.phone).length < 10);

  // Sort each group alphabetically by last name so the commissioner can
  // scan to a specific player quickly.
  const byLastName = (a, b) => {
    const al = (a.lastName || a.name || "").toLowerCase();
    const bl = (b.lastName || b.name || "").toLowerCase();
    return al.localeCompare(bl);
  };
  withPhone.sort(byLastName);
  withoutPhone.sort(byLastName);

  function flashCopied(key) {
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
  }

  async function writeClipboard(text) {
    // Modern clipboard API first; fall back to the textarea-trick for
    // older browsers / non-secure contexts (e.g. a commissioner using
    // the app over plain HTTP in a kiosk setup).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (_) { return false; }
  }

  async function copyAll() {
    if (withPhone.length === 0) return;
    // Canonical digit-only form, comma-separated. Most group-create
    // flows (WhatsApp web, iMessage paste-into-To, Telegram) accept this.
    const text = withPhone.map(p => digitsOnly(p.phone)).join(", ");
    const ok = await writeClipboard(text);
    if (ok) flashCopied("all");
  }

  async function copyOne(player) {
    const ok = await writeClipboard(digitsOnly(player.phone));
    if (ok) flashCopied(player.id);
  }

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Use these numbers to set up a group thread for the league. Tap "Copy all" and paste into WhatsApp, iMessage, or your messaging app of choice.
      </p>

      {withPhone.length > 0 ? (
        <div style={{ marginBottom: 16, padding: "10px 12px", background: CSC.blueLight, borderRadius: 8, border: `0.5px solid ${CSC.blue}30`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: CSC.blueDark, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {withPhone.length} number{withPhone.length !== 1 ? "s" : ""}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: CSC.blueDark, opacity: 0.85 }}>
              Comma-separated, ready to paste.
            </p>
          </div>
          <button
            type="button"
            onClick={copyAll}
            style={{
              ...S.btnSm("primary"),
              background: copied === "all" ? "#3B6D11" : CSC.blue,
              color: "#fff",
              borderColor: copied === "all" ? "#3B6D11" : CSC.blue,
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "background-color 120ms ease",
            }}>
            {copied === "all" ? "✓ Copied" : "Copy all"}
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: 16, padding: "10px 12px", background: "var(--color-background-secondary)", borderRadius: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
          No phone numbers on file yet. Players added before phone became required may need to update their profile.
        </div>
      )}

      <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
        {withPhone.map(p => {
          const formatted = formatPhone(p.phone);
          const digits = digitsOnly(p.phone);
          // On mobile we wrap the number in a tel: link so the dialer
          // can take over. On desktop the number is a span — clicking
          // it would either do nothing or open a default-handler app
          // the commissioner didn't ask for. Better to keep it
          // copy-only there.
          const phoneEl = isMobile ? (
            <a
              href={`tel:${digits}`}
              style={{ color: CSC.blue, textDecoration: "none", fontWeight: 600 }}>
              {formatted}
            </a>
          ) : (
            <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>{formatted}</span>
          );
          return (
            <div key={p.id} style={{ ...S.card, marginBottom: 8, padding: "10px 12px" }}>
              <div style={{ ...S.row, gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 13, flexShrink: 0 }}>
                  {playerInitial(p)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{formatPlayerName(p)}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 13 }}>{phoneEl}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyOne(p)}
                  style={{
                    ...S.btnSm("secondary"),
                    fontSize: 11,
                    background: copied === p.id ? "#3B6D11" : "transparent",
                    color: copied === p.id ? "#fff" : "var(--color-text-secondary)",
                    borderColor: copied === p.id ? "#3B6D11" : "var(--color-border-secondary)",
                    flexShrink: 0,
                    transition: "background-color 120ms ease",
                  }}>
                  {copied === p.id ? "✓" : "Copy"}
                </button>
              </div>
            </div>
          );
        })}
        {withoutPhone.length > 0 && (
          <>
            <p style={{ margin: "12px 0 6px", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              No phone on file
            </p>
            {withoutPhone.map(p => (
              <div key={p.id} style={{ ...S.card, marginBottom: 8, padding: "10px 12px", opacity: 0.7 }}>
                <div style={{ ...S.row, gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--color-text-tertiary)", fontSize: 13, flexShrink: 0 }}>
                    {playerInitial(p)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{formatPlayerName(p)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                      no number — ask them to update their profile
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{ ...S.row, justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button style={S.btn("secondary")} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
