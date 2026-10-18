// ⌥⌘K creates a component (or combines components as variants), ⌥⌘B detaches instances.
import { createComponentFromSelection, detachSelection } from "../state/component-actions";

/** Handles component shortcuts; returns true when the event was used. */
export function handleComponentShortcut(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return false;
  // with ⌥ held, e.key is a special character on macOS, so match the physical key
  if (e.code === "KeyK") createComponentFromSelection();
  else if (e.code === "KeyB") detachSelection();
  else return false;
  e.preventDefault();
  return true;
}
