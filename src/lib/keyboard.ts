/** Helpers to let global keyboard shortcuts coexist with real text fields and modal dialogs. */

/** Is the event aimed at something the user is typing into? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A dialog, alert dialog or open select list is on screen: it owns the keyboard. */
export function isOverlayOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]') !== null;
}

/** Ctrl/⌘ combos are shortcuts, not typing (AltGr on Windows reports ctrl+alt, so it is let through). */
export function isShortcut(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "getModifierState">): boolean {
  const altGr = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
  return (e.ctrlKey || e.metaKey) && !altGr;
}
