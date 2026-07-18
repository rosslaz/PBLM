import { useState } from "react";
import { S } from "../styles.js";
import { CHECKIN_OPTS } from "../lib/constants.js";

// ─── Per-player RSVP editor (v1.6.0) ────────────────────────────────────────
// One row per player inside the expanded commissioner summary. Lets the
// commissioner set someone's RSVP on their behalf — the common case being a
// player who texts "can't make it Thursday" instead of opening the app.
//
// Deliberately compact: a name, the four status buttons, and (for "sub") a
// name field. Four buttons at ~44px each fits a phone without wrapping.
//
// Tapping the active status clears it back to "no response".
function PlayerRsvpRow({ playerId, playerName, checkIn, isLocked, onSet }) {
  const current = checkIn?.status || null;
  const [subName, setSubName] = useState(checkIn?.subName || "");
  const [showSubInput, setShowSubInput] = useState(current === "sub");

  function handleClick(optKey) {
    if (isLocked) return;
    if (current === optKey) {
      onSet(playerId, null);            // tap active = clear
      setShowSubInput(false);
      return;
    }
    if (optKey === "sub") {
      setShowSubInput(true);
      onSet(playerId, "sub", subName);
      return;
    }
    setShowSubInput(false);
    onSet(playerId, optKey);
  }

  function commitSubName() {
    if (current === "sub" && subName !== (checkIn?.subName || "")) {
      onSet(playerId, "sub", subName);
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 0",
      borderTop: "0.5px solid var(--color-border-tertiary)",
      flexWrap: "wrap",
    }}>
      <span style={{
        flex: "1 1 120px", minWidth: 0,
        fontSize: 13,
        color: "var(--color-text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {playerName}
        {checkIn?.setByAdmin && (
          <span
            title="You set this on the player's behalf"
            style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-tertiary)" }}>
            (set by you)
          </span>
        )}
      </span>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {CHECKIN_OPTS.map(opt => {
          const active = current === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={isLocked}
              onClick={() => handleClick(opt.key)}
              title={isLocked ? "Week is locked" : `Mark ${playerName} as ${opt.label}`}
              style={{
                minWidth: 34,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 700,
                border: `1px solid ${active ? opt.color : "var(--color-border-secondary)"}`,
                background: active ? opt.color : "var(--color-background-primary)",
                color: active ? "#fff" : opt.color,
                borderRadius: 6,
                cursor: isLocked ? "not-allowed" : "pointer",
                opacity: isLocked ? 0.5 : 1,
                fontFamily: "inherit",
                lineHeight: 1.2,
              }}>
              {opt.icon}
            </button>
          );
        })}
      </div>
      {showSubInput && current === "sub" && (
        <input
          type="text"
          value={subName}
          onChange={e => setSubName(e.target.value)}
          onBlur={commitSubName}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          disabled={isLocked}
          placeholder="Sub's name"
          style={{ ...S.input, flex: "1 1 100%", padding: "5px 8px", fontSize: 12 }}
        />
      )}
    </div>
  );
}

// Commissioner view: collapsible per-week check-in summary with counts, the
// ability to email reminders / copy a plain-text report, and (v1.6.0) direct
// editing of any player's RSVP.
export function CheckInSummary({ regs, getCheckInForPlayer, getPlayerName, getPlayerEmail, leagueId, leagueName, week, weekDate, onSetPlayerCheckIn, isLocked }) {
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

  // Roster in a stable, useful order for the editor: everyone who hasn't
  // responded first (they're the ones the commissioner is chasing), then the
  // rest alphabetically. Sorting by status would make rows jump around as
  // soon as you set one, which is disorienting mid-edit — so we compute the
  // order once from the *initial* buckets and keep it stable within a render.
  const editorOrder = [
    ...buckets.none,
    ...[...buckets.in, ...buckets.maybe, ...buckets.sub, ...buckets.out]
      .sort((a, b) => getPlayerName(a).localeCompare(getPlayerName(b))),
  ];

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

          {/* ─── v1.6.0: set RSVPs on players' behalf ─────────────────────
              For the player who texts "can't make it" instead of opening the
              app. Anything set here is stamped as commissioner-set, and the
              player sees a note explaining it in their own view — so their
              status never silently changes with no explanation. */}
          {onSetPlayerCheckIn && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--color-border-secondary)" }}>
              <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Set availability for a player
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
                {isLocked
                  ? "This week is locked — unlock it to change RSVPs."
                  : "For players who told you outside the app. They'll see that you set it, and can still change it themselves."}
              </p>
              {editorOrder.map(pid => (
                <PlayerRsvpRow
                  key={pid}
                  playerId={pid}
                  playerName={getPlayerName(pid)}
                  checkIn={getCheckInForPlayer(pid)}
                  isLocked={isLocked}
                  onSet={onSetPlayerCheckIn}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
