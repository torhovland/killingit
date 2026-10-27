import { useState, type PointerEvent } from "react";
import type { FitnessHistoryDay } from "@killingit/shared";
import { CHART_PADDING, CHART_WIDTH, indexAt } from "./chartGeometry";

/** The day under the pointer, and where to draw its marker and hover card. */
export interface HoveredChartDay {
  day: FitnessHistoryDay;
  /** X in plot coordinates. */
  x: number;
  /** The hover card's offset, as a share of the chart's width. */
  percent: number;
}

const PLOT_WIDTH = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;

/**
 * Follows the pointer across a chart and resolves the nearest day. Shared by
 * the fitness and FTP charts so both show the same hover card. `dayAt` maps a
 * point index to the athlete's day, which lets the FTP chart snap by its own
 * points while still describing the day.
 */
export function useChartHover(
  count: number,
  dayAt: (index: number) => FitnessHistoryDay | undefined,
): {
  hovered: HoveredChartDay | null;
  onPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onPointerLeave: () => void;
} {
  const [hovered, setHovered] = useState<HoveredChartDay | null>(null);

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) {
      return;
    }
    // Work in viewBox units so the hover follows the rendered scale.
    const viewX =
      ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH -
      CHART_PADDING.left;
    const index = indexAt(viewX / PLOT_WIDTH, count);
    const day = dayAt(index);
    if (day === undefined) {
      setHovered(null);
      return;
    }
    const x = count <= 1 ? PLOT_WIDTH / 2 : (index / (count - 1)) * PLOT_WIDTH;
    setHovered({
      day,
      x,
      // Keep the card inside the chart's edges.
      percent: Math.min(
        80,
        Math.max(20, ((CHART_PADDING.left + x) / CHART_WIDTH) * 100),
      ),
    });
  }

  return {
    hovered,
    onPointerMove,
    onPointerLeave: () => setHovered(null),
  };
}
