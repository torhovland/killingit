import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryResponse } from "@killingit/shared";
import { FitnessView } from "./FitnessView";

function history(
  overrides: Partial<FitnessHistoryResponse> = {},
): FitnessHistoryResponse {
  return {
    days: [
      {
        date: "2026-10-20",
        tss: 0,
        atl: 20,
        ctl: 40,
        tsb: 20,
        activities: [],
        planned: null,
      },
      {
        date: "2026-10-21",
        tss: 80,
        atl: 28.6,
        ctl: 41,
        tsb: 12.4,
        activities: [],
        planned: {
          title: "Endurance ride",
          type: "workout",
          durationMinutes: 90,
        },
      },
      {
        date: "2026-10-22",
        tss: 60,
        atl: 33.1,
        ctl: 41.5,
        tsb: 8.4,
        activities: [
          {
            id: "activity-1",
            name: "Morning ride",
            type: "cycling",
            durationMinutes: 60,
          },
        ],
        planned: null,
      },
    ],
    thresholds: [
      {
        sport: "cycling",
        measure: "ftp",
        label: "FTP",
        unit: "W",
        kind: "power",
        points: [
          { date: "2026-10-20", value: 250 },
          { date: "2026-10-21", value: 250 },
          { date: "2026-10-22", value: 255 },
        ],
      },
      {
        sport: "running",
        measure: "threshold_pace",
        label: "Threshold pace",
        unit: "s/km",
        kind: "pace",
        points: [
          { date: "2026-10-20", value: 270 },
          { date: "2026-10-21", value: 269 },
          { date: "2026-10-22", value: 268 },
        ],
      },
    ],
    body: {
      weight: [
        { date: "2026-10-20", value: 78.2 },
        { date: "2026-10-21", value: 78.1 },
        { date: "2026-10-22", value: 78.0 },
      ],
      bodyFat: [{ date: "2026-10-20", value: 18.4 }],
    },
    latestGarmin: {
      dailyHealth: [
        { metric: "resting_heart_rate", date: "2026-10-22", value: 52 },
        { metric: "hrv", date: "2026-10-22", value: 48 },
        { metric: "body_battery_high", date: "2026-10-22", value: 75 },
        { metric: "body_battery_low", date: "2026-10-22", value: 20 },
        { metric: "stress", date: "2026-10-22", value: 26 },
        { metric: "steps", date: "2026-10-22", value: 8200 },
        { metric: "intensity_minutes", date: "2026-10-22", value: 30 },
        { metric: "active_calories", date: "2026-10-22", value: 640 },
        { metric: "respiration", date: "2026-10-22", value: 14.2 },
        { metric: "spo2", date: "2026-10-22", value: 96 },
        { metric: "training_readiness", date: "2026-10-22", value: 78 },
        { metric: "recovery_time", date: "2026-10-22", value: 600 },
        { metric: "vo2max", date: "2026-10-22", value: 48.5 },
        { metric: "vo2max_cycling", date: "2026-10-22", value: 43 },
        { metric: "sleep_score", date: "2026-10-22", value: 84 },
        { metric: "sleep_duration", date: "2026-10-22", value: 430 },
        { metric: "deep_sleep", date: "2026-10-22", value: 80 },
        { metric: "rem_sleep", date: "2026-10-22", value: 100 },
        { metric: "light_sleep", date: "2026-10-22", value: 220 },
        { metric: "awake_sleep", date: "2026-10-22", value: 8 },
      ],
      weight: { date: "2026-10-21", value: 78.2 },
      bodyFat: null,
      ftp: { date: "2026-10-01", value: 250 },
    },
    dailyHealth: [
      { metric: "resting_heart_rate", date: "2026-10-20", value: 54 },
      { metric: "resting_heart_rate", date: "2026-10-21", value: 53 },
      { metric: "resting_heart_rate", date: "2026-10-22", value: 52 },
      { metric: "body_battery_high", date: "2026-10-20", value: 65 },
      { metric: "body_battery_high", date: "2026-10-21", value: 70 },
      { metric: "body_battery_high", date: "2026-10-22", value: 75 },
      { metric: "sleep_score", date: "2026-10-20", value: 80 },
      { metric: "sleep_score", date: "2026-10-21", value: 82 },
      { metric: "sleep_score", date: "2026-10-22", value: 84 },
      { metric: "stress", date: "2026-10-20", value: 30 },
      { metric: "stress", date: "2026-10-21", value: 28 },
      { metric: "stress", date: "2026-10-22", value: 26 },
      { metric: "deep_sleep", date: "2026-10-20", value: 70 },
      { metric: "deep_sleep", date: "2026-10-21", value: 75 },
      { metric: "deep_sleep", date: "2026-10-22", value: 80 },
      { metric: "light_sleep", date: "2026-10-20", value: 200 },
      { metric: "light_sleep", date: "2026-10-21", value: 210 },
      { metric: "light_sleep", date: "2026-10-22", value: 220 },
      { metric: "rem_sleep", date: "2026-10-20", value: 90 },
      { metric: "rem_sleep", date: "2026-10-21", value: 95 },
      { metric: "rem_sleep", date: "2026-10-22", value: 100 },
      { metric: "awake_sleep", date: "2026-10-20", value: 10 },
      { metric: "awake_sleep", date: "2026-10-21", value: 12 },
      { metric: "awake_sleep", date: "2026-10-22", value: 8 },
      { metric: "sleep_duration", date: "2026-10-20", value: 360 },
      { metric: "sleep_duration", date: "2026-10-21", value: 380 },
      { metric: "sleep_duration", date: "2026-10-22", value: 400 },
    ],
    nutrition: [],
    seasonEndDate: null,
    dietTargets: [],
    ...overrides,
  };
}

