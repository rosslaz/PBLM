import { useState } from "react";
import { S } from "../styles.js";
import { CSC, COLORS, COURT_NAMES, COURT_COLORS } from "../lib/constants.js";
import { formatDate } from "../lib/format.js";
import { sortLeagues } from "../lib/session.js";
import { Toast, Modal } from "./ui.jsx";
import { PlayerForm } from "./PlayerForm.jsx";

export function HomeView({ leagues, players, db, onPlayerLogin, onCreatePlayer, toast, modal, setModal, registerForLeague }) {
  const [loginEmail, setLoginEmail] = useState("");
  const [loginError, setLoginError] = useState("");
  function handlePlayerLogin() {
    const p = players.find(p => p.email.toLowerCase() === loginEmail.toLowerCase().trim());
    if (!p) { setLoginError("No player found with that email."); return; }
    onPlayerLogin(p);
  }

  return (
    <div style={S.page}>
      <Toast toast={toast} />
      {modal?.type === "newPlayer" && <Modal title="Create Player Account" onClose={() => setModal(null)}><PlayerForm onSubmit={async d => { await onCreatePlayer(d); setModal(null); }} onCancel={() => setModal(null)} /></Modal>}
      <div style={{ background: CSC.blue, color: "#fff", padding: "32px 24px 28px", textAlign: "center" }}>
        <img
          src="/csc-pickleball.png"
          alt="CSC Pickleball"
          style={{ maxWidth: 320, width: "85%", height: "auto", display: "block", margin: "0 auto 12px", borderRadius: 8 }}
        />
        <p style={{ margin: 0, color: "#fff", opacity: 0.92, fontSize: 14, fontWeight: 500, letterSpacing: "0.3px" }}>League Manager</p>
      </div>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 17 }}>Player Login</h2>
          <label style={S.label}>Email address</label>
          <input style={S.input} type="email" placeholder="you@email.com" value={loginEmail} onChange={e => { setLoginEmail(e.target.value); setLoginError(""); }} onKeyDown={e => e.key === "Enter" && handlePlayerLogin()} />
          {loginError && <p style={{ color: "#A32D2D", fontSize: 13, margin: "6px 0 0" }}>{loginError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ ...S.btn("primary"), flex: 1 }} onClick={handlePlayerLogin}>Log In as Player</button>
            <button style={S.btn("secondary")} onClick={() => setModal({ type: "newPlayer" })}>New Account</button>
          </div>
        </div>


        {/* Court legend */}
        <div style={{ ...S.card, padding: "12px 16px", marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>How scheduling works</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            {COURT_NAMES.map((name, i) => <div key={name} style={{ textAlign: "center" }}>
              <div style={{ height: 28, borderRadius: 6, background: COURT_COLORS[i], display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>4–5</span></div>
              <p style={{ margin: "4px 0 0", fontSize: 10, color: COURT_COLORS[i], fontWeight: 600 }}>{name}</p>
            </div>)}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>Each week, players rotate to new court groups. All players within a court play each other. Matchmaking balances opponents across the season.</p>
        </div>
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
                      <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 15 }}>{l.name}</p>
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
    </div>
  );
}
