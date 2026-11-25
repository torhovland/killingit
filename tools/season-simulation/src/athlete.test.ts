import { describe, expect, it } from "bun:test";
import type { WeekSession } from "@killingit/shared";
import { ATHLETE } from "./config.js";
import {
  buildSessionActivity,
  inferSport,
  isTrainingDay,
  plannedSessionTss,
} from "./athlete.js";
import {
  advanceAthleteState,
  advanceThroughDate,
  initialAthleteState,
} from "./progression.js";

function intensityFor(target: number, minutes: number): number {
  return Math.sqrt(target / (100 * (minutes / 60)));
}

function session(overrides: Partial<WeekSession> = {}): WeekSession {
  return {
    date: "2027-01-04",
    day: "Mon",
    type: "workout",
    title: "Bike: 3 x 12 min sweet spot",
    description: "Steady sweet-spot intervals on the trainer.",
    durationMinutes: 90,
    intensity: "moderate",
    status: "planned",
    estimatedTss: 80,
    ...overrides,
  };
}

describe("session planning", () => {
  it("infers the sport from the title", () => {
    expect(inferSport(session())).toBe("cycling");
    expect(inferSport(session({ title: "Easy run", description: "" }))).toBe(
      "running",
    );
    expect(
      inferSport(session({ title: "Strength", description: "Gym session" })),
    ).toBe("strength");
  });

  it("uses the coach's TSS and falls back to an intensity rate", () => {
    expect(plannedSessionTss(session())).toBe(80);
    expect(
      plannedSessionTss(
        session({ estimatedTss: undefined, intensity: "hard" }),
      ),
    ).toBe(128);
    expect(plannedSessionTss(session({ type: "rest" }))).toBe(0);
  });

  it("schedules alternate days globally", () => {
    expect(isTrainingDay("alternate-days", "2026-11-22", "2026-11-23")).toBe(
      true,
    );
    expect(isTrainingDay("alternate-days", "2026-11-22", "2026-11-24")).toBe(
      false,
    );
    expect(isTrainingDay("every-session", "2026-11-22", "2026-11-24")).toBe(
      true,
    );
  });
});