function view(
  overrides: Partial<Parameters<typeof FitnessView>[0]> = {},
): string {
  return renderToStaticMarkup(
    <FitnessView
      history={history()}
      today="2026-10-22"
      range="month"
      onRangeChange={() => undefined}
      {...overrides}
    />,
  );
}

describe("FitnessView", () => {
  it("shows today's load with its form interpretation", () => {
    const html = view();

    expect(html).toContain("Fitness");
    // The summary spells each metric out and keeps the acronym beside it.
    expect(html).toContain("Training stress 60");
    expect(html).toContain("Fatigue 33");
    expect(html).toContain("Fitness 42");
    expect(html).toContain("Form +8");
    for (const acronym of ["TSS", "ATL", "CTL", "TSB"]) {
      expect(html).toContain(`(${acronym})`);
    }
    expect(html).toContain("Fresh");
  });

  it("splits the latest Garmin readings into a general and Sleep column", () => {
    const html = view();
    const leftStart = html.indexOf('data-testid="fitness-today-garmin-left"');
    const sleepStart = html.indexOf('data-testid="fitness-today-garmin-sleep"');

    expect(html).not.toContain("Latest Garmin data");
    expect(leftStart).toBeGreaterThan(-1);
    expect(sleepStart).toBeGreaterThan(leftStart);

    const left = html.slice(leftStart, sleepStart);
    for (const expected of [
      "Resting heart rate",
      "52 bpm",
      "Overnight HRV",
      "48 ms",
      "Body Battery high",
      "75",
      "Body Battery low",
      "20",
      "Stress",
      "26",
      "Steps",
      "8200",
      "Intensity minutes",
      "30 min",
      "Active calories",
      "640 kcal",
      "Respiration",
      "14.2 breaths/min",
      "SpO2",
      "96 %",
      "Training readiness",
      "78",
      "Recovery time",
      "10 h",
      "VO2max",
      "48.5 ml/kg/min",
      "Cycling VO2max",
      "43.0 ml/kg/min",
      "Weight",
      "78.2 kg",
      "FTP measurement",
      "250 W",
    ]) {
      expect(left).toContain(expected);
    }

    const sleep = html.slice(sleepStart);
    expect(sleep).toContain("Sleep");
    for (const expected of [
      "Sleep score",
      "84",
      "Sleep duration",
      "7 h 10 min",
      "Deep sleep",
      "1 h 20 min",
      "REM sleep",
      "1 h 40 min",
      "Light sleep",
      "3 h 40 min",
      "Awake during sleep",
      "8 min",
    ]) {
      expect(sleep).toContain(expected);
    }
  });

  it("draws the recovery, score and stacked sleep charts", () => {
    const html = view();

    expect(html).toContain('data-testid="daily-health-charts"');
    expect(html).toContain("Recovery and sleep");
    expect(html).toContain("Resting heart rate");
    expect(html).toContain('data-series="resting_heart_rate"');
    expect(html).toContain("Score");
    expect(html).toContain('data-series="body_battery_high"');
    expect(html).toContain('data-series="sleep_score"');
    expect(html).toContain('data-series="stress"');
    expect(html).toContain('data-testid="sleep-chart"');
    expect(html).toContain('data-series="deep_sleep"');
    expect(html).toContain('data-series="light_sleep"');
    expect(html).toContain('data-series="rem_sleep"');
    expect(html).toContain("Stacked stages add up to sleep duration.");
  });

  it("hides the Garmin panels and charts without daily health data", () => {
    const html = view({
      history: history({
        latestGarmin: {
          dailyHealth: [],
          weight: null,
          bodyFat: null,
          ftp: null,
        },
        dailyHealth: [],
      }),
    });

    expect(html).not.toContain('data-testid="fitness-today-garmin-left"');
    expect(html).not.toContain('data-testid="fitness-today-garmin-sleep"');
    expect(html).not.toContain('data-testid="daily-health-charts"');
  });

  it("offers every range in the picker above the charts", () => {
    const html = view();
    const picker = html.slice(
      html.indexOf("<select"),
      html.indexOf('data-testid="fitness-chart"'),
    );

    for (const label of ["Week", "Month", "Quarter", "Year", "All time"]) {
      expect(picker).toContain(`>${label}</option>`);
    }
    expect(picker).toContain('value="month" selected');
  });

  it("shades the chart with the TSB zone colours and names every zone", () => {
    const html = view();

    expect(html).toContain('data-testid="fitness-chart"');
    for (const zone of [
      "risk",
      "productive",
      "maintaining",
      "fresh",
      "detraining",
    ]) {
      expect(html).toContain(`data-testid="form-zone-${zone}"`);
    }
    expect(html).toContain("fill-form-productive/[62.5%]");
    expect(html).toContain("Productive");
    expect(html).not.toContain("above +25");
  });

  it("draws the TSB line in the zone colours and lists the zones first", () => {
    const html = view();

    expect(html).toContain("stroke-form-fresh-line");
    // The zone legend comes first, then the CTL/ATL/TSB legend (whose name also
    // appears in the chart's accessible label, hence the last match).
    expect(html.indexOf("Detraining")).toBeLessThan(
      html.lastIndexOf("Fitness (CTL)"),
    );
  });

  it("shows every known threshold in the Today panel", () => {
    const html = view();

    const todayPanel = html.slice(
      html.indexOf('data-testid="fitness-today-load"'),
      html.indexOf('data-testid="fitness-chart"'),
    );
    expect(todayPanel).toContain("FTP (cycling) 255 W");
    expect(todayPanel).toContain("Threshold pace (running) 4:28 /km");
    expect(html).toContain('data-testid="threshold-chart"');
    expect(html).toContain("Estimated threshold");
  });

  it("shows body weight and body fat when the athlete has measurements", () => {
    const html = view();

    expect(html).toContain('data-testid="body-chart"');
    expect(html).toContain("Weight (kg)");
    expect(html).toContain("Body fat (%)");
    expect(html).toContain('data-series="weight"');
    expect(html).toContain('data-series="body-fat"');
  });

  it("keeps the body units in the legend and out of the axis", () => {
    const html = view();
    const body = html.slice(html.indexOf('data-testid="body-chart"'));

    expect(body).not.toMatch(/>[\d.]+ ?(kg|%)</);
    expect(body).toContain("Weight (kg)");
    expect(body).toContain("Body fat (%)");
  });

  it("labels the body axis in the same size as the other charts", () => {
    const html = view();
    const body = html.slice(html.indexOf('data-testid="body-chart"'));

    expect(body).toContain("text-[10px]");
    expect(body).not.toContain("text-xs");
  });

  it("offers the body chart's season view when diet targets exist", () => {
    const html = view({
      history: history({
        seasonEndDate: "2026-12-31",
        dietTargets: [
          { date: "2026-11-01", weightKg: 77, bodyFatPercent: null },
        ],
      }),
    });

    expect(html).toContain('data-testid="body-chart-future-toggle"');
    expect(html).toContain("Include future dates to the end of the season");
  });

  it("hides the body chart without any measurements", () => {
    const html = view({
      history: history({ body: { weight: [], bodyFat: [] } }),
    });

    expect(html).not.toContain('data-testid="body-chart"');
  });

  it("shows only weight when there is no body-fat data", () => {
    const html = view({
      history: history({
        body: {
          weight: [{ date: "2026-10-20", value: 78.2 }],
          bodyFat: [],
        },
      }),
    });

    expect(html).toContain('data-testid="body-chart"');
    expect(html).toContain("Weight (kg)");
    expect(html).not.toContain("Body fat (%)");
  });

  it("hides the threshold chart when the athlete has no threshold", () => {
    const html = view({ history: history({ thresholds: [] }) });

    expect(html).not.toContain('data-testid="threshold-chart"');
    expect(html).not.toContain("Estimated threshold");
    expect(html).not.toContain('data-testid="fitness-today-thresholds"');
  });

  it("asks for training history when there is nothing to chart yet", () => {
    const html = view({ history: history({ days: [] }) });

    expect(html).toContain("Not enough history yet");
    expect(html).not.toContain('data-testid="fitness-chart"');
  });

  it("shows loading, updating, and error states", () => {
    expect(view({ history: null })).toContain("Loading…");
    expect(view({ loading: true })).toContain("Updating…");
    expect(view({ history: null, error: "Network down" })).toContain(
      "Error: Network down",
    );
  });
});
