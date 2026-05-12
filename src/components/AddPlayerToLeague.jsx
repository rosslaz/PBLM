import { useState, useMemo } from "react";
import { S } from "../styles.js";
import { CSC } from "../lib/constants.js";
import { formatPlayerName, playerInitial, playerSearchString } from "../lib/format.js";
import { PlayerForm } from "./PlayerForm.jsx";

export function AddPlayerToLeague({ players, leagueId, existing, onRegister, onCreatePlayer, onClose }) {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  const available = useMemo(() => {
    const q = search.toLowerCase();
    return players.filter(p => !existingSet.has(p.id) && playerSearchString(p).includes(q));
  }, [players, existingSet, search]);
  if (showNew) return <PlayerForm onSubmit={async d => { const id = await onCreatePlayer(d); if (id) await onRegister(leagueId, id); onClose(); }} onCancel={() => setShowNew(false)} />;
  return (
    <div>
      <input style={{ ...S.input, marginBottom: 12 }} placeholder="Search players…" value={search} onChange={e => setSearch(e.target.value)} />
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {available.map(p => (
          <div key={p.id} style={{ ...S.card, marginBottom: 8, cursor: "pointer", padding: "12px 16px" }} onClick={() => { onRegister(leagueId, p.id); onClose(); }}>
            <div style={S.row}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>{playerInitial(p)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{formatPlayerName(p)}</p>
                  {p.gender && <span style={{ ...S.badge("info"), fontSize: 10 }}>{p.gender}</span>}
                  {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC</span>}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}</p>
              </div>
            </div>
          </div>
        ))}
        {available.length === 0 && <p style={{ fontSize: 14, color: "var(--color-text-secondary)", textAlign: "center", padding: "16px 0" }}>No available players found.</p>}
      </div>
      <button style={{ ...S.btn("secondary"), width: "100%", marginTop: 12 }} onClick={() => setShowNew(true)}>+ Create New Player</button>
    </div>
  );
}
