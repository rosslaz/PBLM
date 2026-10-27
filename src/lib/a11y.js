// ─── Keyboard support for clickable containers (v1.15.2) ───────────────────
// Week headers, the RSVP summary bar, standings cards and league cards are
// clickable boxes rather than <button>s — several contain buttons of their
// own, and buttons can't nest. As plain <div onClick>s they were unreachable
// by keyboard: Tab skipped them and Enter did nothing, so a keyboard user
// could only ever see the one week that opens by default.
//
// Spread the result onto the element:  <div {...pressable(toggle, { expanded })}>
//
// Keys pressed while focus is on a nested control (a Lock button inside a
// week header, say) are ignored here — they belong to that control.
export function pressable(onActivate, { expanded, label, disabled = false } = {}) {
  return {
    role: "button",
    tabIndex: disabled ? -1 : 0,
    "aria-expanded": expanded,
    "aria-label": label,
    "aria-disabled": disabled || undefined,
    onClick: e => { if (!disabled) onActivate(e); },
    onKeyDown: e => {
      if (disabled || e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();               // stop Space from scrolling the page
        onActivate(e);
      }
    },
  };
}
