import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChartHover } from "./useChartHover";
import { CHART_KEYBOARD_HINT } from "./useChartKeyboard";

const days = [
  { date: "2026-10-20", score: 41 },
  { date: "2026-10-21", score: 42 },
  { date: "2026-10-22", score: 43 },
];

/**
 * The shared hover hook on a minimal chart: the SVG is the tab stop, the card
 * shows what the marker would draw, and the live region shows what is
 * announced.
 */
function ChartHarness() {
  const {
    hovered,
    announced,
    instructionId,
    onPointerMove,
    onPointerLeave,
    onKeyDown,
    onBlur,
  } = useChartHover(days.length, (index) => days[index]);
  return (
    <figure>
      <svg
        role="img"
        aria-label="Harness chart"
        aria-describedby={instructionId}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <title>Harness chart</title>
      </svg>
      <p id={instructionId} className="sr-only">
        {CHART_KEYBOARD_HINT}
      </p>
      <p data-testid="card">{describeDay(hovered?.day)}</p>
      <div role="status" aria-live="polite">
        {describeDay(announced?.day)}
      </div>
      <button type="button">after the chart</button>
    </figure>
  );
}

function describeDay(day: { date: string; score: number } | undefined): string {
  return day === undefined ? "" : `${day.date} score ${day.score}`;
}

function announced(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("useChartHover", () => {
  it("starts with no card and nothing announced", () => {
    render(<ChartHarness />);

    expect(screen.getByTestId("card").textContent).toBe("");
    expect(announced()).toBe("");
  });

  it("is one keyboard stop whose description names the keys", async () => {
    const user = userEvent.setup();
    render(<ChartHarness />);

    await user.tab();
    const chart = screen.getByRole("img", { name: "Harness chart" });
    expect(document.activeElement).toBe(chart);

    const instructionId = chart.getAttribute("aria-describedby") ?? "";
    const instruction = document.getElementById(instructionId);
    expect(instruction?.textContent).toContain("left and right arrow keys");
    expect(instruction?.textContent).toContain("Home and End");
    expect(instruction?.textContent).toContain("Escape");
  });

  it("steps through the days with the arrow keys and announces each one", async () => {
    const user = userEvent.setup();
    render(<ChartHarness />);
    await user.tab();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("card").textContent).toBe("2026-10-20 score 41");
    expect(announced()).toBe("2026-10-20 score 41");

    await user.keyboard("{ArrowRight}");
    expect(announced()).toBe("2026-10-21 score 42");

    await user.keyboard("{ArrowLeft}");
    expect(announced()).toBe("2026-10-20 score 41");

    // The first day is the end of the line, not a wrap-around.
    await user.keyboard("{ArrowLeft}");
    expect(announced()).toBe("2026-10-20 score 41");
    await user.keyboard("{End}");
    await user.keyboard("{ArrowRight}");
    expect(announced()).toBe("2026-10-22 score 43");
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    render(<ChartHarness />);
    await user.tab();

    await user.keyboard("{End}");
    expect(screen.getByTestId("card").textContent).toBe("2026-10-22 score 43");
    await user.keyboard("{Home}");
    expect(announced()).toBe("2026-10-20 score 41");
  });

  it("clears the card and the announcement on Escape and on blur", async () => {
    const user = userEvent.setup();
    render(<ChartHarness />);
    await user.tab();

    await user.keyboard("{ArrowRight}");
    expect(announced()).not.toBe("");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("card").textContent).toBe("");
    expect(announced()).toBe("");

    await user.keyboard("{ArrowRight}");
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "after the chart" }),
    );
    expect(screen.getByTestId("card").textContent).toBe("");
    expect(announced()).toBe("");
  });

  it("keeps the live region quiet while the pointer moves", () => {
    render(<ChartHarness />);
    const chart = screen.getByRole("img", { name: "Harness chart" });
    chart.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 320,
      width: 640,
      height: 320,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(chart, { clientX: 0 });
    expect(screen.getByTestId("card").textContent).toBe("2026-10-20 score 41");
    // A pointer sweeping the plot marks the day but reads nothing aloud.
    expect(announced()).toBe("");
  });

  it("ignores keys it does not own", async () => {
    const user = userEvent.setup();
    render(<ChartHarness />);
    await user.tab();

    await user.keyboard("{ArrowUp}{ArrowDown}a");
    expect(screen.getByTestId("card").textContent).toBe("");
    expect(announced()).toBe("");
  });
});
