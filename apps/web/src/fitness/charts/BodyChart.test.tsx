import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FitnessDietTarget } from "@killingit/shared";
import { BodyChartSection } from "./BodyChart";

const days = [
  { date: "2026-10-20" },
  { date: "2026-10-21" },
  { date: "2026-10-22" },
];
const weight = [
  { date: "2026-10-20", value: 82 },
  { date: "2026-10-21", value: 81.8 },
  { date: "2026-10-22", value: 81.5 },
];
const bodyFat = [
  { date: "2026-10-20", value: 19 },
  { date: "2026-10-21", value: 18.9 },
  { date: "2026-10-22", value: 18.8 },
];
const dietTargets: FitnessDietTarget[] = [
  { date: "2026-11-01", weightKg: 80, bodyFatPercent: 18 },
  { date: "2026-12-01", weightKg: 78, bodyFatPercent: 16 },
];

function renderChart(
  overrides: Partial<Parameters<typeof BodyChartSection>[0]> = {},
) {
  const user = userEvent.setup();
  const { container } = render(
    <BodyChartSection
      days={days}
      weight={weight}
      bodyFat={bodyFat}
      today="2026-10-22"
      seasonEndDate="2026-12-31"
      dietTargets={dietTargets}
      {...overrides}
    />,
  );
  return { container, user };
}

/** The `d` attribute of the path a chart draws for one series. */
function pathData(html: string, series: string): string {
  const match = html.match(
    new RegExp(`d="([^"]*)"[^>]*data-series="${series}"`),
  );
  return match?.[1] ?? "";
}

describe("BodyChartSection", () => {
  it("offers the season view when diet targets exist", () => {
    renderChart();

    expect(screen.getByTestId("body-chart-future-toggle")).toBeDefined();
    expect(screen.getByLabelText(/Include future dates/)).toBeDefined();
  });

  it("draws the coach's dotted target lines only when the season view is on", async () => {
    const { container, user } = renderChart();
    expect(container.innerHTML).not.toContain(
      'data-series="diet-target-weight"',
    );
    expect(container.innerHTML).not.toContain("Estimated diet progress");

    await user.click(screen.getByTestId("body-chart-future-toggle"));

    expect(container.innerHTML).toContain('data-series="diet-target-weight"');
    expect(container.innerHTML).toContain('data-series="diet-target-body-fat"');
    expect(container.innerHTML).toContain('data-target-date="2026-11-01"');
    expect(container.innerHTML).toContain('data-target-date="2026-12-01"');
    expect(container.innerHTML).toContain("Estimated diet progress");
  });

  it("joins the sparse target points into one line", async () => {
    const { container, user } = renderChart();
    await user.click(screen.getByTestId("body-chart-future-toggle"));

    const line = pathData(container.innerHTML, "diet-target-weight");

    // The targets are weeks or months apart, so a broken line would show one
    // subpath per target instead of one trend.
    expect(line.match(/M/g)).toHaveLength(1);
    expect(line.match(/L/g)?.length).toBeGreaterThan(0);
  });

  it("hides the season view without a diet target", () => {
    renderChart({ dietTargets: [] });

    expect(screen.queryByTestId("body-chart-future-toggle")).toBeNull();
  });

  it("hides the season view when the season ends today", () => {
    renderChart({ seasonEndDate: "2026-10-22" });

    expect(screen.queryByTestId("body-chart-future-toggle")).toBeNull();
  });

  it("hides the chart without measurements", () => {
    const { container } = renderChart({ weight: [], bodyFat: [] });

    expect(container.innerHTML).toBe("");
  });
});
