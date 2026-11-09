import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chartScale } from "./chartGeometry";
import { ChartFrame } from "./ChartFrame";

const days = [
  { date: "2026-10-20" },
  { date: "2026-10-21" },
  { date: "2026-10-22" },
  { date: "2026-10-23" },
];
const scale = chartScale(days.length, { min: 0, max: 100 });

describe("ChartFrame", () => {
  it("draws the shared caption, axes, date labels and plot content", () => {
    const html = renderToStaticMarkup(
      <ChartFrame
        title="Resting heart rate"
        subtitle="bpm"
        label="Resting heart rate chart"
        days={days}
        scale={scale}
        ticks={[0, 50, 100]}
        formatTick={(value) => `${value} bpm`}
        rightTicks={[10, 20]}
        formatRightTick={(value) => `${value}%`}
        legend={<span>Legend</span>}
        footer={<p>Footer</p>}
        svgTestId="shared-chart"
        figureProps={{ "data-testid": "shared-frame", "data-unit": "bpm" }}
      >
        {(hovered) => (
          <path d="M0 0" data-series="test" data-hovered={hovered !== null} />
        )}
      </ChartFrame>,
    );

    expect(html).toContain('data-testid="shared-frame"');
    expect(html).toContain('data-unit="bpm"');
    expect(html).toContain("Resting heart rate");
    expect(html).toContain("bpm");
    expect(html).toContain('viewBox="0 0 640 320"');
    expect(html).toContain('data-testid="shared-chart"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Resting heart rate chart"');
    expect(html).toContain("0 bpm");
    expect(html).toContain("50 bpm");
    expect(html).toContain("100 bpm");
    expect(html).toContain("10%");
    expect(html).toContain("20%");
    expect(html).toContain("20 Oct");
    expect(html).toContain("23 Oct");
    expect(html).toContain('data-series="test"');
    expect(html).toContain("Legend");
    expect(html).toContain("Footer");
  });

  it("omits the caption for a chart with its own heading", () => {
    const html = renderToStaticMarkup(
      <ChartFrame
        label="Estimated threshold"
        days={days}
        scale={scale}
        ticks={[0, 100]}
        svgTitle="Estimated threshold in watts"
      >
        {() => null}
      </ChartFrame>,
    );

    expect(html).not.toContain("<figcaption");
    expect(html).toContain("<title>Estimated threshold in watts</title>");
  });
});
