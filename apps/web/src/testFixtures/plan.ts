import type { CoachPlan, PlanPending } from "@killingit/shared";

/** The bullet the plan headings separate their parts with. */
export const BULLET = '<span class="mx-[0.75em]">·</span>';

/** No plan level is waiting to be replaced, for view tests without a refresh. */
export const noPending: PlanPending = {
  initial: false,
  day: false,
  week: false,
  block: false,
  tomorrow: false,
  nextWeek: false,
  nextBlock: false,
  dietProgress: false,
};

/** The plan fixture every CoachPlanView test builds on. */
export const plan: CoachPlan = {
  season: {
    goal: "Sub-4-hour marathon",
    startDate: "2026-10-21",
    endDate: "2027-04-01",
    rationale: "Build a strong aerobic base before marathon-specific work.",
    goals: [
      {
        title: "Sub-4-hour marathon",
        date: "2027-04-01",
        priority: "A",
        target: "Under 4:00",
      },
    ],
    blocks: [
      {
        name: "Base",
        focus: "Aerobic endurance",
        startDate: "2026-10-21",
        endDate: "2026-12-01",
        weekCount: 6,
        subGoals: [
          {
            goalTitle: "Sub-4-hour marathon",
            goalDate: "2027-04-01",
            role: "build",
            target: "Six consistent weeks of aerobic running",
            byDate: "2026-11-30",
          },
        ],
      },
    ],
  },
  block: {
    name: "Base",
    focus: "Aerobic endurance",
    rationale: "Establish consistent aerobic volume.",
    startDate: "2026-10-21",
    endDate: "2026-12-01",
    subGoals: [
      {
        goalTitle: "Sub-4-hour marathon",
        goalDate: "2027-04-01",
        role: "build",
        target: "Six consistent weeks of aerobic running",
        byDate: "2026-11-30",
      },
    ],
    weeks: [
      {
        number: 1,
        startDate: "2026-10-19",
        focus: "Aerobic base",
        targetLoad: "Easy",
      },
    ],
  },
  week: {
    startDate: "2026-10-19",
    focus: "Aerobic base",
    rationale: "Keep the week easy and consistent.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(19 + index)}`,
      day: "Monday",
      type: index === 6 ? "rest" : "workout",
      title:
        index === 0
          ? "Morning Run"
          : index === 1
            ? "No activity recorded"
            : index === 2
              ? "Easy run"
              : `Session ${index + 1}`,
      description:
        index === 0
          ? "Completed: running · 10.00 km · 45 min"
          : index === 1
            ? "The athlete did not record a workout for this day."
            : "Easy aerobic work.",
      durationMinutes: index === 1 ? 0 : 45,
      intensity: index === 6 ? "rest" : "easy",
      status:
        index === 0
          ? "completed"
          : index === 1
            ? "missed"
            : index === 6
              ? "rest"
              : "planned",
    })),
  },
  today: {
    date: "2026-10-21",
    type: "workout",
    title: "Easy run",
    description: "45 minutes at conversational pace.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: ["Cross-train for 45 minutes."],
    rationale: "Easy aerobic work supports recovery.",
    optional: false,
    optionalRationale:
      "This easy run builds the aerobic durability your sub-4-hour marathon needs. Skipping it would leave you underprepared for the Sunday long run and slow the base build.",
    status: "planned",
  },
  tomorrow: {
    date: "2026-10-22",
    type: "workout",
    title: "Easy run",
    description: "40 minutes easy.",
    durationMinutes: 40,
    intensity: "easy",
    alternatives: [],
    rationale: "Keep the aerobic week consistent.",
    optional: true,
    optionalRationale:
      "This short recovery run adds easy volume toward the marathon goal. Skipping it costs little today because the hard work this week is already done.",
    status: "planned",
  },
  nextWeek: null,
  nextBlock: null,
};
