import { describe, expect, it } from "bun:test";
import {
  ATHLETE_METRICS_SYSTEM_PROMPT,
  buildAthleteMetricsPrompt,
  type AthleteMetricSource,
} from "./athleteMetricsPrompt.js";
import { GLOBAL_PROMPT_RULES } from "./promptRules.js";

const source: AthleteMetricSource = {
  profile: [
    {
      prompt: "Performance numbers?",
      answer: "I am 187 cm, 89,5 kg and 24,5 % body fat.",
      skipped: false,
    },
  ],
  profileSavedAt: "2026-10-25",
  entries: [
    {
      date: "2026-10-22",
      label: "activity comment",
      text: "Weighed 88.4 kg this morning.",
    },
    { date: "2026-10-20", label: "weekly note", text: "Felt flat all week." },
  ],
};

describe("athlete metric prompts", () => {
  it("asks the coach, not a phrase list, to read the measurements", () => {
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain(GLOBAL_PROMPT_RULES);
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain(
      "report the measurements they state about themselves",
    );
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain(
      "never turn a goal into a measurement",
    );
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain("typical best");
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain("kilograms");
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain(
      "percentage of body weight",
    );
  });

  it("names every field in the JSON contract", () => {
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"statements"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"date"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"thresholds"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"sport"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"measure"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"weightKg"');
    expect(ATHLETE_METRICS_SYSTEM_PROMPT).toContain('"bodyFatPercent"');
  });

  it("dates the profile and each statement it sends", () => {
    const prompt = buildAthleteMetricsPrompt(source);

    expect(prompt).toContain(
      "Athlete profile (answers last saved 2026-10-25):",
    );
    expect(prompt).toContain("89,5 kg and 24,5 % body fat");
    expect(prompt).toContain(
      "- 2026-10-22 (activity comment): Weighed 88.4 kg this morning.",
    );
    expect(prompt).toContain("- 2026-10-20 (weekly note): Felt flat all week.");
  });

  it("says so when the athlete wrote nothing else", () => {
    const prompt = buildAthleteMetricsPrompt({
      profile: [],
      profileSavedAt: null,
      entries: [],
    });

    expect(prompt).toContain("Athlete profile:");
    expect(prompt).toContain(
      "The athlete has written no comments, notes, or manual entries.",
    );
  });
});
