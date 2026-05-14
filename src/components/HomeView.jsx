import { useState, useMemo } from "react";
import { S } from "../styles.js";
import { CSC, COLORS, SPACE } from "../lib/constants.js";
import { formatDate, playerFullName, playerInitial } from "../lib/format.js";
import { sortLeagues, loadLastEmail, saveLastEmail } from "../lib/session.js";
import { Toast, Modal, VersionFooter, PWAInstallBanner } from "./ui.jsx";
import { PlayerForm } from "./PlayerForm.jsx";

export function HomeView({ leagues, players, db, onPlayerLogin, onCreatePlayer, toast, modal, setModal, registerForLeague }) {
  // Pre-fill the email input with the last-used email on this device. Even
  // after explicit logout this remains, so coming back to log in is at most
  // one tap if the saved email matches a player.
  const initialEmail = useMemo(loadLastEmail, []);
  const [loginEmail, setLoginEmail] = useState(initialEmail);
  const [loginError, setLoginError] = useState("");

  // Resolve the remembered email to a player record if possible. If we have
  // one, show a prominent "Continue as Jane Smith" button as the primary
  // login path. Otherwise fall back to the email-input form.
  const rememberedPlayer = useMemo(() => {
    if (!initialEmail) return null;
    const p = players.find(p => p.email?.toLowerCase() === initialEmail.toLowerCase());
    // Skip soft-deleted players — they shouldn't auto-log in.
    if (p && !p.deletedAt) return p;
    return null;
  }, [initialEmail, players]);

  function handlePlayerLogin() {
    const trimmed = loginEmail.toLowerCase().trim();
    const p = players.find(p => p.email?.toLowerCase() === trimmed);
    if (!p || p.deletedAt) {
      setLoginError("notfound");
      return;
    }
    onPlayerLogin(p);
  }

  // Forget the remembered player. Used when a different person on a shared
  // device needs to log in (i.e. the "Use a different email" link).
  function clearRemembered() {
    saveLastEmail("");
    setLoginEmail("");
    setLoginError("");
    // Force the "Continue as" card to disappear by clearing initialEmail
    // through a soft remount: simplest is a page reload, but a state nudge
    // works without reload — we already have rememberedPlayer keyed off
    // initialEmail (memo), but we want a fresh memo. Easiest path: set a
    // forced flag.
    setForceForget(true);
  }
  const [forceForget, setForceForget] = useState(false);
  const showContinueCard = !!rememberedPlayer && !forceForget;

  // After successful account creation, the new player record exists in `db.players`.
  // Find it by email and log them in directly — saves them retyping the email.
  async function handleCreatePlayer(data) {
    const newId = await onCreatePlayer(data);
    setModal(null);
    if (newId) {
      // The just-created player is in the in-memory db now (the action wrapper
      // reloaded). Re-find by email since `db.players[newId]` may not have
      // propagated to this render yet.
      const created = Object.values(db.players).find(p => p.id === newId)
        || { id: newId, email: data.email, firstName: data.firstName, lastName: data.lastName, name: data.name };
      onPlayerLogin(created);
    }
  }

  return (
    <div style={S.page}>
      <Toast toast={toast} />
      {modal?.type === "newPlayer" && (
        <Modal title="Create Player Account" onClose={() => setModal(null)}>
          <PlayerForm
            initial={loginEmail ? { email: loginEmail } : undefined}
            onSubmit={handleCreatePlayer}
            onCancel={() => setModal(null)} />
        </Modal>
      )}
      <div className="pwa-safe-top-lg" style={{ background: CSC.blue, color: "#fff", padding: "32px 24px 28px", textAlign: "center" }}>
        <img
          src="/csc-pickleball.png"
          alt="CSC Pickleball"
          style={{ maxWidth: 320, width: "85%", height: "auto", display: "block", margin: "0 auto 12px", borderRadius: 8 }}
        />
        <p style={{ margin: 0, color: "#fff", opacity: 0.92, fontSize: 14, fontWeight: 500, letterSpacing: "0.3px" }}>League Manager</p>
      </div>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px" }}>

        {/* PWA install nudge — appears once for iOS Safari users who haven't
            installed the app or dismissed the banner. Other platforms see
            nothing here. */}
        <PWAInstallBanner />

        {/* Continue-as card: one-tap re-login when we know who used this
            device last. Replaces the email form for the common case. */}
        {showContinueCard && (
          <div style={{ ...S.card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => onPlayerLogin(rememberedPlayer)}
              style={{
                display: "flex", alignItems: "center", gap: SPACE.md,
                width: "100%", padding: `${SPACE.lg}px ${SPACE.xl}px`,
                background: "transparent", border: "none", cursor: "pointer",
                textAlign: "left", fontFamily: "inherit",
              }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: CSC.blueLight, color: CSC.blue,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 18, flexShrink: 0,
              }}>
                {playerInitial(rememberedPlayer)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Continue as</p>
                <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {playerFullName(rememberedPlayer)}
                </p>
              </div>
              <span style={{ fontSize: 22, color: CSC.blue, flexShrink: 0 }}>›</span>
            </button>
            <div style={{
              borderTop: "0.5px solid var(--color-border-tertiary)",
              padding: `${SPACE.sm}px ${SPACE.xl}px`,
              textAlign: "center",
            }}>
              <button
                type="button"
                onClick={clearRemembered}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--color-text-secondary)", fontSize: 12,
                  fontFamily: "inherit", textDecoration: "underline",
                }}>
                Not you? Use a different email
              </button>
            </div>
          </div>
        )}

        {/* Email login card. Shown when there's no remembered player, or
            when the user explicitly asked to use a different email. */}
        {!showContinueCard && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 17 }}>Player Login</h2>
            <label style={S.label}>Email address</label>
            <input
              style={S.input}
              type="email"
              placeholder="you@email.com"
              value={loginEmail}
              onChange={e => { setLoginEmail(e.target.value); setLoginError(""); }}
              onKeyDown={e => e.key === "Enter" && handlePlayerLogin()}
            />
            {loginError === "notfound" && (
              <div style={{
                marginTop: SPACE.sm,
                padding: `${SPACE.sm}px ${SPACE.md}px`,
                background: "#FAEEDA",
                border: "0.5px solid #ECC580",
                borderRadius: 8,
                fontSize: 13,
                color: "#854F0B",
              }}>
                <p style={{ margin: 0 }}>No player found with that email.</p>
                <p style={{ margin: `${SPACE.xs}px 0 0`, fontSize: 12 }}>
                  Want to register?{" "}
                  <button
                    type="button"
                    onClick={() => setModal({ type: "newPlayer" })}
                    style={{
                      background: "none", border: "none", padding: 0,
                      color: "#854F0B", textDecoration: "underline",
                      cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                      fontWeight: 600,
                    }}>
                    Create an account with this email
                  </button>
                </p>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...S.btn("primary"), flex: 1 }} onClick={handlePlayerLogin}>Log In as Player</button>
              <button style={S.btn("secondary")} onClick={() => setModal({ type: "newPlayer" })}>New Account</button>
            </div>
          </div>
        )}

        {leagues.length > 0 && (
          <div>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--color-text-secondary)" }}>Active Leagues</h3>
            {sortLeagues(leagues.filter(l => l.status !== "archived")).map(l => {
              const lc = COLORS[l.color] || COLORS.csc;
              const regs = Object.values(db.registrations).filter(r => r.leagueId === l.id);
              const archived = l.status === "archived";
              return (
                <div key={l.id} style={{ ...S.card, borderLeft: `4px solid ${lc.bg}`, marginBottom: 8, opacity: archived ? 0.6 : 1 }}>
                  <div style={S.row}>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>{l.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{l.gender || "Mixed"} · {regs.length} players · {l.weeks} weeks · Starts {formatDate(l.startDate)}</p>
                    </div>
                    <span style={S.badge(l.status==="active"?"success":l.status==="archived"?"warning":"info")}>{l.status==="archived"?"📦 archived":l.status||"open"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <VersionFooter />
    </div>
  );
}
