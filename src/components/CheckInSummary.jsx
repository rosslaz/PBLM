import { useState } from "react";
import { S } from "../styles.js";

// Commissioner view: collapsible per-week check-in summary with counts and the
// ability to email reminders / copy a plain-text report.
export function CheckInSummary({ regs, getCheckInForPlayer, getPlayerName, getPlayerEmail, leagueId, leagueName, week, weekDate }) {
  const [expanded, setExpanded] = useState(false);
  const counts = { in: 0, out: 0, maybe: 0, sub: 0, none: 0 };
  const buckets = { in: [], maybe: [], sub: [], out: [], none: [] };
  // Track playerId + subName so we can render "Bob → sub: John Smith" in summary
  const subNames = {};
  regs.forEach(r => {
    const ci = getCheckInForPlayer(r.playerId);
    const status = ci?.status || "none";
    counts[status]++;
    buckets[status].push(r.playerId);
    if (status === "sub" && ci?.subName) subNames[r.playerId] = ci.subName;
  });

  function copyReport() {
    const lines = [
      `Week ${week} Check-In Report`,
      ``,
      `IN (${counts.in}):`,
      ...buckets.in.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `MAYBE (${counts.maybe}):`,
      ...buckets.maybe.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `SUB — out but found a sub (${counts.sub}):`,
      ...buckets.sub.map(id => `  - ${getPlayerName(id)}${subNames[id] ? ` (sub: ${subNames[id]})` : " (sub: not specified)"}`),
      ``,
      `OUT (${counts.out}):`,
      ...buckets.out.map(id => `  - ${getPlayerName(id)}`),
      ``,
      `NO RESPONSE (${counts.none}):`,
      ...buckets.none.map(id => `  - ${getPlayerName(id)}`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => alert("Report copied to clipboard."),
      () => alert("Could not copy to clipboard.")
    );
  }

  // Build a mailto: URL targeting players who haven't responded yet
  function emailNoResponse() {
    const recipients = buckets.none
      .map(id => getPlayerEmail?.(id))
      .filter(e => e && e.includes("@"));
    if (recipients.length === 0) {
      alert("No outstanding players to remind — everyone has checked in!");
      return;
    }
    const subject = `${leagueName || "League"} — Please check in for Week ${week}${weekDate ? ` (${weekDate})` : ""}`;
    const body =
      `Hi,\n\n` +
      `Just a quick reminder to mark your availability for Week ${week}${weekDate ? ` (${weekDate})` : ""} of ${leagueName || "the league"}.\n\n` +
      `Please log in and select In, Maybe, Sub (if you've arranged a sub), or Out so we can plan the courts.\n\n` +
      `Thanks!`;
    const params = new URLSearchParams({
      bcc: recipients.join(","),
      subject,
      body,
    });
    window.location.href = `mailto:?${params.toString()}`;
  }

  // Email everyone in the league (any status) — useful for general announcements
  function emailEveryone() {
    const recipients = regs
      .map(r => getPlayerEmail?.(r.playerId))
      .filter(e => e && e.includes("@"));
    if (recipients.length === 0) { alert("No player emails available."); return; }
    const subject = `${leagueName || "League"} — Week ${week}${weekDate ? ` (${weekDate})` : ""}`;
    const params = new URLSearchParams({ bcc: recipients.join(","), subject, body: "" });
    window.location.href = `mailto:?${params.toString()}`;
  }

  return (
    <div style={{ margin: "12px 16px 0", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, background: "var(--color-background-secondary)", overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>Check-ins:</span>
          <span style={{ ...S.badge("success"), fontSize: 11 }}>✓ {counts.in} in</span>
          <span style={{ ...S.badge("warning"), fontSize: 11 }}>? {counts.maybe} maybe</span>
          {counts.sub > 0 && <span style={{ ...S.badge("purple"), fontSize: 11 }}>↔ {counts.sub} sub</span>}
          <span style={{ ...S.badge("danger"), fontSize: 11 }}>✗ {counts.out} out</span>
          {counts.none > 0 && <span style={{ ...S.badge("info"), fontSize: 11 }}>• {counts.none} no reply</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {counts.none > 0 && (
            <button
              style={{ ...S.btnSm("primary", "#185FA5"), fontSize: 11 }}
              onClick={e => { e.stopPropagation(); emailNoResponse(); }}
              title={`Email the ${counts.none} player${counts.none!==1?"s":""} who haven't responded`}>
              ✉ Remind ({counts.none})
            </button>
          )}
          <button
            style={{ ...S.btnSm("secondary"), fontSize: 11 }}
            onClick={e => { e.stopPropagation(); emailEveryone(); }}
            title="Email all players in this league">
            ✉ All
          </button>
          <button
            style={{ ...S.btnSm("secondary"), fontSize: 11 }}
            onClick={e => { e.stopPropagation(); copyReport(); }}>
            Copy Report
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 12px 10px" }}>
          {[
            ["in", "In", "#3B6D11"],
            ["maybe", "Maybe", "#854F0B"],
            ["sub", "Sub (found a sub)", "#534AB7"],
            ["out", "Out", "#A32D2D"],
            ["none", "No response", "#78716c"],
          ].map(([k, label, color]) => (
            buckets[k].length > 0 && (
              <div key={k} style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color }}>{label} ({buckets[k].length})</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                  {buckets[k].map(id => {
                    const name = getPlayerName(id);
                    if (k === "sub") {
                      const sn = subNames[id];
                      return sn ? `${name} → ${sn}` : `${name} → (sub not named)`;
                    }
                    return name;
                  }).join(", ")}
                </p>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
