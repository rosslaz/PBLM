// ─── Schedule preview — review a generated schedule before committing it ────
// Round-Robin leagues generate a full season at once; ladder leagues generate
// one week. Either way, this modal shows the proposed court compositions and
// the commissioner accepts, retries (if applicable), or cancels.
//
// Desktop also gets a per-week court editor: clicking "Edit courts" on any
// week swaps that week into edit mode, letting the commissioner drag
// players between courts (or onto another player to swap). Edits are
// applied in memory to the modal's local proposal — the algorithm does
// NOT re-run; the rest of the schedule is left alone. Commit writes the
// edited proposal as-is.
import { useState, useEffect } from "react";
import { S } from "../styles.js";
import { CSC, COURT_COLORS, MIN_PER_COURT, MAX_PER_COURT } from "../lib/constants.js";
import { formatDate, formatDateTime, formatTime, resolveCourtName, resolveCourtTime } from "../lib/format.js";
import { useIsMobile } from "../lib/session.js";
import { buildCourtMatches } from "../lib/scheduling.js";
import { Spinner, useIsActionPending } from "./Spinner.jsx";

// ─── Per-week court editor (desktop only) ──────────────────────────────────
// Drag-and-drop UI for moving players between courts in a single week.
//   - Drag a chip onto another court → moves the player (if size allows).
//   - Drag a chip onto another player → swaps them (always allowed; sizes
//     don't change).
// On any successful drop, calls onChange(newGroups) — the parent rebuilds
// matches for the affected courts and updates its local proposal.
function WeekEditor({ week, league, onChange, playerNamesById, onDone }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const courtStatus = (count) => {
    if (count < MIN_PER_COURT) return "under";
    if (count > MAX_PER_COURT) return "over";
    return "ok";
  };

  function handleDragStart(e, playerId, fromCourtIdx) {
    setDraggedId(playerId);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `${playerId}|${fromCourtIdx}`);
    } catch (_) { /* some browsers throw on restricted setData */ }
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDropTarget(null);
  }

  // Helper used by both dragOver and drop to test whether moving the
  // currently-dragged player to `toCourtIdx` would respect MIN/MAX. Returns
  // false for no-ops (drop on same court) and for capacity-violating moves.
  function isDropAllowed(toCourtIdx) {
    if (draggedId == null) return false;
    const fromCourtIdx = week.courts.findIndex(c => c.players.includes(draggedId));
    if (fromCourtIdx === -1) return false;
    if (fromCourtIdx === toCourtIdx) return false;
    if (week.courts[toCourtIdx].players.length >= MAX_PER_COURT) return false;
    if (week.courts[fromCourtIdx].players.length <= MIN_PER_COURT) return false;
    return true;
  }

  function handleDragOver(e, courtIdx) {
    if (!isDropAllowed(courtIdx)) {
      if (dropTarget != null) setDropTarget(null);
      return;
    }
    e.preventDefault();
    if (dropTarget !== courtIdx) setDropTarget(courtIdx);
  }

  function handleDragLeave(e, courtIdx) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dropTarget === courtIdx) setDropTarget(null);
  }

  function handleDrop(e, toCourtIdx) {
    e.preventDefault();
    const data = (e.dataTransfer.getData("text/plain") || "").split("|");
    const playerId = data[0] || draggedId;
    const fromCourtIdx = data[1] != null ? parseInt(data[1], 10) : null;
    setDraggedId(null);
    setDropTarget(null);
    if (!playerId || fromCourtIdx == null) return;
    if (fromCourtIdx === toCourtIdx) return;
    const targetSize = week.courts[toCourtIdx].players.length;
    const sourceSize = week.courts[fromCourtIdx].players.length;
    if (targetSize >= MAX_PER_COURT) return;
    if (sourceSize <= MIN_PER_COURT) return;
    const newGroups = week.courts.map((c, i) => {
      if (i === fromCourtIdx) return c.players.filter(p => p !== playerId);
      if (i === toCourtIdx) return [...c.players, playerId];
      return [...c.players];
    });
    onChange(newGroups);
  }

  // Chip-on-chip drop = swap. Always allowed (no size change). Only fires
  // when dragging across courts — within-court swaps are no-ops since
  // order isn't meaningful.
  function handleChipDragOver(e, targetPlayerId, targetCourtIdx) {
    if (draggedId == null || draggedId === targetPlayerId) return;
    const fromCourtIdx = week.courts.findIndex(c => c.players.includes(draggedId));
    if (fromCourtIdx === -1 || fromCourtIdx === targetCourtIdx) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function handleChipDrop(e, targetPlayerId, targetCourtIdx) {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedId;
    setDraggedId(null);
    setDropTarget(null);
    if (!sourceId || sourceId === targetPlayerId) return;
    const fromCourtIdx = week.courts.findIndex(c => c.players.includes(sourceId));
    if (fromCourtIdx === -1 || fromCourtIdx === targetCourtIdx) return;
    const newGroups = week.courts.map((c, i) => {
      if (i === fromCourtIdx) return c.players.map(p => p === sourceId ? targetPlayerId : p);
      if (i === targetCourtIdx) return c.players.map(p => p === targetPlayerId ? sourceId : p);
      return [...c.players];
    });
    onChange(newGroups);
  }

  return (
    <div style={{ marginBottom: 12, border: `1px solid ${CSC.blue}40`, borderRadius: 8, padding: "12px 12px", background: CSC.blueLight }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: CSC.blueDark }}>Editing Week {week.week}</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: CSC.blueDark, opacity: 0.85 }}>
            {formatDateTime(week.date, week.time) || formatDate(week.date)}
          </span>
        </div>
        <button
          type="button"
          onClick={onDone}
          style={{
            ...S.btnSm("primary"),
            background: CSC.blue,
            color: "#fff",
            borderColor: CSC.blue,
            whiteSpace: "nowrap",
          }}>
          Done editing
        </button>
      </div>
      <p style={{ margin: "4px 0 10px", fontSize: 12, color: CSC.blueDark, opacity: 0.85 }}>
        Drag a player to another court to move them, or drop a player on another player to swap.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${week.courts.length}, 1fr)`, gap: 8 }}>
        {week.courts.map((court, ci) => {
          const color = COURT_COLORS[ci % COURT_COLORS.length];
          const displayName = resolveCourtName(court, ci, league);
          const status = courtStatus(court.players.length);
          const isHovering = dropTarget === ci;
          const borderColor = status === "ok"
            ? (isHovering ? color : `${color}60`)
            : "#A32D2D";
          return (
            <div
              key={court.courtName}
              onDragOver={e => handleDragOver(e, ci)}
              onDragLeave={e => handleDragLeave(e, ci)}
              onDrop={e => handleDrop(e, ci)}
              style={{
                border: `2px solid ${borderColor}`,
                borderRadius: 8,
                padding: "8px 8px",
                background: isHovering ? `${color}18` : "var(--color-background-primary)",
                minHeight: 80,
                transition: "background 120ms ease, border-color 120ms ease",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 11, color, letterSpacing: "0.4px" }}>
                  {displayName.toUpperCase()}
                </span>
                <span style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  fontWeight: 600,
                  color: status === "ok" ? "var(--color-text-tertiary)" : "#A32D2D",
                }}>
                  {court.players.length} player{court.players.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {court.players.map(pid => (
                  <div
                    key={pid}
                    draggable
                    onDragStart={e => handleDragStart(e, pid, ci)}
                    onDragEnd={handleDragEnd}
                    onDragOver={e => handleChipDragOver(e, pid, ci)}
                    onDrop={e => handleChipDrop(e, pid, ci)}
                    title="Drag to another court — or onto another player to swap"
                    style={{
                      padding: "5px 8px",
                      borderRadius: 6,
                      fontSize: 12,
                      background: draggedId === pid ? `${color}40` : `${color}15`,
                      border: `0.5px solid ${color}50`,
                      color: "var(--color-text-primary)",
                      cursor: "grab",
                      opacity: draggedId === pid ? 0.4 : 1,
                      userSelect: "none",
                      transition: "opacity 80ms ease, background 80ms ease",
                    }}>
                    {playerNamesById[pid] || pid}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Single week of preview — read-only view of courts and their players, plus
// an "Edit courts" button on desktop that switches the parent into the
// per-week editor for this week.
function PreviewWeek({ week, league, canEdit, onEditClick }) {
  return (
    <div style={{ marginBottom: 12, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "12px 12px", background: "var(--color-background-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Week {week.week}</span>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {formatDateTime(week.date, week.time) || formatDate(week.date)}
          </span>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={onEditClick}
            style={{ ...S.btnSm("secondary"), fontSize: 11, whiteSpace: "nowrap" }}>
            Edit courts
          </button>
        )}
      </div>
      {week.courts.map((court, ci) => {
        const color = COURT_COLORS[ci % COURT_COLORS.length];
        const displayName = resolveCourtName(court, ci, league);
        const courtTime = resolveCourtTime(court, ci, league, week.time);
        const showCourtTime = courtTime && courtTime !== week.time;
        return (
          <div key={court.courtName} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, padding: "5px 8px", borderRadius: 6, background: color + "12", border: `0.5px solid ${color}40` }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 11, color, letterSpacing: "0.4px", minWidth: 60 }}>
              {displayName.toUpperCase()}
            </span>
            {showCourtTime && (
              <span style={{ fontSize: 11, fontWeight: 600, color, opacity: 0.85 }}>
                {formatTime(courtTime)}
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--color-text-primary)", flex: 1, minWidth: 0 }}>
              {court.playerNames.join(" · ")}
            </span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>
              {court.players.length} players
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Apply a court-groups edit to a single week of the proposal: rebuild the
// matches arrays for the courts whose players changed, refresh playerNames,
// and return a new week object. Pure — does not mutate input.
function applyWeekEdit(week, newGroups, league, playerNamesById) {
  const isLadderOrRR = true; // shape is the same for both
  void isLadderOrRR;
  const format = league.format || "Singles";
  const courts = week.courts.map((c, ci) => {
    const oldPlayers = c.players;
    const newPlayers = newGroups[ci] || [];
    // Same membership → keep existing matches (avoids reshuffling doubles
    // partner templates unnecessarily).
    const same = oldPlayers.length === newPlayers.length
      && oldPlayers.every(p => newPlayers.includes(p));
    if (same) {
      return {
        ...c,
        players: newPlayers,
        playerNames: newPlayers.map(pid => playerNamesById[pid] || pid),
      };
    }
    const matches = buildCourtMatches(newPlayers, week.week, ci, format, week.date);
    return {
      ...c,
      players: newPlayers,
      playerNames: newPlayers.map(pid => playerNamesById[pid] || pid),
      matches,
    };
  });
  return { ...week, courts };
}

// `preview` is what computeScheduleProposal returned. It must have:
//   - weeks: same shape as schedule data, but each court has a `playerNames`
//     array alongside `players` (pre-resolved for display)
//   - leagueName, summary (a one-line description)
//   - canRetry (bool): whether the "Try Again" button is shown
// `league` is the league record (for resolving league-level court defaults).
// `onAccept(finalProposal)` writes the proposal to the DB — receives the
// commissioner's edited version (or the original if nothing was changed).
// `onRetry` recomputes from scratch (only used if canRetry).
// `onCancel` closes the modal.
export function SchedulePreview({ preview, league, onAccept, onRetry, onCancel }) {
  const isCommitting = useIsActionPending("commit-schedule");
  const isMobile = useIsMobile();
  // Local mutable proposal so edits don't have to round-trip through the
  // parent. Reset when the parent supplies a new preview (after Try Again
  // or after a different generation entirely).
  const [localProposal, setLocalProposal] = useState(preview);
  // Which week is currently in edit mode. null = none (read-only view).
  const [editingWeek, setEditingWeek] = useState(null);

  useEffect(() => {
    setLocalProposal(preview);
    setEditingWeek(null);
  }, [preview]);

  if (!localProposal) return null;

  // Build an id → name lookup from the proposal. This stays stable across
  // edits because moving players between courts doesn't change their names.
  const playerNamesById = {};
  localProposal.weeks.forEach(w => {
    w.courts.forEach(c => {
      c.players.forEach((pid, i) => {
        playerNamesById[pid] = c.playerNames[i] || pid;
      });
    });
  });

  // Edit mode is desktop only. Drag-and-drop on touch devices is
  // unreliable enough that it would create more friction than it removes.
  const canEdit = !isMobile && !!league;

  function applyEdit(weekNum, newGroups) {
    setLocalProposal(p => {
      if (!p) return p;
      const weeks = p.weeks.map(w => {
        if (w.week !== weekNum) return w;
        return applyWeekEdit(w, newGroups, league, playerNamesById);
      });
      // Mirror weeks into the underlying `schedule` payload too — that's
      // what the commit writes to the DB. The `weeks` field above carries
      // the display copy (with playerNames); the schedule object is the
      // canonical one consumed by dbWriteSchedule.
      let nextSchedule = p.schedule;
      if (p.schedule) {
        nextSchedule = {
          ...p.schedule,
          weeks: p.schedule.weeks.map(w => {
            if (w.week !== weekNum) return w;
            // Strip playerNames from the edited week before storing in
            // schedule (storage layer doesn't expect them).
            const edited = applyWeekEdit(w, newGroups, league, playerNamesById);
            return {
              ...edited,
              courts: edited.courts.map(({ playerNames, ...rest }) => rest),
            };
          }),
        };
      }
      return { ...p, weeks, schedule: nextSchedule };
    });
  }

  return (
    <div>
      <div style={{ marginBottom: 12, padding: "12px 12px", background: CSC.blueLight, borderRadius: 8, border: `0.5px solid ${CSC.blue}30` }}>
        <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: CSC.blueDark, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Preview · not yet saved
        </p>
        <p style={{ margin: 0, fontSize: 13, color: CSC.blueDark }}>{localProposal.summary}</p>
        {canEdit && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: CSC.blueDark, opacity: 0.85 }}>
            Click "Edit courts" on any week to rearrange players. Other weeks won't be affected.
          </p>
        )}
      </div>

      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4, marginBottom: 12 }}>
        {localProposal.weeks.map(w => {
          if (editingWeek === w.week) {
            return (
              <WeekEditor
                key={w.week}
                week={w}
                league={league}
                playerNamesById={playerNamesById}
                onChange={newGroups => applyEdit(w.week, newGroups)}
                onDone={() => setEditingWeek(null)} />
            );
          }
          return (
            <PreviewWeek
              key={w.week}
              week={w}
              league={league}
              canEdit={canEdit && editingWeek === null}
              onEditClick={() => setEditingWeek(w.week)} />
          );
        })}
      </div>

      {localProposal.warning && (
        <div style={{ padding: "8px 12px", marginBottom: 12, background: "#FAEEDA", border: "0.5px solid #ECC580", borderRadius: 8, fontSize: 12, color: "#854F0B" }}>
          ⚠ {localProposal.warning}
        </div>
      )}

      <div style={{ ...S.row, justifyContent: "space-between", gap: 8 }}>
        <button style={S.btn("secondary")} onClick={onCancel} disabled={isCommitting}>Cancel</button>
        <div style={{ display: "flex", gap: 8 }}>
          {localProposal.canRetry && editingWeek === null && (
            <button style={S.btn("secondary")} onClick={onRetry} disabled={isCommitting}>↻ Try Again</button>
          )}
          {/* Label and color shift when we're about to overwrite an existing
              schedule. Plain "Generate" reads as creation; "Replace" admits
              the destructive nature. Red tint only when there are actual
              scores to lose — losing an empty prior schedule is low stakes. */}
          {(() => {
            const replacing = !!localProposal.isReplace;
            const destructive = localProposal.scoresWiped > 0;
            const label = isCommitting
              ? <><Spinner /> Saving…</>
              : replacing ? "Replace Schedule" : "Generate Schedule";
            const bg = destructive ? "#A32D2D" : undefined;
            return (
              <button
                style={{ ...S.btn("primary", bg), minWidth: 170 }}
                onClick={() => onAccept(localProposal)}
                disabled={isCommitting}>
                {label}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
