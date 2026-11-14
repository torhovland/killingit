import { useId, useState, type KeyboardEvent } from "react";

/**
 * What the keyboard does on a chart. Every chart names it in a visually hidden
 * instruction that its focusable `<svg>` points at with `aria-describedby`.
 */
export const CHART_KEYBOARD_HINT =
  "Use the left and right arrow keys to step through the values, Home and End to jump to the first and last, and Escape to clear the selection.";

/**
 * One keyboard cursor across a chart's positions. The chart is a single tab
 * stop: the left and right arrow keys move the cursor, Home and End jump to the
 * ends, and Escape, or leaving the chart, clears it. Up and down are
 * deliberately unbound so a focused chart never takes the page's vertical
 * scrolling away; Home and End belong to the focused widget, so they are
 * prevented. See `docs/specs/chart-keyboard-navigation.md` and ADR 0051.
 */
export function useChartKeyboard(count: number): {
  /** The selected position, or null when nothing is selected. */
  index: number | null;
  /** The id of the element holding `CHART_KEYBOARD_HINT`. */
  instructionId: string;
  onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void;
  onBlur: () => void;
  /**
   * Drops the selection, so a pointer move can take over without leaving a
   * stale cursor or announcing what the pointer touched.
   */
  clear: () => void;
} {
  const [selected, setSelected] = useState<number | null>(null);
  const instructionId = useId();
  const last = Math.max(0, count - 1);
  // A chart can lose positions, such as the body chart's season view closing,
  // so a stored position is clamped to what is on screen now.
  const index = selected === null ? null : Math.min(selected, last);

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>): void {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        setSelected(Math.min(last, (index ?? -1) + 1));
        return;
      case "ArrowLeft":
        event.preventDefault();
        setSelected(Math.max(0, (index ?? last + 1) - 1));
        return;
      case "Home":
        event.preventDefault();
        setSelected(0);
        return;
      case "End":
        event.preventDefault();
        setSelected(last);
        return;
      case "Escape":
        setSelected(null);
        return;
      default:
        return;
    }
  }

  return {
    index,
    instructionId,
    onKeyDown,
    onBlur: () => setSelected(null),
    clear: () => setSelected(null),
  };
}
