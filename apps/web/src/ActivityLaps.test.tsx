import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLaps } from "./ActivityLaps";

const laps = [
  {
    index: 1,
    type: "active",
    movingTime: 600,
    elapsedTime: 610,
    distance: 3050,
    averagePower: 180,
    maxPower: 240,
    averageSpeed: 7.5,
    averageHeartRate: 135,
    maxHeartRate: 142,
    averageCadence: 88,
    totalElevationGain: 12,
  },
  {
    index: 2,
    type: "active",
    movingTime: 240,
    distance: 1200,
    averagePower: 350,
    maxPower: 420,
    averageSpeed: 5,
    averageHeartRate: 168,
    maxHeartRate: 175,
    averageCadence: 90,
  },
];

describe("ActivityLaps", () => {
  it("renders a collapsible table of the recorded laps and their averages", () => {
    const html = renderToStaticMarkup(
      <ActivityLaps laps={laps} activityType="road_biking" />,
    );

    expect(html).toContain('data-testid="activity-laps"');
    expect(html).toContain("Recorded laps (2)");
    expect(html).toContain("Lap");
    expect(html).toContain("Time");
    expect(html).toContain("Distance km");
    expect(html).toContain("Speed km/h");
    expect(html).toContain("Avg power W");
    expect(html).toContain("Max power W");
    expect(html).toContain("Avg HR bpm");
    expect(html).toContain("Max HR bpm");
    expect(html).toContain("Cadence rpm");
    expect(html).toContain("Elevation m");
    expect(html).toContain("1 (active)");
    expect(html).toContain("10:00");
    expect(html).toContain("3.05");
    expect(html).toContain("27.0");
    expect(html).toContain("350");
    expect(html).toContain("420");
    expect(html).toContain("168");
    expect(html).toContain("90");
    expect(html).toContain("12");
  });

  it("shows pace for pace-based sports and omits unrecorded columns", () => {
    const html = renderToStaticMarkup(
      <ActivityLaps
        laps={[
          {
            index: 1,
            movingTime: 240,
            distance: 1200,
            averageSpeed: 5,
            averageHeartRate: 168,
          },
        ]}
        activityType="running"
      />,
    );

    expect(html).toContain("Pace /km");
    expect(html).toContain("3:20 /km");
    expect(html).toContain("Avg HR bpm");
    expect(html).not.toContain("Power W");
    expect(html).not.toContain("Cadence");
    expect(html).not.toContain("Elevation m");
  });
});
