import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivitySamples } from "./ActivitySamples";

const samples = [
  {
    timestamp: "2026-10-01T06:30:00Z",
    heartRate: 120,
    power: 180,
    speed: 7.5,
    distance: 0,
    elevation: 40,
    cadence: 76,
  },
  {
    timestamp: "2026-10-01T06:40:00Z",
    heartRate: 150,
    power: 240,
    speed: 9,
    distance: 5000,
    elevation: 80,
    cadence: 78,
  },
];

describe("ActivitySamples", () => {
  it("renders a collapsible table of the recorded channels", () => {
    const html = renderToStaticMarkup(
      <ActivitySamples
        samples={samples}
        sampleCount={600}
        activityType="running"
      />,
    );

    expect(html).toContain('data-testid="activity-samples"');
    expect(html).toContain("Recorded samples (2 of 600 shown)");
    expect(html).toContain("Elapsed");
    expect(html).toContain("HR bpm");
    expect(html).toContain("Power W");
    expect(html).toContain("Cadence spm");
    expect(html).toContain("Speed km/h");
    expect(html).toContain("Distance km");
    expect(html).toContain("Elevation m");
    expect(html).toContain("10:00");
    expect(html).toContain("27.0");
  });

  it("uses rpm for cadence on rides", () => {
    const html = renderToStaticMarkup(
      <ActivitySamples
        samples={samples}
        sampleCount={2}
        activityType="indoor_cycling"
      />,
    );

    expect(html).toContain("Cadence rpm");
    expect(html).not.toContain("Cadence spm");
  });

  it("omits channels that were not recorded", () => {
    const html = renderToStaticMarkup(
      <ActivitySamples
        samples={[{ timestamp: "2026-10-01T06:30:00Z", heartRate: 140 }]}
        sampleCount={1}
        activityType="running"
      />,
    );

    expect(html).toContain("HR bpm");
    expect(html).not.toContain("Power W");
    expect(html).not.toContain("Cadence");
  });
});
