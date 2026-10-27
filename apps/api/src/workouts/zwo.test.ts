import { describe, expect, it } from "bun:test";
import { buildZwoWorkout, zwoFilename } from "./zwo.js";

const workout = {
  ftpWatts: 250,
  intervals: [
    { durationSeconds: 600, powerPercent: 50 },
    { durationSeconds: 480, powerPercent: 90 },
    { durationSeconds: 300, powerPercent: 45 },
  ],
};

describe("buildZwoWorkout", () => {
  it("writes the session metadata and one steady-state step per interval", () => {
    const zwo = buildZwoWorkout({
      title: "Sweet spot intervals",
      description: "Three blocks on the trainer.",
      workout,
    });

    expect(zwo).toContain("<name>Sweet spot intervals</name>");
    expect(zwo).toContain("<sportType>bike</sportType>");
    expect(zwo).toContain('<SteadyState Duration="600" Power="0.5"/>');
    expect(zwo).toContain('<SteadyState Duration="480" Power="0.9"/>');
    expect(zwo).toContain('<SteadyState Duration="300" Power="0.45"/>');
    expect(zwo.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(zwo.trimEnd().endsWith("</workout_file>")).toBe(true);
  });

  it("escapes XML in the title and description", () => {
    const zwo = buildZwoWorkout({
      title: 'Hard & fast <"intervals">',
      description: "Don't skip & recover.",
      workout,
    });

    expect(zwo).toContain(
      "<name>Hard &amp; fast &lt;&quot;intervals&quot;&gt;</name>",
    );
    expect(zwo).toContain(
      "<description>Don&apos;t skip &amp; recover.</description>",
    );
  });
});

describe("zwoFilename", () => {
  it("uses the date and a slug of the title", () => {
    expect(zwoFilename("2026-10-21", "Sweet Spot: 3 × 8 min")).toBe(
      "2026-10-21-sweet-spot-3-8-min.zwo",
    );
  });

  it("falls back to a generic name when the title has no letters", () => {
    expect(zwoFilename("2026-10-21", "→")).toBe("2026-10-21-workout.zwo");
  });

  it("strips accents and trailing separators", () => {
    expect(zwoFilename("2026-10-21", "Norsk økt — terskel")).toBe(
      "2026-10-21-norsk-kt-terskel.zwo",
    );
  });
});
