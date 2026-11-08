import { describe, expect, it } from "bun:test";
import {
  formatActivitySummary,
  formatBlockPlan,
  formatDayPlan,
  formatLaps,
  formatPlanContext,
  formatSeasonPlan,
  formatWeekPlan,
  summarizeLaps,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";

const activity: RecentActivityContext = {
  summary: {
    id: 42,
    name: "Strength training",
    type: "cardio",
    startDate: "2026-10-22T17:00:00Z",
    distance: 0,
    movingTime: 2400,
    elapsedTime: 2400,
    totalElevationGain: 0,
  },
  analysis: "A short strength session recorded as cardio.",
};

function input(overrides: Partial<PlanContextInput> = {}): PlanContextInput {
  return {
    athleteAnswers: [],
    recentActivities: [activity],
    today: "2026-10-22",
    ...overrides,
  };
}

describe("formatPlanContext", () => {
  it("lists the athlete's upcoming goals and events", () => {
    const text = formatPlanContext(
      input({
        events: [
          {
            startDate: "2026-10-20",
            endDate: null,
            title: "Past race",
            kind: "race",
          },
          {
            startDate: "2027-03-14",
            endDate: null,
            title: "Oslo Marathon",
            kind: "race",
          },
          {
            startDate: "2026-10-23",
            endDate: "2026-10-25",
            title: "Camp",
            kind: "trip",
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("Dated goals and events the athlete stated:");
    expect(text).toContain("- 2027-03-14 (race): Oslo Marathon");
    expect(text).toContain("- 2026-10-23 → 2026-10-25 (trip): Camp");
    expect(text).not.toContain("Past race");
  });

  it("attaches a comment to the activity it describes", () => {
    const lines = formatPlanContext(
      input({
        activityComments: [
          {
            activityId: "42",
            comment: "Goblet squats, glute bridges, and planks.",
          },
        ],
      }),
    );
    const text = lines.join("\n");

    expect(text).toContain(
      "Athlete comment about this same activity (not an additional session): Goblet squats",
    );
    expect(text).not.toContain("Activity comments:");
  });

  it("includes the weekly note and the coach's reply to it", () => {
    const text = formatPlanContext(
      input({
        weeklyNote: "I can only train before work this week.",
        weeklyNoteReply: "Then keep the weekday sessions short and easy.",
      }),
    ).join("\n");

    expect(text).toContain(
      "Weekly note for the week starting 2026-10-19 (2026-10-19 → 2026-10-25):\nI can only train before work this week.",
    );
    expect(text).toContain(
      "Coach reply to the weekly note:\nThen keep the weekday sessions short and easy.",
    );
    expect(text).toContain(
      "A weekly note is normally scoped to the week it was written for.",
    );
  });

  it("includes the athlete's FTP and recorded power", () => {
    const text = formatPlanContext(
      input({
        athleteFtpWatts: 250,
        recentActivities: [
          {
            ...activity,
            summary: {
              ...activity.summary,
              normalizedPower: 200,
              averagePower: 195,
            },
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Athlete FTP: 250 W (the latest FTP the athlete stated or the coach estimated as of today)",
    );
    expect(text).toContain("NP 200 W (average 195 W)");
  });

  it("includes average pace or speed in recent workouts", () => {
    const run = {
      ...activity,
      summary: {
        ...activity.summary,
        type: "running",
        distance: 5000,
        movingTime: 1500,
        elapsedTime: 1600,
      },
    };
    const runText = formatPlanContext(input({ recentActivities: [run] })).join(
      "\n",
    );
    expect(runText).toContain("5.00 km, 5:00 /km, 25:00 moving");

    const ride = {
      ...activity,
      summary: {
        ...activity.summary,
        type: "road_biking",
        distance: 20000,
        movingTime: 2400,
        elapsedTime: 2600,
      },
    };
    const rideText = formatPlanContext(
      input({ recentActivities: [ride] }),
    ).join("\n");
    expect(rideText).toContain("20.00 km, 30.0 km/h, 40:00 moving");
  });

  const laps = [
    {
      index: 1,
      type: "active",
      movingTime: 600,
      distance: 3050,
      averagePower: 180,
      maxPower: 240,
      averageSpeed: 7.5,
      averageHeartRate: 135,
      maxHeartRate: 142,
      averageCadence: 88,
      totalElevationGain: 12,
    },
    { index: 2, type: "rest", movingTime: 120, averageHeartRate: 110 },
  ];

  it("lists each recorded lap with its averages", () => {
    const lines = formatActivitySummary(
      {
        ...activity.summary,
        type: "road_biking",
        laps,
      },
      100,
    );

    expect(lines).toContain(
      "- Lap 1 (active): 10:00, 3.05 km, avg 180 W, max 240 W, 27.0 km/h, avg 135 bpm, max 142 bpm, 88 rpm, 12 m climb",
    );
    expect(lines).toContain("- Lap 2 (rest): 2:00, avg 110 bpm");
  });

  it("summarises laps compactly in the plan context", () => {
    const ride = {
      ...activity,
      summary: { ...activity.summary, type: "road_biking", laps },
    };
    const text = formatPlanContext(input({ recentActivities: [ride] })).join(
      "\n",
    );

    expect(text).toContain(
      "Laps: 2 recorded, lap avg power 180 W, lap avg HR 110–135 bpm",
    );
  });

  it("ignores a single lap as if no laps were recorded", () => {
    const single = [
      {
        index: 1,
        movingTime: 2400,
        distance: 20000,
        averagePower: 200,
        averageHeartRate: 140,
      },
    ];
    const lines = formatActivitySummary(
      { ...activity.summary, type: "road_biking", laps: single },
      0,
    );
    expect(lines.join("\n")).not.toContain("Recorded laps");

    const ride = {
      ...activity,
      summary: { ...activity.summary, type: "road_biking", laps: single },
    };
    const text = formatPlanContext(input({ recentActivities: [ride] })).join(
      "\n",
    );
    expect(text).not.toContain("Laps:");
  });

  it("bounds the lap table and reports how many were recorded", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      index: index + 1,
      movingTime: 60,
    }));

    const lines = formatLaps(many, "cycling");

    expect(lines.filter((line) => line.startsWith("- Lap "))).toHaveLength(40);
    expect(lines).toContain("(40 of 45 recorded laps shown.)");
    expect(summarizeLaps(many)).toBe("45 recorded");
  });

  it("dates the profile so an undated weight is not read as today's", () => {
    const text = formatPlanContext(
      input({
        athleteAnswers: [
          {
            prompt: "Health goals?",
            answer: "I am 89,5 kg and 24,5 % body fat.",
            skipped: false,
            answeredAt: new Date("2026-10-20T08:00:00Z"),
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("Athlete profile (answers last saved 2026-10-20):");
    expect(text).toContain("I am 89,5 kg and 24,5 % body fat.");
  });

  it("includes the stored body weight and body-fat history", () => {
    const text = formatPlanContext(
      input({
        bodyHistory: {
          weight: [
            { date: "2026-10-20", value: 90, source: "user" },
            { date: "2026-10-22", value: 89.5, source: "coach" },
          ],
          bodyFat: [{ date: "2026-10-20", value: 24.5, source: "garmin" }],
        },
      }),
    ).join("\n");

    expect(text).toContain(
      'Body weight history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
    );
    expect(text).toContain("- 2026-10-20: 90.0 kg (user)");
    expect(text).toContain("- 2026-10-22: 89.5 kg (coach)");
    expect(text).toContain("- 2026-10-20: 24.5 % (garmin)");
  });

  it("omits a body history that has no measurements", () => {
    const text = formatPlanContext(
      input({ bodyHistory: { weight: [], bodyFat: [] } }),
    ).join("\n");

    expect(text).not.toContain("Body weight history");
    expect(text).not.toContain("Body fat history");
  });

  it("includes the diet goal and earlier calorie targets", () => {
    const text = formatPlanContext(
      input({
        dietGoal: {
          goal: "Lose 3 kg by March",
          goalWeightKg: 80,
          goalBodyFatPercent: 15,
          goalDate: "2027-03-01",
          goalMissReason: "The brevet build needs full fuelling.",
          assessment: "The trend is on target.",
        },
        calorieHistory: [
          { date: "2026-10-22", caloriesKcal: 2400 },
          { date: "2026-10-21", caloriesKcal: 2350 },
        ],
      }),
    ).join("\n");

    expect(text).toContain("Diet goal: Lose 3 kg by March");
    expect(text).toContain(
      "Diet goal target: 80.0 kg, 15.0 % body fat, by 2027-03-01.",
    );
    expect(text).toContain(
      "Diet goal trade-off: The brevet build needs full fuelling.",
    );
    expect(text).toContain("Diet assessment: The trend is on target.");
    expect(text).toContain("Earlier daily calorie targets");
    expect(text).toContain("- 2026-10-22: 2400 kcal");
  });

  it("shows a legacy body-fat goal in the prompt target line", () => {
    const text = formatPlanContext(
      input({
        dietGoal: {
          goal: "Lose fat gradually toward 15% body fat",
          assessment: "On target.",
        },
      }),
    ).join("\n");

    expect(text).toContain("Diet goal target: 15.0 % body fat.");
  });

  it("says whether the diet goal was stated and whether diet advice is on", () => {
    const stated = formatPlanContext(
      input({
        dietAdvice: true,
        dietGoal: {
          goal: "Lose 3 kg by March",
          goalProvided: true,
          assessment: "On target.",
        },
      }),
    ).join("\n");
    expect(stated).toContain("Diet goal status: stated by the athlete.");
    expect(stated).toContain("Diet advice: enabled.");

    const fallback = formatPlanContext(
      input({
        dietAdvice: false,
        dietGoal: {
          goal: "Maintain current weight",
          assessment: "Holding.",
        },
      }),
    ).join("\n");
    expect(fallback).toContain(
      "Diet goal status: default because the athlete stated none.",
    );
    expect(fallback).toContain("Diet advice: disabled.");
  });

  it("includes the stored daily health and recovery summary", () => {
    const text = formatPlanContext(
      input({
        dailyHealth: [
          { metric: "resting_heart_rate", date: "2026-10-21", value: 54 },
          { metric: "resting_heart_rate", date: "2026-10-22", value: 52 },
          { metric: "hrv", date: "2026-10-22", value: 48 },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Daily health and recovery (from Garmin, 14 days through 2026-10-22):",
    );
    expect(text).toContain("Resting heart rate: latest 52 bpm on 2026-10-22");
    expect(text).toContain("Overnight HRV: latest 48 ms on 2026-10-22");
  });

  it("renders recorded strength sets in a recent activity", () => {
    const text = formatPlanContext(
      input({
        recentActivities: [
          {
            ...activity,
            summary: {
              ...activity.summary,
              strengthSets: [
                {
                  setType: "active",
                  repetitions: 10,
                  weightKg: 12,
                  exercises: [{ category: "SQUAT", name: "GOBLET_SQUAT" }],
                },
              ],
            },
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("Strength sets: Goblet squat: 1 × 10 reps at 12 kg");
  });

  it("includes the coach's reply to an activity comment", () => {
    const text = formatPlanContext(
      input({
        recentActivities: [
          {
            ...activity,
            coachReply: "Keep the next run just as relaxed.",
          },
        ],
        activityComments: [
          { activityId: "42", comment: "Felt easy throughout." },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Coach reply to that comment: Keep the next run just as relaxed.",
    );
  });

  it("includes completed week and block reviews with athlete feedback", () => {
    const text = formatPlanContext(
      input({
        periodReviews: [
          {
            kind: "week",
            title: "Week starting 2026-10-13",
            startDate: "2026-10-13",
            endDate: "2026-10-19",
            summary: "A consistent week of easy work.",
            comment: "I felt strong.",
            reply: "Keep the momentum.",
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Completed week: Week starting 2026-10-13 (2026-10-13 → 2026-10-19)",
    );
    expect(text).toContain("Coach summary: A consistent week of easy work.");
    expect(text).toContain("Athlete comment: I felt strong.");
    expect(text).toContain("Coach reply: Keep the momentum.");
  });

  it("renders the forecast with units and the location name", () => {
    const text = formatPlanContext(
      input({
        locationName: "Oslo, Norway",
        forecast: [
          {
            date: "2026-10-25",
            icon: "sun",
            temperatureMaxC: 12.4,
            temperatureMinC: 4.2,
            windMaxMs: 4.6,
            gustMaxMs: 8.2,
            precipitationMm: 0,
            sunrise: "07:45",
            sunset: "16:30",
          },
          {
            date: "2026-10-26",
            icon: "rain",
            temperatureMaxC: 9.1,
            temperatureMinC: 3.8,
            windMaxMs: 6.2,
            gustMaxMs: 11.4,
            precipitationMm: 3.6,
            sunrise: "07:47",
            sunset: "16:27",
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Combined daily weather and daylight forecast for Oslo, Norway",
    );
    expect(text).toContain("Temperatures are in °C");
    expect(text).toContain("sunrise and sunset are local clock times");
    expect(text).toContain(
      "- 2026-10-25: Sunny (sun), 4–12 °C, wind up to 5 m/s, gusts up to 8 m/s, 0.0 mm precipitation, sunrise 07:45, sunset 16:30",
    );
    expect(text).toContain(
      "- 2026-10-26: Rain (rain), 4–9 °C, wind up to 6 m/s, gusts up to 11 m/s, 3.6 mm precipitation, sunrise 07:47, sunset 16:27",
    );
  });

  it("omits daylight times when the forecast has none", () => {
    const text = formatPlanContext(
      input({
        forecast: [
          {
            date: "2026-10-25",
            icon: "sun",
            temperatureMaxC: 12.4,
            temperatureMinC: 4.2,
            windMaxMs: 4.6,
            gustMaxMs: 8.2,
            precipitationMm: 0,
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("0.0 mm precipitation");
    expect(text).not.toMatch(/sunrise \d{2}:\d{2}/);
    expect(text).not.toMatch(/sunset \d{2}:\d{2}/);
  });

  it("keeps comments for unlisted activities clearly separate", () => {
    const text = formatPlanContext(
      input({
        activityComments: [{ activityId: "99", comment: "An older session." }],
      }),
    ).join("\n");

    expect(text).toContain("Activity comments:");
    expect(text).toContain(
      "Each comment describes the activity with the matching ID. It is not a separate activity or extra training.",
    );
    expect(text).toContain("- Activity 99: An older session.");
  });

  it("renders stored diet progress at every plan level", () => {
    const season = formatSeasonPlan({
      goal: "Ride a century",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build endurance.",
      dietProgress: {
        targetWeightKg: 78,
        targetBodyFatPercent: 15,
        note: "Reach race weight by the season end.",
      },
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-11-29",
          weekCount: 6,
          dietProgress: {
            targetWeightKg: 80,
            targetBodyFatPercent: null,
            note: "Hold weight while building volume.",
          },
        },
      ],
    });
    expect(season).toContain(
      "Diet progress by the end of the season: 78.0 kg and 15.0 % body fat. Reach race weight by the season end.",
    );
    expect(season).toContain(
      "Diet progress by the end of this block: 80.0 kg. Hold weight while building volume.",
    );

    const block = formatBlockPlan({
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-19",
      endDate: "2026-11-29",
      rationale: "Build endurance.",
      dietProgress: {
        targetWeightKg: 80,
        targetBodyFatPercent: null,
        note: "Hold weight while building volume.",
      },
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Easy aerobic",
          targetLoad: "Easy",
          dietProgress: {
            targetWeightKg: null,
            targetBodyFatPercent: null,
            note: "Hold weight through the week.",
          },
        },
      ],
    });
    expect(block).toContain(
      "Diet progress by the end of the block: 80.0 kg. Hold weight while building volume.",
    );
    expect(block).toContain(
      "diet progress by the end of the week: no numeric target. Hold weight through the week.",
    );

    const week = formatWeekPlan({
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      dietProgress: {
        targetWeightKg: 80.5,
        targetBodyFatPercent: null,
        note: "Hold weight through the week.",
      },
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${19 + index}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Easy aerobic work.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    });
    expect(week).toContain(
      "Diet progress by the end of the week: 80.5 kg. Hold weight through the week.",
    );
  });

  it("renders the power targets of a structured bike workout", () => {
    const text = formatWeekPlan({
      startDate: "2026-10-19",
      focus: "Threshold",
      rationale: "Build power.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${19 + index}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Indoor trainer ride.",
        durationMinutes: 30,
        intensity: "moderate" as const,
        status: "planned" as const,
        ...(index === 2
          ? {
              outdoor: false,
              canBeOutdoor: false,
              bikeWorkout: {
                ftpWatts: 220,
                intervals: [
                  { durationSeconds: 600, powerPercent: 55 },
                  { durationSeconds: 480, powerPercent: 90 },
                ],
              },
            }
          : {}),
      })),
    });

    expect(text).toContain(
      "power targets at FTP 220 W: 600s at 55% FTP, 480s at 90% FTP",
    );
    expect(text).toContain("Indoor trainer ride.");
  });

  it("renders each week session's projected form", () => {
    const text = formatWeekPlan({
      startDate: "2026-10-19",
      focus: "Build",
      rationale: "Build load.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${19 + index}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Endurance work.",
        durationMinutes: 60,
        intensity: "moderate" as const,
        status: "planned" as const,
        estimatedTss: 60,
        ...(index === 0
          ? { trainingLoad: { tss: 60, atl: 20, ctl: 45, tsb: -25 } }
          : {}),
      })),
    });

    expect(text).toContain("ATL 20 · CTL 45 · TSB -25 · Productive");
  });

  it("carries the current form into the shared plan context", () => {
    const text = formatPlanContext(
      input({
        currentForm: { tss: 60, atl: 65, ctl: 45, tsb: -20 },
      }),
    ).join("\n");

    expect(text).toContain(
      "Current form (2026-10-22): ATL 65 · CTL 45 · TSB -20 · Productive.",
    );
  });

  it("omits the current form when no snapshot is available", () => {
    const text = formatPlanContext(input()).join("\n");

    expect(text).not.toContain("Current form (");
  });

  it("renders the recent meals and completed-week summaries", () => {
    const text = formatPlanContext(
      input({
        diet: {
          meals: [
            {
              eatenDate: "2026-10-22",
              eatenTime: "08:15",
              description: "Porridge with berries",
              analysis: {
                meal: "A bowl of porridge with berries",
                carbsGrams: 62,
                proteinGrams: 18,
                fatGrams: 9,
                caloriesKcal: 410,
                dietFit: "Good fuelling before a long ride.",
              },
              analysisError: null,
            },
          ],
          weeks: [
            {
              weekStart: "2026-10-12",
              meals: 16,
              daysLogged: 6,
              nutritionDays: 6,
              carbsGramsPerDay: 210,
              proteinGramsPerDay: 120,
              fatGramsPerDay: 70,
              caloriesKcalPerDay: 2400,
            },
          ],
        },
      }),
    ).join("\n");

    expect(text).toContain("Recent meals (last 7 days, most recent first):");
    expect(text).toContain(
      '2026-10-22 08:15 — Athlete: "Porridge with berries"',
    );
    expect(text).toContain("62 g carbs, 18 g protein, 9 g fat, 410 kcal");
    expect(text).toContain("Good fuelling before a long ride.");
    expect(text).toContain(
      "Week starting 2026-10-12: 16 meals over 6 days; averaged over 6 logged days: 210 g carbs, 120 g protein, 70 g fat, 2400 kcal per day.",
    );
  });

  it("marks a meal the coach could not analyse", () => {
    const text = formatPlanContext(
      input({
        diet: {
          meals: [
            {
              eatenDate: "2026-10-22",
              eatenTime: "08:15",
              description: "Toast",
              analysis: null,
              analysisError: "No model configured.",
            },
          ],
          weeks: [],
        },
      }),
    ).join("\n");

    expect(text).toContain("Coach analysis unavailable (No model configured.)");
  });

  it("omits the food log when diet advice is off or nothing is logged", () => {
    expect(formatPlanContext(input()).join("\n")).not.toContain("Food log");
    expect(
      formatPlanContext(input({ diet: { meals: [], weeks: [] } })).join("\n"),
    ).not.toContain("Food log");
  });
});

describe("formatDayPlan", () => {
  it("renders the day's projected training load and form", () => {
    const text = formatDayPlan({
      date: "2026-10-22",
      type: "workout",
      title: "Endurance ride",
      description: "Steady aerobic work.",
      durationMinutes: 90,
      intensity: "moderate",
      alternatives: [],
      rationale: "Aerobic base.",
      optional: false,
      status: "planned",
      estimatedTss: 64,
      trainingLoad: { tss: 64, atl: 18, ctl: 40, tsb: -22 },
    });

    expect(text).toContain("Estimated TSS: 64");
    expect(text).toContain(
      "Projected load: ATL 18 · CTL 40 · TSB -22 · Productive",
    );
  });

  it("omits the projected load when the day has no snapshot", () => {
    const text = formatDayPlan({
      date: "2026-10-22",
      type: "rest",
      title: "Rest",
      description: "Rest day.",
      durationMinutes: 0,
      intensity: "rest",
      alternatives: [],
      rationale: "Recovery.",
      optional: false,
      status: "rest",
    });

    expect(text).not.toContain("Projected load:");
  });
});
