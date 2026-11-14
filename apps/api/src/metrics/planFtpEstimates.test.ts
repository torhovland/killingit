import { describe, expect, it } from "bun:test";
import { makeDay, makePlan } from "../testFixtures/plan.js";
import { planFtpEstimates } from "./planFtpEstimates.js";

describe("planFtpEstimates", () => {
  it("stores one FTP point per planned day from today onward", () => {
    const plan = makePlan({ today: makeDay("2026-10-21") });
    const estimates = planFtpEstimates({
      ...plan,
      week: {
        ...plan.week,
        estimatedFtpWatts: 255,
        sessions: plan.week.sessions.map((session) =>
          session.date === "2026-10-22"
            ? { ...session, estimatedFtpWatts: 260 }
            : session,
        ),
      },
    });

    expect(estimates.map((entry) => entry.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(estimates.find((entry) => entry.date === "2026-10-21")?.watts).toBe(
      255,
    );
    expect(estimates.find((entry) => entry.date === "2026-10-22")?.watts).toBe(
      260,
    );
  });
});
