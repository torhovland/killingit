import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CalendarImportedActivity,
  CalendarResponse,
  WeekSession,
} from "@killingit/shared";
import { CalendarEntryDialog, CalendarView } from "./CalendarView";

const recorded: CalendarImportedActivity = {
  source: "garmin",
  id: 123,
  name: "Morning ride",
  type: "cycling",
  startDate: "2026-10-06T07:00:00.000Z",
  distance: 25000,
  movingTime: 3600,
  elapsedTime: 3900,
  totalElevationGain: 300,
  sampleCount: 10,
  route: [
    { latitude: 59.9, longitude: 10.7 },
    { latitude: 59.92, longitude: 10.72 },
  ],
  analysis: null,
  analysisError: null,
  programAnalysis: {
    text: "This ride supported the week's aerobic focus.",
    model: "test/model",
    generatedAt: "2026-10-06T08:00:00.000Z",
  },
  comment: "Felt strong.",
  coachReply: {
    text: "Nice steady effort.",
    model: "test/model",
    generatedAt: "2026-10-06T08:05:00.000Z",
  },
  reviewed: false,
  trainingLoad: { tss: 50, atl: 40, ctl: 45, tsb: 5 },
};

const workout: WeekSession = {
  date: "2026-10-08",
  day: "Thursday",
  type: "workout",
  title: "Tempo ride",
  description: "Three blocks at tempo.",
  durationMinutes: 75,
  intensity: "moderate",
  status: "planned",
  estimatedTss: 70,
};

const rest: WeekSession = {
  date: "2026-10-07",
  day: "Wednesday",
  type: "rest",
  title: "Rest",
  description: "Take the day off.",
  durationMinutes: 0,
  intensity: "rest",
  status: "rest",
};

const data: CalendarResponse = {
  earliestDate: "2026-10-01",
  latestDate: "2026-12-31",
  season: {
    goal: "Ride a century.",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic",
        startDate: "2026-10-01",
        endDate: "2026-12-01",
        weekCount: 8,
      },
    ],
    rationale: "Build endurance.",
  },
  days: [
    {
      date: "2026-10-01",
      activities: [],
      session: null,
      blockStart: {
        name: "Base",
        focus: "Aerobic",
        startDate: "2026-10-01",
        endDate: "2026-12-01",
        weekCount: 8,
      },
      seasonEnd: false,
    },
    {
      date: "2026-10-05",
      activities: [
        {
          source: "manual",
          id: 7,
          name: "Club ride",
          details: "Club ride",
          startDate: "2026-10-05",
          coachReply: null,
          estimatedTss: 80,
        },
      ],
      session: null,
      blockStart: null,
      seasonEnd: false,
    },
    {
      date: "2026-10-06",
      activities: [recorded],
      session: null,
      blockStart: null,
      seasonEnd: false,
    },
    {
      date: "2026-10-07",
      activities: [],
      session: rest,
      blockStart: null,
      seasonEnd: false,
    },
    {
      date: "2026-10-08",
      activities: [],
      session: workout,
      blockStart: null,
      seasonEnd: false,
    },
  ],
};

describe("CalendarView", () => {
  it("renders a month of activities, workouts, rest days, and a block start", () => {
    const html = renderToStaticMarkup(
      <CalendarView
        data={data}
        month="2026-10"
        onMonthChange={() => {}}
        today="2026-10-27"
      />,
    );

    expect(html).toContain("Calendar");
    expect(html).toContain("Oct 2026");
    expect(html).toContain("Season ends");
    expect(html).toContain("Ride a century.");
    expect(html).toContain("Block starts · Base");
    expect(html).toContain("Morning ride");
    expect(html).toContain("25.0 km");
    expect(html).toContain("Club ride");
    expect(html).toContain("TSS 80");
    expect(html).toContain("Tempo ride");
    expect(html).toContain("75 min");
    expect(html).toContain("Rest");
  });

  it("bounds the month picker to the data range", () => {
    const html = renderToStaticMarkup(
      <CalendarView
        data={data}
        month="2026-10"
        onMonthChange={() => {}}
        today="2026-10-27"
      />,
    );

    expect(html).toContain('min="2026-10"');
    expect(html).toContain('max="2026-12"');
    expect(html).toContain("Showing");
    expect(html).toContain("disabled");
  });

  it("shows a recorded activity's full details in the dialog", () => {
    const html = renderToStaticMarkup(
      <CalendarEntryDialog
        selection={{ kind: "activity", activity: recorded }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Morning ride");
    expect(html).toContain("25.00 km");
    expect(html).toContain(
      "This ride supported the week&#x27;s aerobic focus.",
    );
    expect(html).toContain("You:");
    expect(html).toContain("Felt strong.");
    expect(html).toContain("Coach:");
    expect(html).toContain("Nice steady effort.");
    expect(html).toContain('data-testid="activity-map"');
  });

  it("shows a planned workout's details in the dialog", () => {
    const html = renderToStaticMarkup(
      <CalendarEntryDialog
        selection={{ kind: "session", session: workout }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Tempo ride");
    expect(html).toContain("75 min");
    expect(html).toContain("Three blocks at tempo.");
    expect(html).toContain("Estimated TSS");
  });
});
