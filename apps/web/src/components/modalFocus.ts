/**
 * The index a Tab press moves to inside a dialog that traps focus.
 *
 * `count` is the number of focusable elements and `activeIndex` is the
 * position of the currently focused one, or `-1` when focus sits on the panel
 * itself or has escaped. `null` means the browser's own move already stays
 * inside the dialog, so the key press needs no handling.
 */
export function trappedFocusIndex(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count === 0) {
    return activeIndex === -1 ? null : -1;
  }
  if (activeIndex === -1) {
    return shiftKey ? count - 1 : 0;
  }
  if (shiftKey && activeIndex === 0) {
    return count - 1;
  }
  if (!shiftKey && activeIndex === count - 1) {
    return 0;
  }
  return null;
}