describe("activity generation", () => {
  it("records a cycling session at the target TSS", () => {
    const target = plannedSessionTss(session());
    const activity = buildSessionActivity({
      session: session(),
      capability: { ftpWatts: 250, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 1,
    });
    const intensity = intensityFor(target, 90);
    const power = activity.normalizedPower ?? 0;
    const tss = (activity.movingTime / 3600) * (power / 250) ** 2 * 100;
    expect(power).toBe(Math.round(250 * intensity));
    expect(tss).toBeCloseTo(target, 0);
  });

  it("records a cycling test at the modelled current capability", () => {
    const activity = buildSessionActivity({
      session: session({
        title: "FTP test",
        description: "Twenty-minute test inside an endurance ride.",
        durationMinutes: 60,
        estimatedTss: 40,
      }),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 3,
    });
    expect(activity.normalizedPower).toBe(252);
    expect(activity.analysis?.text).toContain("Test result: FTP 252 W");
  });

  it("recognises a test described inside a normal workout", () => {
    const activity = buildSessionActivity({
      session: session({
        title: "Endurance ride",
        description: "Include a 20-minute FTP test in the middle.",
        durationMinutes: 90,
        estimatedTss: 70,
      }),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 5,
    });
    expect(activity.analysis?.text).toContain("Test result: FTP 252 W");
  });

  it("leaves an ordinary workout without a test result", () => {
    const activity = buildSessionActivity({
      session: session(),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 6,
    });
    expect(activity.analysis?.text).not.toContain("Test result");
  });

  it("does not treat a passing mention of testing or a rehearsal as a test", () => {
    const intervals = buildSessionActivity({
      session: session({
        title: "Controlled half-marathon pace intervals",
        description:
          "Controlled repetitions develop sustainable running strength and test comfort near goal pace.",
        durationMinutes: 70,
        estimatedTss: 75,
      }),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 7,
    });
    expect(intervals.analysis?.text).not.toContain("Test result");

    const easy = buildSessionActivity({
      session: session({
        title: "Easy endurance ride",
        description:
          "Comfortable aerobic ride maintains frequency without compromising the key weekend rehearsal.",
        durationMinutes: 60,
        estimatedTss: 30,
      }),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 8,
    });
    expect(easy.normalizedPower).toBe(138);
    expect(easy.analysis?.text).not.toContain("Test result");
  });

  it("recognises a rehearsal named in a title", () => {
    const activity = buildSessionActivity({
      session: session({
        title: "Hilly gravel endurance rehearsal",
        description: "Practise race pacing and fuelling.",
        durationMinutes: 210,
        estimatedTss: 180,
      }),
      capability: { ftpWatts: 249, runThresholdSecPerKm: 325 },
      profile: ATHLETE,
      id: 9,
    });
    expect(activity.analysis?.text).toContain("Test result: FTP 249 W");
  });

  it("records a running threshold test at the modelled current pace", () => {
    const activity = buildSessionActivity({
      session: session({
        title: "Threshold run test",
        description: "A controlled 30-minute test.",
        durationMinutes: 60,
        estimatedTss: 40,
      }),
      capability: { ftpWatts: 252, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 4,
    });
    expect(activity.movingTime).toBe(3600);
    expect(activity.analysis?.text).toContain(
      "Test result: threshold pace 5:30 /km",
    );
  });

  it("records a run at the target pace and TSS", () => {
    const target = plannedSessionTss(session({ title: "Easy run" }));
    const activity = buildSessionActivity({
      session: session({
        title: "Easy run",
        description: "Easy aerobic running.",
        durationMinutes: 60,
      }),
      capability: { ftpWatts: 250, runThresholdSecPerKm: 330 },
      profile: ATHLETE,
      id: 2,
    });
    const intensity = intensityFor(target, 60);
    const pace = 330 / intensity;
    expect(activity.distance).toBe(Math.round((60 * 60 * 1000) / pace));
    expect(
      (activity.movingTime / 3600) * intensity * intensity * 100,
    ).toBeCloseTo(target, 0);
  });
});

describe("progression", () => {
  it("starts at the stated baseline", () => {
    const state = initialAthleteState(ATHLETE, "2026-11-22");
    expect(state.ftpWatts).toBe(180);
    expect(state.runThresholdSecPerKm).toBe(360);
  });

  it("regains the prior peak at full chronic load and never exceeds it", () => {
    const base = { date: "2026-11-22", ftpWatts: 0, runThresholdSecPerKm: 0 };
    const full = advanceAthleteState(
      { ...base, ctl: 55 },
      "2026-11-22",
      55,
      ATHLETE,
    );
    expect(full.ftpWatts).toBeCloseTo(285, 6);
    expect(full.runThresholdSecPerKm).toBeCloseTo(315, 6);
    const beyond = advanceAthleteState(
      { ...base, ctl: 100 },
      "2026-11-22",
      100,
      ATHLETE,
    );
    expect(beyond.ftpWatts).toBe(285);
  });

  it("advances rest days up to, but not including, the session day", () => {
    const base = initialAthleteState(ATHLETE, "2026-11-22");
    const monday = advanceThroughDate(base, "2026-11-23", ATHLETE);
    expect(monday.date).toBe("2026-11-22");
    const thursday = advanceThroughDate(
      { ...base, date: "2026-11-23" },
      "2026-11-26",
      ATHLETE,
    );
    expect(thursday.date).toBe("2026-11-25");
  });

  it("counts each training day as one chronic-load step", () => {
    let state = initialAthleteState(ATHLETE, "2026-11-22");
    for (const date of [
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]) {
      state = advanceAthleteState(state, date, 43, ATHLETE);
    }
    expect(state.ctl).toBeCloseTo(43 * (1 - (41 / 42) ** 7), 6);
  });

  it("moves slowly toward the peak across a season of training", () => {
    let state = initialAthleteState(ATHLETE, "2026-11-22");
    for (let day = 0; day < 280; day += 1) {
      state = advanceAthleteState(
        state,
        state.date,
        day % 2 === 0 ? 60 : 0,
        ATHLETE,
      );
    }
    expect(state.ctl).toBeGreaterThan(20);
    expect(state.ftpWatts).toBeGreaterThan(230);
    expect(state.ftpWatts).toBeLessThan(285);
  });
});
