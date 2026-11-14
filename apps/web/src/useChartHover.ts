import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FitnessHistoryDay } from "@killingit/shared";
import { CHART_PADDING, CHART_WIDTH, indexAt } from "./chartGeometry";
import { useChartKeyboard } from "./useChartKeyboard";

/** The day under the pointer, and where to draw its marker and hover card. */
export interface HoveredChartDay<
  T extends { date: string } = FitnessHistoryDay,
> {
  day: T;
  /** X in plot coordinates. */
  x: number;
  /** The hover card's offset, as a share of the chart's width. */
  percent: number;
}

const PLOT_WIDTH = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;

/**
 * Follows the pointer across a chart and resolves the nearest day, and does the
 * same for the keyboard cursor shared with `ChartFrame`. `dayAt` maps a point
 * index to the athlete's day, which lets the FTP chart snap by its own points
 * while still describing the day.
 *
 * `hovered` is what the marker and the card draw, whichever device moved it.
 * `announced` is set only when the keyboard moved the cursor, so a polite live
 * region reads a day the athlete asked for and stays quiet while a pointer
 * sweeps the plot.
 */
export function useChartHover<T extends { date: string }>(
  count: number,
  dayAt: (index: number) => T | undefined,
): {
  hovered: HoveredChartDay<T> | null;
  announced: HoveredChartDay<T> | null;
  /** The id of the keyboard instruction the chart's SVG describes itself with. */
  instructionId: string;
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerLeave: () => void;
  onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void;
  onBlur: () => void;
} {
  const [pointerHovered, setPointerHovered] =
    useState<HoveredChartDay<T> | null>(null);
  const keyboard = useChartKeyboard(count);

  function hoveredDay(index: number): HoveredChartDay<T> | null {
    const day = dayAt(index);
    if (day === undefined) {
      return null;
    }
    const x = count <= 1 ? PLOT_WIDTH / 2 : (index / (count - 1)) * PLOT_WIDTH;
    return {
      day,
      x,
      // Keep the card inside the chart's edges.
      percent: Math.min(
        80,
        Math.max(20, ((CHART_PADDING.left + x) / CHART_WIDTH) * 100),
      ),
    };
  }

  const keyboardHovered =
    keyboard.index === null ? null : hoveredDay(keyboard.index);

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    // The pointer takes over from the keyboard cursor. Clearing it also keeps
    // the live region quiet while the pointer moves.
    keyboard.clear();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) {
      return;
    }
    // Work in viewBox units so the hover follows the rendered scale.
    const viewX =
      ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH -
      CHART_PADDING.left;
    setPointerHovered(hoveredDay(indexAt(viewX / PLOT_WIDTH, count)));
  }

  return {
    hovered: keyboard.index === null ? pointerHovered : keyboardHovered,
    announced: keyboardHovered,
    instructionId: keyboard.instructionId,
    onPointerMove,
    onPointerLeave: () => setPointerHovered(null),
    onKeyDown: keyboard.onKeyDown,
    onBlur: () => {
      keyboard.onBlur();
      setPointerHovered(null);
    },
  };
}
