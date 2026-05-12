import { S } from "../styles.js";
import { CSC, COLORS, SPACE } from "../lib/constants.js";
import { useIsMobile } from "../lib/session.js";
import { EmptyState } from "./ui.jsx";

// ─── Standings ──────────────────────────────────────────────────────────────
// Two layouts: desktop shows the traditional table; mobile shows per-player
// cards stacked vertically (no horizontal scroll, which the old table relied
// on at narrow widths and which broke row alignment when scrolled).
export function StandingsTable({ standings, getPlayerName, color, myId, pendingWeeks = 0 }) {
  const c = color || COLORS.csc;
  const isMobile = useIsMobile();

  if (standings.length === 0) {
    return (
      <EmptyState
        msg={pendingWeeks > 0
          ? `${pendingWeeks} week${pendingWeeks!==1?"s":""} of scores entered, but the commissioner hasn't locked any weeks yet. Standings appear once weeks are locked.`
          : "No results yet. Standings appear after the commissioner locks completed weeks."}
      />
    );
  }

  const pendingBanner = pendingWeeks > 0 ? (
    <div style={{ padding: "8px 12px", background: "#FAEEDA", borderRadius: 6, fontSize: 12, color: "#854F0B", marginBottom: SPACE.md }}>
      ⏳ {pendingWeeks} week{pendingWeeks!==1?"s":""} of unlocked scores not yet counted. Standings update once the commissioner locks each week.
    </div>
  ) : null;

  const tieBreakerNote = (
    <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: SPACE.sm }}>
      Only locked weeks count. Ranked by Win% (accounts for sit-outs), then +/- (points for minus points against), then wins. PF=Points For · PA=Points Against
    </p>
  );

  if (isMobile) {
    return (
      <div>
        {pendingBanner}
        <div className="tabular-nums">
          {standings.map((s, i) => (
            <StandingsCard
              key={s.id}
              rank={i + 1}
              stat={s}
              name={getPlayerName(s.id)}
              isMe={myId && s.id === myId}
              themeColor={c}
            />
          ))}
        </div>
        {tieBreakerNote}
      </div>
    );
  }

  // Desktop: traditional table
  return (
    <div>
      {pendingBanner}
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
      {tieBreakerNote}
    </div>
  );
}

// ─── Mobile stat card ───────────────────────────────────────────────────────
// Single-player card with the same data as one table row, rearranged for a
// narrow viewport. Layout:
//   ┌─────────────────────────────────────────────┐
//   │ #1  Jane Smith                       [You]  │
//   │ ─────────────────────────────────────────── │
//   │   Win%             +/-                      │
//   │    75%             +12                      │
//   │ ─────────────────────────────────────────── │
//   │  W: 3   L: 1   PF: 47   PA: 35             │
//   └─────────────────────────────────────────────┘
// The "You" card uses the league-theme tint for the background so the user
// can spot themselves in a long list at a glance.
function StandingsCard({ rank, stat, name, isMe, themeColor }) {
  const diff = stat.pointsFor - stat.pointsAgainst;
  const c = themeColor;
  const hasMatches = stat.matches > 0;
  return (
    <div
      style={{
        background: isMe ? c.light : "var(--color-background-primary)",
        border: isMe ? `1px solid ${c.bg}40` : "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10,
        padding: `${SPACE.md}px ${SPACE.lg}px`,
        marginBottom: SPACE.sm,
      }}>
      {/* Top row: rank + name + you-badge */}
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm }}>
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--color-text-tertiary)",
          minWidth: 28,
        }}>
          #{rank}
        </span>
        <span style={{
          flex: 1,
          fontSize: 15,
          fontWeight: isMe ? 700 : 600,
          color: isMe ? c.bg : "var(--color-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {name}
        </span>
        {isMe && <span style={{ ...S.badge("info"), fontSize: 10 }}>You</span>}
      </div>

      {/* Headline stats: Win% and +/- */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: SPACE.sm,
        padding: `${SPACE.sm}px 0`,
        borderTop: "0.5px solid var(--color-border-tertiary)",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
      }}>
        <HeadlineStat
          label="Win%"
          value={hasMatches ? `${Math.round(stat.winPct * 100)}%` : "—"}
          color={isMe ? c.bg : "var(--color-text-primary)"}
        />
        <HeadlineStat
          label="+/-"
          value={hasMatches ? `${diff > 0 ? "+" : ""}${diff}` : "—"}
          color={!hasMatches ? "var(--color-text-tertiary)" : diff >= 0 ? CSC.blue : "#A32D2D"}
        />
      </div>

      {/* Detail strip: W / L / PF / PA */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: SPACE.xs,
        marginTop: SPACE.sm,
      }}>
        <DetailStat label="W" value={stat.wins} color={CSC.blue} />
        <DetailStat label="L" value={stat.losses} color="#A32D2D" />
        <DetailStat label="PF" value={stat.pointsFor} color="var(--color-text-secondary)" />
        <DetailStat label="PA" value={stat.pointsAgainst} color="var(--color-text-secondary)" />
      </div>
    </div>
  );
}

function HeadlineStat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--color-text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color,
      }}>
        {value}
      </div>
    </div>
  );
}

function DetailStat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 600 }}>{label}:</span>{" "}
      <span style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}
