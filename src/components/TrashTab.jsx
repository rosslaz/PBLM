// ─── Trash tab — soft-deleted leagues and players awaiting auto-purge ───────
import { S } from "../styles.js";
import { CSC, COLORS, TRASH_RETENTION_DAYS } from "../lib/constants.js";
import { formatDate, formatPlayerName, playerInitial } from "../lib/format.js";
import { EmptyState } from "./ui.jsx";

// "deletedAt" → "Auto-deletes Apr 30" or "Auto-deletes today" style label.
// We're not doing ms-precision here; "in N days" reads fine and the actual
// purge is opportunistic on the next loadDB anyway.
function purgeETA(deletedAt) {
  if (!deletedAt) return null;
  const t = Date.parse(deletedAt);
  if (!Number.isFinite(t)) return null;
  const purgeMs = t + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const purgeDate = new Date(purgeMs);
  const iso = purgeDate.toISOString().split("T")[0];
  const daysLeft = Math.ceil((purgeMs - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return { label: "Purging soon", iso, daysLeft: 0, urgent: true };
  if (daysLeft === 1) return { label: "Auto-deletes tomorrow", iso, daysLeft, urgent: true };
  if (daysLeft <= 7) return { label: `Auto-deletes in ${daysLeft} days`, iso, daysLeft, urgent: true };
  return { label: `Auto-deletes ${formatDate(iso)}`, iso, daysLeft, urgent: false };
}

function deletedAgo(deletedAt) {
  if (!deletedAt) return "";
  const ms = Date.now() - Date.parse(deletedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function TrashTab({ trashedLeagues, trashedPlayers, onRestoreLeague, onRestorePlayer, onHardDeleteLeague, onHardDeletePlayer }) {
  const total = trashedLeagues.length + trashedPlayers.length;
  return (
    <div style={S.section}>
      <div style={{ ...S.row, justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Trash</h2>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
        Soft-deleted leagues and players. Each is automatically removed for good after {TRASH_RETENTION_DAYS} days.
        Restore brings everything back (registrations, scores, check-ins). Delete Forever removes them immediately — no undo.
      </p>

      {total === 0 && <EmptyState msg="Trash is empty." />}

      {trashedLeagues.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, padding: "0 2px" }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Leagues
            </h3>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({trashedLeagues.length})</span>
          </div>
          {trashedLeagues.map(l => {
            const lc = COLORS[l.color] || COLORS.csc;
            const eta = purgeETA(l.deletedAt);
            return (
              <div key={l.id} style={{ ...S.card, borderLeft: `4px solid ${lc.bg}`, opacity: 0.85 }}>
                <div style={S.row}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 15 }}>{l.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {l.gender || "Mixed"} · {l.format || "Singles"} · {l.weeks} weeks
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      Deleted {deletedAgo(l.deletedAt)}
                      {eta && (
                        <span style={{ marginLeft: 6, color: eta.urgent ? "#A32D2D" : "var(--color-text-tertiary)", fontWeight: eta.urgent ? 600 : 400 }}>
                          · {eta.label}
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button style={{ ...S.btnSm("primary"), background: "#3B6D11", fontSize: 11 }} onClick={() => onRestoreLeague(l)}>
                      Restore
                    </button>
                    <button style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11 }} onClick={() => onHardDeleteLeague(l)}>
                      Delete Forever
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {trashedPlayers.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, padding: "0 2px" }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Players
            </h3>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>({trashedPlayers.length})</span>
          </div>
          {trashedPlayers.map(p => {
            const eta = purgeETA(p.deletedAt);
            return (
              <div key={p.id} style={S.card}>
                <div style={{ ...S.row, opacity: 0.85 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>
                    {playerInitial(p)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{formatPlayerName(p)}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      Deleted {deletedAgo(p.deletedAt)}
                      {eta && (
                        <span style={{ marginLeft: 6, color: eta.urgent ? "#A32D2D" : "var(--color-text-tertiary)", fontWeight: eta.urgent ? 600 : 400 }}>
                          · {eta.label}
                        </span>
                      )}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button style={{ ...S.btnSm("primary"), background: "#3B6D11", fontSize: 11 }} onClick={() => onRestorePlayer(p)}>
                      Restore
                    </button>
                    <button style={{ ...S.btnSm("secondary"), color: "#A32D2D", borderColor: "#A32D2D", fontSize: 11 }} onClick={() => onHardDeletePlayer(p)}>
                      Delete Forever
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
