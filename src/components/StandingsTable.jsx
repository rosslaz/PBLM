import { S } from "../styles.js";
import { CSC, COLORS } from "../lib/constants.js";
import { EmptyState } from "./ui.jsx";

export function StandingsTable({ standings, getPlayerName, color, myId, pendingWeeks = 0 }) {
  const c = color || COLORS.csc;
  if (standings.length === 0) return <EmptyState msg={pendingWeeks > 0 ? `${pendingWeeks} week${pendingWeeks!==1?"s":""} of scores entered, but the commissioner hasn't locked any weeks yet. Standings appear once weeks are locked.` : "No results yet. Standings appear after the commissioner locks completed weeks."} />;
  return (
    <div>
      {pendingWeeks > 0 && (
        <div style={{ padding: "8px 12px", background: "#FAEEDA", borderRadius: 6, fontSize: 12, color: "#854F0B", marginBottom: 12 }}>
          ⏳ {pendingWeeks} week{pendingWeeks!==1?"s":""} of unlocked scores not yet counted. Standings update once the commissioner locks each week.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="tabular-nums" style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: 14, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {[["Player","32%"],["Win%","14%"],["+/-","14%"],["W","10%"],["L","10%"],["PF","10%"],["PA","10%"]].map(([h,w]) => (
                <th key={h} style={{ padding: h==="Player"?"8px 12px":"8px", textAlign: h==="Player"?"left":"center", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", width: w }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const isMe = myId && s.id === myId;
              const diff = s.pointsFor - s.pointsAgainst;
              return (
                <tr key={s.id} style={{ background: isMe ? c.light : i%2===0 ? "transparent" : "var(--color-background-secondary)", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
                  <td style={{ padding: "12px 12px", fontWeight: isMe?700:400, color: isMe?c.bg:"var(--color-text-primary)" }}>
                    <span style={{ marginRight: 8, color: "var(--color-text-tertiary)", fontSize: 12 }}>#{i+1}</span>
                    {getPlayerName(s.id)}
                    {isMe && <span style={{ ...S.badge("info"), marginLeft: 8, fontSize: 10 }}>You</span>}
                  </td>
                  <td style={{ padding:"12px 8px",textAlign:"center",fontWeight:700,fontSize:14,color:isMe?c.bg:"var(--color-text-primary)" }}>
                    {s.matches > 0 ? `${Math.round(s.winPct * 100)}%` : "—"}
                  </td>
                  <td style={{ padding:"12px 8px",textAlign:"center",color:diff>=0?CSC.blue:"#A32D2D",fontWeight:700,fontSize:15 }}>{diff>0?"+":""}{diff}</td>
                  <td style={{ padding:"12px 8px",textAlign:"center",fontWeight:600,color:CSC.blue }}>{s.wins}</td>
                  <td style={{ padding:"12px 8px",textAlign:"center",color:"#A32D2D" }}>{s.losses}</td>
                  <td style={{ padding:"12px 8px",textAlign:"center",color:"var(--color-text-secondary)" }}>{s.pointsFor}</td>
                  <td style={{ padding:"12px 8px",textAlign:"center",color:"var(--color-text-secondary)" }}>{s.pointsAgainst}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>Only locked weeks count. Ranked by Win% (accounts for sit-outs), then +/- (points for minus points against), then wins. PF=Points For · PA=Points Against</p>
    </div>
  );
}
