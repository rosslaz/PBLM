import { useState, useMemo } from "react";
import { S, genderBadgeStyle } from "../styles.js";
import { CSC } from "../lib/constants.js";
import { formatPlayerName, playerInitial, playerSearchString, playerFitsLeagueGender } from "../lib/format.js";
import { PlayerForm } from "./PlayerForm.jsx";

export function AddPlayerToLeague({ players, leagueId, leagueGender, existing, onRegister, onCreatePlayer, onClose }) {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  // Gender filter: Men's leagues hide Female players; Women's leagues hide
  // Male; Mixed leagues accept everyone. Logic is shared with the player's
  // own join-league filter so the two flows match exactly.
  const available = useMemo(() => {
    const q = search.toLowerCase();
    return players.filter(p =>
      !existingSet.has(p.id) &&
      playerFitsLeagueGender(p.gender, leagueGender) &&
      playerSearchString(p).includes(q)
    );
  }, [players, existingSet, search, leagueGender]);
  // Count of players excluded by the gender filter (independent of search).
  // Used to explain to the commissioner why some players aren't appearing —
  // otherwise a player-not-found feels like a bug.
  const filteredByGenderCount = useMemo(() => {
    if (leagueGender === "Mixed" || !leagueGender) return 0;
    return players.filter(p =>
      !existingSet.has(p.id) &&
      !playerFitsLeagueGender(p.gender, leagueGender)
    ).length;
  }, [players, existingSet, leagueGender]);

  if (showNew) return <PlayerForm onSubmit={async d => { const id = await onCreatePlayer(d); if (id) await onRegister(leagueId, id); onClose(); }} onCancel={() => setShowNew(false)} />;
  return (
    <div>
      <input style={{ ...S.input, marginBottom: 12 }} placeholder="Search players…" value={search} onChange={e => setSearch(e.target.value)} />
      {filteredByGenderCount > 0 && (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 12px", padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: 6 }}>
          {filteredByGenderCount} player{filteredByGenderCount !== 1 ? "s" : ""} hidden — this is a {leagueGender} league.
        </p>
      )}
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {available.map(p => (
          <div key={p.id} style={{ ...S.card, marginBottom: 8, cursor: "pointer", padding: "12px 16px" }} onClick={() => { onRegister(leagueId, p.id); onClose(); }}>
            <div style={S.row}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: CSC.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: CSC.blue, fontSize: 14, flexShrink: 0 }}>{playerInitial(p)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{formatPlayerName(p)}</p>
                  {p.gender && <span style={{ ...genderBadgeStyle(p.gender), fontSize: 10 }}>{p.gender}</span>}
                  {p.cscMember && <span style={{ ...S.badge("success"), fontSize: 10 }}>CSC</span>}
                </div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>{p.email}</p>
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
