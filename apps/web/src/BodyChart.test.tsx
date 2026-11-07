import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessDietTarget } from "@killingit/shared";
import { BodyChart } from "./BodyChart";

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

function render(overrides: Partial<Parameters<typeof BodyChart>[0]> = {}) {
  return renderToStaticMarkup(
    <BodyChart
      days={days}
      weight={weight}
      bodyFat={bodyFat}
      today="2026-10-22"
      seasonEndDate="2026-12-31"
      dietTargets={dietTargets}
      onShowFutureChange={() => undefined}
      {...overrides}
    />,
  );
}

describe("BodyChart", () => {
  it("offers the season view when diet targets exist", () => {
    const html = render();
    expect(html).toContain('data-testid="body-chart-future-toggle"');
    expect(html).toContain("Include future dates to the end of the season");
  });

  it("draws the coach's dotted target lines only when the season view is on", () => {
    const off = render();
    expect(off).not.toContain('data-series="diet-target-weight"');
    expect(off).not.toContain("Estimated diet progress");

    const on = render({ showFuture: true });
    expect(on).toContain('data-series="diet-target-weight"');
    expect(on).toContain('data-series="diet-target-body-fat"');
    expect(on).toContain('data-target-date="2026-11-01"');
    expect(on).toContain('data-target-date="2026-12-01"');
    expect(on).toContain("Estimated diet progress");
  });

  it("hides the season view without a target or a future season end", () => {
    expect(render({ dietTargets: [] })).not.toContain(
      'data-testid="body-chart-future-toggle"',
    );
    expect(render({ seasonEndDate: "2026-10-22" })).not.toContain(
      'data-testid="body-chart-future-toggle"',
    );
  });

  it("hides the chart without measurements", () => {
    const html = render({ weight: [], bodyFat: [] });
    expect(html).toBe("");
  });
});
